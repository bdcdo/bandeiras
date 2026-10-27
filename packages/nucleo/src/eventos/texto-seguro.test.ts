import { describe, expect, it } from 'vitest'
import { ehTextoSeguro, textoSeguroParaLog } from './texto-seguro'

describe('texto seguro para o log', () => {
  it('aceita texto comum, vazio e com par substituto completo', () => {
    for (const texto of ['', 'Item A', 'São Tomé', 'marca 🏳️ e 👍🏽']) {
      expect(ehTextoSeguro(texto), texto).toBe(true)
      expect(textoSeguroParaLog(texto)).toBe(texto)
    }
  })

  it('recusa U+0000 e metade solta de par substituto, no começo, no meio e no fim', () => {
    for (const texto of ['\u0000', 'a\u0000b', '\ud800', 'a\ud800b', 'a\udc00', '\udc00\ud800', '👍\ud83d']) {
      expect(ehTextoSeguro(texto), JSON.stringify(texto)).toBe(false)
    }
  })

  it('troca cada caractere proibido por U+FFFD e preserva os pares completos', () => {
    expect(textoSeguroParaLog('a\u0000b')).toBe('a�b')
    expect(textoSeguroParaLog('\ud800👍\udc00')).toBe('�👍�')
    expect(textoSeguroParaLog('\udc00\ud800')).toBe('��')
    expect(ehTextoSeguro(textoSeguroParaLog('x\ud83d'))).toBe(true)
  })
})
