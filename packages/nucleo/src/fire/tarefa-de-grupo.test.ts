import fc from 'fast-check'
import { describe, expect, it } from 'vitest'
import { desembrulhar } from '../base/resultado'
import { somarDias, type Dias, type Instante } from '../base/tempo'
import { TECNICAS_TODAS_LIGADAS } from '../catalogo/tecnicas'
import { DIRECOES, type Direcao, type IdGrupo, type IdItem } from '../catalogo/tipos'
import { montarGrafo, type Grafo } from '../grafo/grafo'
import { topicoDeGrupo, topicoDeItem, type IdTopico } from '../grafo/topico'
import { atualizarAcuracia } from '../memoria/acuracia'
import { estadoMemoriaInicial, type EstadoMemoria } from '../memoria/estado-memoria'
import { aplicarRepeticao } from '../memoria/modelo'
import { PARAMETROS_PADRAO as P, resolverParametros, type Dificuldade } from '../memoria/parametros'
import { velocidade } from '../memoria/velocidade'
import { propagarPenalidade, type ContextoDePropagacao, type Memorias } from './propagacao'
import { aplicarTarefaDeGrupo, type RespostaDeAlvo, type TarefaDeGrupo } from './tarefa-de-grupo'

const T0 = 1_700_000_000_000 as Instante
const DEVIDO = somarDias(T0, 2.2 as Dias)
const item = (id: string): IdTopico => topicoDeItem(id as IdItem).id
const grupo = (id: string): IdTopico => topicoDeGrupo(id as IdGrupo).id
const [A, B, C, D, F, G] = [item('a'), item('b'), item('c'), item('d'), grupo('grupo-f'), grupo('grupo-g')] as const

/** O grupo F encompassa a, b, c e d com peso 1; o grupo G, os membros de `pesosDeG`, cada um com o peso dado. */
function grafoCom(pesosDeG: ReadonlyMap<IdTopico, number>): Grafo {
  const topicos = [
    ...['a', 'b', 'c', 'd'].map((id) => topicoDeItem(id as IdItem)),
    topicoDeGrupo('grupo-f' as IdGrupo),
    topicoDeGrupo('grupo-g' as IdGrupo),
  ]
  const deF = [A, B, C, D].map((para) => ({ de: F, para, peso: 1 }))
  const deG = [...pesosDeG].map(([para, peso]) => ({ de: G, para, peso }))
  return desembrulhar(montarGrafo(topicos, [...deF, ...deG]))
}

// No grafo dos casos fixos, G encompassa a e d com peso 1. Uma tarefa de F com alvos a e d mexe em G pela penalidade.
const grafo = grafoCom(
  new Map([
    [A, 1],
    [D, 1],
  ]),
)

// Mesmo estado do teste da propagação: duas repetições e memória 1 no instante zero; no dia devido, fator de
// precocidade 1 e decay 1.
const pronto = (campos: Partial<EstadoMemoria> = {}): EstadoMemoria => ({
  ...estadoMemoriaInicial(P.acuraciaNeutra),
  numRepeticoes: 2,
  memoriaBase: 1,
  ultimaRepEm: T0,
  ultimaTentativaEm: T0,
  ...campos,
})
const TOPICOS = [A, B, C, D, F, G]
const todos = (): Memorias => new Map(TOPICOS.map((t) => [t, pronto()]))
const contexto = (campos: Partial<ContextoDePropagacao> = {}): ContextoDePropagacao => ({
  grafo,
  parametros: P,
  tecnicas: TECNICAS_TODAS_LIGADAS,
  agora: DEVIDO,
  dificuldade: () => 2,
  ...campos,
})
const resposta = (alvo: IdTopico, deltaBruto: number, direcao: Direcao = 'recordar'): RespostaDeAlvo => ({
  alvo,
  deltaBruto,
  direcao,
})
const tarefa = (respostas: RespostaDeAlvo[], exibidos: IdTopico[] = [B, C]): TarefaDeGrupo => ({
  grupo: F,
  respostas,
  exibidos: new Set(exibidos),
  elegiveis: new Set(TOPICOS),
})
const aplicar = (t: TarefaDeGrupo, ctx = contexto(), m = todos()) => desembrulhar(aplicarTarefaDeGrupo(ctx, m, t))
const numRep = (m: Memorias, t: IdTopico): number | undefined => m.get(t)?.numRepeticoes

