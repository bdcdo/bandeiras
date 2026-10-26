import fc from 'fast-check'
import { describe, expect, it } from 'vitest'
import { desembrulhar } from '../base/resultado'
import { carregarCatalogo } from '../catalogo/carregar-catalogo'
import type { DadosDeCatalogo, IdGrupo, IdItem, ItemBruto } from '../catalogo/tipos'
import { topicoDeGrupo, topicoDeItem, type IdTopico } from '../grafo/topico'
import { acuraciaInicial, atualizarAcuracia } from './acuracia'
import { estadoMemoriaInicial, type EstadoMemoria } from './estado-memoria'
import { PARAMETROS_PADRAO as P } from './parametros'

describe('atualizarAcuracia', () => {
  it('puxa a acurácia para 1 no acerto e para 0 no erro, com alfa vezes o peso', () => {
    const e = estadoMemoriaInicial(0.85)
    expect(atualizarAcuracia(e, true, 1, P).acuracia).toBeCloseTo(0.7 * 0.85 + 0.3, 12)
    expect(atualizarAcuracia(e, false, 1, P).acuracia).toBeCloseTo(0.7 * 0.85, 12)
    expect(atualizarAcuracia(e, true, 0.5, P).acuracia).toBeCloseTo(0.85 * 0.85 + 0.15, 12)
    expect(atualizarAcuracia(e, true, 1, P).nAvaliacoes).toBe(1)
  })

  it('com a direção, muda a acurácia dela e deixa as outras direções', () => {
    const e = atualizarAcuracia(estadoMemoriaInicial(0.5), false, 1, P, 'recordar')
    expect(e.acuraciaPorDirecao).toEqual({ reconhecer: 0.5, produzir: 0.5, recordar: 0.35 })
    expect(atualizarAcuracia(estadoMemoriaInicial(0.5), false, 1, P).acuraciaPorDirecao).toEqual({
      reconhecer: 0.5,
      produzir: 0.5,
      recordar: 0.5,
    })
  })

  it('fica em [0, 1] e anda na direção da evidência para qualquer peso', () => {
    fc.assert(
      fc.property(
        fc.double({ min: 0, max: 1, noNaN: true }),
        fc.boolean(),
        fc.double({ min: -2, max: 5, noNaN: true }),
        (a, correta, peso) => {
          const depois = atualizarAcuracia(estadoMemoriaInicial(a), correta, peso, P).acuracia
          expect(depois).toBeGreaterThanOrEqual(0)
          expect(depois).toBeLessThanOrEqual(1)
          if (correta) expect(depois).toBeGreaterThanOrEqual(a)
          else expect(depois).toBeLessThanOrEqual(a)
        },
      ),
    )
  })
})

function item(id: string, categoria: string, subcategoria: string, grupos: readonly string[] = []): ItemBruto {
  return {
    id,
    rotulo: `Item ${id}`,
    aliases: [],
    categoria,
    subcategoria,
    grupos,
    dificuldadeAPriori: 2,
    descricao: `Descrição de ${id}`,
    classe: 'classe-1',
    vizinhos: [],
  }
}

// 'a' e 'b' formam o grupo-1; 'a' e 'c' dividem a subcategoria-1 da categoria-1; 'e' está numa subcategoria de mesmo id,
// mas em outra categoria, e por isso não é vizinho de subcategoria de 'a'.
const catalogo = desembrulhar(
  carregarCatalogo({
    itens: [
      item('a', 'categoria-1', 'subcategoria-1', ['grupo-1']),
      item('b', 'categoria-1', 'subcategoria-2', ['grupo-1']),
      item('c', 'categoria-1', 'subcategoria-1'),
      item('d', 'categoria-1', 'subcategoria-2'),
      item('e', 'categoria-2', 'subcategoria-1'),
    ],
    grupos: [{ id: 'grupo-1', nome: 'Grupo 1', membros: ['a', 'b'], tracoDistintivo: { a: 'ta', b: 'tb' } }],
    vizinhancas: [],
    classes: ['classe-1'],
    categorias: [
      {
        id: 'categoria-1',
        nome: 'Categoria 1',
        subcategorias: [
          { id: 'subcategoria-1', nome: 'Sub 1' },
          { id: 'subcategoria-2', nome: 'Sub 2' },
        ],
      },
      { id: 'categoria-2', nome: 'Categoria 2', subcategorias: [{ id: 'subcategoria-1', nome: 'Sub 1' }] },
    ],
  } satisfies DadosDeCatalogo),
)

