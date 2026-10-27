// O jsonb do Postgres recusa o caractere U+0000 e a metade de um par substituto sem a outra. Um evento com um deles faria
// falhar o envio do lote inteiro, e a sincronização travaria nele para sempre; por isso o leitor de eventos os recusa nos
// textos que vêm de fora (o texto digitado, o aparelho e a semente), e o motor troca o texto digitado na entrada da
// resposta, antes de avaliá-lo.
//
// A conferência percorre as unidades de código UTF-16, e não usa `isWellFormed`, que é do ES2024, contra o ES2023 do
// núcleo, nem expressão regular com lookbehind, que um Safari anterior ao 16.4 não compila e que derrubaria o módulo
// inteiro na carga.

const SUBSTITUICAO = '�'
const ehAlto = (c: number): boolean => c >= 0xd800 && c <= 0xdbff
const ehBaixo = (c: number): boolean => c >= 0xdc00 && c <= 0xdfff

/** Verdadeiro se o texto não tem U+0000 nem metade solta de par substituto. */
export function ehTextoSeguro(texto: string): boolean {
  for (let i = 0; i < texto.length; i++) {
    const c = texto.charCodeAt(i)
    if (c === 0 || ehBaixo(c)) return false
    if (ehAlto(c)) {
      if (!ehBaixo(texto.charCodeAt(i + 1))) return false
      i++
    }
  }
  return true
}

/**
 * O texto com cada U+0000 e cada metade solta de par substituto trocados por U+FFFD, o caractere de substituição. Um par
 * completo, como o de um emoji, fica como está. O motor aplica isto ao texto digitado antes de avaliar a resposta, para
 * a avaliação e o evento verem o mesmo texto.
 */
export function textoSeguroParaLog(texto: string): string {
  if (ehTextoSeguro(texto)) return texto
  let saida = ''
  for (let i = 0; i < texto.length; i++) {
    const c = texto.charCodeAt(i)
    if (ehAlto(c) && ehBaixo(texto.charCodeAt(i + 1))) {
      saida += texto.slice(i, i + 2)
      i++
    } else {
      saida += c === 0 || ehAlto(c) || ehBaixo(c) ? SUBSTITUICAO : texto.charAt(i)
    }
  }
  return saida
}