describe('aplicarTarefaDeGrupo', () => {
  it('num acerto de todos os alvos, credita cada alvo, o grupo e, pela metade, os exibidos', () => {
    const r = aplicar(tarefa([resposta(A, 1), resposta(D, 1)]))
    expect(numRep(r.memorias, A)).toBeCloseTo(3, 9)
    expect(numRep(r.memorias, D)).toBeCloseTo(3, 9)
    expect(numRep(r.memorias, F)).toBeCloseTo(3, 9)
    expect(numRep(r.memorias, B)).toBeCloseTo(2 + P.fatorExposicaoDistrator, 9)
    expect(numRep(r.memorias, C)).toBeCloseTo(2 + P.fatorExposicaoDistrator, 9)
    expect(r.memorias.get(G)).toEqual(pronto())
    expect(r.memorias.get(A)?.ultimaTentativaEm).toBe(DEVIDO)
    expect(r.memorias.get(F)?.ultimaTentativaEm).toBe(DEVIDO)
    expect(r.memorias.get(B)?.ultimaTentativaEm).toBe(T0)
    expect([...r.culpa]).toEqual([])
  })

  it('não credita membro que não foi exibido', () => {
    const r = aplicar(tarefa([resposta(A, 1), resposta(D, 1)], [B]))
    expect(numRep(r.memorias, B)).toBeCloseTo(2.5, 9)
    expect(r.memorias.get(C)).toEqual(pronto())
  })

  it('dá à múltipla escolha o fator dela, e atualiza a acurácia da direção da pergunta', () => {
    const r = aplicar(tarefa([resposta(A, 1, 'reconhecer'), resposta(D, -1, 'produzir')]))
    expect(numRep(r.memorias, A)).toBeCloseTo(2 + P.fatorMultiplaEscolha, 9)
    expect(numRep(r.memorias, D)).toBeCloseTo(2 - P.fatorMultiplaEscolha, 9)
    const direcoesDeA = r.memorias.get(A)?.acuraciaPorDirecao
    expect(direcoesDeA?.reconhecer).toBeCloseTo(0.7 * 0.85 + 0.3, 12)
    expect(direcoesDeA?.produzir).toBe(0.85)
    expect(direcoesDeA?.recordar).toBe(0.85)
    expect(r.memorias.get(D)?.acuraciaPorDirecao.produzir).toBeCloseTo(0.7 * 0.85, 12)
  })

  it('sobe a penalidade de cada alvo errado aos ascendentes, menos ao grupo da tarefa', () => {
    const r = aplicar(tarefa([resposta(A, -1), resposta(B, 1)], [C]))
    // F: um acerto em dois, delta 0; G: penalidade de a com peso 1.
    expect(numRep(r.memorias, F)).toBe(2)
    expect(numRep(r.memorias, G)).toBeCloseTo(1, 9)
    expect([...r.culpa]).toEqual([G, A])
    // Com delta do grupo 0, nenhum crédito implícito desce.
    expect(r.memorias.get(C)).toEqual(pronto())
  })

  it('dá ao ascendente alcançado por dois erros uma penalidade só, a mais forte', () => {
    const ctx = contexto()
    const r = aplicar(tarefa([resposta(A, -1), resposta(D, -0.5)]), ctx)
    const soDeA = propagarPenalidade(ctx, todos(), { origem: A, deltaBruto: -1, elegiveis: new Set(TOPICOS) })
    expect(r.memorias.get(G)).toEqual(soDeA.memorias.get(G))
  })

  it('escolhe a mesma penalidade em toda ordem de três erros com deltas diferentes no mesmo ascendente', () => {
    // G encompassa a, b e d. Os deltas efetivos são -1 (errada, recordar), -0,5 (tempo esgotado, recordar) e -0,25
    // (tempo esgotado em múltipla escolha). Em toda ordem, G recebe só a penalidade de a; uma escolha que fique com o
    // primeiro ou o último erro da lista reprova em quatro das seis ordens.
    const ctx = contexto({
      grafo: grafoCom(
        new Map([
          [A, 1],
          [B, 1],
          [D, 1],
        ]),
      ),
    })
    const erros = [
      resposta(A, P.deltaBruto.errada),
      resposta(B, P.deltaBruto['tempo-esgotado']),
      resposta(D, P.deltaBruto['tempo-esgotado'], 'reconhecer'),
    ]
    const soDeA = propagarPenalidade(ctx, todos(), { origem: A, deltaBruto: -1, elegiveis: new Set(TOPICOS) })
    const ordens = erros.flatMap((x) =>
      erros.filter((y) => y !== x).flatMap((y) => erros.filter((z) => z !== x && z !== y).map((z) => [x, y, z])),
    )
    expect(ordens).toHaveLength(6)
    const resultados = ordens.map((ordem) => aplicar(tarefa(ordem), ctx))
    for (const [k, r] of resultados.entries()) {
      expect(r.memorias.get(G), `ordem ${String(k)}`).toEqual(soDeA.memorias.get(G))
      expect([...r.memorias], `ordem ${String(k)}`).toEqual([...(resultados[0]?.memorias ?? [])])
    }
  })

  it('no empate de delta entre dois erros, dá ao ascendente o peso de acurácia do maior fator, em qualquer ordem', () => {
    // G encompassa a com peso 0,5 e d com peso 1. O erro de a (-1) e o tempo esgotado de d (-0,5) dão a G o mesmo
    // delta, -0,5, com fatores 0,5 e 1. Vence o fator 1: acurácia 0,85 * (1 - 0,3 * 1) = 0,595, e não 0,7225.
    const ctx = contexto({
      grafo: grafoCom(
        new Map([
          [A, 0.5],
          [D, 1],
        ]),
      ),
    })
    const deA = resposta(A, P.deltaBruto.errada)
    const deD = resposta(D, P.deltaBruto['tempo-esgotado'])
    for (const ordem of [
      [deA, deD],
      [deD, deA],
    ]) {
      const g = aplicar(tarefa(ordem), ctx).memorias.get(G)
      expect(g?.numRepeticoes).toBeCloseTo(2 - 0.5, 9)
      expect(g?.acuracia).toBeCloseTo(0.85 * 0.7, 12)
    }
  })

  it('aplica ao grupo uma única repetição explícita com delta 2 * acertos / alvos - 1', () => {
    const casos: [RespostaDeAlvo[], number, number][] = [
      // A conta escrita como o código a faz, para o delta esperado sair com os mesmos bits.
      [[resposta(A, 1), resposta(B, 1), resposta(C, -1)], (2 * 2) / 3 - 1, 2 / 3],
      [[resposta(A, -1), resposta(B, -1)], -1, 0],
      [[resposta(A, 1, 'reconhecer')], 1, 1],
    ]
    for (const [respostas, delta, fracaoDeAcertos] of casos) {
      const r = aplicar(tarefa(respostas, [D]))
      const e = pronto()
      const esperado = atualizarAcuracia(
        aplicarRepeticao(e, { deltaBruto: delta, agora: DEVIDO, velocidade: 1, origem: 'explicita' }, P),
        fracaoDeAcertos,
        1,
        P,
      )
      expect(r.memorias.get(F)).toEqual(esperado)
    }
  })

  it('dá à acurácia do grupo a fração de acertos: metade dos alvos certos não pesa como erro', () => {
    const r = aplicar(tarefa([resposta(A, 1), resposta(B, -1)], [C]))
    const f = r.memorias.get(F)
    // Delta do grupo 0: numRepeticoes não muda, e a acurácia vai a 0,7 * 0,85 + 0,3 * 0,5 = 0,745, e não a 0,595.
    expect(f?.numRepeticoes).toBe(2)
    expect(f?.acuracia).toBeCloseTo(0.7 * 0.85 + 0.3 * 0.5, 12)
  })

  it('usa cada fator no lugar dele: múltipla escolha no alvo, exposição de distrator no exibido', () => {
    // No padrão os dois fatores e a força da acurácia implícita valem 0,5; aqui cada um tem um valor.
    const p = desembrulhar(
      resolverParametros({ fatorExposicaoDistrator: 0.2, fatorMultiplaEscolha: 0.35, forcaAcuraciaImplicita: 0.8 }),
    )
    const r = aplicar(tarefa([resposta(A, 1, 'reconhecer'), resposta(D, 1)], [B]), contexto({ parametros: p }))
    expect(numRep(r.memorias, A)).toBeCloseTo(2 + 0.35, 9)
    expect(numRep(r.memorias, D)).toBeCloseTo(3, 9)
    expect(numRep(r.memorias, F)).toBeCloseTo(3, 9)
    expect(numRep(r.memorias, B)).toBeCloseTo(2 + 0.2, 9)
    expect(r.memorias.get(B)?.acuracia).toBeCloseTo(0.85 + 0.3 * 0.8 * 0.2 * (1 - 0.85), 12)
  })

  it('recusa tarefa sem alvo, com alvo repetido, fora do grupo ou sem estado', () => {
    const ctx = contexto()
    const semB = new Map(todos())
    semB.delete(B)
    const casos: [TarefaDeGrupo, Memorias, string][] = [
      [tarefa([]), todos(), 'tarefa sem alvo'],
      [tarefa([resposta(A, 1), resposta(A, -1)]), todos(), "alvo repetido: 'item:a'"],
      [{ ...tarefa([resposta(A, 1)]), grupo: G }, todos(), ''],
      [tarefa([resposta(G, 1)]), todos(), "alvo que o grupo não encompassa: 'grupo:grupo-g'"],
      [tarefa([resposta(B, 1)]), semB, "alvo sem estado de memória: 'item:b'"],
    ]
    for (const [t, m, detalhe] of casos) {
      const r = aplicarTarefaDeGrupo(ctx, m, t)
      if (detalhe === '') expect(r.ok).toBe(true)
      else expect(r).toEqual({ ok: false, erro: { codigo: 'TAREFA_DE_GRUPO_INVALIDA', detalhe } })
    }
    const semGrupo = new Map(todos())
    semGrupo.delete(F)
    expect(aplicarTarefaDeGrupo(ctx, semGrupo, tarefa([resposta(A, 1)])).ok).toBe(false)
  })
})

