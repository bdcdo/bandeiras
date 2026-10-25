import fc from 'fast-check'
import { describe, expect, it } from 'vitest'
import { desembrulhar } from '../base/resultado'
import { carregarCatalogo, type CodigoDeErroDeCatalogo } from './carregar-catalogo'
import { normalizarRotulo } from './normalizacao'
import type { DadosDeCatalogo, GrupoBruto, IdGrupo, IdItem, IdVizinhanca, ItemBruto, VizinhancaBruta } from './tipos'

// Catálogo pequeno escrito à mão: três itens, um grupo, uma vizinhança, duas classes, uma categoria com duas
// subcategorias.
function dadosMinimos(): DadosDeCatalogo {
  return {
    itens: [
      {
        id: 'a',
        rotulo: 'Item A',
        aliases: ['Apelido A'],
        categoria: 'categoria-1',
        subcategoria: 'subcategoria-1',
        grupos: ['grupo-1'],
        dificuldadeAPriori: 2,
        descricao: 'Descrição de A',
        classe: 'classe-1',
        vizinhos: ['b', 'c'],
      },
      {
        id: 'b',
        rotulo: 'Item B',
        aliases: [],
        categoria: 'categoria-1',
        subcategoria: 'subcategoria-2',
        grupos: ['grupo-1'],
        dificuldadeAPriori: 3,
        descricao: 'Descrição de B',
        classe: 'classe-2',
        vizinhos: ['a'],
        tracoVizinhanca: 'traço de B na vizinhança',
      },
      {
        id: 'c',
        rotulo: 'Item C',
        aliases: [],
        categoria: 'categoria-1',
        subcategoria: 'subcategoria-1',
        grupos: [],
        dificuldadeAPriori: 1,
        descricao: 'Descrição de C',
        classe: 'classe-1',
        vizinhos: [],
      },
    ],
    grupos: [
      {
        id: 'grupo-1',
        nome: 'Grupo 1',
        membros: ['a', 'b'],
        paresIndiscerniveis: [['a', 'b']],
        tracoDistintivo: { a: 'traço de A', b: 'traço de B' },
        pesos: { a: 0.5 },
      },
    ],
    vizinhancas: [
      { id: 'vizinhanca-1', nome: 'Vizinhança 1', membros: ['b', 'c'], tracoDistintivo: { b: 'tb', c: 'tc' } },
    ],
    classes: ['classe-1', 'classe-2'],
    categorias: [
      {
        id: 'categoria-1',
        nome: 'Categoria 1',
        subcategorias: [
          { id: 'subcategoria-1', nome: 'Subcategoria 1' },
          { id: 'subcategoria-2', nome: 'Subcategoria 2' },
        ],
      },
    ],
  }
}

// Gerador de catálogos válidos. Ids previsíveis (i0, i1, ...), rótulos e aliases de texto Unicode qualquer, únicos
// depois de normalizados; grupos de 2 a n - 1 membros, para sempre sobrar um item fora de cada grupo.
type Minimos = { grupos?: number; vizinhancas?: number; categorias?: number }

const formaValida = fc
  .string({ unit: 'grapheme', minLength: 1, maxLength: 10 })
  .filter((s) => normalizarRotulo(s) !== '')
const descricaoValida = fc.string({ minLength: 1, maxLength: 20 }).filter((s) => s.trim() !== '')

