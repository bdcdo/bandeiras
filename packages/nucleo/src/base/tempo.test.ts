import { describe, expect, it } from 'vitest'
import {
  diasEntre,
  minutosParaMilis,
  somarDias,
  somarMilis,
  type Dias,
  type Instante,
  type Milis,
  type Minutos,
} from './tempo'

const DIA = 86_400_000

describe('diasEntre', () => {
  it('conta dias fracionários, positivo para a frente e negativo para trás', () => {
    const a = 1_000 as Instante
    const b = (1_000 + DIA * 1.5) as Instante
    expect(diasEntre(a, b)).toBe(1.5)
    expect(diasEntre(b, a)).toBe(-1.5)
    expect(diasEntre(a, a)).toBe(0)
  })
})

describe('somarDias', () => {
  it('desloca o instante em dias de 24 horas', () => {
    expect(somarDias(0 as Instante, 2 as Dias)).toBe(2 * DIA)
    expect(somarDias(DIA as Instante, -0.5 as Dias)).toBe(DIA / 2)
  })

  it('é o inverso de diasEntre', () => {
    const a = 123_456 as Instante
    expect(diasEntre(a, somarDias(a, 3.25 as Dias))).toBe(3.25)
  })
})

describe('somarMilis', () => {
  it('desloca o instante em milissegundos', () => {
    expect(somarMilis(10 as Instante, 5 as Milis)).toBe(15)
  })
})

describe('minutosParaMilis', () => {
  it('multiplica por 60 mil', () => {
    expect(minutosParaMilis(15 as Minutos)).toBe(900_000)
    expect(minutosParaMilis(0.5 as Minutos)).toBe(30_000)
  })
})

describe('marcas de tempo', () => {
  it('Instante não aceita number cru', () => {
    const cru = 1_000
    // @ts-expect-error: número sem marca não passa por Instante
    const instante: Instante = cru
    expect(instante).toBe(cru)
  })

  it('Dias não passa por Milis', () => {
    const dias = 2 as Dias
    // @ts-expect-error: unidades diferentes têm marcas diferentes
    const milis: Milis = dias
    expect(milis).toBe(2)
  })
})
