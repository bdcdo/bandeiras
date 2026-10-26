import fc from 'fast-check'
import { describe, expect, it } from 'vitest'
import { desembrulhar } from '../base/resultado'
import { somarDias, type Dias, type Instante } from '../base/tempo'
import { TECNICAS_TODAS_LIGADAS } from '../catalogo/tecnicas'
import type { IdGrupo, IdItem } from '../catalogo/tipos'
import { fechoAscendente, fechoDescendente } from '../grafo/consultas'
import { montarGrafo, type ArestaEncompassing, type Grafo } from '../grafo/grafo'
import { topicoDeGrupo, topicoDeItem, type IdTopico, type Topico } from '../grafo/topico'
import { estadoMemoriaInicial, type EstadoMemoria } from '../memoria/estado-memoria'
import { aplicarRepeticao } from '../memoria/modelo'
import { PARAMETROS_PADRAO as P, type Dificuldade } from '../memoria/parametros'
import { ehTopicoLento, velocidade } from '../memoria/velocidade'
import { propagarCredito, propagarPenalidade, type ContextoDePropagacao, type Memorias } from './propagacao'

const T0 = 1_700_000_000_000 as Instante
const em = (dias: number): Instante => somarDias(T0, dias as Dias)

const item = (id: string): Topico => topicoDeItem(id as IdItem)
const grupo = (id: string): Topico => topicoDeGrupo(id as IdGrupo)
const [A, B, C, G1, G2] = [item('a'), item('b'), item('c'), grupo('grupo-1'), grupo('grupo-2')].map((t) => t.id) as [
  IdTopico,
  IdTopico,
  IdTopico,
  IdTopico,
  IdTopico,
]

/**
 * Dois níveis: grupo-2 encompassa grupo-1 (peso 1) e c (peso 0,5); grupo-1 encompassa a (peso 1) e b (peso 0,5). É o
 * caso genérico que o domínio das bandeiras não tem, em que o crédito desce mais de uma camada.
 */
const grafo = desembrulhar(
  montarGrafo(
    [item('a'), item('b'), item('c'), grupo('grupo-1'), grupo('grupo-2')],
    [
      { de: G2, para: G1, peso: 1 },
      { de: G2, para: C, peso: 0.5 },
      { de: G1, para: A, peso: 1 },
      { de: G1, para: B, peso: 0.5 },
    ],
  ),
)

// Duas repetições, memória 1 no instante zero e última tentativa no mesmo instante. No dia devido (2,2 dias depois) a
// memória está no limiar: o fator de precocidade vale 1 e o decay vale 1, e as contas ficam à mão.
const DEVIDO = em(2.2)
const pronto = (campos: Partial<EstadoMemoria> = {}): EstadoMemoria => ({
  ...estadoMemoriaInicial(P.acuraciaNeutra),
  numRepeticoes: 2,
  memoriaBase: 1,
  ultimaRepEm: T0,
  ultimaTentativaEm: T0,
  ...campos,
})
const todos = (campos: Partial<EstadoMemoria> = {}): Memorias =>
  new Map([A, B, C, G1, G2].map((t) => [t, pronto(campos)]))

function contexto(campos: Partial<ContextoDePropagacao> = {}): ContextoDePropagacao {
  return { grafo, parametros: P, tecnicas: TECNICAS_TODAS_LIGADAS, agora: DEVIDO, dificuldade: () => 2, ...campos }
}
const numRep = (m: Memorias, t: IdTopico): number | undefined => m.get(t)?.numRepeticoes
const TODOS = new Set([A, B, C, G1, G2])

