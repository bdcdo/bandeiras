import { describe, expect, it } from 'vitest'
import { idsSequenciais } from './ids-sequenciais'

describe('idsSequenciais', () => {
  it('numera a partir de 1 com o prefixo padrão', () => {
    const ids = idsSequenciais()
    expect([ids.proximo(), ids.proximo(), ids.proximo()]).toEqual(['id-1', 'id-2', 'id-3'])
  })

  it('usa o prefixo dado, e cada gerador conta sozinho', () => {
    const a = idsSequenciais('tarefa')
    const b = idsSequenciais('tarefa')
    expect(a.proximo()).toBe('tarefa-1')
    expect(a.proximo()).toBe('tarefa-2')
    expect(b.proximo()).toBe('tarefa-1')
  })
})
