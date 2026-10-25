import type { Marca } from './marca'

/** Milissegundos desde 1970-01-01T00:00:00Z, como `Date.now()`. É o único formato de data que o núcleo conhece. */
export type Instante = Marca<number, 'Instante'>
/** Duração em milissegundos. */
export type Milis = Marca<number, 'Milis'>
/** Duração em dias de 24 horas, possivelmente fracionária: a memória decai continuamente entre revisões. */
export type Dias = Marca<number, 'Dias'>
/** Duração em minutos, a unidade do orçamento de sessão. */
export type Minutos = Marca<number, 'Minutos'>

const MILIS_POR_MINUTO = 60_000
// Dia de 24 horas corridas, sem fuso nem horário de verão. O dia de calendário local, com virada às 4h, é outra conta e
// fica com quem precisa dele; aqui só se mede distância entre instantes.
const MILIS_POR_DIA = 86_400_000

/** Dias de `a` até `b`: positivo quando `b` vem depois de `a`. Não arredonda. */
export function diasEntre(a: Instante, b: Instante): Dias {
  return ((b - a) / MILIS_POR_DIA) as Dias
}

export function somarDias(instante: Instante, dias: Dias): Instante {
  return (instante + dias * MILIS_POR_DIA) as Instante
}

export function somarMilis(instante: Instante, milis: Milis): Instante {
  return (instante + milis) as Instante
}

export function minutosParaMilis(minutos: Minutos): Milis {
  return (minutos * MILIS_POR_MINUTO) as Milis
}