function catalogoValido(minimos: Minimos = {}): fc.Arbitrary<DadosDeCatalogo> {
  return fc.integer({ min: 3, max: 8 }).chain((n) => {
    const ids = Array.from({ length: n }, (_, k) => `i${String(k)}`)
    const grupo = fc.record({
      membros: fc.shuffledSubarray(ids, { minLength: 2, maxLength: n - 1 }),
      comPar: fc.boolean(),
      peso: fc.option(fc.double({ min: 0.01, max: 10, noNaN: true }), { nil: undefined }),
    })
    return fc
      .record({
        formas: fc.uniqueArray(formaValida, { selector: normalizarRotulo, minLength: n, maxLength: 3 * n }),
        subcategoriasPorCategoria: fc.array(fc.integer({ min: 1, max: 3 }), {
          minLength: minimos.categorias ?? 1,
          maxLength: 3,
        }),
        nClasses: fc.integer({ min: 1, max: 4 }),
        escolhas: fc.array(
          fc.record({
            categoria: fc.nat(),
            subcategoria: fc.nat(),
            classe: fc.nat(),
            dificuldade: fc.constantFrom(1, 2, 3),
            descricao: descricaoValida,
            tracoVizinhanca: fc.option(fc.string(), { nil: undefined }),
          }),
          { minLength: n, maxLength: n },
        ),
        grupos: fc.array(grupo, { minLength: minimos.grupos ?? 0, maxLength: 3 }),
        vizinhancas: fc.array(fc.shuffledSubarray(ids, { minLength: 2 }), {
          minLength: minimos.vizinhancas ?? 0,
          maxLength: 3,
        }),
        vizinhos: fc.tuple(
          ...ids.map((id) =>
            fc.shuffledSubarray(
              ids.filter((outro) => outro !== id),
              { maxLength: Math.min(6, n - 1) },
            ),
          ),
        ),
      })
      .map((g): DadosDeCatalogo => {
        const categorias = g.subcategoriasPorCategoria.map((nSub, c) => ({
          id: `categoria-${String(c)}`,
          nome: `Categoria ${String(c)}`,
          // Os mesmos ids de subcategoria em categorias diferentes: a unicidade vale só dentro da categoria.
          subcategorias: Array.from({ length: nSub }, (_, s) => ({
            id: `subcategoria-${String(s)}`,
            nome: `Sub ${String(s)}`,
          })),
        }))
        const grupos: GrupoBruto[] = g.grupos.map((gr, k) => ({
          id: `grupo-${String(k)}`,
          nome: `Grupo ${String(k)}`,
          membros: gr.membros,
          tracoDistintivo: Object.fromEntries(gr.membros.map((m) => [m, `traço de ${m}`])),
          ...(gr.comPar ? { paresIndiscerniveis: [gr.membros.slice(0, 2)] } : {}),
          ...(gr.peso === undefined ? {} : { pesos: { [gr.membros[0] ?? '']: gr.peso } }),
        }))
        const itens = ids.map((id, k): ItemBruto => {
          const e = g.escolhas[k]
          if (e === undefined) throw new Error('escolha faltando no gerador')
          const categoria = categorias[e.categoria % categorias.length]
          if (categoria === undefined) throw new Error('categoria faltando no gerador')
          const subcategoria = categoria.subcategorias[e.subcategoria % categoria.subcategorias.length]
          return {
            id,
            rotulo: g.formas[k] ?? '',
            aliases: g.formas.slice(n).filter((_, j) => j % n === k),
            categoria: categoria.id,
            subcategoria: subcategoria?.id ?? '',
            grupos: grupos.filter((gr) => gr.membros.includes(id)).map((gr) => gr.id),
            dificuldadeAPriori: e.dificuldade,
            descricao: e.descricao,
            classe: `classe-${String(e.classe % g.nClasses)}`,
            vizinhos: g.vizinhos[k] ?? [],
            ...(e.tracoVizinhanca === undefined ? {} : { tracoVizinhanca: e.tracoVizinhanca }),
          }
        })
        return {
          itens,
          grupos,
          vizinhancas: g.vizinhancas.map((membros, k) => ({
            id: `vizinhanca-${String(k)}`,
            nome: `Vizinhança ${String(k)}`,
            membros,
            tracoDistintivo: Object.fromEntries(membros.map((m) => [m, `traço de ${m}`])),
          })),
          classes: Array.from({ length: g.nClasses }, (_, k) => `classe-${String(k)}`),
          categorias,
        }
      })
  })
}

function posicao<T>(xs: readonly T[], k: number): T {
  const x = xs[k]
  if (x === undefined) throw new Error(`o cenário pede uma lista com a posição ${String(k)}`)
  return x
}
const primeiro = <T>(xs: readonly T[]): T => posicao(xs, 0)
/** O registro depois do de posição k, dando a volta no fim da lista. */
const seguinte = <T>(xs: readonly T[], k: number): T => posicao(xs, (k + 1) % xs.length)

const naPosicao = <T>(xs: readonly T[], k: number, mudanca: (x: T) => T): T[] =>
  xs.map((x, j) => (j === k ? mudanca(x) : x))

