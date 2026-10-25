import { describe, expect, it } from 'vitest'
import { relogioFixo } from './relogio-fixo'
import type { Instante, Milis } from './tempo'

describe('relogioFixo', () => {
  it('começa no instante dado e não anda sozinho', () => {
    const relogio = relogioFixo(1_000 as Instante)
    expect(relogio.agora()).toBe(1_000)
    expect(relogio.agora()).toBe(1_000)
  })

  it('avança pela duração pedida, acumulando', () => {
    const relogio = relogioFixo(1_000 as Instante)
    relogio.avancar(500 as Milis)
    relogio.avancar(250 as Milis)
    expect(relogio.agora()).toBe(1_750)
  })

  it('vai para qualquer instante, inclusive para trás', () => {
    const relogio = relogioFixo(1_000 as Instante)
    relogio.irPara(5_000 as Instante)
    expect(relogio.agora()).toBe(5_000)
    relogio.irPara(10 as Instante)
    expect(relogio.agora()).toBe(10)
  })
})
