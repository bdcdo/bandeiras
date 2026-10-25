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

// Palavras depois das quais vem expressão: uma barra logo depois delas abre expressão regular.
const PEDEM_EXPRESSAO: ReadonlySet<string> = new Set([
  'await',
  'case',
  'default',
  'delete',
  'do',
  'else',
  'in',
  'instanceof',
  'new',
  'of',
  'return',
  'throw',
  'typeof',
  'void',
  'yield',
])
// O parêntese que fecha a condição destas palavras é seguido de comando, que pode começar por expressão regular.
const ABREM_CONDICAO: ReadonlySet<string> = new Set(['for', 'if', 'while'])

/** Fim da expressão regular que começa na barra da posição `inicio`, flags inclusive, ou undefined se a linha acaba. */
function fimDaRegex(codigo: string, inicio: number): number | undefined {
  let emClasse = false
  for (let j = inicio + 1; j < codigo.length; j++) {
    const c = codigo[j]
    if (c === '\\') j++
    else if (c === '\n') return undefined
    else if (c === '[') emClasse = true
    else if (c === ']') emClasse = false
    else if (c === '/' && !emClasse) {
      let fim = j + 1
      while (/[a-z]/i.test(codigo[fim] ?? '')) fim++
      return fim
    }
  }
  return undefined
}

/**
 * Tira comentários de linha e de bloco e mantém o resto, que é código: strings, template literals e expressões
 * regulares inclusive. Comentário de bloco vira só as quebras de linha que tinha, para o número de linha do achado
 * continuar certo.
 *
 * O que impede isto de ser uma busca por `//` e `/*` é a barra. Dentro de expressão regular, `[/*]` e `\/\/` não abrem
 * comentário, e a aspa de `/[']/` não abre string. Ler a regex como código deixaria um comentário falso apagar código,
 * ou uma string falsa desalinhar as aspas até o `//` de dentro de uma string verdadeira virar comentário. Se a barra
 * abre regex ou divide depende do token anterior, como no parser: depois de nome, número, literal, `)` e `]`, divide;
 * depois de operador, `(`, `[`, `{`, `}`, `,`, `;`, das palavras de PEDEM_EXPRESSAO e do `)` que fecha a condição de
 * `if`, `for` e `while`, abre regex. `++`, `--` e `!` mantêm a decisão de antes deles, porque valem como prefixo onde
 * cabe expressão e como sufixo depois dela; com quebra de linha antes, são prefixo.
 *
 * A regra lê divisão como regex em dois casos: depois de `}` que fecha expressão (objeto ou função dividido por algo)
 * e depois de `of`, `await` ou `yield` usados como nome. Nenhum dos dois aparece no núcleo, e o TypeScript recusa o
 * primeiro sem cast. Fora deles, o que sobra é o que o parser lê como código, e nada de código sai como comentário.
 */