describe('propagarCredito', () => {
  it('desce por mais de uma camada, esmaecendo pelo produto dos pesos', () => {
    const m = propagarCredito(contexto(), todos(), { origem: G2, deltaBruto: 1, exposicao: () => 1 })
    expect(numRep(m, G2)).toBe(2)
    expect(numRep(m, G1)).toBeCloseTo(3, 9)
    expect(numRep(m, C)).toBeCloseTo(2.5, 9)
    expect(numRep(m, A)).toBeCloseTo(3, 9)
    expect(numRep(m, B)).toBeCloseTo(2.5, 9)
    // A acurácia do encompassado recebe o acerto com meia força: alfa * peso * 0,5.
    expect(m.get(G1)?.acuracia).toBeCloseTo(0.85 + 0.3 * 0.5 * (1 - 0.85), 12)
    expect(m.get(C)?.acuracia).toBeCloseTo(0.85 + 0.3 * 0.25 * (1 - 0.85), 12)
  })

  it('grava ultimaRepEm e deixa ultimaTentativaEm de quem recebeu crédito implícito', () => {
    const m = propagarCredito(contexto(), todos(), { origem: G2, deltaBruto: 1, exposicao: () => 1 })
    for (const t of [G1, C, A, B]) {
      expect(m.get(t)?.ultimaRepEm).toBe(DEVIDO)
      expect(m.get(t)?.ultimaTentativaEm).toBe(T0)
    }
  })

  it('multiplica pela exposição, e exposição 0 corta o ramo inteiro', () => {
    const exposicao = (t: IdTopico): number => (t === G1 ? 0 : t === C ? 0.5 : 1)
    const m = propagarCredito(contexto(), todos(), { origem: G2, deltaBruto: 1, exposicao })
    expect(m.get(G1)).toEqual(pronto())
    expect(m.get(A)).toEqual(pronto())
    expect(m.get(B)).toEqual(pronto())
    expect(numRep(m, C)).toBeCloseTo(2 + 0.5 * 0.5, 9)
  })

  it('pula o tópico lento e corta o ramo abaixo dele', () => {
    const dificuldade = (t: IdTopico): Dificuldade => (t === G1 ? 3 : 2)
    const m = propagarCredito(contexto({ dificuldade }), todos(), { origem: G2, deltaBruto: 1, exposicao: () => 1 })
    expect(m.get(G1)).toEqual(pronto())
    expect(m.get(A)).toEqual(pronto())
    expect(numRep(m, C)).toBeCloseTo(2.5, 9)
  })

  it('num tópico alcançado por dois caminhos, aplica uma vez só, pelo mais forte', () => {
    const comAtalho = desembrulhar(
      montarGrafo(
        [item('a'), item('b'), item('c'), grupo('grupo-1'), grupo('grupo-2')],
        [...[...grafo.arestasAbaixo.values()].flat(), { de: G2, para: A, peso: 0.3 } satisfies ArestaEncompassing],
      ),
    )
    const m = propagarCredito(contexto({ grafo: comAtalho }), todos(), {
      origem: G2,
      deltaBruto: 1,
      exposicao: () => 1,
    })
    expect(numRep(m, A)).toBeCloseTo(3, 9)
  })

  it('não faz nada com delta que não é positivo, nem com fire desligado', () => {
    const m = todos()
    expect(propagarCredito(contexto(), m, { origem: G2, deltaBruto: 0, exposicao: () => 1 })).toBe(m)
    expect(propagarCredito(contexto(), m, { origem: G2, deltaBruto: -1, exposicao: () => 1 })).toBe(m)
    const desligado = contexto({ tecnicas: { ...TECNICAS_TODAS_LIGADAS, fire: false } })
    expect(propagarCredito(desligado, m, { origem: G2, deltaBruto: 1, exposicao: () => 1 })).toBe(m)
  })

  it('não passa por tópico sem estado', () => {
    const m = new Map(todos())
    m.delete(G1)
    const depois = propagarCredito(contexto(), m, { origem: G2, deltaBruto: 1, exposicao: () => 1 })
    expect(depois.has(G1)).toBe(false)
    expect(depois.get(A)).toEqual(pronto())
  })
})

