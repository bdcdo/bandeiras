import type { Marca } from '../base/marca'
import type { Instante } from '../base/tempo'
import type { Parametros } from '../memoria'

/** Dia de calendário local, `'AAAA-MM-DD'`, com a virada na hora de `horaViradaDoDia`. Só `diaLocal` constrói um. */
export type DiaLocal = Marca<string, 'DiaLocal'>

const MILIS_POR_MINUTO = 60_000
const MILIS_POR_HORA = 3_600_000
const MILIS_POR_DIA = 86_400_000

// Conversão entre dias contados de 1970-01-01 e data do calendário gregoriano, pelo algoritmo de Howard Hinnant
// ("chrono-Compatible Low-Level Date Algorithms"), escrita à mão porque o núcleo não usa `Date`.
//
// A conta desloca o zero para 1º de março do ano 0 (os 719468 dias), para o dia bissexto cair no fim do ano e não no
// meio. Daí divide o tempo em eras de 400 anos, de 146097 dias cada, o ciclo exato do calendário gregoriano: dentro da
// era, o ano sai do dia descontando os dias bissextos (um a cada 4 anos, menos um a cada 100, mais um a cada 400), e o
// mês sai do dia do ano pela reta 153/5, que dá 153 dias a cada cinco meses na sequência de 31 e 30 que começa em março.
// `Math.floor`, e não divisão truncada, para os dias antes de 1970 caírem na era certa.

/** Ano, mês (1 a 12) e dia (1 a 31) do dia de número `dias` desde 1970-01-01. */
function dataCivil(dias: number): readonly [number, number, number] {
  const z = dias + 719_468
  const era = Math.floor(z / 146_097)
  const diaDaEra = z - era * 146_097
  const anoDaEra = Math.floor(
    (diaDaEra - Math.floor(diaDaEra / 1460) + Math.floor(diaDaEra / 36_524) - Math.floor(diaDaEra / 146_096)) / 365,
  )
  const diaDoAno = diaDaEra - (365 * anoDaEra + Math.floor(anoDaEra / 4) - Math.floor(anoDaEra / 100))
  const mesDesdeMarco = Math.floor((5 * diaDoAno + 2) / 153)
  const dia = diaDoAno - Math.floor((153 * mesDesdeMarco + 2) / 5) + 1
  const mes = mesDesdeMarco < 10 ? mesDesdeMarco + 3 : mesDesdeMarco - 9
  return [anoDaEra + era * 400 + (mes <= 2 ? 1 : 0), mes, dia]
}

/** O inverso de `dataCivil`: o número do dia, desde 1970-01-01, da data dada. */
function diasDaData(ano: number, mes: number, dia: number): number {
  const anoDesdeMarco = mes <= 2 ? ano - 1 : ano
  const era = Math.floor(anoDesdeMarco / 400)
  const anoDaEra = anoDesdeMarco - era * 400
  const diaDoAno = Math.floor((153 * (mes > 2 ? mes - 3 : mes + 9) + 2) / 5) + dia - 1
  const diaDaEra = anoDaEra * 365 + Math.floor(anoDaEra / 4) - Math.floor(anoDaEra / 100) + diaDoAno
  return era * 146_097 + diaDaEra - 719_468
}

const doisDigitos = (n: number): string => String(n).padStart(2, '0')

function formatar(dias: number): DiaLocal {
  const [ano, mes, dia] = dataCivil(dias)
  return `${String(ano).padStart(4, '0')}-${doisDigitos(mes)}-${doisDigitos(dia)}` as DiaLocal
}

/**
 * Dia local do instante. `fusoMinutos` segue a convenção de `getTimezoneOffset` do navegador, que a casca passa como
 * vem: minutos a somar à hora local para chegar ao UTC, 180 em Brasília. Por isso a hora local é o instante menos o
 * fuso, e não mais. A virada do dia fica em `horaViradaDoDia`, e não à meia-noite, para o estudo da madrugada contar no
 * dia que a pessoa ainda vive.
 */
export function diaLocal(instante: Instante, fusoMinutos: number, parametros: Parametros): DiaLocal {
  const local = instante - fusoMinutos * MILIS_POR_MINUTO - parametros.horaViradaDoDia * MILIS_POR_HORA
  if (!Number.isFinite(local)) throw new RangeError(`instante ou fuso que não é número finito: ${String(local)}`)
  return formatar(Math.floor(local / MILIS_POR_DIA))
}

/** O dia anterior ao dado, pelo calendário. */
export function diaAnterior(dia: DiaLocal): DiaLocal {
  const partes = /^(\d{4,})-(\d{2})-(\d{2})$/.exec(dia)
  if (partes === null) throw new RangeError(`dia local fora do formato AAAA-MM-DD: '${dia}'`)
  const [, ano, mes, d] = partes.map(Number)
  return formatar(diasDaData(ano ?? 0, mes ?? 0, d ?? 0) - 1)
}
