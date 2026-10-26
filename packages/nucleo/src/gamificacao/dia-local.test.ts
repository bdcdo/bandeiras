import fc from 'fast-check'
import { describe, expect, it } from 'vitest'
import { desembrulhar } from '../base/resultado'
import type { Instante } from '../base/tempo'
import { PARAMETROS_PADRAO as P, resolverParametros } from '../memoria/parametros'
import { diaAnterior, diaLocal, type DiaLocal } from './dia-local'

const BRASILIA = 180
const utc = (ano: number, mes: number, dia: number, hora: number, minuto: number) =>
  Date.UTC(ano, mes - 1, dia, hora, minuto) as Instante

describe('diaLocal', () => {
  it('em Brasília, 3h59 ainda é o dia anterior, e 4h01 já é o novo', () => {
    // 26/10/2026 às 3h59 em Brasília (UTC-3) são 6h59 UTC.
    expect(diaLocal(utc(2026, 10, 26, 6, 59), BRASILIA, P)).toBe('2026-10-25')
    expect(diaLocal(utc(2026, 10, 26, 7, 1), BRASILIA, P)).toBe('2026-10-26')
  })

  it('na virada do ano, a madrugada de 1º de janeiro ainda conta em 31 de dezembro', () => {
    // 1/1/2027 às 2h em Brasília são 5h UTC; às 4h30, 7h30 UTC.
    expect(diaLocal(utc(2027, 1, 1, 5, 0), BRASILIA, P)).toBe('2026-12-31')
    expect(diaLocal(utc(2027, 1, 1, 7, 30), BRASILIA, P)).toBe('2027-01-01')
    // Em UTC, a meia-noite e meia de 1º de janeiro também fica no ano velho.
    expect(diaLocal(utc(2027, 1, 1, 0, 30), 0, P)).toBe('2026-12-31')
  })

  it('a virada segue o parâmetro, e o fuso do leste é negativo', () => {
    // Virada às 6h, e não às 4h: em Brasília, 5h59 ainda é o dia anterior.
    const seis = desembrulhar(resolverParametros({ horaViradaDoDia: 6 }))
    expect(diaLocal(utc(2026, 10, 26, 8, 59), BRASILIA, seis)).toBe('2026-10-25')
    expect(diaLocal(utc(2026, 10, 26, 9, 1), BRASILIA, seis)).toBe('2026-10-26')
    // Tóquio, UTC+9, tem `getTimezoneOffset` de -540: 19h01 UTC de 25/10 são 4h01 de 26/10 lá.
    expect(diaLocal(utc(2026, 10, 25, 19, 1), -540, P)).toBe('2026-10-26')
  })

  it('cobre 29 de fevereiro e as datas antes de 1970', () => {
    expect(diaLocal(utc(2028, 2, 29, 12, 0), 0, P)).toBe('2028-02-29')
    expect(diaLocal(utc(1969, 12, 31, 12, 0), 0, P)).toBe('1969-12-31')
    expect(diaLocal(utc(1900, 3, 1, 12, 0), 0, P)).toBe('1900-03-01')
  })

  it('recusa instante ou fuso que não é número finito', () => {
    expect(() => diaLocal(Number.NaN as Instante, BRASILIA, P)).toThrow(RangeError)
    expect(() => diaLocal(utc(2026, 1, 1, 0, 0), Number.POSITIVE_INFINITY, P)).toThrow(RangeError)
  })

  it('concorda com o calendário do Date para quaisquer instante, fuso e hora de virada', () => {
    fc.assert(
      fc.property(
        // De 1900 a 2200, os fusos de getTimezoneOffset, e viradas inteiras e fracionárias.
        fc.integer({ min: -2_208_988_800_000, max: 7_258_118_400_000 }),
        fc.integer({ min: -840, max: 720 }),
        fc.double({ min: 0, max: 24, maxExcluded: true, noNaN: true }),
        (instante, fuso, hora) => {
          const p = desembrulhar(resolverParametros({ horaViradaDoDia: hora }))
          // O `Math.floor` antes do Date porque o Date trunca o milissegundo fracionário em direção ao zero: um instante
          // local de -0,5 ms seria 1º de janeiro de 1970 para ele, e é 31 de dezembro de 1969 pela conta do dia.
          const local = Math.floor(instante - fuso * 60_000 - hora * 3_600_000)
          const esperado = new Date(local).toISOString().slice(0, 10)
          expect(diaLocal(instante as Instante, fuso, p)).toBe(esperado)
        },
      ),
    )
  })
})

describe('diaAnterior', () => {
  it('volta um dia pelo calendário, pela virada de mês, de ano e pelo 29 de fevereiro', () => {
    const anterior = (dia: string) => diaAnterior(dia as DiaLocal)
    expect(anterior('2026-10-26')).toBe('2026-10-25')
    expect(anterior('2026-11-01')).toBe('2026-10-31')
    expect(anterior('2027-01-01')).toBe('2026-12-31')
    expect(anterior('2028-03-01')).toBe('2028-02-29')
    expect(anterior('2100-03-01')).toBe('2100-02-28')
    expect(anterior('2000-03-01')).toBe('2000-02-29')
    expect(() => anterior('26/10/2026')).toThrow(RangeError)
  })
})
