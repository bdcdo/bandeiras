import fc from 'fast-check'
import { describe, expect, it } from 'vitest'
import { desembrulhar } from '../base/resultado'
import { carregarCatalogo } from '../catalogo/carregar-catalogo'
import { TECNICAS_TODAS_DESLIGADAS, TECNICAS_TODAS_LIGADAS } from '../catalogo/tecnicas'
import type { DadosDeCatalogo, IdItem, ItemBruto } from '../catalogo/tipos'
import { fechoAscendente, fechoDescendente, fronteira, preRequisitos } from './consultas'
import { construirGrafo, montarGrafo, type ArestaEncompassing } from './grafo'
import { topicoDeItem, type IdTopico, type Topico } from './topico'

const t = (id: string): Topico => topicoDeItem(id as IdItem)
const id = (rotulo: string): IdTopico => t(rotulo).id
const aresta = (de: string, para: string, peso = 1): ArestaEncompassing => ({ de: id(de), para: id(para), peso })

/**
 * DAG gerado: n tópicos com posto topológico 0..n-1, arestas só do posto menor para o maior (o que basta para não haver
 * ciclo) e rótulos embaralhados, para a lista de tópicos não chegar já em ordem topológica.
 */
type DagGerado = { topicos: Topico[]; arestas: ArestaEncompassing[] }

const pesoValido = fc.oneof(fc.constant(1), fc.double({ min: 0.001, max: 1, noNaN: true }))

const dag: fc.Arbitrary<DagGerado> = fc.integer({ min: 1, max: 8 }).chain((n) => {
  const postos = Array.from({ length: n }, (_, k) => k)
  // Os pares possíveis são enumerados e sorteados por subconjunto, e não filtrados de pares quaisquer: com n = 1 não há
  // par nenhum, e um filtro ficaria sorteando para sempre.
  const possiveis = postos.flatMap((a) => postos.filter((b) => a < b).map((b): [number, number] => [a, b]))
  return fc
    .record({
      rotulos: fc.shuffledSubarray(postos, { minLength: n, maxLength: n }),
      pares: fc.subarray(possiveis),
      pesos: fc.array(pesoValido, { minLength: possiveis.length, maxLength: possiveis.length }),
    })
    .map(({ rotulos, pares, pesos }) => {
      const nome = (posto: number): string => `t${String(rotulos[posto] ?? posto)}`
      return {
        topicos: postos.map((k) => t(`t${String(k)}`)),
        arestas: pares.map(([a, b], k) => aresta(nome(a), nome(b), pesos[k] ?? 1)),
      }
    })
})

/** Um DAG com um ciclo acrescentado: a sequência de tópicos distintos sorteada, ligada em anel. */
const ciclico: fc.Arbitrary<DagGerado> = dag.chain((g) =>
  fc
    .shuffledSubarray(
      g.topicos.map((x) => x.id),
      { minLength: 1 },
    )
    .map((anel) => {
      const doAnel = anel.map((de, k) => ({ de, para: anel[(k + 1) % anel.length] ?? de, peso: 1 }))
      const chave = (a: ArestaEncompassing): string => `${a.de}|${a.para}`
      const noAnel = new Set(doAnel.map(chave))
      return { topicos: g.topicos, arestas: [...g.arestas.filter((a) => !noAnel.has(chave(a))), ...doAnel] }
    }),
)

function codigoDoErro(topicos: readonly Topico[], arestas: readonly ArestaEncompassing[]): string | undefined {
  const r = montarGrafo(topicos, arestas)
  return r.ok ? undefined : r.erro.codigo
}

