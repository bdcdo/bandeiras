import fc from 'fast-check'
import { describe, expect, it } from 'vitest'
import { compararEventos } from './ordem'

const ev = (em: number, id: string) => ({ em, id })

describe('compararEventos', () => {
  it('ordena pelo instante e, no empate, pelo id', () => {
    const ordenados = [ev(2, 'a'), ev(1, 'c'), ev(1, 'b'), ev(0, 'z')].sort(compararEventos)
    expect(ordenados).toEqual([ev(0, 'z'), ev(1, 'b'), ev(1, 'c'), ev(2, 'a')])
  })

  it('desempata dois aparelhos no mesmo instante pelo id, qualquer que seja a ordem de entrada', () => {
    const [menor, maior] = [ev(5, '0f3a000000000000'), ev(5, '9a00000000000000')]
    expect([maior, menor].sort(compararEventos)).toEqual([menor, maior])
    expect([menor, maior].sort(compararEventos)).toEqual([menor, maior])
  })

  it('compara o id por unidade de código, e não pelo idioma', () => {
    // 'B' (U+0042) vem antes de 'a' (U+0061) por unidade de código; localeCompare poria 'a' primeiro.
    expect([ev(1, 'a'), ev(1, 'B')].sort(compararEventos)).toEqual([ev(1, 'B'), ev(1, 'a')])
    expect(compararEventos(ev(1, 'x'), ev(1, 'x'))).toBe(0)
  })

  it('dá a mesma ordem para qualquer permutação da entrada', () => {
    const evento = fc.record({ em: fc.integer({ min: 0, max: 3 }), id: fc.constantFrom('a', 'b', 'B', 'c') })
    fc.assert(
      fc.property(fc.uniqueArray(evento, { selector: (e) => `${String(e.em)}|${e.id}` }), fc.nat(), (eventos, giro) => {
        const k = eventos.length === 0 ? 0 : giro % eventos.length
        const girados = [...eventos.slice(k), ...eventos.slice(0, k)].reverse()
        expect([...girados].sort(compararEventos)).toEqual([...eventos].sort(compararEventos))
      }),
    )
  })
})
