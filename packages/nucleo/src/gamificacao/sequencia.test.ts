import fc from 'fast-check'
import { describe, expect, it } from 'vitest'
import type { DiaLocal } from './dia-local'
import { sequenciaDeDias, somarXpDoDia, type XpPorDia } from './sequencia'

const dia = (texto: string) => texto as DiaLocal
const xpPorDia = (registros: Readonly<Record<string, number>>): XpPorDia =>
  new Map(Object.entries(registros).map(([d, xp]) => [dia(d), xp]))

describe('somarXpDoDia', () => {
  it('soma ao dia sem mexer no mapa recebido, e não deixa o dia abaixo de zero', () => {
    const antes = xpPorDia({ '2026-10-26': 1 })
    const depois = somarXpDoDia(antes, dia('2026-10-26'), 2.5)
    expect(depois.get(dia('2026-10-26'))).toBe(3.5)
    expect(antes.get(dia('2026-10-26'))).toBe(1)
    expect(somarXpDoDia(depois, dia('2026-10-26'), -5).get(dia('2026-10-26'))).toBe(0)
    expect(somarXpDoDia(new Map(), dia('2026-10-27'), -0.56).get(dia('2026-10-27'))).toBe(0)
  })

  it('XP do dia nunca fica negativo, qualquer que seja a ordem de ganhos e penalidades', () => {
    const dias = ['2026-10-25', '2026-10-26', '2026-10-27'].map(dia)
    fc.assert(
      fc.property(
        fc.array(fc.tuple(fc.constantFrom(...dias), fc.double({ min: -10, max: 10, noNaN: true })), { maxLength: 40 }),
        (somas) => {
          let mapa: XpPorDia = new Map()
          for (const [d, xp] of somas) {
            mapa = somarXpDoDia(mapa, d, xp)
            for (const valor of mapa.values()) expect(valor).toBeGreaterThanOrEqual(0)
          }
        },
      ),
    )
  })
})

describe('sequenciaDeDias', () => {
  // Meta de 12, e não os 15 do padrão: a sequência lê a meta que recebe.
  const meta = () => 12

  it('cinco dias com um dia sem meta no meio: a sequência é a dos dias depois dele', () => {
    // De 30/10 a 3/11, pela virada do mês; 1/11 fica abaixo da meta.
    const registros = xpPorDia({
      '2026-10-30': 15,
      '2026-10-31': 12,
      '2026-11-01': 11.9,
      '2026-11-02': 20,
      '2026-11-03': 13,
    })
    expect(sequenciaDeDias(registros, meta, dia('2026-11-03'))).toBe(2)
    expect(sequenciaDeDias(registros, meta, dia('2026-10-31'))).toBe(2)
    expect(sequenciaDeDias(registros, meta, dia('2026-11-01'))).toBe(2)
  })

  it('hoje conta só se já cumpriu; senão, vale a sequência até ontem', () => {
    const registros = xpPorDia({ '2026-12-30': 12, '2026-12-31': 30, '2027-01-01': 4 })
    expect(sequenciaDeDias(registros, meta, dia('2027-01-01'))).toBe(2)
    expect(sequenciaDeDias(registros, meta, dia('2027-01-02'))).toBe(0)
    expect(sequenciaDeDias(somarXpDoDia(registros, dia('2027-01-01'), 8), meta, dia('2027-01-01'))).toBe(3)
  })

  it('usa a meta de cada dia, e dia sem registro nunca cumpre, nem com meta zero', () => {
    const registros = xpPorDia({ '2026-10-24': 10, '2026-10-25': 10, '2026-10-26': 10 })
    // Com a meta subindo para 11 a partir de 25/10, os dias de 10 XP deixam de cumprir; descendo para 9 em 26/10, os
    // três cumprem, cada um pela meta que tinha.
    const subiu = (d: DiaLocal) => (d >= '2026-10-25' ? 11 : 10)
    const desceu = (d: DiaLocal) => (d >= '2026-10-26' ? 9 : 10)
    expect(sequenciaDeDias(registros, subiu, dia('2026-10-26'))).toBe(0)
    expect(sequenciaDeDias(registros, desceu, dia('2026-10-26'))).toBe(3)
    expect(sequenciaDeDias(registros, () => 0, dia('2026-10-26'))).toBe(3)
    expect(sequenciaDeDias(new Map(), () => 0, dia('2026-10-26'))).toBe(0)
  })
})
