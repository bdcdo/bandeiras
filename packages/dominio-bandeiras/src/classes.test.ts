import { describe, expect, it } from 'vitest'
import { PADROES_VISUAIS } from './classes'

describe('PADROES_VISUAIS', () => {
  it('é uma lista fechada de oito padrões sem repetição', () => {
    expect(PADROES_VISUAIS).toHaveLength(8)
    expect(new Set(PADROES_VISUAIS).size).toBe(PADROES_VISUAIS.length)
  })
})
