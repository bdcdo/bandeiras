/** Lista com pelo menos um elemento: `xs[0]` tem tipo `T`, e não `T | undefined`. */
export type NaoVazio<T> = readonly [T, ...T[]]

export function ehNaoVazio<T>(xs: readonly T[]): xs is NaoVazio<T> {
  return xs.length > 0
}