const comItem = (d: DadosDeCatalogo, k: number, mudanca: (i: ItemBruto) => ItemBruto): DadosDeCatalogo => ({
  ...d,
  itens: naPosicao(d.itens, k, mudanca),
})
const comItemDeId = (d: DadosDeCatalogo, id: string, mudanca: (i: ItemBruto) => ItemBruto): DadosDeCatalogo =>
  comItem(
    d,
    d.itens.findIndex((i) => i.id === id),
    mudanca,
  )
const comGrupo = (d: DadosDeCatalogo, k: number, mudanca: (g: GrupoBruto) => GrupoBruto): DadosDeCatalogo => ({
  ...d,
  grupos: naPosicao(d.grupos, k, mudanca),
})
const comVizinhanca = (
  d: DadosDeCatalogo,
  k: number,
  mudanca: (v: VizinhancaBruta) => VizinhancaBruta,
): DadosDeCatalogo => ({
  ...d,
  vizinhancas: naPosicao(d.vizinhancas, k, mudanca),
})
const semChave = (registro: Readonly<Record<string, string>>, chave: string): Record<string, string> =>
  Object.fromEntries(Object.entries(registro).filter(([k]) => k !== chave))

/**
 * Altera a entrada em profundidade, como faria quem chamou depois da carga: toda lista ganha um elemento e todo objeto
 * ganha uma chave, dos registros de item e grupo ao traço distintivo, aos pesos e a cada par indiscernível.
 */
function mexerEmTudo(valor: unknown): void {
  if (Array.isArray(valor)) {
    for (const x of valor) mexerEmTudo(x)
    valor.push('intruso')
  } else if (typeof valor === 'object' && valor !== null) {
    for (const x of Object.values(valor)) mexerEmTudo(x)
    Object.assign(valor, { intruso: 'intruso' })
  }
}

type Colecao = 'itens' | 'grupos' | 'vizinhancas' | 'categorias'

/**
 * Uma forma de quebrar uma invariante no registro de posição k da coleção `em`, sem quebrar nenhuma que venha antes
 * dela na ordem de verificação. Aplicada em duas posições, quebra a invariante em dois registros.
 */
type Violacao = { em: Colecao; violar: (d: DadosDeCatalogo, k: number) => DadosDeCatalogo }

const noItem = (mudanca: (i: ItemBruto, d: DadosDeCatalogo, k: number) => ItemBruto): Violacao => ({
  em: 'itens',
  violar: (d, k) => comItem(d, k, (i) => mudanca(i, d, k)),
})
const noGrupo = (mudanca: (g: GrupoBruto) => GrupoBruto): Violacao => ({
  em: 'grupos',
  violar: (d, k) => comGrupo(d, k, mudanca),
})
const naVizinhanca = (mudanca: (v: VizinhancaBruta) => VizinhancaBruta): Violacao => ({
  em: 'vizinhancas',
  violar: (d, k) => comVizinhanca(d, k, mudanca),
})
/** No item que `escolher` aponta a partir do grupo de posição k: as invariantes de 5 cruzam item e grupo. */
const noItemDoGrupo = (
  escolher: (g: GrupoBruto, d: DadosDeCatalogo) => string,
  mudanca: (i: ItemBruto, g: GrupoBruto) => ItemBruto,
): Violacao => ({
  em: 'grupos',
  violar: (d, k) => {
    const g = posicao(d.grupos, k)
    return comItemDeId(d, escolher(g, d), (i) => mudanca(i, g))
  },
})
const primeiroMembro = (g: GrupoBruto): string => primeiro(g.membros)
function foraDoGrupo(g: GrupoBruto, d: DadosDeCatalogo): string {
  const fora = d.itens.find((i) => !g.membros.includes(i.id))
  if (fora === undefined) throw new Error('o gerador deixa sempre um item fora de cada grupo')
  return fora.id
}

