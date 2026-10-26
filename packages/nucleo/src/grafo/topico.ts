import type { Marca } from '../base/marca'
import type { IdGrupo, IdItem } from '../catalogo/tipos'

/**
 * Id de um tópico do grafo: `'item:<id>'` para o tópico de um item e `'grupo:<id>'` para o de um grupo. O prefixo separa
 * os dois espaços de ids, porque um item e um grupo podem ter o mesmo id no catálogo sem serem o mesmo tópico.
 */
export type IdTopico = Marca<string, 'IdTopico'>

/** Um tópico do grafo: o de um item (reconhecer, produzir e recordar o item) ou o de um grupo (discriminar os membros). */
export type Topico = { tipo: 'item'; id: IdTopico; item: IdItem } | { tipo: 'grupo'; id: IdTopico; grupo: IdGrupo }

const PREFIXO_ITEM = 'item:'
const PREFIXO_GRUPO = 'grupo:'

export function topicoDeItem(item: IdItem): Topico {
  return { tipo: 'item', id: `${PREFIXO_ITEM}${item}` as IdTopico, item }
}

export function topicoDeGrupo(grupo: IdGrupo): Topico {
  return { tipo: 'grupo', id: `${PREFIXO_GRUPO}${grupo}` as IdTopico, grupo }
}

/**
 * O tópico que o id descreve, com o id de origem no catálogo. Todo `IdTopico` nasce de `topicoDeItem` ou de
 * `topicoDeGrupo`, então o prefixo é sempre um dos dois; o id de origem é tudo depois do primeiro dois-pontos, e por isso
 * um id de item que contenha dois-pontos volta inteiro.
 */
export function lerTopico(id: IdTopico): Topico {
  if (id.startsWith(PREFIXO_GRUPO)) return { tipo: 'grupo', id, grupo: id.slice(PREFIXO_GRUPO.length) as IdGrupo }
  return { tipo: 'item', id, item: id.slice(PREFIXO_ITEM.length) as IdItem }
}
