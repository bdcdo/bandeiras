import type { EstadoMotor } from '../estado'

/** O valor com todo Map e Set trocados por listas, na ordem de inserção, em qualquer profundidade. */
function semColecoes(valor: unknown): unknown {
  if (valor instanceof Map) return [...valor].map(([k, v]) => [semColecoes(k), semColecoes(v)])
  if (valor instanceof Set) return [...valor].map(semColecoes)
  if (Array.isArray(valor)) return valor.map(semColecoes)
  if (typeof valor === 'object' && valor !== null) {
    return Object.fromEntries(Object.entries(valor).map(([k, v]) => [k, semColecoes(v)]))
  }
  return valor
}

/**
 * O estado como objeto comparável por `toStrictEqual`: cada Map vira lista de pares e cada Set, lista, na ordem de
 * inserção. A comparação de Map do Vitest ignora a ordem, e a ordem importa: o planejador percorre os mapas do estado, e
 * dois estados com as mesmas entradas em ordens diferentes levariam a decisões diferentes.
 */
export function instantaneoDoEstado(estado: EstadoMotor): Readonly<Record<string, unknown>> {
  return semColecoes(estado) as Readonly<Record<string, unknown>>
}
