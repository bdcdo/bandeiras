import type { DiaLocal } from '../gamificacao'
import type { IdTopico } from '../grafo'
import type { Parametros } from '../memoria'
import type { EstadoMotor, StatusLicao } from './tipos'

const PENDENTE: StatusLicao = { status: 'pendente' }

/** A situação da lição do tópico; o tópico sem registro é pendente. */
export function statusDaLicao(estado: EstadoMotor, topico: IdTopico): StatusLicao {
  return estado.licoes.get(topico) ?? PENDENTE
}

/**
 * A meta de um dia, passado ou futuro: a da alteração mais recente até esse dia, ou `orcamentoPadraoMin` antes da
 * primeira. Mudar a meta hoje não muda a de ontem, e a sequência de dias conta cada dia pela meta que ele tinha. O dia
 * local tem ano de quatro dígitos e mês e dia com dois, então a ordem do texto é a do calendário.
 */
export function metaDoDia(estado: EstadoMotor, dia: DiaLocal, parametros: Parametros): number {
  let vigente: DiaLocal | undefined
  let meta = parametros.orcamentoPadraoMin
  for (const [d, xp] of estado.metaPorDia) {
    if (d <= dia && (vigente === undefined || d > vigente)) {
      vigente = d
      meta = xp
    }
  }
  return meta
}
