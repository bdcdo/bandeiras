import { describe, expect, it } from 'vitest'
import { desembrulhar, erro, ok, type Resultado } from './resultado'

describe('ok', () => {
  it('embrulha o valor com ok verdadeiro', () => {
    expect(ok(3)).toEqual({ ok: true, valor: 3 })
  })
})

describe('erro', () => {
  it('embrulha o erro com ok falso', () => {
    expect(erro({ codigo: 'X', detalhe: 'y' })).toEqual({ ok: false, erro: { codigo: 'X', detalhe: 'y' } })
  })
})

describe('desembrulhar', () => {
  it('devolve o valor de um resultado ok', () => {
    const r: Resultado<number> = ok(7)
    expect(desembrulhar(r)).toBe(7)
  })

  it('lança com o erro serializado quando o resultado não é ok', () => {
    const r: Resultado<number> = erro({ codigo: 'FALHOU', detalhe: 'motivo legível' })
    expect(() => desembrulhar(r)).toThrow(
      'desembrulhar recebeu um erro: {"codigo":"FALHOU","detalhe":"motivo legível"}',
    )
  })
})
