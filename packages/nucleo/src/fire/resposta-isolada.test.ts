import fc from 'fast-check'
import { describe, expect, it } from 'vitest'
import { desembrulhar } from '../base/resultado'
import { somarDias, type Dias, type Instante } from '../base/tempo'
import { TECNICAS_TODAS_LIGADAS } from '../catalogo/tecnicas'
import { DIRECOES, type Direcao, type IdGrupo, type IdItem } from '../catalogo/tipos'
import { montarGrafo } from '../grafo/grafo'
import { topicoDeGrupo, topicoDeItem, type IdTopico } from '../grafo/topico'
import { atualizarAcuracia } from '../memoria/acuracia'
import { estadoMemoriaInicial, type EstadoMemoria } from '../memoria/estado-memoria'
import { aplicarRepeticao } from '../memoria/modelo'
import { PARAMETROS_PADRAO as P, resolverParametros, type Parametros } from '../memoria/parametros'
import { velocidade } from '../memoria/velocidade'
import {
  propagarCredito,
  propagarPenalidade,
  type ContextoDePropagacao,
  type Memorias,
  type ResultadoDePenalidade,
} from './propagacao'
import { aplicarRespostaIsolada, type RespostaIsolada } from './resposta-isolada'

const T0 = 1_700_000_000_000 as Instante
const DEVIDO = somarDias(T0, 2.2 as Dias)
const item = (id: string): IdTopico => topicoDeItem(id as IdItem).id
const grupo = (id: string): IdTopico => topicoDeGrupo(id as IdGrupo).id
const [A, B, C, D, F, G] = [item('a'), item('b'), item('c'), item('d'), grupo('grupo-f'), grupo('grupo-g')] as const
const TOPICOS = [A, B, C, D, F, G]

// F encompassa a, b, c e d com peso 1; G encompassa a com peso 1 e d com peso 0,5. a tem dois ascendentes e nenhum
// descendente; F tem descendentes e nenhum ascendente.
const grafo = desembrulhar(
  montarGrafo(
    [
      ...['a', 'b', 'c', 'd'].map((id) => topicoDeItem(id as IdItem)),
      ...['grupo-f', 'grupo-g'].map((id) => topicoDeGrupo(id as IdGrupo)),
    ],
    [
      ...[A, B, C, D].map((para) => ({ de: F, para, peso: 1 })),
      { de: G, para: A, peso: 1 },
      { de: G, para: D, peso: 0.5 },
    ],
  ),
)

// Os fatores que a resposta isolada lê, ou que uma troca por engano leria, com valores que não coincidem entre si: nos
// padrões, os três valem 0,5, e uma fórmula que lesse um no lugar do outro passaria.
const AJUSTADOS = desembrulhar(
  resolverParametros({ fatorMultiplaEscolha: 0.4, fatorExposicaoDistrator: 0.7, forcaAcuraciaImplicita: 0.3 }),
)

// Duas repetições e memória 1 no instante zero, como nos testes da tarefa de grupo: no dia devido, fator de precocidade
// 1, e com a acurácia neutra e dificuldade 2 a velocidade vale 1, então cada repetição soma o próprio delta.
const pronto = (campos: Partial<EstadoMemoria> = {}): EstadoMemoria => ({
  ...estadoMemoriaInicial(P.acuraciaNeutra),
  numRepeticoes: 2,
  memoriaBase: 1,
  ultimaRepEm: T0,
  ultimaTentativaEm: T0,
  ...campos,
})
const todos = (): Memorias => new Map(TOPICOS.map((t) => [t, pronto()]))
const contexto = (parametros: Parametros = AJUSTADOS, fire = true): ContextoDePropagacao => ({
  grafo,
  parametros,
  tecnicas: { ...TECNICAS_TODAS_LIGADAS, fire },
  agora: DEVIDO,
  dificuldade: () => 2,
})
const resposta = (
  alvo: IdTopico,
  deltaBruto: number,
  direcao: Direcao = 'recordar',
  elegiveis: readonly IdTopico[] = TOPICOS,
): RespostaIsolada => ({ alvo, deltaBruto, direcao, elegiveis: new Set(elegiveis) })
const numRep = (m: Memorias, t: IdTopico): number | undefined => m.get(t)?.numRepeticoes

