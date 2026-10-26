import { describe, expect, it } from 'vitest'
import {
  conferirTecnicas,
  TECNICAS_TODAS_DESLIGADAS,
  TECNICAS_TODAS_LIGADAS,
  type NomeDeTecnica,
  type Tecnicas,
} from './tecnicas'

const NOMES = Object.keys(TECNICAS_TODAS_LIGADAS) as NomeDeTecnica[]

function com(alteracoes: Partial<Tecnicas>): Tecnicas {
  return { ...TECNICAS_TODAS_LIGADAS, ...alteracoes }
}

describe('TECNICAS_TODAS_LIGADAS e TECNICAS_TODAS_DESLIGADAS', () => {
  it('têm os doze interruptores, todos no mesmo valor', () => {
    expect(NOMES).toHaveLength(12)
    expect(Object.values(TECNICAS_TODAS_LIGADAS).every((v) => v)).toBe(true)
    expect(Object.keys(TECNICAS_TODAS_DESLIGADAS)).toEqual(NOMES)
    expect(Object.values(TECNICAS_TODAS_DESLIGADAS).some((v) => v)).toBe(false)
  })

  it('são congeladas', () => {
    expect(Object.isFrozen(TECNICAS_TODAS_LIGADAS)).toBe(true)
    expect(Object.isFrozen(TECNICAS_TODAS_DESLIGADAS)).toBe(true)
  })
})

describe('conferirTecnicas', () => {
  it('aceita tudo ligado e tudo desligado', () => {
    expect(conferirTecnicas(TECNICAS_TODAS_LIGADAS)).toEqual({ ok: true, valor: TECNICAS_TODAS_LIGADAS })
    expect(conferirTecnicas(TECNICAS_TODAS_DESLIGADAS)).toEqual({ ok: true, valor: TECNICAS_TODAS_DESLIGADAS })
  })

  const FIRE = 'fire exige grupos: sem grupos o grafo não tem aresta por onde o crédito se propague'
  const COMPRESSAO = 'compressao exige grupos: sem grupos não há tópico que cubra outros'

  it('recusa fire sem grupos', () => {
    expect(conferirTecnicas(com({ grupos: false, compressao: false }))).toEqual({
      ok: false,
      erro: { codigo: 'TECNICAS_INCOERENTES', detalhe: FIRE },
    })
  })

  it('recusa compressao sem grupos', () => {
    expect(conferirTecnicas(com({ grupos: false, fire: false }))).toEqual({
      ok: false,
      erro: { codigo: 'TECNICAS_INCOERENTES', detalhe: COMPRESSAO },
    })
  })

  it('relata as duas incoerências de uma vez', () => {
    expect(conferirTecnicas(com({ grupos: false }))).toEqual({
      ok: false,
      erro: { codigo: 'TECNICAS_INCOERENTES', detalhe: `${FIRE}; ${COMPRESSAO}` },
    })
  })

  it('aceita exatamente as combinações em que fire e compressao têm grupos, nas 4096 possíveis', () => {
    for (let mascara = 0; mascara < 2 ** NOMES.length; mascara++) {
      const tecnicas = Object.fromEntries(NOMES.map((nome, k) => [nome, ((mascara >> k) & 1) === 1])) as Tecnicas
      const coerente = tecnicas.grupos || (!tecnicas.fire && !tecnicas.compressao)
      expect(conferirTecnicas(tecnicas).ok).toBe(coerente)
    }
  })
})