/** Uma violação por invariante. O tipo obriga a tabela a cobrir todo código de erro. */
const VIOLACOES: Record<CodigoDeErroDeCatalogo, Violacao> = {
  ID_DE_ITEM_REPETIDO: { em: 'itens', violar: (d, k) => ({ ...d, itens: [...d.itens, posicao(d.itens, k)] }) },
  ID_DE_GRUPO_REPETIDO: { em: 'grupos', violar: (d, k) => ({ ...d, grupos: [...d.grupos, posicao(d.grupos, k)] }) },
  ID_DE_VIZINHANCA_REPETIDO: {
    em: 'vizinhancas',
    violar: (d, k) => ({ ...d, vizinhancas: [...d.vizinhancas, posicao(d.vizinhancas, k)] }),
  },
  ID_DE_CATEGORIA_REPETIDO: {
    em: 'categorias',
    violar: (d, k) => ({ ...d, categorias: [...d.categorias, posicao(d.categorias, k)] }),
  },
  ID_DE_SUBCATEGORIA_REPETIDO: {
    em: 'categorias',
    violar: (d, k) => ({
      ...d,
      categorias: naPosicao(d.categorias, k, (c) => ({
        ...c,
        subcategorias: [...c.subcategorias, primeiro(c.subcategorias)],
      })),
    }),
  },
  ROTULO_VAZIO: noItem((i) => ({ ...i, rotulo: ' - ' })),
  ROTULO_AMBIGUO: noItem((i, d, k) => ({ ...i, aliases: [...i.aliases, seguinte(d.itens, k).rotulo] })),
  ROTULO_REPETIDO: noItem((i) => ({ ...i, aliases: [...i.aliases, i.rotulo] })),
  DESCRICAO_VAZIA: noItem((i) => ({ ...i, descricao: '  ' })),
  CATEGORIA_INEXISTENTE: noItem((i) => ({ ...i, categoria: 'categoria-inexistente' })),
  SUBCATEGORIA_INEXISTENTE: noItem((i) => ({ ...i, subcategoria: 'subcategoria-inexistente' })),
  CLASSE_INEXISTENTE: noItem((i) => ({ ...i, classe: 'classe-inexistente' })),
  DIFICULDADE_INVALIDA: noItem((i) => ({ ...i, dificuldadeAPriori: 4 })),
  GRUPO_COM_MENOS_DE_DOIS_MEMBROS: noGrupo((g) => ({ ...g, membros: [primeiro(g.membros)] })),
  GRUPO_COM_MEMBRO_INEXISTENTE: noGrupo((g) => ({ ...g, membros: [...g.membros, 'inexistente'] })),
  GRUPO_COM_MEMBRO_REPETIDO: noGrupo((g) => ({ ...g, membros: [...g.membros, primeiro(g.membros)] })),
  GRUPO_SEM_TRACO_DE_MEMBRO: noGrupo((g) => ({
    ...g,
    tracoDistintivo: semChave(g.tracoDistintivo, primeiro(g.membros)),
  })),
  GRUPO_COM_TRACO_DE_NAO_MEMBRO: noGrupo((g) => ({
    ...g,
    tracoDistintivo: { ...g.tracoDistintivo, inexistente: 'traço' },
  })),
  GRUPO_COM_PAR_INVALIDO: noGrupo((g) => ({ ...g, paresIndiscerniveis: [[primeiro(g.membros), primeiro(g.membros)]] })),
  GRUPO_COM_PESO_DE_NAO_MEMBRO: noGrupo((g) => ({ ...g, pesos: { inexistente: 1 } })),
  GRUPO_COM_PESO_INVALIDO: noGrupo((g) => ({ ...g, pesos: { [primeiro(g.membros)]: 0 } })),
  ITEM_COM_GRUPO_INEXISTENTE: noItem((i) => ({ ...i, grupos: [...i.grupos, 'grupo-inexistente'] })),
  ITEM_COM_GRUPO_REPETIDO: noItemDoGrupo(primeiroMembro, (i, g) => ({ ...i, grupos: [...i.grupos, g.id] })),
  ITEM_NAO_E_MEMBRO_DO_GRUPO: noItemDoGrupo(foraDoGrupo, (i, g) => ({ ...i, grupos: [...i.grupos, g.id] })),
  MEMBRO_NAO_DECLARA_O_GRUPO: noItemDoGrupo(primeiroMembro, (i, g) => ({
    ...i,
    grupos: i.grupos.filter((x) => x !== g.id),
  })),
  VIZINHANCA_COM_MEMBRO_INEXISTENTE: naVizinhanca((v) => ({ ...v, membros: [...v.membros, 'inexistente'] })),
  VIZINHANCA_COM_MEMBRO_REPETIDO: naVizinhanca((v) => ({ ...v, membros: [...v.membros, primeiro(v.membros)] })),
  VIZINHANCA_SEM_TRACO_DE_MEMBRO: naVizinhanca((v) => ({
    ...v,
    tracoDistintivo: semChave(v.tracoDistintivo, primeiro(v.membros)),
  })),
  VIZINHANCA_COM_TRACO_DE_NAO_MEMBRO: naVizinhanca((v) => ({
    ...v,
    tracoDistintivo: { ...v.tracoDistintivo, inexistente: 'traço' },
  })),
  VIZINHO_INEXISTENTE: noItem((i) => ({ ...i, vizinhos: [...i.vizinhos, 'inexistente'] })),
  VIZINHO_E_O_PROPRIO_ITEM: noItem((i) => ({ ...i, vizinhos: [...i.vizinhos, i.id] })),
  VIZINHO_REPETIDO: noItem((i, d, k) => {
    const outro = seguinte(d.itens, k).id
    return { ...i, vizinhos: [outro, outro] }
  }),
}