/**
 * A composição escrita sem o atalho da função: repetição explícita com a velocidade de antes, acurácia, e a propagação
 * sempre chamada, tenha o alvo aresta ou não. É o que a função tem de dar.
 */
function composicao(ctx: ContextoDePropagacao, memorias: Memorias, r: RespostaIsolada): ResultadoDePenalidade {
  const e = memorias.get(r.alvo)
  if (e === undefined) return { memorias, culpa: new Set(), condicionaisPenalizados: [] }
  const p = ctx.parametros
  const delta = r.deltaBruto * (r.direcao === 'recordar' ? 1 : p.fatorMultiplaEscolha)
  const v = velocidade(e, ctx.dificuldade(r.alvo), p, ctx.tecnicas)
  const repetido = aplicarRepeticao(e, { deltaBruto: delta, agora: ctx.agora, velocidade: v, origem: 'explicita' }, p)
  const depois = new Map(memorias).set(r.alvo, atualizarAcuracia(repetido, r.deltaBruto > 0, 1, p, r.direcao))
  if (r.deltaBruto > 0) {
    const finais = propagarCredito(ctx, depois, { origem: r.alvo, deltaBruto: delta, exposicao: () => 1 })
    return { memorias: finais, culpa: new Set(), condicionaisPenalizados: [] }
  }
  return propagarPenalidade(ctx, depois, { origem: r.alvo, deltaBruto: delta, elegiveis: r.elegiveis })
}

