import { hashFnv1a } from '../base/hash'
import type { NaoVazio } from '../base/nao-vazio'
import { erro, ok, type Resultado } from '../base/resultado'
import { formasNormalizadas, normalizarRotulo } from './normalizacao'
import type {
  Catalogo,
  DadosDeCatalogo,
  Grupo,
  GrupoBruto,
  IdGrupo,
  IdItem,
  IdVizinhanca,
  Item,
  ItemBruto,
  Vizinhanca,
  VizinhancaBruta,
} from './tipos'

/** Índices dos dados de entrada que as verificações consultam. Montados uma vez, antes de qualquer verificação. */
type Contexto = {
  dados: DadosDeCatalogo
  itens: ReadonlyMap<string, ItemBruto>
  grupos: ReadonlyMap<string, GrupoBruto>
  subcategorias: ReadonlyMap<string, ReadonlySet<string>>
  classes: ReadonlySet<string>
}

type Verificacao = {
  codigo: string
  descricao: string
  /** Cada ocorrência da violação, já legível. Lista vazia: a invariante vale. */
  ocorrencias: (contexto: Contexto) => string[]
}

const aspas = (texto: string): string => `'${texto}'`

/** Cada valor que aparece mais de uma vez, com a contagem, na ordem da primeira aparição. */
function repetidos(valores: readonly string[]): string[] {
  const contagem = new Map<string, number>()
  for (const valor of valores) contagem.set(valor, (contagem.get(valor) ?? 0) + 1)
  return [...contagem]
    .filter(([, vezes]) => vezes > 1)
    .map(([valor, vezes]) => `${aspas(valor)} (${String(vezes)} vezes)`)
}

/** Prefixa cada ocorrência achada num registro com o tipo e o id dele. */
function emCada<T extends { id: string }>(
  rotulo: string,
  registros: readonly T[],
  achar: (r: T) => string[],
): string[] {
  return registros.flatMap((registro) => achar(registro).map((o) => `${rotulo} ${aspas(registro.id)}: ${o}`))
}

// Grupos e vizinhanças compartilham a forma { id, membros, tracoDistintivo } e as mesmas quatro invariantes de membros.
type Conjunto = GrupoBruto | VizinhancaBruta

const membrosInexistentes = (c: Conjunto, itens: ReadonlyMap<string, ItemBruto>): string[] =>
  c.membros.filter((m) => !itens.has(m)).map(aspas)

// Object.hasOwn, e não `in` nem indexação, porque um id de item pode coincidir com uma chave herdada de Object.prototype
// (`constructor`, `toString`), e aí o traço pareceria existir sem ter sido declarado.
const membrosSemTraco = (c: Conjunto): string[] =>
  c.membros.filter((m) => !Object.hasOwn(c.tracoDistintivo, m)).map(aspas)

const chavesForaDosMembros = (registro: Readonly<Record<string, unknown>>, c: Conjunto): string[] => {
  const membros = new Set(c.membros)
  return Object.keys(registro)
    .filter((chave) => !membros.has(chave))
    .map(aspas)
}

function parInvalido(par: readonly string[], g: GrupoBruto): boolean {
  const [a, b] = par
  return !(
    par.length === 2 &&
    a !== undefined &&
    b !== undefined &&
    a !== b &&
    g.membros.includes(a) &&
    g.membros.includes(b)
  )
}

/**
 * As invariantes do catálogo, na ordem em que são conferidas. A ordem é parte do contrato: cada verificação pressupõe as
 * anteriores (com id repetido, "o item de id x" nem é bem definido), e por isso a primeira violada é a que se relata.
 * Os números nos comentários agrupam as invariantes por classe.
 */