const topico = (id: string): IdTopico => topicoDeItem(id as IdItem).id
const medido = (acuracia: number, nAvaliacoes = 3): EstadoMemoria => ({
  ...estadoMemoriaInicial(acuracia),
  nAvaliacoes,
})
const memorias = (estados: Record<string, EstadoMemoria>): ReadonlyMap<IdTopico, EstadoMemoria> =>
  new Map(Object.entries(estados).map(([id, e]) => [topico(id), e]))

describe('acuraciaInicial', () => {
  it('vale a neutra sem nenhum tópico medido', () => {
    expect(acuraciaInicial(topico('a'), catalogo, new Map(), P)).toBe(P.acuraciaNeutra)
    expect(acuraciaInicial(topico('a'), catalogo, memorias({ b: medido(0.1, 0) }), P)).toBe(P.acuraciaNeutra)
  })

  it('pondera os três anéis: grupo 0,5, subcategoria 0,3 e global 0,2', () => {
    const m = memorias({ b: medido(0.6), c: medido(0.9), d: medido(0.3) })
    // Grupo: b = 0,6. Subcategoria: c = 0,9. Global: média de b, c e d = 0,6.
    expect(acuraciaInicial(topico('a'), catalogo, m, P)).toBeCloseTo(0.5 * 0.6 + 0.3 * 0.9 + 0.2 * 0.6, 12)
  })

  it('redistribui o peso do anel vazio entre os outros na proporção deles', () => {
    // Sem membro de grupo medido: subcategoria (c = 0,9) e global (c e d, 0,6), com pesos 0,3 e 0,2 renormalizados.
    const m = memorias({ c: medido(0.9), d: medido(0.3) })
    expect(acuraciaInicial(topico('a'), catalogo, m, P)).toBeCloseTo((0.3 * 0.9 + 0.2 * 0.6) / 0.5, 12)
    // Só o global: a média dele.
    expect(acuraciaInicial(topico('a'), catalogo, memorias({ d: medido(0.3) }), P)).toBeCloseTo(0.3, 12)
  })

  it('não conta o próprio item, nem quem não foi medido, nem subcategoria de mesmo id em outra categoria', () => {
    const m = memorias({ a: medido(0.0), e: medido(0.0), b: medido(0.6), c: medido(0.9, 0) })
    // Grupo: b = 0,6. Subcategoria: vazia (c sem medida, e de outra categoria). Global: b e e, média 0,3.
    expect(acuraciaInicial(topico('a'), catalogo, m, P)).toBeCloseTo((0.5 * 0.6 + 0.2 * 0.3) / 0.7, 12)
  })

  it('dá a um grupo a média dos membros, pelo estado ou pela previsão de cada um', () => {
    const grupo = topicoDeGrupo('grupo-1' as IdGrupo).id
    expect(acuraciaInicial(grupo, catalogo, memorias({ a: medido(0.4), b: medido(0.8) }), P)).toBeCloseTo(0.6, 12)
    // 'b' sem estado: a previsão dele é a de 'a' pelo anel de grupo (0,4) e pelo global (0,4).
    expect(acuraciaInicial(grupo, catalogo, memorias({ a: medido(0.4) }), P)).toBeCloseTo(0.4, 12)
  })

  it('vale a neutra para tópico que o catálogo não conhece', () => {
    expect(acuraciaInicial(topico('inexistente'), catalogo, memorias({ b: medido(0.1) }), P)).toBe(P.acuraciaNeutra)
    expect(acuraciaInicial(topicoDeGrupo('nenhum' as IdGrupo).id, catalogo, new Map(), P)).toBe(P.acuraciaNeutra)
  })

  it('fica entre a menor e a maior acurácia medida dos outros itens', () => {
    const ids = ['a', 'b', 'c', 'd', 'e']
    fc.assert(
      fc.property(
        fc.constantFrom(...ids),
        fc.dictionary(fc.constantFrom(...ids), fc.double({ min: 0, max: 1, noNaN: true }), { minKeys: 1 }),
        (alvo, acuracias) => {
          const outras = Object.entries(acuracias).filter(([id]) => id !== alvo)
          fc.pre(outras.length > 0)
          const previsto = acuraciaInicial(
            topico(alvo),
            catalogo,
            memorias(Object.fromEntries(Object.entries(acuracias).map(([id, a]) => [id, medido(a)]))),
            P,
          )
          const valores = outras.map(([, a]) => a)
          expect(previsto).toBeGreaterThanOrEqual(Math.min(...valores) - 1e-12)
          expect(previsto).toBeLessThanOrEqual(Math.max(...valores) + 1e-12)
        },
      ),
    )
  })
})