describe('aplicarRespostaIsolada', () => {
  it('dá ao alvo o rawDelta vezes fatorMultiplaEscolha na múltipla escolha, e cheio no texto digitado', () => {
    const ctx = contexto()
    expect(numRep(aplicarRespostaIsolada(ctx, todos(), resposta(A, 1, 'reconhecer')).memorias, A)).toBeCloseTo(2.4, 9)
    expect(numRep(aplicarRespostaIsolada(ctx, todos(), resposta(A, 1, 'produzir')).memorias, A)).toBeCloseTo(2.4, 9)
    expect(numRep(aplicarRespostaIsolada(ctx, todos(), resposta(A, 1, 'recordar')).memorias, A)).toBeCloseTo(3, 9)
    expect(numRep(aplicarRespostaIsolada(ctx, todos(), resposta(A, -1, 'produzir')).memorias, A)).toBeCloseTo(1.6, 9)
  })

  it('repete o alvo com a velocidade de antes da resposta e só depois move a acurácia geral e a da direção', () => {
    // Acurácia 0,6 dá velocidade abaixo de 1, e o acerto a sobe: com a velocidade de depois, a repetição seria outra.
    const e: EstadoMemoria = { ...pronto(), ...estadoMemoriaInicial(0.6), numRepeticoes: 2, memoriaBase: 1 }
    const memorias = new Map(todos()).set(A, e)
    const ctx = contexto()
    const v = velocidade(e, 2, AJUSTADOS, ctx.tecnicas)
    const vDepois = velocidade(atualizarAcuracia(e, true, 1, AJUSTADOS, 'reconhecer'), 2, AJUSTADOS, ctx.tecnicas)
    expect(vDepois).not.toBeCloseTo(v, 6)
    const repetido = aplicarRepeticao(
      e,
      { deltaBruto: 0.4, agora: DEVIDO, velocidade: v, origem: 'explicita' },
      AJUSTADOS,
    )
    const esperado = atualizarAcuracia(repetido, true, 1, AJUSTADOS, 'reconhecer')
    expect(aplicarRespostaIsolada(ctx, memorias, resposta(A, 1, 'reconhecer')).memorias.get(A)).toEqual(esperado)
    expect(esperado.acuraciaPorDirecao.reconhecer).toBeGreaterThan(0.6)
    expect(esperado.acuraciaPorDirecao.produzir).toBe(0.6)
  })

  it('desce o acerto com exposição 1 a todo encompassado, com o rawDelta do formato', () => {
    const r = aplicarRespostaIsolada(contexto(), todos(), resposta(F, 1, 'reconhecer'))
    // Cada membro de F recebe 0,4 pelo peso 1: nem o delta cheio, nem o fator de exposição do distrator.
    for (const membro of [A, B, C, D]) expect(numRep(r.memorias, membro)).toBeCloseTo(2.4, 9)
    expect(r.memorias.get(G)).toEqual(pronto())
    expect([...r.culpa]).toEqual([])
    expect(r).toEqual(composicao(contexto(), todos(), resposta(F, 1, 'reconhecer')))
  })

  it('sobe o erro só aos ascendentes elegíveis, com a culpa de propagarPenalidade', () => {
    const r = aplicarRespostaIsolada(contexto(), todos(), resposta(A, -1, 'recordar', [F]))
    expect(numRep(r.memorias, F)).toBeCloseTo(1, 9)
    expect(r.memorias.get(G)).toEqual(pronto())
    expect([...r.culpa].sort()).toEqual([F, A].sort())
    expect(r).toEqual(composicao(contexto(), todos(), resposta(A, -1, 'recordar', [F])))
  })

  it('sem aresta no sentido da propagação, dá o mesmo que a propagação chamada daria', () => {
    for (const r of [resposta(A, 1, 'reconhecer'), resposta(F, -1, 'recordar'), resposta(F, -0.5, 'produzir')]) {
      const obtido = aplicarRespostaIsolada(contexto(), todos(), r)
      expect(obtido, `${r.alvo} ${String(r.deltaBruto)}`).toEqual(composicao(contexto(), todos(), r))
    }
    expect([...aplicarRespostaIsolada(contexto(), todos(), resposta(F, -1)).culpa]).toEqual([F])
  })

  it('com fire desligado, só o alvo muda', () => {
    const ctx = contexto(AJUSTADOS, false)
    for (const r of [resposta(F, 1, 'reconhecer'), resposta(A, -1)]) {
      const obtido = aplicarRespostaIsolada(ctx, todos(), r)
      for (const t of TOPICOS.filter((t) => t !== r.alvo)) expect(obtido.memorias.get(t)).toEqual(pronto())
      expect(obtido.memorias.get(r.alvo)).not.toEqual(pronto())
    }
  })

  it('não muda nada quando o alvo não tem estado de memória', () => {
    const semA = new Map([...todos()].filter(([t]) => t !== A))
    const r = aplicarRespostaIsolada(contexto(), semA, resposta(A, -1))
    expect(r.memorias).toBe(semA)
    expect([...r.culpa]).toEqual([])
  })

  it('é a composição sem atalho para estados, respostas e elegíveis sorteados', () => {
    const estado = fc
      .record({
        acuracia: fc.double({ min: 0, max: 1, noNaN: true }),
        numRepeticoes: fc.double({ min: 0, max: 6, noNaN: true }),
      })
      .map((campos) => pronto(campos))
    fc.assert(
      fc.property(
        fc.array(estado, { minLength: TOPICOS.length, maxLength: TOPICOS.length }),
        fc.constantFrom(...TOPICOS),
        fc.constantFrom(1, 0.6, -0.5, -1),
        fc.constantFrom(...DIRECOES),
        fc.subarray(TOPICOS),
        fc.boolean(),
        (estados, alvo, deltaBruto, direcao, elegiveis, fire) => {
          const memorias: Memorias = new Map(TOPICOS.map((t, k) => [t, estados[k] ?? pronto()]))
          const ctx = contexto(AJUSTADOS, fire)
          const r = resposta(alvo, deltaBruto, direcao, elegiveis)
          expect(aplicarRespostaIsolada(ctx, memorias, r)).toEqual(composicao(ctx, memorias, r))
        },
      ),
    )
  })
})