describe('interruptor fire na tarefa de grupo', () => {
  const desligado = contexto({ tecnicas: { ...TECNICAS_TODAS_LIGADAS, fire: false } })

  it('desligado, o acerto não credita o membro exibido que não foi alvo', () => {
    const t = tarefa([resposta(A, 1), resposta(D, 1)])
    expect(numRep(aplicar(t).memorias, B)).toBeGreaterThan(2)
    const r = aplicar(t, desligado)
    expect(r.memorias.get(B)).toEqual(pronto())
    expect(r.memorias.get(C)).toEqual(pronto())
    expect(numRep(r.memorias, A)).toBeCloseTo(3, 9)
    expect(numRep(r.memorias, F)).toBeCloseTo(3, 9)
  })

  it('desligado, o erro não sobe aos ascendentes', () => {
    const t = tarefa([resposta(A, -1), resposta(B, 1)], [C])
    expect(numRep(aplicar(t).memorias, G)).toBeLessThan(2)
    const r = aplicar(t, desligado)
    expect(r.memorias.get(G)).toEqual(pronto())
    expect(numRep(r.memorias, A)).toBeCloseTo(1, 9)
    expect([...r.culpa]).toEqual([A])
  })
})

// Propriedades com estados, respostas, exibidos, elegíveis, dificuldades e pesos de G sorteados sobre o grafo de dois
// grupos.