const VERIFICACOES = [
  // 1. Ids únicos.
  {
    codigo: 'ID_DE_ITEM_REPETIDO',
    descricao: 'id de item repetido',
    ocorrencias: ({ dados }) => repetidos(dados.itens.map((i) => i.id)),
  },
  {
    codigo: 'ID_DE_GRUPO_REPETIDO',
    descricao: 'id de grupo repetido',
    ocorrencias: ({ dados }) => repetidos(dados.grupos.map((g) => g.id)),
  },
  {
    codigo: 'ID_DE_VIZINHANCA_REPETIDO',
    descricao: 'id de vizinhança repetido',
    ocorrencias: ({ dados }) => repetidos(dados.vizinhancas.map((v) => v.id)),
  },
  {
    codigo: 'ID_DE_CATEGORIA_REPETIDO',
    descricao: 'id de categoria repetido',
    ocorrencias: ({ dados }) => repetidos(dados.categorias.map((c) => c.id)),
  },
  {
    codigo: 'ID_DE_SUBCATEGORIA_REPETIDO',
    descricao: 'id de subcategoria repetido dentro da mesma categoria',
    ocorrencias: ({ dados }) =>
      emCada('categoria', dados.categorias, (c) => repetidos(c.subcategorias.map((s) => s.id))),
  },

  // 2. Rótulos e descrições. O vazio vem antes da ambiguidade, senão dois aliases vazios apareceriam como a forma ''
  // ambígua, e não como o que são.
  {
    codigo: 'ROTULO_VAZIO',
    descricao: 'rótulo ou alias vazio depois de normalizado',
    ocorrencias: ({ dados }) =>
      emCada('item', dados.itens, (i) =>
        [i.rotulo, ...i.aliases]
          .filter((forma) => normalizarRotulo(forma) === '')
          .map((forma) => JSON.stringify(forma)),
      ),
  },
  {
    codigo: 'ROTULO_AMBIGUO',
    descricao: 'rótulo ou alias que, normalizado, resolve mais de um item',
    ocorrencias: ({ dados }) => {
      const donos = new Map<string, string[]>()
      for (const item of dados.itens) {
        for (const forma of new Set(formasNormalizadas(item))) donos.set(forma, [...(donos.get(forma) ?? []), item.id])
      }
      return [...donos]
        .filter(([, ids]) => ids.length > 1)
        .map(([forma, ids]) => `${aspas(forma)} em ${ids.map(aspas).join(', ')}`)
    },
  },
  {
    codigo: 'ROTULO_REPETIDO',
    descricao: 'rótulo ou alias que, normalizado, se repete no mesmo item',
    ocorrencias: ({ dados }) => emCada('item', dados.itens, (i) => repetidos(formasNormalizadas(i))),
  },
  {
    codigo: 'DESCRICAO_VAZIA',
    descricao: 'descrição vazia',
    ocorrencias: ({ dados }) => dados.itens.filter((i) => i.descricao.trim() === '').map((i) => `item ${aspas(i.id)}`),
  },

  // 3. Referências de cada item às listas fechadas.
  {
    codigo: 'CATEGORIA_INEXISTENTE',
    descricao: 'item em categoria que não existe',
    ocorrencias: ({ dados, subcategorias }) =>
      emCada('item', dados.itens, (i) => (subcategorias.has(i.categoria) ? [] : [aspas(i.categoria)])),
  },
  {
    codigo: 'SUBCATEGORIA_INEXISTENTE',
    descricao: 'item em subcategoria que não existe na categoria dele',
    ocorrencias: ({ dados, subcategorias }) =>
      emCada('item', dados.itens, (i) =>
        subcategorias.get(i.categoria)?.has(i.subcategoria) === true ? [] : [aspas(i.subcategoria)],
      ),
  },
  {
    codigo: 'CLASSE_INEXISTENTE',
    descricao: 'item com classe fora da lista de classes',
    ocorrencias: ({ dados, classes }) =>
      emCada('item', dados.itens, (i) => (classes.has(i.classe) ? [] : [aspas(i.classe)])),
  },
  {
    codigo: 'DIFICULDADE_INVALIDA',
    descricao: 'dificuldade a priori fora de {1, 2, 3}',
    ocorrencias: ({ dados }) =>
      emCada('item', dados.itens, (i) =>
        [1, 2, 3].includes(i.dificuldadeAPriori) ? [] : [String(i.dificuldadeAPriori)],
      ),
  },

  // 4. Grupos.
  {
    codigo: 'GRUPO_COM_MENOS_DE_DOIS_MEMBROS',
    descricao: 'grupo com menos de dois membros',
    ocorrencias: ({ dados }) =>
      emCada('grupo', dados.grupos, (g) => (g.membros.length < 2 ? [`${String(g.membros.length)} membro(s)`] : [])),
  },
  {
    codigo: 'GRUPO_COM_MEMBRO_INEXISTENTE',
    descricao: 'membro de grupo que não é item do catálogo',
    ocorrencias: ({ dados, itens }) => emCada('grupo', dados.grupos, (g) => membrosInexistentes(g, itens)),
  },
  {
    codigo: 'GRUPO_COM_MEMBRO_REPETIDO',
    descricao: 'membro repetido no grupo',
    ocorrencias: ({ dados }) => emCada('grupo', dados.grupos, (g) => repetidos(g.membros)),
  },
  {
    codigo: 'GRUPO_SEM_TRACO_DE_MEMBRO',
    descricao: 'membro de grupo sem traço distintivo',
    ocorrencias: ({ dados }) => emCada('grupo', dados.grupos, membrosSemTraco),
  },
  {
    codigo: 'GRUPO_COM_TRACO_DE_NAO_MEMBRO',
    descricao: 'traço distintivo de quem não é membro do grupo',
    ocorrencias: ({ dados }) => emCada('grupo', dados.grupos, (g) => chavesForaDosMembros(g.tracoDistintivo, g)),
  },
  {
    codigo: 'GRUPO_COM_PAR_INVALIDO',
    descricao: 'par indiscernível que não é formado por dois membros distintos do grupo',
    ocorrencias: ({ dados }) =>
      emCada('grupo', dados.grupos, (g) =>
        (g.paresIndiscerniveis ?? []).filter((par) => parInvalido(par, g)).map((par) => JSON.stringify(par)),
      ),
  },
  {
    codigo: 'GRUPO_COM_PESO_DE_NAO_MEMBRO',
    descricao: 'peso de quem não é membro do grupo',
    ocorrencias: ({ dados }) => emCada('grupo', dados.grupos, (g) => chavesForaDosMembros(g.pesos ?? {}, g)),
  },
  {
    codigo: 'GRUPO_COM_PESO_INVALIDO',
    descricao: 'peso que não é número finito maior que zero',
    ocorrencias: ({ dados }) =>
      emCada('grupo', dados.grupos, (g) =>
        Object.entries(g.pesos ?? {})
          .filter(([, peso]) => !(Number.isFinite(peso) && peso > 0))
          .map(([membro, peso]) => `${aspas(membro)} = ${String(peso)}`),
      ),
  },

  // 5. Item e grupo concordam nos dois sentidos: item.grupos, sem repetição, é exatamente o conjunto dos grupos que o
  // listam em membros.
  {
    codigo: 'ITEM_COM_GRUPO_INEXISTENTE',
    descricao: 'item declara grupo que não existe',
    ocorrencias: ({ dados, grupos }) =>
      emCada('item', dados.itens, (i) => i.grupos.filter((g) => !grupos.has(g)).map(aspas)),
  },
  {
    codigo: 'ITEM_COM_GRUPO_REPETIDO',
    descricao: 'item declara o mesmo grupo mais de uma vez',
    ocorrencias: ({ dados }) => emCada('item', dados.itens, (i) => repetidos(i.grupos)),
  },
  {
    codigo: 'ITEM_NAO_E_MEMBRO_DO_GRUPO',
    descricao: 'item declara grupo que não o lista em membros',
    ocorrencias: ({ dados, grupos }) =>
      emCada('item', dados.itens, (i) =>
        i.grupos.filter((g) => grupos.get(g)?.membros.includes(i.id) !== true).map(aspas),
      ),
  },
  {
    codigo: 'MEMBRO_NAO_DECLARA_O_GRUPO',
    descricao: 'grupo lista membro que não o declara em grupos',
    ocorrencias: ({ dados, itens }) =>
      emCada('grupo', dados.grupos, (g) =>
        g.membros.filter((m) => itens.get(m)?.grupos.includes(g.id) !== true).map(aspas),
      ),
  },

  // 6. Vizinhanças.
  {
    codigo: 'VIZINHANCA_COM_MEMBRO_INEXISTENTE',
    descricao: 'membro de vizinhança que não é item do catálogo',
    ocorrencias: ({ dados, itens }) => emCada('vizinhança', dados.vizinhancas, (v) => membrosInexistentes(v, itens)),
  },
  {
    codigo: 'VIZINHANCA_COM_MEMBRO_REPETIDO',
    descricao: 'membro repetido na vizinhança',
    ocorrencias: ({ dados }) => emCada('vizinhança', dados.vizinhancas, (v) => repetidos(v.membros)),
  },
  {
    codigo: 'VIZINHANCA_SEM_TRACO_DE_MEMBRO',
    descricao: 'membro de vizinhança sem traço distintivo',
    ocorrencias: ({ dados }) => emCada('vizinhança', dados.vizinhancas, membrosSemTraco),
  },
  {
    codigo: 'VIZINHANCA_COM_TRACO_DE_NAO_MEMBRO',
    descricao: 'traço distintivo de quem não é membro da vizinhança',
    ocorrencias: ({ dados }) =>
      emCada('vizinhança', dados.vizinhancas, (v) => chavesForaDosMembros(v.tracoDistintivo, v)),
  },

  // 7. Vizinhos de cada item.
  {
    codigo: 'VIZINHO_INEXISTENTE',
    descricao: 'vizinho que não é item do catálogo',
    ocorrencias: ({ dados, itens }) =>
      emCada('item', dados.itens, (i) => i.vizinhos.filter((v) => !itens.has(v)).map(aspas)),
  },
  {
    codigo: 'VIZINHO_E_O_PROPRIO_ITEM',
    descricao: 'item listado como vizinho de si mesmo',
    ocorrencias: ({ dados }) => dados.itens.filter((i) => i.vizinhos.includes(i.id)).map((i) => `item ${aspas(i.id)}`),
  },
  {
    codigo: 'VIZINHO_REPETIDO',
    descricao: 'vizinho repetido',
    ocorrencias: ({ dados }) => emCada('item', dados.itens, (i) => repetidos(i.vizinhos)),
  },
] as const satisfies readonly Verificacao[]

