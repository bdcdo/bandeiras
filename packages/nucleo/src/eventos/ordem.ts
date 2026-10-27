/**
 * Ordem do log: pelo instante e, no empate, pelo id em unidade de código, nunca por `localeCompare`, para a ordem não
 * depender do idioma do aparelho. A reconstrução, o armazenamento em memória e o da casca usam esta mesma função, e o
 * índice `[em, id]` do IndexedDB compara do mesmo jeito.
 *
 * O empate de instante só acontece entre aparelhos diferentes: um mesmo aparelho carimba cada evento depois de tudo o
 * que o estado já reduziu. Aceita qualquer objeto com `em` e `id`, para servir ao evento lido e ao envelope opaco.
 */
export function compararEventos(
  a: Readonly<{ em: number; id: string }>,
  b: Readonly<{ em: number; id: string }>,
): number {
  if (a.em !== b.em) return a.em - b.em
  if (a.id === b.id) return 0
  return a.id < b.id ? -1 : 1
}
