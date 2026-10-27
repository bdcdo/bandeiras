/**
 * Chave de um conjunto de ids: os ids em ordem de unidade de código, para o mesmo conjunto em outra ordem dar a mesma
 * chave, separados por U+001F, um caractere de controle que nenhum id de catálogo tem, para `['a|b', 'c']` e
 * `['a', 'b|c']` não colidirem. É a fonte do formato das chaves do núcleo que juntam ids, a do par confundido e a das
 * opções de uma questão; quem precisa dos ids de uma chave os guarda ao lado dela, porque a chave não se desmonta.
 */
export function chaveDeConjunto(ids: readonly string[]): string {
  return [...ids].sort().join('\u001f')
}