describe('propagarPenalidade', () => {
  it('sobe por mais de uma camada até os elegíveis e devolve a culpa', () => {
    const r = propagarPenalidade(contexto(), todos(), { origem: A, deltaBruto: -1, elegiveis: TODOS })
    expect(numRep(r.memorias, A)).toBe(2)
    expect(numRep(r.memorias, G1)).toBeCloseTo(1, 9)
    expect(numRep(r.memorias, G2)).toBeCloseTo(1, 9)
    expect(r.memorias.get(B)).toEqual(pronto())
    expect(r.memorias.get(C)).toEqual(pronto())
    expect(r.memorias.get(G1)?.acuracia).toBeCloseTo(0.85 * 0.7, 12)
    expect(r.memorias.get(G1)?.ultimaTentativaEm).toBe(T0)
    expect([...r.culpa]).toEqual([G2, G1, A])
    expect(r.condicionaisPenalizados).toEqual([])
  })

  it('esmaece pelo peso da aresta', () => {
    const r = propagarPenalidade(contexto(), todos(), { origem: B, deltaBruto: -1, elegiveis: TODOS })
    expect(numRep(r.memorias, G1)).toBeCloseTo(2 - 0.5, 9)
    expect(numRep(r.memorias, G2)).toBeCloseTo(2 - 0.5, 9)
    expect(r.memorias.get(G1)?.acuracia).toBeCloseTo(0.85 * (1 - 0.3 * 0.5), 12)
  })

  it('passa por quem não é elegível ou foi excluído, sem penalizá-lo', () => {
    const soDeCima = propagarPenalidade(contexto(), todos(), { origem: A, deltaBruto: -1, elegiveis: new Set([G2]) })
    expect(soDeCima.memorias.get(G1)).toEqual(pronto())
    expect(numRep(soDeCima.memorias, G2)).toBeCloseTo(1, 9)
    expect([...soDeCima.culpa]).toEqual([G2, A])
    const excluido = propagarPenalidade(contexto(), todos(), {
      origem: A,
      deltaBruto: -1,
      elegiveis: TODOS,
      excluir: new Set([G1]),
    })
    expect(excluido.memorias.get(G1)).toEqual(pronto())
    expect(numRep(excluido.memorias, G2)).toBeCloseTo(1, 9)
  })

  it('penaliza o tópico lento como qualquer outro', () => {
    const dificuldade = (t: IdTopico): Dificuldade => (t === G1 ? 3 : 2)
    const r = propagarPenalidade(contexto({ dificuldade }), todos(), { origem: A, deltaBruto: -1, elegiveis: TODOS })
    expect(numRep(r.memorias, G1)).toBeLessThan(2)
  })

  it('devolve quais ascendentes penalizados estavam concluídos condicionalmente', () => {
    const m = new Map(todos())
    m.set(G2, pronto({ condicional: true }))
    const r = propagarPenalidade(contexto(), m, { origem: A, deltaBruto: -1, elegiveis: TODOS })
    expect(r.condicionaisPenalizados).toEqual([G2])
    const naoAlcancado = propagarPenalidade(contexto(), m, { origem: A, deltaBruto: -1, elegiveis: new Set([G1]) })
    expect(naoAlcancado.condicionaisPenalizados).toEqual([])
  })

  it('com fire desligado, ou delta que não é negativo, devolve o mapa e só a origem como culpa', () => {
    const m = todos()
    const desligado = contexto({ tecnicas: { ...TECNICAS_TODAS_LIGADAS, fire: false } })
    for (const [ctx, deltaBruto] of [
      [desligado, -1],
      [contexto(), 0],
      [contexto(), 1],
    ] as const) {
      const r = propagarPenalidade(ctx, m, { origem: A, deltaBruto, elegiveis: TODOS })
      expect(r.memorias).toBe(m)
      expect([...r.culpa]).toEqual([A])
      expect(r.condicionaisPenalizados).toEqual([])
    }
  })
})

// Propriedades sobre grafos gerados: DAG de até 8 tópicos com arestas do posto menor para o maior e rótulos
// embaralhados, estados aleatórios (alguns tópicos sem estado) e dificuldade sorteada por tópico.

type Cenario = { grafo: Grafo; memorias: Memorias; dificuldades: ReadonlyMap<IdTopico, Dificuldade>; origem: IdTopico }

