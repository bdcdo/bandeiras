import { describe, expect, it } from 'vitest'
import { chaveDeConjunto } from './chave-de-conjunto'

describe('chaveDeConjunto', () => {
  it('não depende da ordem dos ids e não muda a lista recebida', () => {
    const ids = ['b', 'a', 'c']
    expect(chaveDeConjunto(ids)).toBe(chaveDeConjunto(['c', 'b', 'a']))
    expect(ids).toStrictEqual(['b', 'a', 'c'])
  })

  it('ids com o separador de texto comum não colidem', () => {
    expect(chaveDeConjunto(['a|b', 'c'])).not.toBe(chaveDeConjunto(['a', 'b|c']))
    expect(chaveDeConjunto(['a,b', 'c'])).not.toBe(chaveDeConjunto(['a', 'b,c']))
  })
})
