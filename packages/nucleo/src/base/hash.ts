/**
 * FNV-1a de 64 bits sobre os code units UTF-16 do texto, em 16 dígitos hexadecimais.
 *
 * É o id de todo evento e a semente derivada de todo sorteio, então precisa ser determinístico entre aparelhos e barato.
 * 64 bits, e não 32, porque o id deduplica eventos na união de logs: com 32 bits, 10 mil eventos por ano dariam cerca de
 * 1% de chance anual de dois eventos distintos colidirem e um deles sumir em silêncio.
 */
export function hashFnv1a(texto: string): string {
  let hash = 0xcbf29ce484222325n
  for (let i = 0; i < texto.length; i++) {
    hash ^= BigInt(texto.charCodeAt(i))
    hash = (hash * 0x100000001b3n) & 0xffffffffffffffffn
  }
  return hash.toString(16).padStart(16, '0')
}
