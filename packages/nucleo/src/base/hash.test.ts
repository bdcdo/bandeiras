import { describe, expect, it } from 'vitest'
import { hashFnv1a } from './hash'

describe('hashFnv1a', () => {
  it('bate com os vetores publicados do FNV-1a de 64 bits', () => {
    expect(hashFnv1a('')).toBe('cbf29ce484222325')
    expect(hashFnv1a('a')).toBe('af63dc4c8601ec8c')
    expect(hashFnv1a('foobar')).toBe('85944171f73967e8')
  })

  it('tem sempre 16 dígitos e muda com um caractere', () => {
    expect(hashFnv1a('bandeira:br')).toHaveLength(16)
    expect(hashFnv1a('bandeira:br')).not.toBe(hashFnv1a('bandeira:bo'))
  })
})
