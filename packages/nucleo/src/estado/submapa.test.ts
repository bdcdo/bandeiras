import fc from 'fast-check'
import { describe, expect, it } from 'vitest'
import { catalogoDe, idDeTeste, type EspecificacaoDeCatalogo } from '../apoio-a-testes/catalogo-de-teste'
import { estadoDeTeste } from '../apoio-a-testes/estado-de-teste'
import { desembrulhar } from '../base/resultado'
import type { Instante } from '../base/tempo'
import { TECNICAS_TODAS_LIGADAS } from '../catalogo/tecnicas'
import { DIRECOES, type IdGrupo } from '../catalogo/tipos'
import { aplicarRespostaIsolada, aplicarTarefaDeGrupo, type Memorias } from '../fire'
import { preRequisitos, topicoDeGrupo, topicoDeItem, type IdTopico } from '../grafo'
import { aplicarRepeticao, estadoMemoriaInicial, PARAMETROS_PADRAO as P, type EstadoMemoria } from '../memoria'
import { criarContextoDeReducao } from './contexto'
import { contextoDePropagacao, devolver, submapa } from './memoria-do-rascunho'
import type { Copiavel } from './rascunho'

// A redução passa a fire/ só o submapa das origens, e grava de volta o que mudou. A equivalência com a função sobre o
// mapa inteiro é o que autoriza o atalho: o mesmo mapa, na mesma ordem, a mesma culpa e os mesmos condicionais, para a
// resposta isolada (crédito no acerto, penalidade no erro) e para a tarefa de grupo, com estados, ordem de inserção e
// ausências sorteados.
//
// Os grupos se sobrepõem, para o erro de um item subir a mais de um grupo e o submapa de uma tarefa de grupo precisar
// dos grupos vizinhos dos alvos: grupo-1 tem a, b, c e d; grupo-2, c, d e e; grupo-3, e, f, g e h; grupo-4, a e f.
const ESPECIFICACAO: EspecificacaoDeCatalogo = {
  classes: [1, 1, 2, 2, 3, 3, 4, 4],
  categorias: [1, 2, 1, 2, 1, 2, 1, 2],
  aliases: [],
  vizinhos: [],
  grupos: [
    { membros: [0, 1, 2, 3], par: true },
    { membros: [2, 3, 4], par: false },
    { membros: [4, 5, 6, 7], par: false },
    { membros: [0, 5], par: false },
  ],
  vizinhancas: [],
}
const ctx = desembrulhar(
  criarContextoDeReducao({ catalogo: catalogoDe(ESPECIFICACAO), tecnicas: TECNICAS_TODAS_LIGADAS, parametros: P }),
)
const T0 = Date.UTC(2025, 9, 10) as Instante
const PROPAGACAO = contextoDePropagacao(ctx, (T0 + 3 * 86_400_000) as Instante)
const ITENS = Array.from({ length: 8 }, (_, k) => topicoDeItem(idDeTeste(k)).id)
const GRUPOS = [1, 2, 3, 4].map((j) => topicoDeGrupo(`grupo-${String(j)}` as IdGrupo).id)
const TOPICOS = [...ITENS, ...GRUPOS]

/** Um estado com acurácia e repetições sorteadas e a última repetição em T0, para o vencimento e o decay existirem. */
const estado: fc.Arbitrary<EstadoMemoria> = fc
  .record({ acuracia: fc.double({ min: 0, max: 1, noNaN: true }), repeticoes: fc.integer({ min: 0, max: 6 }) })
  .map((pedido) =>
    aplicarRepeticao(estadoDeTeste(pedido), { deltaBruto: 1, agora: T0, velocidade: 1, origem: 'explicita' }, P),
  )

/** Memórias de um subconjunto sorteado dos tópicos, inseridas numa ordem sorteada. */
const memorias: fc.Arbitrary<Memorias> = fc.shuffledSubarray(TOPICOS).chain((ts) =>
  fc.array(estado, { minLength: ts.length, maxLength: ts.length }).map((es) =>
    ts.reduce<Map<IdTopico, EstadoMemoria>>((m, t, k) => {
      const e = es[k]
      return e === undefined ? m : m.set(t, e)
    }, new Map()),
  ),
)

