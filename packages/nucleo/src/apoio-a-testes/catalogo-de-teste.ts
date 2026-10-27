import { desembrulhar } from '../base/resultado'
import { carregarCatalogo } from '../catalogo/carregar-catalogo'
import type { Catalogo, DadosDeCatalogo, GrupoBruto, IdItem, ItemBruto, VizinhancaBruta } from '../catalogo/tipos'

/**
 * Descrição compacta de um catálogo genérico, por índice de item, para os testes de propriedade sortearem: o item k tem o
 * id da k-ésima letra (`'a'`, `'b'`, ...), rótulo `Item A`, a classe `classe-<c>` e a categoria `categoria-<c>` dos
 * índices dados, e tantos aliases quanto pedido. O teste sorteia a descrição, e `catalogoDe` cuida das invariantes que o
 * catálogo exige: membros e vizinhos sem repetição, sem o próprio item, e `grupos` de cada item coerente com os membros.
 */
export type EspecificacaoDeCatalogo = Readonly<{
  classes: readonly number[]
  categorias: readonly number[]
  aliases: readonly number[]
  vizinhos: readonly (readonly number[])[]
  /** Membros por índice; com `par`, os dois primeiros membros distintos formam um par indiscernível. */
  grupos: readonly Readonly<{ membros: readonly number[]; par: boolean }>[]
  vizinhancas: readonly (readonly number[])[]
}>

const LETRAS = 'abcdefghijklmnopqrstuvwxyz'

/** Id do item de índice k: a letra, e depois da vigésima sexta, a letra com o número da volta. */
export function idDeTeste(k: number): IdItem {
  const letra = LETRAS[k % LETRAS.length] ?? 'a'
  const volta = Math.floor(k / LETRAS.length)
  return (volta === 0 ? letra : `${letra}${String(volta)}`) as IdItem
}

const unicos = (xs: readonly number[]): number[] => [...new Set(xs)]

/**
 * Catálogo fixo dos casos escritos à mão, com doze itens de `a` a `l`:
 *
 * | item | classe | categoria | grupos  | vizinhos | aliases |
 * |------|--------|-----------|---------|----------|---------|
 * | a    | 1      | 1         | grupo-1 |          | 1       |
 * | b    | 1      | 1         | grupo-1 |          | 2       |
 * | c    | 1      | 2         | grupo-1 | g        |         |
 * | d    | 1      | 2         | grupo-1 |          |         |
 * | e    | 2      | 1         | grupo-2 | a, g     |         |
 * | f    | 2      | 2         | grupo-2 | h, i     |         |
 * | g    | 1      | 1         |         |          |         |
 * | h    | 2      | 2         |         |          |         |
 * | i    | 3      | 1         |         |          |         |
 * | j    | 3      | 2         |         |          |         |
 * | k    | 4      | 1         |         |          |         |
 * | l    | 4      | 2         |         |          |         |
 *
 * `a` e `b` são o par indiscernível do grupo-1; `i` e `j` dividem a vizinhanca-1.
 */
export const ESPECIFICACAO_FIXA: EspecificacaoDeCatalogo = {
  classes: [1, 1, 1, 1, 2, 2, 1, 2, 3, 3, 4, 4],
  categorias: [1, 1, 2, 2, 1, 2, 1, 2, 1, 2, 1, 2],
  aliases: [1, 2],
  vizinhos: [[], [], [6], [], [0, 6], [7, 8]],
  grupos: [
    { membros: [0, 1, 2, 3], par: true },
    { membros: [4, 5], par: false },
  ],
  vizinhancas: [[8, 9]],
}

export function catalogoFixo(): Catalogo {
  return catalogoDe(ESPECIFICACAO_FIXA)
}

export function catalogoDe(espec: EspecificacaoDeCatalogo): Catalogo {
  return desembrulhar(carregarCatalogo(dadosDe(espec)))
}

