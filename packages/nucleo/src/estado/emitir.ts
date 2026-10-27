import type { NaoVazio } from '../base/nao-vazio'
import { ok, type Resultado } from '../base/resultado'
import type { Instante } from '../base/tempo'
import {
  criarEvento,
  type CorpoDeEvento,
  type CorpoDoTipo,
  type ErroDeLeitura,
  type Evento,
  type EventoDoTipo,
} from '../eventos'
import type { ContextoDeReducao } from './contexto'
import { estadoDoPerfil, reduzir } from './reduzir'
import type { EstadoMotor, Transicao } from './tipos'

/** De onde vêm os eventos de uma ação: o aparelho, o agora do relógio dele e o fuso, na convenção de `getTimezoneOffset`. */
export type Origem = Readonly<{ dispositivo: string; agora: Instante; fusoMinutos: number }>

/**
 * Cria o perfil e o estado da época que ele abre. O instante é o agora arredondado para baixo, porque o log guarda
 * milissegundos inteiros.
 */
export function iniciarPerfil(
  ctx: ContextoDeReducao,
  corpo: CorpoDoTipo<'perfil-criado'>,
  origem: Origem,
): Resultado<Transicao, ErroDeLeitura> {
  const { dispositivo, fusoMinutos } = origem
  const criado = criarEvento({ em: Math.floor(origem.agora) as Instante, dispositivo, fusoMinutos }, corpo)
  if (!criado.ok) return criado
  // criarEvento devolve o evento do tipo do corpo, que aqui é perfil-criado; a união não carrega essa ligação.
  const perfil = criado.valor as EventoDoTipo<'perfil-criado'>
  return ok({ estado: estadoDoPerfil(ctx, perfil), eventos: [perfil] })
}

/**
 * Cria os eventos dos corpos, em ordem, e reduz cada um antes de criar o seguinte. O instante de cada evento é
 * `max(floor(agora), ultimoEm + 1)`, sobre o estado já reduzido pelo corpo anterior: estritamente maior que tudo o que o
 * estado já viu, o evento novo é sempre o último na ordem do log, e o estado vivo é igual ao reconstruído mesmo depois
 * de uma união com eventos de outro aparelho, e mesmo com o relógio parado, repetido ou recuando. O piso tira a fração
 * de milissegundo, que o log não guarda.
 *
 * Um corpo que o leitor recusa devolve o erro, e nenhum evento da ação vale.
 */
export function emitir(
  ctx: ContextoDeReducao,
  estado: EstadoMotor,
  corpos: NaoVazio<CorpoDeEvento>,
  origem: Origem,
): Resultado<Transicao, ErroDeLeitura> {
  const { dispositivo, fusoMinutos } = origem
  let atual = estado
  const eventos: Evento[] = []
  for (const corpo of corpos) {
    const em = Math.max(Math.floor(origem.agora), atual.ultimoEm + 1) as Instante
    const criado = criarEvento({ em, dispositivo, fusoMinutos }, corpo)
    if (!criado.ok) return criado
    atual = reduzir(ctx, atual, criado.valor)
    eventos.push(criado.valor)
  }
  return ok({ estado: atual, eventos })
}