export type CodigoDeErroDeCatalogo = (typeof VERIFICACOES)[number]['codigo']

export type ErroDeCatalogo = { codigo: CodigoDeErroDeCatalogo; detalhe: string }

/**
 * Valida os dados e constrói o catálogo. É o único caminho até um `Catalogo`.
 *
 * Devolve o erro da primeira invariante violada, na ordem de `VERIFICACOES`, com todas as ocorrências dela no
 * `detalhe`: quem corrige a curadoria vê de uma vez tudo o que aquela regra recusou, e não um caso por rodada.
 */
export function carregarCatalogo(dados: DadosDeCatalogo): Resultado<Catalogo, ErroDeCatalogo> {
  const contexto: Contexto = {
    dados,
    itens: new Map(dados.itens.map((i) => [i.id, i])),
    grupos: new Map(dados.grupos.map((g) => [g.id, g])),
    subcategorias: new Map(dados.categorias.map((c) => [c.id, new Set(c.subcategorias.map((s) => s.id))])),
    classes: new Set(dados.classes),
  }
  for (const verificacao of VERIFICACOES) {
    const ocorrencias = verificacao.ocorrencias(contexto)
    if (ocorrencias.length > 0) {
      return erro({ codigo: verificacao.codigo, detalhe: `${verificacao.descricao}: ${ocorrencias.join('; ')}` })
    }
  }
  return ok(construir(dados))
}

