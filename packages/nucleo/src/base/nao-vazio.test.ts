import { describe, expect, it } from 'vitest'
import { ehNaoVazio, type NaoVazio } from './nao-vazio'

describe('ehNaoVazio', () => {
  it('aceita lista com um elemento ou mais e estreita o tipo', () => {
    const xs: readonly string[] = ['a', 'b']
    if (!ehNaoVazio(xs)) throw new Error('a lista tem dois elementos')
    const primeiro: string = xs[0]
    expect(primeiro).toBe('a')
  })

  it('recusa a lista vazia', () => {
    expect(ehNaoVazio([])).toBe(false)
  })

  it('não aceita lista vazia literal no tipo', () => {
    // @ts-expect-error: NaoVazio exige pelo menos um elemento
    const vazia: NaoVazio<string> = []
    expect(vazia).toHaveLength(0)
  })
})
