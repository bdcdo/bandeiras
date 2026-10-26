/**
 * Contratos dos scripts do gerador que o teste de dados não alcança, porque não aparecem no que fica commitado: a versão
 * de Node em que eles rodam e a assinatura de similaridade das bandeiras que o resvg não desenha por inteiro.
 */
import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import revisoes from '../gerado/commons-revisoes.json'
import { assinar } from '../scripts/similaridade.ts'

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

describe('assinatura de similaridade', () => {
  // O original do Paquistão no Commons, byte a byte (domínio público): a estrela é um polígono com coordenadas na casa
  // das centenas de milhares sob scale(0.00001557408), e o resvg não a desenha neste arquivo.
  const PAQUISTAO = [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<!DOCTYPE svg PUBLIC "-//W3C//DTD SVG 1.1//EN" "http://www.w3.org/Graphics/SVG/1.1/DTD/svg11.dtd">',
    '<svg xmlns="http://www.w3.org/2000/svg" width="900" height="600" viewBox="-75 -40 120 80" version="1.1">',
    '<title>Flag of Pakistan</title>',
    '  <rect x="-75" y="-40" width="120" height="80" fill="#fff"/>',
    '  <rect x="-45" y="-40" width="90" height="80" fill="#01411C"/>',
    '  <circle r="24" fill="#fff"/>',
    '  <circle r="22" cx="-7" cy="-40" fill="#01411C" transform="rotate(-41.63354, 45, -40)"/>',
    '<polygon points="0,-513674 301930,415571 -488533,-158734 488533,-158734 -301930,415571" fill="#fff" transform="rotate(-41.63354) translate(16) rotate(18) scale(0.00001557408)"/>',
    '</svg>',
    '',
  ].join('\n')

  it('o original do teste é a revisão do Paquistão fixada em commons-revisoes.json', () => {
    const fixada = revisoes.find((r) => r.codigo === 'pk')?.sha1
    expect(createHash('sha1').update(PAQUISTAO).digest('hex')).toBe(fixada)
  })

  it('a assinatura do Paquistão inclui a estrela', () => {
    // Com e sem a estrela, a grade 3x3 tem de mudar. Ela fica quase toda na célula da direita da linha do meio e ocupa
    // poucos por cento dela: o branco sobre o verde muda a cor média dessa célula em cerca de 5 ΔE.
    const com = assinar('pk', Buffer.from(PAQUISTAO)).grade
    const sem = assinar('pk', Buffer.from(PAQUISTAO.replace(/<polygon[^>]*\/>/, ''))).grade
    const deltas = com.map((c, i) => {
      const s = sem[i] ?? [0, 0, 0]
      return Math.hypot(c[0] - s[0], c[1] - s[1], c[2] - s[2])
    })
    expect(Math.max(...deltas)).toBeGreaterThan(1)
  })
})