const membros = [A, B, C, D]
const estadoSorteado = fc
  .record({
    numRepeticoes: fc.double({ min: 0, max: 8, noNaN: true }),
    memoriaBase: fc.double({ min: 0, max: 1.5, noNaN: true }),
    diasDesdeRep: fc.double({ min: 0, max: 30, noNaN: true }),
    acuracia: fc.double({ min: 0, max: 1, noNaN: true }),
    condicional: fc.boolean(),
  })
  .map((s): EstadoMemoria => ({
    ...estadoMemoriaInicial(s.acuracia),
    numRepeticoes: s.numRepeticoes,
    memoriaBase: s.memoriaBase,
    ultimaRepEm: somarDias(DEVIDO, -s.diasDesdeRep as Dias),
    ultimaTentativaEm: somarDias(DEVIDO, -s.diasDesdeRep as Dias),
    condicional: s.condicional,
  }))
const deltaSorteado = fc.constantFrom(...Object.values(P.deltaBruto))
const deltaDeErro = fc.constantFrom(...Object.values(P.deltaBruto).filter((d) => d < 0))
// Peso de aresta de G: 1, as frações exatas que fazem dois erros diferentes empatarem no delta com fatores diferentes
// (-1 com peso 0,5 contra -0,5 com peso 1), ou qualquer outro na faixa do grafo.
const pesoDeG = fc.oneof(fc.constantFrom(1, 0.5, 0.25), fc.double({ min: 0.01, max: 1, noNaN: true }))