describe('montarGrafo', () => {
  it('indexa as arestas nos dois sentidos e dá entrada vazia a quem não tem aresta', () => {
    const grafo = desembrulhar(montarGrafo([t('a'), t('b'), t('c')], [aresta('a', 'b', 0.5)]))
    expect(grafo.arestasAbaixo.get(id('a'))).toEqual([aresta('a', 'b', 0.5)])
    expect(grafo.arestasAcima.get(id('b'))).toEqual([aresta('a', 'b', 0.5)])
    expect(grafo.arestasAbaixo.get(id('c'))).toEqual([])
    expect(grafo.arestasAcima.get(id('a'))).toEqual([])
    expect([...grafo.topicos.keys()]).toEqual([id('a'), id('b'), id('c')])
  })

  it('aceita todo DAG gerado, com ordem topológica que contém cada tópico uma vez', () => {
    fc.assert(
      fc.property(dag, ({ topicos, arestas }) => {
        const r = montarGrafo(topicos, arestas)
        expect(r.ok).toBe(true)
        if (!r.ok) return
        const posicao = new Map(r.valor.ordem.map((x, k) => [x, k]))
        expect([...posicao.keys()].sort()).toEqual(topicos.map((x) => x.id).sort())
        for (const a of arestas) expect(posicao.get(a.de)).toBeLessThan(posicao.get(a.para) ?? -1)
      }),
    )
  })

  it('recusa todo grafo com ciclo e põe no detalhe um ciclo que existe', () => {
    fc.assert(
      fc.property(ciclico, ({ topicos, arestas }) => {
        const r = montarGrafo(topicos, arestas)
        expect(r.ok ? undefined : r.erro.codigo).toBe('GRAFO_CICLICO')
        if (r.ok) return
        const ciclo = r.erro.detalhe
          .slice('ciclo: '.length)
          .split(' -> ')
          .map((x) => x.slice(1, -1))
        expect(ciclo.length).toBeGreaterThanOrEqual(2)
        expect(ciclo[0]).toBe(ciclo.at(-1))
        const existentes = new Set(arestas.map((a) => `${a.de}|${a.para}`))
        for (let k = 0; k + 1 < ciclo.length; k++) {
          expect(existentes.has(`${ciclo[k] ?? ''}|${ciclo[k + 1] ?? ''}`)).toBe(true)
        }
      }),
    )
  })

  it('recusa aresta de um tópico para ele mesmo como ciclo', () => {
    const r = montarGrafo([t('a')], [aresta('a', 'a')])
    expect(r).toEqual({ ok: false, erro: { codigo: 'GRAFO_CICLICO', detalhe: "ciclo: 'item:a' -> 'item:a'" } })
  })

  it('recusa tópico repetido', () => {
    expect(montarGrafo([t('a'), t('b'), t('a')], [])).toEqual({
      ok: false,
      erro: { codigo: 'TOPICO_REPETIDO', detalhe: "tópico repetido: 'item:a'" },
    })
  })

  it('recusa aresta com tópico que não existe, de qualquer lado, e lista todas', () => {
    expect(montarGrafo([t('a')], [aresta('a', 'x'), aresta('y', 'a')])).toEqual({
      ok: false,
      erro: {
        codigo: 'ARESTA_COM_TOPICO_INEXISTENTE',
        detalhe: "aresta com tópico que não existe: 'item:a' -> 'item:x'; 'item:y' -> 'item:a'",
      },
    })
  })

  it('recusa aresta repetida, mesmo com outro peso', () => {
    expect(montarGrafo([t('a'), t('b')], [aresta('a', 'b', 1), aresta('a', 'b', 0.5)])).toEqual({
      ok: false,
      erro: { codigo: 'ARESTA_REPETIDA', detalhe: "aresta repetida: 'item:a' -> 'item:b'" },
    })
  })

  it('não confunde dois pares distintos cuja descrição coincide', () => {
    const topicos = [t("x' -> 'item:y"), t('z'), t('x'), t("y' -> 'item:z")]
    const arestas = [aresta("x' -> 'item:y", 'z'), aresta('x', "y' -> 'item:z")]
    expect(montarGrafo(topicos, arestas).ok).toBe(true)
  })

  it('recusa peso zero, negativo, acima de 1 ou não finito', () => {
    for (const peso of [0, -0.5, 1.5, Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(codigoDoErro([t('a'), t('b')], [aresta('a', 'b', peso)]), String(peso)).toBe('PESO_INVALIDO')
    }
    expect(codigoDoErro([t('a'), t('b')], [aresta('a', 'b', 1)])).toBeUndefined()
    expect(codigoDoErro([t('a'), t('b')], [aresta('a', 'b', Number.MIN_VALUE)])).toBeUndefined()
  })

  it('confere na ordem: tópico repetido antes de aresta quebrada, antes de peso, antes de ciclo', () => {
    const ciclo = [aresta('a', 'b'), aresta('b', 'a')]
    expect(codigoDoErro([t('a'), t('b'), t('a')], [...ciclo, aresta('a', 'x')])).toBe('TOPICO_REPETIDO')
    expect(codigoDoErro([t('a'), t('b')], [...ciclo, aresta('a', 'x', 0)])).toBe('ARESTA_COM_TOPICO_INEXISTENTE')
    expect(codigoDoErro([t('a'), t('b')], [...ciclo, aresta('a', 'b', 0)])).toBe('ARESTA_REPETIDA')
    expect(codigoDoErro([t('a'), t('b')], [aresta('a', 'b', 0), aresta('b', 'a')])).toBe('PESO_INVALIDO')
  })

  it('copia as arestas: mexer na entrada depois não muda o grafo', () => {
    const arestas = [aresta('a', 'b', 0.5)]
    const grafo = desembrulhar(montarGrafo([t('a'), t('b')], arestas))
    const primeira = arestas[0]
    if (primeira !== undefined) primeira.peso = 0.9
    expect(grafo.arestasAbaixo.get(id('a'))?.[0]?.peso).toBe(0.5)
  })
})

function item(idDoItem: string, grupos: readonly string[]): ItemBruto {
  return {
    id: idDoItem,
    rotulo: `Item ${idDoItem}`,
    aliases: [],
    categoria: 'categoria-1',
    subcategoria: 'subcategoria-1',
    grupos,
    dificuldadeAPriori: 2,
    descricao: `Descrição de ${idDoItem}`,
    classe: 'classe-1',
    vizinhos: [],
  }
}

/** Três itens e dois grupos; 'b' está nos dois, e o segundo grupo dá peso 0,5 a 'c'. */
function dados(pesoDeC = 0.5): DadosDeCatalogo {
  return {
    itens: [item('a', ['grupo-1']), item('b', ['grupo-1', 'grupo-2']), item('c', ['grupo-2'])],
    grupos: [
      { id: 'grupo-1', nome: 'Grupo 1', membros: ['a', 'b'], tracoDistintivo: { a: 'ta', b: 'tb' } },
      {
        id: 'grupo-2',
        nome: 'Grupo 2',
        membros: ['b', 'c'],
        tracoDistintivo: { b: 'tb', c: 'tc' },
        pesos: { c: pesoDeC },
      },
    ],
    vizinhancas: [],
    classes: ['classe-1'],
    categorias: [{ id: 'categoria-1', nome: 'Categoria 1', subcategorias: [{ id: 'subcategoria-1', nome: 'Sub 1' }] }],
  }
}

describe('construirGrafo', () => {
  it('com grupos ligado, monta um tópico por item e por grupo e uma aresta por membro', () => {
    const grafo = desembrulhar(construirGrafo(desembrulhar(carregarCatalogo(dados())), TECNICAS_TODAS_LIGADAS))
    expect(grafo.ordem).toEqual(['grupo:grupo-1', 'grupo:grupo-2', 'item:a', 'item:b', 'item:c'])
    expect([...grafo.topicos.keys()]).toEqual(['item:a', 'item:b', 'item:c', 'grupo:grupo-1', 'grupo:grupo-2'])
    expect([...grafo.arestasAbaixo.values()].flat()).toEqual([
      { de: 'grupo:grupo-1', para: 'item:a', peso: 1 },
      { de: 'grupo:grupo-1', para: 'item:b', peso: 1 },
      { de: 'grupo:grupo-2', para: 'item:b', peso: 1 },
      { de: 'grupo:grupo-2', para: 'item:c', peso: 0.5 },
    ])
  })

  it('com grupos desligado, monta só os tópicos de item e nenhuma aresta', () => {
    const catalogo = desembrulhar(carregarCatalogo(dados()))
    const ligado = desembrulhar(construirGrafo(catalogo, TECNICAS_TODAS_LIGADAS))
    const desligado = desembrulhar(construirGrafo(catalogo, { ...TECNICAS_TODAS_LIGADAS, grupos: false }))
    expect([...ligado.topicos.values()].some((x) => x.tipo === 'grupo')).toBe(true)
    expect([...desligado.topicos.values()].map((x) => x.tipo)).toEqual(['item', 'item', 'item'])
    expect([...desligado.arestasAbaixo.values()].flat()).toEqual([])
    expect(desembrulhar(construirGrafo(catalogo, TECNICAS_TODAS_DESLIGADAS)).topicos.size).toBe(3)
  })

  it('recusa o peso acima de 1 que o catálogo aceita', () => {
    const r = construirGrafo(desembrulhar(carregarCatalogo(dados(2))), TECNICAS_TODAS_LIGADAS)
    expect(r.ok ? undefined : r.erro.codigo).toBe('PESO_INVALIDO')
  })

  it('dá peso 1 ao membro cujo id é uma chave herdada de Object.prototype', () => {
    const base = dados()
    const comConstructor: DadosDeCatalogo = {
      ...base,
      itens: [...base.itens, item('constructor', ['grupo-3']), item('d', ['grupo-3'])],
      grupos: [
        ...base.grupos,
        {
          id: 'grupo-3',
          nome: 'Grupo 3',
          membros: ['constructor', 'd'],
          tracoDistintivo: { constructor: 't', d: 't' },
          pesos: {},
        },
      ],
    }
    const grafo = desembrulhar(construirGrafo(desembrulhar(carregarCatalogo(comConstructor)), TECNICAS_TODAS_LIGADAS))
    expect(grafo.arestasAbaixo.get('grupo:grupo-3' as IdTopico)?.map((a) => a.peso)).toEqual([1, 1])
  })
})

describe('fechoDescendente e fechoAscendente', () => {
  it('seguem as arestas por mais de uma camada, sem o próprio tópico', () => {
    const grafo = desembrulhar(
      montarGrafo(
        [t('a'), t('b'), t('c'), t('d')],
        [aresta('a', 'b'), aresta('b', 'c'), aresta('a', 'c'), aresta('d', 'c')],
      ),
    )
    expect([...fechoDescendente(grafo, id('a'))]).toEqual([id('b'), id('c')])
    expect([...fechoAscendente(grafo, id('c'))]).toEqual([id('b'), id('a'), id('d')])
    expect(fechoDescendente(grafo, id('c')).size).toBe(0)
    expect(fechoAscendente(grafo, id('a')).size).toBe(0)
  })

  it('são inversos: u desce de v se e só se v sobe de u', () => {
    fc.assert(
      fc.property(dag, ({ topicos, arestas }) => {
        const grafo = desembrulhar(montarGrafo(topicos, arestas))
        for (const v of topicos) {
          expect(fechoDescendente(grafo, v.id).has(v.id)).toBe(false)
          for (const u of topicos) {
            expect(fechoDescendente(grafo, v.id).has(u.id)).toBe(fechoAscendente(grafo, u.id).has(v.id))
          }
        }
      }),
    )
  })

  it('alcançam exatamente os tópicos ligados por caminho de arestas', () => {
    fc.assert(
      fc.property(dag, ({ topicos, arestas }) => {
        const grafo = desembrulhar(montarGrafo(topicos, arestas))
        // Fecho transitivo pela definição, repetindo a composição até parar de crescer.
        const alcanca = new Set(arestas.map((a) => `${a.de}|${a.para}`))
        for (let mudou = true; mudou;) {
          mudou = false
          for (const a of arestas) {
            for (const x of topicos) {
              if (alcanca.has(`${a.para}|${x.id}`) && !alcanca.has(`${a.de}|${x.id}`)) {
                alcanca.add(`${a.de}|${x.id}`)
                mudou = true
              }
            }
          }
        }
        for (const v of topicos) {
          const esperado = topicos.filter((u) => alcanca.has(`${v.id}|${u.id}`)).map((u) => u.id)
          expect([...fechoDescendente(grafo, v.id)].sort()).toEqual(esperado.sort())
        }
      }),
    )
  })
})

describe('preRequisitos', () => {
  it('devolve os membros de um grupo e nada para um item', () => {
    const grafo = desembrulhar(construirGrafo(desembrulhar(carregarCatalogo(dados())), TECNICAS_TODAS_LIGADAS))
    expect(preRequisitos(grafo, 'grupo:grupo-2' as IdTopico)).toEqual(['item:b', 'item:c'])
    expect(preRequisitos(grafo, 'item:a' as IdTopico)).toEqual([])
  })
})

describe('fronteira', () => {
  it('libera o grupo só quando todos os membros estão concluídos', () => {
    const grafo = desembrulhar(construirGrafo(desembrulhar(carregarCatalogo(dados())), TECNICAS_TODAS_LIGADAS))
    const concluidos = (...ids: string[]): ReadonlySet<IdTopico> => new Set(ids as IdTopico[])
    expect(fronteira(grafo, concluidos())).toEqual(['item:a', 'item:b', 'item:c'])
    expect(fronteira(grafo, concluidos('item:a', 'item:b'))).toEqual(['item:c', 'grupo:grupo-1'])
    expect(fronteira(grafo, concluidos('item:a', 'item:b', 'item:c', 'grupo:grupo-1'))).toEqual(['grupo:grupo-2'])
  })

  it('é o conjunto dos não concluídos com todos os pré-requisitos concluídos', () => {
    fc.assert(
      fc.property(
        dag.chain((g) => fc.record({ g: fc.constant(g), concluidos: fc.subarray(g.topicos.map((x) => x.id)) })),
        ({ g, concluidos }) => {
          const grafo = desembrulhar(montarGrafo(g.topicos, g.arestas))
          const feitos = new Set(concluidos)
          const esperado = g.topicos
            .map((x) => x.id)
            .filter((x) => !feitos.has(x) && g.arestas.every((a) => a.de !== x || feitos.has(a.para)))
          expect(fronteira(grafo, feitos)).toEqual(esperado)
        },
      ),
    )
  })
})
