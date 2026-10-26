import fc from 'fast-check'
import { describe, expect, it } from 'vitest'
import { TECNICAS_TODAS_LIGADAS } from '../catalogo/tecnicas'
import { estadoMemoriaInicial } from './estado-memoria'
import { PARAMETROS_PADRAO as P, type Dificuldade } from './parametros'
import { ehTopicoLento, velocidade } from './velocidade'

const LIGADA = TECNICAS_TODAS_LIGADAS
const DESLIGADA = { ...TECNICAS_TODAS_LIGADAS, velocidadeAdaptativa: false }
const com = (acuracia: number) => estadoMemoriaInicial(acuracia)
const acuracia = fc.double({ min: 0, max: 1, noNaN: true })
const dificuldade = fc.constantFrom<Dificuldade>(1, 2, 3)

describe('velocidade', () => {
  it('vale 1 sem informação num tópico de dificuldade 2', () => {
    expect(velocidade(com(P.acuraciaNeutra), 2, P, LIGADA)).toBe(1)
  })

  it('divide o ganho pela habilidade pela perda pela dificuldade', () => {
    expect(velocidade(com(P.acuraciaNeutra), 1, P, LIGADA)).toBeCloseTo(1 / 0.8, 12)
    expect(velocidade(com(P.acuraciaNeutra), 3, P, LIGADA)).toBeCloseTo(1 / 1.3, 12)
    // Acurácia 1: 1 + 2,5 * 0,15 = 1,375, dentro do teto de 1,4.
    expect(velocidade(com(1), 1, P, LIGADA)).toBeCloseTo(1.375 / 0.8, 12)
    // Acurácia 0: o ganho cai a 1 - 2,125, e o piso de 0,5 segura.
    expect(velocidade(com(0), 3, P, LIGADA)).toBeCloseTo(0.5 / 1.3, 12)
  })

  it('fica entre os limites, cresce com a acurácia e cai com a dificuldade', () => {
    fc.assert(
      fc.property(acuracia, acuracia, dificuldade, dificuldade, (a, b, d1, d2) => {
        const v = velocidade(com(a), d1, P, LIGADA)
        expect(v).toBeGreaterThanOrEqual(P.velocidadeMin)
        expect(v).toBeLessThanOrEqual(P.velocidadeMax)
        if (a <= b) expect(v).toBeLessThanOrEqual(velocidade(com(b), d1, P, LIGADA))
        if (d1 <= d2) expect(v).toBeGreaterThanOrEqual(velocidade(com(a), d2, P, LIGADA))
      }),
    )
  })
})

describe('ehTopicoLento', () => {
  it('marca o tópico abaixo do limiar: difícil, ou de acurácia baixa', () => {
    expect(ehTopicoLento(com(P.acuraciaNeutra), 3, P, LIGADA)).toBe(true)
    expect(ehTopicoLento(com(0.6), 2, P, LIGADA)).toBe(true)
    expect(ehTopicoLento(com(P.acuraciaNeutra), 2, P, LIGADA)).toBe(false)
    expect(ehTopicoLento(com(1), 3, P, LIGADA)).toBe(false)
  })
})

describe('interruptor velocidadeAdaptativa', () => {
  it('desligado, dá velocidade 1 a todo tópico e nunca corta por lentidão', () => {
    expect(velocidade(com(0), 3, P, LIGADA)).toBeLessThan(1)
    expect(velocidade(com(0), 3, P, DESLIGADA)).toBe(1)
    expect(ehTopicoLento(com(0), 3, P, LIGADA)).toBe(true)
    expect(ehTopicoLento(com(0), 3, P, DESLIGADA)).toBe(false)
    fc.assert(
      fc.property(acuracia, dificuldade, fc.double({ min: 0, max: 10, noNaN: true }), (a, d, limiar) => {
        const p = { ...P, limiarTopicoLento: limiar }
        expect(velocidade(com(a), d, p, DESLIGADA)).toBe(1)
        expect(ehTopicoLento(com(a), d, p, DESLIGADA)).toBe(false)
      }),
    )
  })
})