// Daqui para baixo os dados já passaram por todas as verificações. Os casts para os tipos marcados acontecem só aqui,
// e cada um é garantido por uma invariante acima.

function construir(dados: DadosDeCatalogo): Catalogo {
  return {
    itens: new Map(dados.itens.map((i) => [i.id as IdItem, construirItem(i)])),
    grupos: new Map(dados.grupos.map((g) => [g.id as IdGrupo, construirGrupo(g)])),
    vizinhancas: new Map(dados.vizinhancas.map((v) => [v.id as IdVizinhanca, construirVizinhanca(v)])),
    classes: new Set(dados.classes),
    categorias: new Map(
      dados.categorias.map((c) => [
        c.id,
        { nome: c.nome, subcategorias: new Map(c.subcategorias.map((s) => [s.id, s.nome])) },
      ]),
    ),
    // O hash vai no estado do motor: com ele, um log gravado sobre outro catálogo se reconhece em vez de ser
    // reproduzido sobre itens que mudaram.
    hash: hashFnv1a(serializarCanonico(dados)),
  }
}

// As listas são copiadas para o catálogo não mudar se quem chamou mexer depois nos dados de entrada.

function construirItem(i: ItemBruto): Item {
  return {
    id: i.id as IdItem,
    rotulo: i.rotulo,
    aliases: [...i.aliases],
    categoria: i.categoria,
    subcategoria: i.subcategoria,
    grupos: [...i.grupos] as IdGrupo[],
    dificuldadeAPriori: i.dificuldadeAPriori as 1 | 2 | 3,
    descricao: i.descricao,
    classe: i.classe,
    vizinhos: [...i.vizinhos] as IdItem[],
    ...(i.tracoVizinhanca === undefined ? {} : { tracoVizinhanca: i.tracoVizinhanca }),
  }
}

