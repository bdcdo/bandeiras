/**
 * Contratos dos scripts do gerador que o teste de dados não alcança, porque não aparecem no que fica commitado: a versão
 * de Node em que eles rodam.
 */
import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const RAIZ = new URL('../../../', import.meta.url)
const PACOTE = new URL('../', import.meta.url)

describe('versão do Node', () => {
  // Os scripts só executam sob `if (import.meta.main)`. A propriedade entrou no Node 24.2.0 e passou a valer para arquivo
  // .ts executado por type stripping no 24.3.0; antes disso ela é undefined, e cada script sai com código 0 sem fazer
  // nada, o que deixaria `pnpm gerar:dados` terminar com sucesso sem baixar nem gerar.
  const MINIMA = [24, 3, 0]
  const atende = (versao: number[]): boolean => {
    for (let i = 0; i < MINIMA.length; i++) {
      const [parte, minima] = [versao[i] ?? 0, MINIMA[i] ?? 0]
      if (parte !== minima) return parte > minima
    }
    return true
  }

  it('o engines da raiz e o do pacote começam no Node 24.3', () => {
    for (const [nome, pasta] of [
      ['raiz', RAIZ],
      ['pacote', PACOTE],
    ] as const) {
      const { engines } = JSON.parse(readFileSync(new URL('package.json', pasta), 'utf8')) as {
        engines?: { node?: string }
      }
      const minima = /^>=(\d+(?:\.\d+){0,2}) <25$/.exec(engines?.node ?? '')?.[1]
      expect(minima, `engines.node da ${nome}: ${engines?.node ?? ''}`).toBeDefined()
      expect(atende((minima ?? '').split('.').map(Number)), `engines.node da ${nome}: ${engines?.node ?? ''}`).toBe(true)
    }
  })

  it('o .nvmrc fixa uma versão completa da linha 24, a partir da 24.3', () => {
    const versao = readFileSync(new URL('.nvmrc', RAIZ), 'utf8').trim()
    expect(versao).toMatch(/^24\.\d+\.\d+$/)
    expect(atende(versao.split('.').map(Number)), versao).toBe(true)
  })
})