type Cenario = { ctx: ContextoDePropagacao; memorias: Memorias; tarefa: TarefaDeGrupo }

const cenario: fc.Arbitrary<Cenario> = fc
  .record({
    estados: fc.array(estadoSorteado, { minLength: TOPICOS.length, maxLength: TOPICOS.length }),
    alvos: fc.shuffledSubarray(membros, { minLength: 1 }),
    deltas: fc.array(deltaSorteado, { minLength: 4, maxLength: 4 }),
    direcoes: fc.array(fc.constantFrom(...DIRECOES), { minLength: 4, maxLength: 4 }),
    exibidos: fc.subarray(membros),
    elegiveis: fc.subarray(TOPICOS),
    dificuldades: fc.array(fc.constantFrom<Dificuldade>(1, 2, 3), { minLength: TOPICOS.length, maxLength: 6 }),
    pesoGA: pesoDeG,
    pesoGD: pesoDeG,
  })
  .map((g) => {
    const dificuldades = new Map(TOPICOS.map((t, k) => [t, g.dificuldades[k] ?? 2]))
    const pesosDeG = new Map([
      [A, g.pesoGA],
      [D, g.pesoGD],
    ])
    return {
      ctx: contexto({ grafo: grafoCom(pesosDeG), dificuldade: (t) => dificuldades.get(t) ?? 2 }),
      memorias: new Map(TOPICOS.map((t, k) => [t, g.estados[k] ?? pronto()])),
      tarefa: {
        grupo: F,
        respostas: g.alvos.map((alvo, k) => resposta(alvo, g.deltas[k] ?? 1, g.direcoes[k] ?? 'recordar')),
        exibidos: new Set(g.exibidos),
        elegiveis: new Set(g.elegiveis),
      },
    }
  })

/**
 * O caso em que a ordem poderia mudar o resultado: G encompassa os quatro membros, com pesos sorteados, e é elegível, e
 * a tarefa tem de dois a quatro alvos, todos errados. Cada erro chega a G com um delta efetivo, e a escolha da
 * penalidade de G é o que a ordem poderia decidir.
 */
const variosErrosNoMesmoAscendente: fc.Arbitrary<Cenario> = fc
  .record({
    estados: fc.array(estadoSorteado, { minLength: TOPICOS.length, maxLength: TOPICOS.length }),
    alvos: fc.shuffledSubarray(membros, { minLength: 2 }),
    deltas: fc.array(deltaDeErro, { minLength: 4, maxLength: 4 }),
    direcoes: fc.array(fc.constantFrom(...DIRECOES), { minLength: 4, maxLength: 4 }),
    pesos: fc.array(pesoDeG, { minLength: 4, maxLength: 4 }),
  })
  .map((g) => ({
    ctx: contexto({ grafo: grafoCom(new Map(membros.map((m, k) => [m, g.pesos[k] ?? 1]))) }),
    memorias: new Map(TOPICOS.map((t, k) => [t, g.estados[k] ?? pronto()])),
    tarefa: {
      grupo: F,
      respostas: g.alvos.map((alvo, k) => resposta(alvo, g.deltas[k] ?? -1, g.direcoes[k] ?? 'recordar')),
      exibidos: new Set<IdTopico>(),
      elegiveis: new Set([G]),
    },
  }))

