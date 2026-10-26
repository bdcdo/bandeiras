/** `valor` trazido para dentro de [min, max]. Quem chama garante min <= max; `resolverParametros` garante para os limites. */
export function limitar(valor: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, valor))
}
