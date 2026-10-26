import { diaAnterior, type DiaLocal } from './dia-local'

/** XP acumulado por dia local. Dia sem estudo não tem registro. */
export type XpPorDia = ReadonlyMap<DiaLocal, number>

/**
 * Soma o XP de uma tarefa ao dia, sem deixá-lo abaixo de zero. A penalidade do chute sistemático tira XP do que o dia já
 * tem, mas um dia negativo pediria trabalho extra só para voltar a zero: a penalidade é aviso a quem chuta, não dívida
 * que se arrasta para as tarefas seguintes. Devolve um mapa novo.
 */
export function somarXpDoDia(xpPorDia: XpPorDia, dia: DiaLocal, xp: number): XpPorDia {
  const novo = new Map(xpPorDia)
  novo.set(dia, Math.max(0, (xpPorDia.get(dia) ?? 0) + xp))
  return novo
}

/**
 * Dias seguidos com a meta cumprida até hoje. Hoje conta se já cumpriu; se ainda não, a sequência é a que vem até ontem,
 * porque o dia não acabou. Sem congelamento: um dia sem meta zera a conta.
 *
 * `metaDoDia` dá a meta de cada dia, que muda quando a pessoa a altera; sem alteração, a meta padrão é
 * `orcamentoPadraoMin`, porque o XP é calibrado em minutos. Dia sem registro em `xpPorDia` nunca cumpre a meta, nem
 * meta zero: é o que garante que a contagem para, já que só há registros em número finito.
 */
export function sequenciaDeDias(xpPorDia: XpPorDia, metaDoDia: (dia: DiaLocal) => number, hoje: DiaLocal): number {
  const cumpriu = (dia: DiaLocal): boolean => {
    const xp = xpPorDia.get(dia)
    return xp !== undefined && xp >= metaDoDia(dia)
  }
  let dia = cumpriu(hoje) ? hoje : diaAnterior(hoje)
  let dias = 0
  while (cumpriu(dia)) {
    dias++
    dia = diaAnterior(dia)
  }
  return dias
}