const cenario: fc.Arbitrary<Cenario> = fc.integer({ min: 1, max: 8 }).chain((n) => {
  const postos = Array.from({ length: n }, (_, k) => k)
  const possiveis = postos.flatMap((a) => postos.filter((b) => a < b).map((b): [number, number] => [a, b]))
  const estado = fc.option(
    fc.record({
      numRepeticoes: fc.double({ min: 0, max: 8, noNaN: true }),
      memoriaBase: fc.double({ min: 0, max: 1.5, noNaN: true }),
      diasDesdeRep: fc.double({ min: 0, max: 30, noNaN: true }),
      acuracia: fc.double({ min: 0, max: 1, noNaN: true }),
      condicional: fc.boolean(),
    }),
    { nil: undefined, freq: 5 },
  )
  return fc
    .record({
      rotulos: fc.shuffledSubarray(postos, { minLength: n, maxLength: n }),
      pares: fc.subarray(possiveis),
      pesos: fc.array(fc.oneof(fc.constant(1), fc.double({ min: 0.01, max: 1, noNaN: true })), {
        minLength: possiveis.length,
        maxLength: possiveis.length,
      }),
      estados: fc.array(estado, { minLength: n, maxLength: n }),
      dificuldades: fc.array(fc.constantFrom<Dificuldade>(1, 2, 3), { minLength: n, maxLength: n }),
      origem: fc.nat(n - 1),
    })
    .map((g): Cenario => {
      const id = (posto: number): IdTopico => item(`t${String(g.rotulos[posto] ?? posto)}`).id
      const topicos = postos.map((k) => item(`t${String(k)}`))
      const arestas = g.pares.map(([a, b], k) => ({ de: id(a), para: id(b), peso: g.pesos[k] ?? 1 }))
      const memorias = new Map<IdTopico, EstadoMemoria>()
      postos.forEach((k) => {
        const s = g.estados[k]
        if (s === undefined) return
        memorias.set(topicos[k]?.id ?? id(k), {
          ...estadoMemoriaInicial(s.acuracia),
          numRepeticoes: s.numRepeticoes,
          memoriaBase: s.memoriaBase,
          ultimaRepEm: em(-s.diasDesdeRep),
          ultimaTentativaEm: em(-s.diasDesdeRep),
          condicional: s.condicional,
        })
      })
      return {
        grafo: desembrulhar(montarGrafo(topicos, arestas)),
        memorias,
        dificuldades: new Map(topicos.map((t, k) => [t.id, g.dificuldades[k] ?? 2])),
        origem: id(g.origem),
      }
    })
})

const contextoDo = (c: Cenario): ContextoDePropagacao => ({
  grafo: c.grafo,
  parametros: P,
  tecnicas: TECNICAS_TODAS_LIGADAS,
  agora: T0,
  dificuldade: (t) => c.dificuldades.get(t) ?? 2,
})
const deltaDeAcerto = fc.constantFrom(P.deltaBruto.perfeita, P.deltaBruto.lenta)
const deltaDeErro = fc.constantFrom(P.deltaBruto.errada, P.deltaBruto['tempo-esgotado'])
const exposicoes = fc.array(fc.constantFrom(0, P.fatorExposicaoDistrator, 1), { minLength: 8, maxLength: 8 })

/** Delta de numRepeticoes que o tópico teria com uma repetição explícita de `deltaBruto`, do mesmo estado. */
function deltaExplicito(ctx: ContextoDePropagacao, e: EstadoMemoria, t: IdTopico, deltaBruto: number): number {
  const v = velocidade(e, ctx.dificuldade(t), ctx.parametros, ctx.tecnicas)
  const depois = aplicarRepeticao(e, { deltaBruto, agora: ctx.agora, velocidade: v, origem: 'explicita' }, P)
  return depois.numRepeticoes - e.numRepeticoes
}

