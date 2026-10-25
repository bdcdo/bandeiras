import type { Marca } from '../base/marca'
import type { NaoVazio } from '../base/nao-vazio'

export type IdItem = Marca<string, 'IdItem'>
export type IdGrupo = Marca<string, 'IdGrupo'>
export type IdVizinhanca = Marca<string, 'IdVizinhanca'>

/**
 * Direções de exercício sobre o mesmo item: reconhecer (estímulo para rótulo), produzir (rótulo para estímulo) e
 * recordar (rótulo digitado, sem opções). São três modos de perguntar o mesmo tópico, não três tópicos.
 */
export const DIRECOES = ['reconhecer', 'produzir', 'recordar'] as const
export type Direcao = (typeof DIRECOES)[number]

/**
 * O que se aprende: um estímulo que o domínio sabe mostrar, com o rótulo que o identifica.
 *
 * `classe` é um traço do estímulo numa lista fechada que o domínio declara em `Catalogo.classes`; serve a distratores
 * dissimilares e à descrição. `vizinhos` são os itens mais parecidos, do mais para o menos, e alimentam distratores e
 * remediação. `dificuldadeAPriori` é a estimativa do domínio antes de qualquer resposta.
 */
export type Item = {
  id: IdItem
  rotulo: string
  aliases: readonly string[]
  categoria: string
  subcategoria: string
  grupos: readonly IdGrupo[]
  dificuldadeAPriori: 1 | 2 | 3
  descricao: string
  classe: string
  vizinhos: readonly IdItem[]
  tracoVizinhanca?: string
}

/**
 * Itens parecidos o bastante para virar tópico de discriminação próprio. `tracoDistintivo` diz, por membro, o que o
 * separa dos outros. `paresIndiscerniveis` lista pares que o estímulo não distingue: o motor aceita um pelo outro onde
 * só o estímulo é mostrado e nunca os põe lado a lado como opções. `pesos`, ausente, vale 1 para todo membro.
 */
export type Grupo = {
  id: IdGrupo
  nome: string
  membros: NaoVazio<IdItem>
  paresIndiscerniveis?: readonly (readonly [IdItem, IdItem])[]
  tracoDistintivo: Readonly<Record<string, string>>
  pesos?: Readonly<Record<string, number>>
}

/** Itens parecidos demais e numerosos demais para um tópico só. Fica fora do grafo de tópicos. */
export type Vizinhanca = {
  id: IdVizinhanca
  nome: string
  membros: readonly IdItem[]
  tracoDistintivo: Readonly<Record<string, string>>
}

/** Nome da categoria e das subcategorias, por id. */
export type Categoria = {
  nome: string
  subcategorias: ReadonlyMap<string, string>
}

// O que torna Catalogo nominal. Marca<T, Nome>, a dos ids, não bastaria: o campo `__marca` é público, o spread o copia,
// e `{ ...carregado, grupos: outro.grupos }` passaria por Catalogo com os grupos de um catálogo sobre os itens e o hash
// de outro. Membro privado o spread não copia, e o TypeScript compara tipo com membro privado pela declaração, não pela
// forma. `declare class` não gera código: como `__marca`, o campo nunca existe no objeto.
declare class MarcaDeCatalogo {
  private readonly validado: true
}

/**
 * Catálogo validado. Só `carregarCatalogo` constrói um, com o único cast para este tipo; sem cast, nem um literal com
 * estes campos nem `{ ...catalogo, grupos: outros }` passam por `Catalogo`. Quem tem um tem a garantia de todas as
 * invariantes de lá, e nenhuma camada acima volta a conferir referência quebrada.
 *
 * A garantia é do compilador, e tem o alcance dele: `Object.assign` e o spread dentro de função genérica escapam,
 * porque o TypeScript tipa o resultado dos dois como interseção com o original, marca inclusive.
 */
export type Catalogo = {
  itens: ReadonlyMap<IdItem, Item>
  grupos: ReadonlyMap<IdGrupo, Grupo>
  vizinhancas: ReadonlyMap<IdVizinhanca, Vizinhanca>
  classes: ReadonlySet<string>
  categorias: ReadonlyMap<string, Categoria>
  hash: string
} & MarcaDeCatalogo

// Formas de entrada de carregarCatalogo, amigáveis a JSON: ids como string, listas e objetos simples, dificuldade como
// número qualquer e pares como listas. A validação é que transforma isto nos tipos marcados acima.

export type ItemBruto = {
  id: string
  rotulo: string
  aliases: readonly string[]
  categoria: string
  subcategoria: string
  grupos: readonly string[]
  dificuldadeAPriori: number
  descricao: string
  classe: string
  vizinhos: readonly string[]
  tracoVizinhanca?: string
}

export type GrupoBruto = {
  id: string
  nome: string
  membros: readonly string[]
  paresIndiscerniveis?: readonly (readonly string[])[]
  tracoDistintivo: Readonly<Record<string, string>>
  pesos?: Readonly<Record<string, number>>
}

export type VizinhancaBruta = {
  id: string
  nome: string
  membros: readonly string[]
  tracoDistintivo: Readonly<Record<string, string>>
}

export type CategoriaBruta = {
  id: string
  nome: string
  subcategorias: readonly { id: string; nome: string }[]
}

export type DadosDeCatalogo = {
  itens: readonly ItemBruto[]
  grupos: readonly GrupoBruto[]
  vizinhancas: readonly VizinhancaBruta[]
  classes: readonly string[]
  categorias: readonly CategoriaBruta[]
}