/** Os dados crus do catálogo descrito, antes da carga, para o teste que quer mexer neles antes de carregar. */
export function dadosDe(espec: EspecificacaoDeCatalogo): DadosDeCatalogo {
  const id = (k: number): string => idDeTeste(k)
  const grupos: GrupoBruto[] = espec.grupos.flatMap((g, j) => {
    const membros = unicos(g.membros)
    if (membros.length < 2) return []
    const ids = membros.map(id)
    const [a, b] = ids
    return [
      {
        id: `grupo-${String(j + 1)}`,
        nome: `Grupo ${String(j + 1)}`,
        membros: ids,
        tracoDistintivo: Object.fromEntries(ids.map((m) => [m, `traço de ${m} no grupo-${String(j + 1)}`])),
        ...(g.par && a !== undefined && b !== undefined ? { paresIndiscerniveis: [[a, b]] } : {}),
      },
    ]
  })
  const vizinhancas: VizinhancaBruta[] = espec.vizinhancas.flatMap((v, j) => {
    const ids = unicos(v).map(id)
    if (ids.length < 2) return []
    return [
      {
        id: `vizinhanca-${String(j + 1)}`,
        nome: `Vizinhança ${String(j + 1)}`,
        membros: ids,
        tracoDistintivo: Object.fromEntries(ids.map((m) => [m, `traço de ${m} na vizinhanca-${String(j + 1)}`])),
      },
    ]
  })
  const itens: ItemBruto[] = espec.classes.map((classe, k) => ({
    id: id(k),
    rotulo: `Item ${id(k).toUpperCase()}`,
    aliases: Array.from({ length: espec.aliases[k] ?? 0 }, (_, a) => `Apelido ${id(k).toUpperCase()} ${String(a + 1)}`),
    categoria: `categoria-${String(espec.categorias[k] ?? 0)}`,
    subcategoria: 'subcategoria-1',
    grupos: grupos.filter((g) => g.membros.includes(id(k))).map((g) => g.id),
    dificuldadeAPriori: 2,
    descricao: `Descrição de ${id(k)}`,
    classe: `classe-${String(classe)}`,
    vizinhos: unicos(espec.vizinhos[k] ?? [])
      .filter((v) => v !== k)
      .map(id),
  }))
  const categorias = [...new Set(itens.map((i) => i.categoria))]
  return {
    itens,
    grupos,
    vizinhancas,
    classes: [...new Set(itens.map((i) => i.classe))],
    categorias: categorias.map((c) => ({ id: c, nome: c, subcategorias: [{ id: 'subcategoria-1', nome: 'Sub 1' }] })),
  }
}

/**
 * O catálogo fixo sem um item e sem um grupo, como o catálogo depois de uma curadoria que os tirou. Um log gravado sobre
 * o catálogo fixo cita o que este não tem, e a reconstrução sobre ele precisa absorver as referências sem falhar. O item
 * sai também dos grupos, das vizinhanças e dos vizinhos dos outros, e o grupo, dos grupos de cada item.
 */
export function catalogoFixoSem(item: IdItem, grupo: string): Catalogo {
  const dados = dadosDe(ESPECIFICACAO_FIXA)
  const semItem = (ids: readonly string[]): string[] => ids.filter((i) => i !== item)
  const semChave = (r: Readonly<Record<string, string>>): Record<string, string> =>
    Object.fromEntries(Object.entries(r).filter(([k]) => k !== item))
  return desembrulhar(
    carregarCatalogo({
      ...dados,
      itens: dados.itens
        .filter((i) => i.id !== item)
        .map((i) => ({ ...i, grupos: i.grupos.filter((g) => g !== grupo), vizinhos: semItem(i.vizinhos) })),
      grupos: dados.grupos
        .filter((g) => g.id !== grupo)
        .map((g) => ({
          ...g,
          membros: semItem(g.membros),
          tracoDistintivo: semChave(g.tracoDistintivo),
          ...(g.paresIndiscerniveis === undefined
            ? {}
            : { paresIndiscerniveis: g.paresIndiscerniveis.filter((p) => !p.includes(item)) }),
        })),
      vizinhancas: dados.vizinhancas.map((v) => ({
        ...v,
        membros: semItem(v.membros),
        tracoDistintivo: semChave(v.tracoDistintivo),
      })),
    }),
  )
}