/**
 * Violações que as da tabela acima não alcançam: a forma vazia num alias, e não só no rótulo, e a forma que só coincide
 * com outra depois de normalizada. O ` .` no fim não muda a forma normalizada, porque o ponto some e o espaço que
 * sobra é aparado, mas muda o texto cru.
 */
const VARIANTES: readonly { codigo: CodigoDeErroDeCatalogo; caso: string; violacao: Violacao }[] = [
  { codigo: 'ROTULO_VAZIO', caso: 'num alias', violacao: noItem((i) => ({ ...i, aliases: [...i.aliases, ' . '] })) },
  {
    codigo: 'ROTULO_AMBIGUO',
    caso: 'alias igual ao rótulo de outro item só depois de normalizado',
    violacao: noItem((i, d, k) => ({ ...i, aliases: [...i.aliases, `${seguinte(d.itens, k).rotulo} .`] })),
  },
  {
    codigo: 'ROTULO_REPETIDO',
    caso: 'alias igual ao rótulo só depois de normalizado',
    violacao: noItem((i) => ({ ...i, aliases: [...i.aliases, `${i.rotulo} .`] })),
  },
]

/** As ocorrências que o erro da carga lista no detalhe, depois de conferir que o código é o esperado. */
function ocorrenciasDoErro(codigo: string, dados: DadosDeCatalogo): string[] {
  const r = carregarCatalogo(dados)
  expect(r.ok ? undefined : r.erro.codigo).toBe(codigo)
  if (r.ok) return []
  // O detalhe é a descrição da invariante, dois-pontos e as ocorrências separadas por ponto e vírgula.
  return r.erro.detalhe.slice(r.erro.detalhe.indexOf(': ') + 2).split('; ')
}