describe('propriedades da propagação', () => {
  it('o crédito nunca sobe e a penalidade nunca desce', () => {
    fc.assert(
      fc.property(cenario, deltaDeAcerto, deltaDeErro, (c, acerto, erro) => {
        const ctx = contextoDo(c)
        const credito = propagarCredito(ctx, c.memorias, { origem: c.origem, deltaBruto: acerto, exposicao: () => 1 })
        const abaixo = fechoDescendente(c.grafo, c.origem)
        const penalidade = propagarPenalidade(ctx, c.memorias, {
          origem: c.origem,
          deltaBruto: erro,
          elegiveis: new Set(c.grafo.topicos.keys()),
        })
        const acima = fechoAscendente(c.grafo, c.origem)
        for (const [t, e] of c.memorias) {
          if (!abaixo.has(t)) expect(credito.get(t), t).toEqual(e)
          if (!acima.has(t)) expect(penalidade.memorias.get(t), t).toEqual(e)
        }
      }),
    )
  })

  it('a culpa é a origem e parte dos ascendentes dela', () => {
    fc.assert(
      fc.property(cenario, deltaDeErro, fc.func(fc.boolean()), (c, erro, elegivel) => {
        const elegiveis = new Set([...c.grafo.topicos.keys()].filter((t) => elegivel(t)))
        const r = propagarPenalidade(contextoDo(c), c.memorias, { origem: c.origem, deltaBruto: erro, elegiveis })
        const permitidos = new Set([c.origem, ...fechoAscendente(c.grafo, c.origem)])
        expect(r.culpa.has(c.origem)).toBe(true)
        for (const t of r.culpa) expect(permitidos.has(t)).toBe(true)
        for (const t of r.culpa) if (t !== c.origem) expect(elegiveis.has(t)).toBe(true)
      }),
    )
  })

  it('o delta implícito nunca passa, em módulo, o explícito que o mesmo tópico teria', () => {
    fc.assert(
      fc.property(cenario, deltaDeAcerto, deltaDeErro, exposicoes, (c, acerto, erro, exp) => {
        const ctx = contextoDo(c)
        const indice = new Map([...c.grafo.topicos.keys()].map((t, k) => [t, k]))
        const credito = propagarCredito(ctx, c.memorias, {
          origem: c.origem,
          deltaBruto: acerto,
          exposicao: (t) => exp[indice.get(t) ?? 0] ?? 0,
        })
        const penalidade = propagarPenalidade(ctx, c.memorias, {
          origem: c.origem,
          deltaBruto: erro,
          elegiveis: new Set(c.grafo.topicos.keys()),
        })
        for (const [t, e] of c.memorias) {
          const implicitoC = (credito.get(t)?.numRepeticoes ?? 0) - e.numRepeticoes
          const implicitoP = (penalidade.memorias.get(t)?.numRepeticoes ?? 0) - e.numRepeticoes
          expect(Math.abs(implicitoC)).toBeLessThanOrEqual(Math.abs(deltaExplicito(ctx, e, t, acerto)) + 1e-12)
          expect(Math.abs(implicitoP)).toBeLessThanOrEqual(Math.abs(deltaExplicito(ctx, e, t, erro)) + 1e-12)
        }
      }),
    )
  })

  it('tópico lento e tópico de exposição 0 ficam inalterados pelo crédito', () => {
    fc.assert(
      fc.property(cenario, deltaDeAcerto, exposicoes, (c, acerto, exp) => {
        const ctx = contextoDo(c)
        const indice = new Map([...c.grafo.topicos.keys()].map((t, k) => [t, k]))
        const exposicao = (t: IdTopico): number => exp[indice.get(t) ?? 0] ?? 0
        const credito = propagarCredito(ctx, c.memorias, { origem: c.origem, deltaBruto: acerto, exposicao })
        for (const [t, e] of c.memorias) {
          const lento = ehTopicoLento(e, ctx.dificuldade(t), P, ctx.tecnicas)
          if (lento || exposicao(t) === 0) expect(credito.get(t), t).toEqual(e)
        }
      }),
    )
  })

  it('o crédito implícito nunca grava ultimaTentativaEm', () => {
    fc.assert(
      fc.property(cenario, deltaDeAcerto, deltaDeErro, (c, acerto, erro) => {
        const ctx = contextoDo(c)
        const credito = propagarCredito(ctx, c.memorias, { origem: c.origem, deltaBruto: acerto, exposicao: () => 1 })
        const penalidade = propagarPenalidade(ctx, c.memorias, {
          origem: c.origem,
          deltaBruto: erro,
          elegiveis: new Set(c.grafo.topicos.keys()),
        })
        for (const [t, e] of c.memorias) {
          expect(credito.get(t)?.ultimaTentativaEm).toBe(e.ultimaTentativaEm)
          expect(penalidade.memorias.get(t)?.ultimaTentativaEm).toBe(e.ultimaTentativaEm)
        }
      }),
    )
  })
})