function construirGrupo(g: GrupoBruto): Grupo {
  return {
    id: g.id as IdGrupo,
    nome: g.nome,
    membros: [...g.membros] as readonly string[] as NaoVazio<IdItem>,
    tracoDistintivo: { ...g.tracoDistintivo },
    ...(g.paresIndiscerniveis === undefined
      ? {}
      : {
          paresIndiscerniveis: g.paresIndiscerniveis.map(
            (par) => [...par] as readonly string[] as readonly [IdItem, IdItem],
          ),
        }),
    ...(g.pesos === undefined ? {} : { pesos: { ...g.pesos } }),
  }
}

function construirVizinhanca(v: VizinhancaBruta): Vizinhanca {
  return {
    id: v.id as IdVizinhanca,
    nome: v.nome,
    membros: [...v.membros] as IdItem[],
    tracoDistintivo: { ...v.tracoDistintivo },
  }
}

/**
 * JSON com as chaves de todo objeto em ordem, e as listas na ordem dada: dois objetos iguais em conteúdo dão o mesmo
 * texto mesmo que as chaves tenham sido escritas em ordens diferentes, e trocar a ordem de uma lista muda o texto. A
 * ordenação é por unidade de código UTF-16 (o padrão de `sort`), e não `localeCompare`, para o hash não depender do
 * idioma do aparelho. Chave com valor `undefined` some, como no `JSON.stringify`.
 */
function serializarCanonico(valor: unknown): string {
  if (Array.isArray(valor)) return `[${valor.map(serializarCanonico).join(',')}]`
  if (typeof valor === 'object' && valor !== null) {
    const registro = valor as Readonly<Record<string, unknown>>
    const partes = Object.keys(registro)
      .filter((chave) => registro[chave] !== undefined)
      .sort()
      .map((chave) => `${JSON.stringify(chave)}:${serializarCanonico(registro[chave])}`)
    return `{${partes.join(',')}}`
  }
  return JSON.stringify(valor)
}