describe('carregarCatalogo', () => {
  it('constrói o catálogo com os tipos e os campos da entrada', () => {
    const catalogo = desembrulhar(carregarCatalogo(dadosMinimos()))
    expect([...catalogo.itens.keys()]).toEqual(['a', 'b', 'c'])
    expect(catalogo.itens.get('a' as IdItem)).toEqual({
      id: 'a',
      rotulo: 'Item A',
      aliases: ['Apelido A'],
      categoria: 'categoria-1',
      subcategoria: 'subcategoria-1',
      grupos: ['grupo-1'],
      dificuldadeAPriori: 2,
      descricao: 'Descrição de A',
      classe: 'classe-1',
      vizinhos: ['b', 'c'],
    })
    expect(catalogo.itens.get('a' as IdItem)).not.toHaveProperty('tracoVizinhanca')
    expect(catalogo.itens.get('b' as IdItem)?.tracoVizinhanca).toBe('traço de B na vizinhança')
    expect(catalogo.grupos.get('grupo-1' as IdGrupo)).toEqual({
      id: 'grupo-1',
      nome: 'Grupo 1',
      membros: ['a', 'b'],
      paresIndiscerniveis: [['a', 'b']],
      tracoDistintivo: { a: 'traço de A', b: 'traço de B' },
      pesos: { a: 0.5 },
    })
    expect(catalogo.vizinhancas.get('vizinhanca-1' as IdVizinhanca)?.membros).toEqual(['b', 'c'])
    expect([...catalogo.classes]).toEqual(['classe-1', 'classe-2'])
    expect(catalogo.categorias.get('categoria-1')).toEqual({
      nome: 'Categoria 1',
      subcategorias: new Map([
        ['subcategoria-1', 'Subcategoria 1'],
        ['subcategoria-2', 'Subcategoria 2'],
      ]),
    })
    expect(catalogo.hash).toMatch(/^[0-9a-f]{16}$/)
  })

  it('omite pares e pesos do grupo que não os declara', () => {
    const dados = dadosMinimos()
    const semOpcionais = comGrupo(dados, 0, (g) => ({
      id: g.id,
      nome: g.nome,
      membros: g.membros,
      tracoDistintivo: g.tracoDistintivo,
    }))
    const grupo = desembrulhar(carregarCatalogo(semOpcionais)).grupos.get('grupo-1' as IdGrupo)
    expect(grupo).not.toHaveProperty('paresIndiscerniveis')
    expect(grupo).not.toHaveProperty('pesos')
  })

  it('não muda quando a entrada é alterada depois da carga', () => {
    const dados = dadosMinimos()
    const catalogo = desembrulhar(carregarCatalogo(dados))
    mexerEmTudo(dados)
    expect(catalogo).toEqual(desembrulhar(carregarCatalogo(dadosMinimos())))
  })

  it('carrega todo catálogo válido gerado ao acaso, com um item por id e grupos coerentes', () => {
    fc.assert(
      fc.property(catalogoValido(), (dados) => {
        const r = carregarCatalogo(dados)
        if (!r.ok) throw new Error(`catálogo válido recusado: ${r.erro.codigo}: ${r.erro.detalhe}`)
        expect(r.valor.itens.size).toBe(dados.itens.length)
        expect(r.valor.grupos.size).toBe(dados.grupos.length)
        for (const grupo of r.valor.grupos.values()) {
          for (const membro of grupo.membros) expect(r.valor.itens.get(membro)?.grupos).toContain(grupo.id)
        }
      }),
      { numRuns: 200 },
    )
  })

  it('relata todas as ocorrências da invariante violada', () => {
    const dados = dadosMinimos()
    const r = carregarCatalogo({ ...dados, itens: [...dados.itens, ...dados.itens.slice(0, 2), primeiro(dados.itens)] })
    expect(r).toEqual({
      ok: false,
      erro: { codigo: 'ID_DE_ITEM_REPETIDO', detalhe: "id de item repetido: 'a' (3 vezes); 'b' (2 vezes)" },
    })
  })

  it('relata a primeira invariante violada na ordem de verificação', () => {
    const dados = comItem(dadosMinimos(), 0, (i) => ({ ...i, vizinhos: ['b', 'b'], classe: 'classe-inexistente' }))
    expect(carregarCatalogo(dados)).toMatchObject({ ok: false, erro: { codigo: 'CLASSE_INEXISTENTE' } })
  })

  it('pega cada rótulo ambíguo entre itens depois da normalização', () => {
    const dados = comItem(dadosMinimos(), 1, (i) => ({ ...i, aliases: ['item-á', 'Apelido A.'] }))
    expect(carregarCatalogo(dados)).toEqual({
      ok: false,
      erro: {
        codigo: 'ROTULO_AMBIGUO',
        detalhe:
          "rótulo ou alias que, normalizado, resolve mais de um item: 'item a' em 'a', 'b'; 'apelido a' em 'a', 'b'",
      },
    })
  })

  it('não confunde id de item com chave herdada de Object.prototype', () => {
    // Com `in` ou indexação, tracoDistintivo['constructor'] acharia a função herdada e daria o traço por declarado.
    const base = dadosMinimos()
    const dados: DadosDeCatalogo = {
      ...base,
      itens: base.itens.map((i) => ({ ...i, id: i.id === 'b' ? 'constructor' : i.id, grupos: [], vizinhos: [] })),
      grupos: [],
      vizinhancas: [
        { id: 'vizinhanca-1', nome: 'Vizinhança 1', membros: ['a', 'constructor'], tracoDistintivo: { a: 'ta' } },
      ],
    }
    expect(carregarCatalogo(dados)).toEqual({
      ok: false,
      erro: {
        codigo: 'VIZINHANCA_SEM_TRACO_DE_MEMBRO',
        detalhe: "membro de vizinhança sem traço distintivo: vizinhança 'vizinhanca-1': 'constructor'",
      },
    })
  })

  it('recusa dificuldade fracionária ou fora da faixa', () => {
    for (const dificuldade of [0, 1.5, 4, Number.NaN]) {
      const dados = comItem(dadosMinimos(), 0, (i) => ({ ...i, dificuldadeAPriori: dificuldade }))
      expect(carregarCatalogo(dados)).toMatchObject({ ok: false, erro: { codigo: 'DIFICULDADE_INVALIDA' } })
    }
  })

  it('recusa par indiscernível incompleto, com estranho ou repetido', () => {
    for (const par of [['a'], ['a', 'c'], ['a', 'a'], ['a', 'b', 'a']]) {
      const dados = comGrupo(dadosMinimos(), 0, (g) => ({ ...g, paresIndiscerniveis: [par] }))
      expect(carregarCatalogo(dados)).toMatchObject({ ok: false, erro: { codigo: 'GRUPO_COM_PAR_INVALIDO' } })
    }
  })

  it('recusa peso negativo, nulo ou não finito', () => {
    for (const peso of [-1, 0, Number.NaN, Number.POSITIVE_INFINITY]) {
      const dados = comGrupo(dadosMinimos(), 0, (g) => ({ ...g, pesos: { a: peso } }))
      expect(carregarCatalogo(dados)).toMatchObject({ ok: false, erro: { codigo: 'GRUPO_COM_PESO_INVALIDO' } })
    }
  })

  describe('cada invariante violada devolve o próprio código, com as ocorrências de cada registro que a viola', () => {
    const casos = [
      ...Object.entries(VIOLACOES).map(([codigo, violacao]) => ({ nome: codigo, codigo, violacao })),
      ...VARIANTES.map(({ codigo, caso, violacao }) => ({ nome: `${codigo}, ${caso}`, codigo, violacao })),
    ]
    for (const { nome, codigo, violacao } of casos) {
      const { em, violar } = violacao
      it(nome, () => {
        fc.assert(
          fc.property(
            catalogoValido({ grupos: 2, vizinhancas: 2, categorias: 2 }),
            fc.nat(),
            fc.nat(),
            (dados, a, b) => {
              expect(carregarCatalogo(dados).ok).toBe(true)
              // Duas posições distintas da coleção, sorteadas: a violação não fica presa ao primeiro registro.
              const tamanho = dados[em].length
              const j = a % tamanho
              const k = (j + 1 + (b % (tamanho - 1))) % tamanho
              const emJ = ocorrenciasDoErro(codigo, violar(dados, j))
              const emK = ocorrenciasDoErro(codigo, violar(dados, k))
              const nasDuas = ocorrenciasDoErro(codigo, violar(violar(dados, j), k))
              expect(nasDuas).toEqual(expect.arrayContaining([...emJ, ...emK]))
            },
          ),
          { numRuns: 50 },
        )
      })
    }
  })
})

