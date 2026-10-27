import type { Catalogo, IdItem } from '../catalogo/tipos'

/**
 * Parceiros indiscerníveis do item: os outros itens dos pares que os grupos dele declaram. O estímulo não separa o item
 * de um parceiro, e por isso o rótulo do parceiro conta como acerto onde só o estímulo é mostrado, e os dois nunca
 * aparecem juntos como opções. Quase sempre o conjunto é vazio ou tem um item; com o item em pares de dois grupos, tem os
 * dois parceiros.
 */
export function parceirosIndiscerniveis(item: IdItem, catalogo: Catalogo): ReadonlySet<IdItem> {
  const parceiros = new Set<IdItem>()
  for (const idGrupo of catalogo.itens.get(item)?.grupos ?? []) {
    for (const [a, b] of catalogo.grupos.get(idGrupo)?.paresIndiscerniveis ?? []) {
      if (a === item) parceiros.add(b)
      if (b === item) parceiros.add(a)
    }
  }
  return parceiros
}
