/**
 * Erro esperado como valor. `codigo` é um literal que o chamador compara; `detalhe` é texto para quem lê o log.
 *
 * O núcleo não usa `throw` para fluxo esperado (dado inválido, combinação recusada, ação fora de hora): a função devolve
 * `Resultado`, e o compilador obriga o chamador a olhar `ok` antes de usar o valor.
 */
export type ErroBase = { codigo: string; detalhe: string }

export type Resultado<T, E = ErroBase> = { ok: true; valor: T } | { ok: false; erro: E }

export function ok<T>(valor: T): { ok: true; valor: T } {
  return { ok: true, valor }
}

export function erro<E>(e: E): { ok: false; erro: E } {
  return { ok: false, erro: e }
}

/**
 * Valor de um `Resultado` que o chamador sabe ser `ok`. Lança se não for: serve a testes e a cenários montados à mão,
 * onde um erro é defeito do próprio teste, nunca a código que trata dado de fora.
 */
export function desembrulhar<T>(r: Resultado<T, unknown>): T {
  if (r.ok) return r.valor
  throw new Error(`desembrulhar recebeu um erro: ${JSON.stringify(r.erro)}`)
}
