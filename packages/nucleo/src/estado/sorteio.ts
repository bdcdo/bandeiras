import { serializarCanonico } from '../base/serializacao'
import { sorteioComSemente, type SorteioComSemente } from '../base/sorteio-com-semente'
import type { EstadoMotor } from './tipos'

/**
 * O sorteio de uma decisão no estado: a semente do perfil, o número de eventos, o último evento e a finalidade. O mesmo
 * estado dá a mesma sequência no vivo e na reconstrução, e cada evento novo muda a sequência seguinte. A finalidade, uma
 * por decisão, impede que um sorteio a mais numa decisão desloque os números de outra.
 */
export function sorteioDoEstado(estado: EstadoMotor, finalidade: string): SorteioComSemente {
  return sorteioComSemente(serializarCanonico([estado.semente, estado.nEventos, estado.ultimoEventoId, finalidade]))
}