function semComentarios(codigo: string): string {
  let saida = ''
  let i = 0
  let barraAbreRegex = true
  let palavraAnterior = ''
  let depoisDePonto = false
  let quebraDesdeOToken = false
  // Cada `{` aberto: true se é o `${` de um template literal, cujo `}` devolve a leitura ao texto do template.
  const chaves: boolean[] = []
  // Cada `(` aberto: true se é a condição de if, for ou while.
  const parenteses: boolean[] = []

  const copiar = (fim: number): void => {
    saida += codigo.slice(i, fim)
    i = fim
  }
  // Texto de template literal a partir de i, até a crase que o fecha ou até o `${` de uma expressão.
  const lerTemplate = (): void => {
    let j = i
    while (j < codigo.length && codigo[j] !== '`' && !codigo.startsWith('${', j)) j += codigo[j] === '\\' ? 2 : 1
    if (codigo.startsWith('${', j)) {
      copiar(j + 2)
      chaves.push(true)
      barraAbreRegex = true
    } else {
      copiar(Math.min(j + 1, codigo.length))
      barraAbreRegex = false
    }
  }

  while (i < codigo.length) {
    const c = codigo[i] ?? ''
    if (codigo.startsWith('//', i)) {
      const fim = codigo.indexOf('\n', i)
      i = fim === -1 ? codigo.length : fim
      continue
    }
    if (codigo.startsWith('/*', i)) {
      const fim = codigo.indexOf('*/', i + 2)
      const trecho = codigo.slice(i, fim === -1 ? codigo.length : fim + 2)
      saida += trecho.replace(/[^\n]/g, '')
      quebraDesdeOToken ||= trecho.includes('\n')
      i += trecho.length
      continue
    }
    if (/\s/.test(c)) {
      quebraDesdeOToken ||= c === '\n'
      copiar(i + 1)
      continue
    }

    const palavra = /[\p{ID_Continue}$]+/uy
    palavra.lastIndex = i
    const nome = palavra.exec(codigo)?.[0]
    if (nome !== undefined) {
      copiar(i + nome.length)
      barraAbreRegex = !depoisDePonto && PEDEM_EXPRESSAO.has(nome)
      palavraAnterior = depoisDePonto ? '' : nome
    } else if (c === "'" || c === '"') {
      let j = i + 1
      while (j < codigo.length && codigo[j] !== c && codigo[j] !== '\n') j += codigo[j] === '\\' ? 2 : 1
      copiar(codigo[j] === c ? j + 1 : j)
      barraAbreRegex = false
    } else if (c === '`') {
      copiar(i + 1)
      lerTemplate()
    } else if (c === '/') {
      const fim: number | undefined = barraAbreRegex ? fimDaRegex(codigo, i) : undefined
      copiar(fim ?? i + 1)
      barraAbreRegex = fim === undefined
    } else if (c === '}' && chaves.pop() === true) {
      copiar(i + 1)
      lerTemplate()
    } else if ((c === '+' || c === '-') && codigo[i + 1] === c) {
      copiar(i + 2)
      barraAbreRegex ||= quebraDesdeOToken
    } else if (c === '!' && codigo[i + 1] !== '=') {
      copiar(i + 1)
      barraAbreRegex ||= quebraDesdeOToken
    } else {
      if (c === '(') parenteses.push(ABREM_CONDICAO.has(palavraAnterior))
      if (c === '{') chaves.push(false)
      copiar(i + 1)
      barraAbreRegex = c === ')' ? parenteses.pop() === true : c !== ']'
    }
    if (nome === undefined) palavraAnterior = ''
    depoisDePonto = c === '.'
    quebraDesdeOToken = false
  }
  return saida
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

  it('lê expressão regular como código e decide a barra pelo token anterior', () => {
    const iguais = (codigo: string): [string, string] => [codigo, codigo]
    const casos: [string, string][] = [
      // Expressão regular com `/*`, `//` ou aspa dentro: nada disso abre comentário nem string.
      [
        'const r = /[/*]/g\nexport const pais = 1\n/** doc */\nexport const svg = 2',
        'const r = /[/*]/g\nexport const pais = 1\n\nexport const svg = 2',
      ],
      iguais("const barra = /[//]/; const rotulo = 'bandeira'"),
      ["const r = /a\\/*b/\nconst t = 'svg'\n/** doc */", "const r = /a\\/*b/\nconst t = 'svg'\n"],
      iguais("const r = texto.replace(/[-'\\u2019]/g, ' ').concat('// bandeira')"),
      // Barra de divisão: o que vem depois dela continua sendo lido, e comentário continua sendo comentário.
      ['const x = a / b // comentário', 'const x = a / b '],
      ['const y = (a + b) / 2 /* c */', 'const y = (a + b) / 2 '],
      iguais("const z = i++ / 2 + '/' + '// svg'"),
      iguais("const w = n! / 2 + '/' + '// svg'"),
      // Depois de palavra que pede expressão e do parêntese que fecha a condição de if, a barra abre regex.
      ["return /'/.test(t) // fim", "return /'/.test(t) "],
      ["export default /'/ // fim", "export default /'/ "],
      iguais("if (x) /[/*]/.test(y) + '// svg'"),
      // Template literal: o texto é código, e a expressão dentro de `${}` tem comentários próprios.
      ['const t = `a ${b /* c */} // d`', 'const t = `a ${b } // d`'],
      ['const u = `x ${`y // z`} w` // fim', 'const u = `x ${`y // z`} w` '],
    ]
    for (const [codigo, esperado] of casos) expect(semComentarios(codigo), codigo).toBe(esperado)
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