/** As entradas do mapa inteiro depois de receber de volta o que a função mudou no submapa, na ordem do mapa. */
function devolvido(inteiro: Memorias, depois: Memorias): [IdTopico, EstadoMemoria][] {
  const c: Copiavel<IdTopico, EstadoMemoria> = { atual: inteiro, proprio: undefined }
  devolver(c, depois)
  return [...c.atual]
}

describe('submapa', () => {
  it('de um item tem o item e os grupos dele, e de um grupo, o grupo e os membros', () => {
    const todas = new Map(TOPICOS.map((t) => [t, estadoMemoriaInicial(0.85)]))
    const [a, , c] = ITENS
    const [g1, g2, , g4] = GRUPOS
    expect([...submapa(ctx, todas, [c as IdTopico]).keys()]).toStrictEqual([c, g1, g2])
    expect([...submapa(ctx, todas, [g4 as IdTopico]).keys()]).toStrictEqual([g4, a, ITENS[5]])
  })

  it('a resposta isolada sobre o submapa do alvo dá o mesmo que sobre o mapa inteiro', () => {
    fc.assert(
      fc.property(
        memorias,
        fc.constantFrom(...TOPICOS),
        fc.constantFrom(1, 0.6, -0.5, -1),
        fc.constantFrom(...DIRECOES),
        fc.subarray(TOPICOS),
        (inteiro, alvo, deltaBruto, direcao, elegiveis) => {
          const resposta = { alvo, direcao, deltaBruto, elegiveis: new Set(elegiveis) }
          const esperado = aplicarRespostaIsolada(PROPAGACAO, inteiro, resposta)
          const obtido = aplicarRespostaIsolada(PROPAGACAO, submapa(ctx, inteiro, [alvo]), resposta)
          expect(devolvido(inteiro, obtido.memorias)).toStrictEqual([...esperado.memorias])
          expect([...obtido.culpa]).toStrictEqual([...esperado.culpa])
          expect(obtido.condicionaisPenalizados).toStrictEqual(esperado.condicionaisPenalizados)
        },
      ),
    )
  })

  it('a tarefa de grupo sobre o submapa do grupo e dos alvos dá o mesmo que sobre o mapa inteiro', () => {
    const tarefa = fc.constantFrom(...GRUPOS).chain((grupo) => {
      const membros = [...preRequisitos(ctx.grafo, grupo)]
      return fc.record({
        grupo: fc.constant(grupo),
        alvos: fc.shuffledSubarray(membros, { minLength: 1 }),
        deltas: fc.array(fc.constantFrom(1, 0.6, -0.5, -1), { minLength: membros.length, maxLength: membros.length }),
        direcoes: fc.array(fc.constantFrom(...DIRECOES), { minLength: membros.length, maxLength: membros.length }),
        exibidos: fc.subarray(membros),
        elegiveis: fc.subarray(TOPICOS),
      })
    })
    fc.assert(
      fc.property(memorias, tarefa, (inteiro, t) => {
        const especificacao = {
          grupo: t.grupo,
          respostas: t.alvos.map((alvo, k) => ({
            alvo,
            direcao: t.direcoes[k] ?? 'recordar',
            deltaBruto: t.deltas[k] ?? 1,
          })),
          exibidos: new Set(t.exibidos),
          elegiveis: new Set(t.elegiveis),
        }
        // O grupo sem estado nasce com a mesma memória nos dois caminhos, como a redução faz antes de chamar fire/.
        const inicial = estadoMemoriaInicial(0.5)
        const comGrupo = inteiro.has(t.grupo) ? inteiro : new Map(inteiro).set(t.grupo, inicial)
        const esperado = aplicarTarefaDeGrupo(PROPAGACAO, comGrupo, especificacao)
        const sub = submapa(ctx, inteiro, [t.grupo, ...t.alvos])
        if (!sub.has(t.grupo)) sub.set(t.grupo, inicial)
        const obtido = aplicarTarefaDeGrupo(PROPAGACAO, sub, especificacao)
        if (!esperado.ok || !obtido.ok) {
          expect(obtido).toStrictEqual(esperado)
          return
        }
        expect(devolvido(inteiro, obtido.valor.memorias)).toStrictEqual([...esperado.valor.memorias])
        expect([...obtido.valor.culpa]).toStrictEqual([...esperado.valor.culpa])
        expect(obtido.valor.condicionaisPenalizados).toStrictEqual(esperado.valor.condicionaisPenalizados)
      }),
    )
  })
})
