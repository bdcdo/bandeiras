import type { Evento, EventoDoTipo } from '../eventos'
import { aplicarNoRascunho } from './aplicar'
import type { ContextoDeReducao } from './contexto'
import { estadoDe, rascunhoDe, rascunhoDoPerfil } from './rascunho'
import type { EstadoMotor } from './tipos'

const ignorar = (): void => undefined

/**
 * O estado de uma época recém-aberta pelo perfil: a semente, o catálogo e a versão do evento, nada estudado e a meta
 * padrão. É também o que `reduzir` devolve para um `perfil-reiniciado`, qualquer que seja o estado anterior.
 */
export function estadoDoPerfil(
  ctx: ContextoDeReducao,
  evento: EventoDoTipo<'perfil-criado' | 'perfil-reiniciado'>,
): EstadoMotor {
  return estadoDe(rascunhoDoPerfil(ctx, evento))
}

/**
 * O estado depois do evento. O estado recebido fica intacto: o rascunho copia cada mapa na primeira escrita, e o evento
 * que só conta não copia nenhum. É a mesma redução de `reconstruir`, sem o relato, que só a reconstrução tem.
 */
export function reduzir(ctx: ContextoDeReducao, estado: EstadoMotor, evento: Evento): EstadoMotor {
  const r = rascunhoDe(estado)
  aplicarNoRascunho(ctx, r, evento, ignorar)
  return estadoDe(r)
}