describe('hash do catálogo', () => {
  const hash = (dados: DadosDeCatalogo): string => desembrulhar(carregarCatalogo(dados)).hash

  it('não depende da ordem em que as chaves foram escritas', () => {
    const dados = dadosMinimos()
    const invertido = Object.fromEntries(Object.entries(dados).reverse()) as DadosDeCatalogo
    const itensComChavesInvertidas = {
      ...dados,
      itens: dados.itens.map((i) => Object.fromEntries(Object.entries(i).reverse()) as ItemBruto),
    }
    expect(hash(invertido)).toBe(hash(dados))
    expect(hash(itensComChavesInvertidas)).toBe(hash(dados))
  })

  it('muda quando um valor muda', () => {
    const dados = dadosMinimos()
    expect(hash(comItem(dados, 0, (i) => ({ ...i, descricao: 'Outra descrição' })))).not.toBe(hash(dados))
  })

  it('muda quando a ordem de uma lista muda', () => {
    const dados = dadosMinimos()
    expect(hash({ ...dados, itens: [...dados.itens].reverse() })).not.toBe(hash(dados))
  })

  it('trata chave com undefined como ausente, como o JSON', () => {
    const dados = dadosMinimos()
    const comUndefined = { ...dados, itens: dados.itens.map((i) => ({ ...i, extra: undefined })) }
    expect(hash(comUndefined)).toBe(hash(dados))
  })
})