/** Um cenário e outra ordem das mesmas respostas, sorteada, junto com a ordem inversa, que troca todo par de lugar. */
const comOrdens = (c: Cenario) =>
  fc.record({
    c: fc.constant(c),
    sorteada: fc.shuffledSubarray([...c.tarefa.respostas], { minLength: c.tarefa.respostas.length }),
    inversa: fc.constant([...c.tarefa.respostas].reverse()),
  })

function mesmaSaidaEmToda(c: Cenario, ordens: readonly (readonly RespostaDeAlvo[])[]): void {
  const original = desembrulhar(aplicarTarefaDeGrupo(c.ctx, c.memorias, c.tarefa))
  for (const ordem of ordens) {
    const permutada = desembrulhar(aplicarTarefaDeGrupo(c.ctx, c.memorias, { ...c.tarefa, respostas: ordem }))
    expect([...permutada.memorias]).toEqual([...original.memorias])
    expect([...permutada.culpa]).toEqual([...original.culpa])
    expect(permutada.condicionaisPenalizados).toEqual(original.condicionaisPenalizados)
  }
}

describe('propriedades da tarefa de grupo', () => {
  it('não depende da ordem dos alvos', () => {
    fc.assert(
      fc.property(cenario.chain(comOrdens), ({ c, sorteada, inversa }) => {
        mesmaSaidaEmToda(c, [sorteada, inversa])
      }),
    )
  })

  it('não depende da ordem dos alvos quando vários erros chegam ao mesmo ascendente', () => {
    fc.assert(
      fc.property(variosErrosNoMesmoAscendente.chain(comOrdens), ({ c, sorteada, inversa }) => {
        mesmaSaidaEmToda(c, [sorteada, inversa])
      }),
    )
  })

  it('o grupo recebe exatamente uma repetição explícita, com o delta pela fração de acertos', () => {
    fc.assert(
      fc.property(cenario, ({ ctx, memorias, tarefa: t }) => {
        const r = desembrulhar(aplicarTarefaDeGrupo(ctx, memorias, t))
        const e = memorias.get(F) ?? pronto()
        const acertos = t.respostas.filter((x) => x.deltaBruto > 0).length
        const delta = (2 * acertos) / t.respostas.length - 1
        const v = velocidade(e, ctx.dificuldade(F), P, ctx.tecnicas)
        const esperado = atualizarAcuracia(
          aplicarRepeticao(e, { deltaBruto: delta, agora: ctx.agora, velocidade: v, origem: 'explicita' }, P),
          acertos / t.respostas.length,
          1,
          P,
        )
        expect(r.memorias.get(F)).toEqual(esperado)
        if (acertos / t.respostas.length >= 0.5) {
          expect(r.memorias.get(F)?.numRepeticoes).toBeGreaterThanOrEqual(e.numRepeticoes)
        }
      }),
    )
  })

  it('só os alvos, o grupo, os exibidos e os ascendentes elegíveis mudam, e a culpa fica nos alvos errados e acima', () => {
    fc.assert(
      fc.property(cenario, ({ ctx, memorias, tarefa: t }) => {
        const r = desembrulhar(aplicarTarefaDeGrupo(ctx, memorias, t))
        const alvos = new Set(t.respostas.map((x) => x.alvo))
        const errados = t.respostas.filter((x) => x.deltaBruto < 0).map((x) => x.alvo)
        for (const [topico, e] of memorias) {
          const pode =
            alvos.has(topico) || topico === F || t.exibidos.has(topico) || (topico === G && t.elegiveis.has(G))
          if (!pode) expect(r.memorias.get(topico), topico).toEqual(e)
        }
        for (const culpado of r.culpa) expect(errados.includes(culpado) || culpado === G).toBe(true)
        expect(r.culpa.has(F)).toBe(false)
      }),
    )
  })
})
