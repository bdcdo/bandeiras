import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

// O núcleo é genérico: nenhum módulo de produção nomeia o domínio das bandeiras. Comentário pode citar o domínio como
// exemplo; código, string e identificador não. A comparação é feita sem acento e sem caixa, para "País" e "pais" (e a
// forma decomposta de "país") caírem na mesma palavra.
const RAIZ = fileURLToPath(new URL('.', import.meta.url))
const PALAVRAS_DO_DOMINIO = /bandeira|pais|svg/i

function modulosDeProducao(): string[] {
  return readdirSync(RAIZ, { recursive: true, encoding: 'utf8' })
    .map((caminho) => caminho.split('\\').join('/'))
    .filter((caminho) => caminho.endsWith('.ts') && !caminho.endsWith('.test.ts'))
    .sort()
}

/**
 * Tira comentários de linha e de bloco e mantém strings e template literals, que são código. A alternativa casa a
 * string inteira antes de procurar comentário, e por isso um `//` dentro de uma string não corta o resto da linha.
 * Uma aspa solta dentro de uma expressão regular pode abrir uma string falsa, mas string entre aspas não atravessa
 * linha: no pior caso um comentário daquela linha é lido como código, e o teste acusa a mais, nunca a menos.
 */
function semComentarios(codigo: string): string {
  return codigo.replace(
    /('(?:\\.|[^'\\\n])*'|"(?:\\.|[^"\\\n])*"|`(?:\\[\s\S]|[^`\\])*`)|\/\*[\s\S]*?\*\/|\/\/[^\n]*/g,
    // Comentário de bloco vira só as quebras de linha que tinha, para o número de linha do achado continuar certo.
    (trecho, literal: string | undefined) => literal ?? trecho.replace(/[^\n]/g, ''),
  )
}

const semAcento = (texto: string): string => texto.normalize('NFD').replace(/[\u0300-\u036f]/g, '')

describe('pureza do núcleo', () => {
  it('acha os módulos de produção e deixa os testes de fora', () => {
    const modulos = modulosDeProducao()
    expect(modulos).toContain('base/hash.ts')
    expect(modulos).toContain('catalogo/carregar-catalogo.ts')
    expect(modulos).toContain('index.ts')
    expect(modulos.some((m) => m.endsWith('.test.ts'))).toBe(false)
  })

  it('tira comentários e mantém o código e as strings', () => {
    const codigo = [
      '// bandeira no comentário de linha',
      '/* País no comentário',
      '   de bloco */ const x = 1',
      "const url = 'a//b'",
      'const y = `svg` // fim',
    ].join('\n')
    expect(semComentarios(codigo)).toBe(['', '', ' const x = 1', "const url = 'a//b'", 'const y = `svg` '].join('\n'))
  })

  it('nenhum módulo de produção nomeia o domínio fora de comentários', () => {
    const achados = modulosDeProducao().flatMap((modulo) =>
      semComentarios(readFileSync(join(RAIZ, modulo), 'utf8'))
        .split('\n')
        .flatMap((linha, k) =>
          PALAVRAS_DO_DOMINIO.test(semAcento(linha)) ? [`${modulo}:${String(k + 1)}: ${linha.trim()}`] : [],
        ),
    )
    expect(achados).toEqual([])
  })
})
