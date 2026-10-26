import fc from 'fast-check'
import { describe, expect, it } from 'vitest'
import { sorteioComSemente } from './sorteio-com-semente'

function sequencia(semente: string, n: number): number[] {
  const sorteio = sorteioComSemente(semente)
  return Array.from({ length: n }, () => sorteio.proximo())
}

describe('sorteioComSemente', () => {
  it('bate com o vetor de referência do mulberry32 sobre o FNV-1a da semente', () => {
    // Vetor calculado à parte com a forma publicada do mulberry32, sobre o estado 0xeb63e066 (8 primeiros dígitos de
    // hashFnv1a('semente-fixa')). Se mudar, todo log gravado passa a reproduzir outra sessão.
    expect(sequencia('semente-fixa', 3)).toEqual([0.09628500626422465, 0.5381485782563686, 0.8387248313520104])
    expect(sequencia('', 3)).toEqual([0.37472643656656146, 0.2679676392581314, 0.6177436469588429])
  })

  it('gera a mesma sequência para a mesma semente', () => {
    fc.assert(
      fc.property(fc.string(), (semente) => {
        expect(sequencia(semente, 20)).toEqual(sequencia(semente, 20))
      }),
    )
  })

  it('gera valores em [0, 1)', () => {
    fc.assert(
      fc.property(fc.string(), (semente) => {
        for (const x of sequencia(semente, 200)) {
          expect(x).toBeGreaterThanOrEqual(0)
          expect(x).toBeLessThan(1)
        }
      }),
    )
  })

  it('separa sementes parecidas', () => {
    expect(sequencia('semente-1', 5)).not.toEqual(sequencia('semente-2', 5))
  })
})

describe('inteiro', () => {
  it('fica dentro de [min, maxExclusivo)', () => {
    fc.assert(
      fc.property(
        fc.string(),
        fc.integer({ min: -1_000, max: 1_000 }),
        fc.integer({ min: 1, max: 1_000 }),
        (semente, min, largura) => {
          const sorteio = sorteioComSemente(semente)
          for (let i = 0; i < 50; i++) {
            const x = sorteio.inteiro(min, min + largura)
            expect(Number.isInteger(x)).toBe(true)
            expect(x).toBeGreaterThanOrEqual(min)
            expect(x).toBeLessThan(min + largura)
          }
        },
      ),
    )
  })

  it('recusa intervalo vazio ou limite fracionário', () => {
    const sorteio = sorteioComSemente('s')
    expect(() => sorteio.inteiro(3, 3)).toThrow(RangeError)
    expect(() => sorteio.inteiro(5, 2)).toThrow(RangeError)
    expect(() => sorteio.inteiro(0, 2.5)).toThrow(RangeError)
    expect(() => sorteio.inteiro(0.5, 2)).toThrow(RangeError)
  })
})

describe('embaralhar', () => {
  it('devolve uma permutação da lista e não muda a original', () => {
    fc.assert(
      fc.property(fc.string(), fc.array(fc.integer()), (semente, xs) => {
        const original = [...xs]
        const embaralhada = sorteioComSemente(semente).embaralhar(xs)
        expect(xs).toEqual(original)
        expect([...embaralhada].sort((a, b) => a - b)).toEqual([...xs].sort((a, b) => a - b))
      }),
    )
  })

  it('é determinístico pela semente', () => {
    fc.assert(
      fc.property(fc.string(), fc.array(fc.integer()), (semente, xs) => {
        expect(sorteioComSemente(semente).embaralhar(xs)).toEqual(sorteioComSemente(semente).embaralhar(xs))
      }),
    )
  })

  it('chega a todas as permutações de três elementos', () => {
    const vistas = new Set<string>()
    for (let i = 0; i < 200; i++)
      vistas.add(
        sorteioComSemente(`s${String(i)}`)
          .embaralhar(['a', 'b', 'c'])
          .join(''),
      )
    expect(vistas.size).toBe(6)
  })
})
