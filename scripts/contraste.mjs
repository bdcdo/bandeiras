// Lê apps/web/src/estilos/tokens.css, separa os temas claro e escuro e confere o contraste WCAG dos pares de tokens que a
// interface usa. Sai com 1 em qualquer falha. Conferir pelo número calculado, não no olho.
import { readFileSync } from 'node:fs'

const ARQUIVO = new URL('../apps/web/src/estilos/tokens.css', import.meta.url)
const css = readFileSync(ARQUIVO, 'utf8')

/**
 * @param {string} bloco
 * @returns {Record<string, string>}
 */
function lerTokens(bloco) {
  /** @type {Record<string, string>} */
  const tokens = {}
  for (const [, nome, valor] of bloco.matchAll(/--([a-z0-9-]+):\s*(#[0-9a-fA-F]{6})\s*;/g)) {
    if (nome !== undefined && valor !== undefined) tokens[nome] = valor
  }
  return tokens
}

const escuroInicio = css.indexOf('@media (prefers-color-scheme: dark)')
if (escuroInicio < 0) throw new Error('tokens.css sem o bloco @media (prefers-color-scheme: dark)')
const claro = lerTokens(css.slice(0, escuroInicio))
// O escuro herda do claro o que não redefine.
const escuro = { ...claro, ...lerTokens(css.slice(escuroInicio)) }

/** @param {string} hex */
function luminancia(hex) {
  const [r, g, b] = [1, 3, 5].map((i) => {
    const c = parseInt(hex.slice(i, i + 2), 16) / 255
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4
  })
  return 0.2126 * (r ?? 0) + 0.7152 * (g ?? 0) + 0.0722 * (b ?? 0)
}

/**
 * @param {string} a
 * @param {string} b
 */
function contraste(a, b) {
  const [la, lb] = [luminancia(a), luminancia(b)]
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05)
}

const ESTADOS = ['nao-vista', 'aprendendo', 'em-revisao', 'fragil', 'dominada']
/**
 * Pares [frente, fundo, mínimo]. Texto 4,5:1; borda, foco e outros objetos gráficos 3:1.
 * @type {[string, string, number][]}
 */
const PARES = [
  ['cor-texto', 'cor-fundo', 4.5],
  ['cor-texto', 'cor-superficie', 4.5],
  ['cor-texto-suave', 'cor-fundo', 4.5],
  ['cor-texto-suave', 'cor-superficie', 4.5],
  ['cor-acao', 'cor-fundo', 4.5],
  ['cor-acao', 'cor-superficie', 4.5],
  ['cor-texto-sobre-acao', 'cor-acao', 4.5],
  ['cor-acerto', 'cor-fundo', 4.5],
  ['cor-acerto', 'cor-superficie', 4.5],
  ['cor-erro', 'cor-fundo', 4.5],
  ['cor-erro', 'cor-superficie', 4.5],
  ['cor-borda', 'cor-fundo', 3],
  ['cor-borda', 'cor-superficie', 3],
  ['cor-foco', 'cor-fundo', 3],
  ['cor-foco', 'cor-superficie', 3],
  ...ESTADOS.map((estado) => /** @type {[string, string, number]} */ ([`cor-estado-${estado}`, 'cor-superficie', 4.5])),
]

let falhas = 0
for (const [tema, tokens] of /** @type {[string, Record<string, string>][]} */ ([
  ['claro', claro],
  ['escuro', escuro],
])) {
  for (const [frente, fundo, minimo] of PARES) {
    const a = tokens[frente]
    const b = tokens[fundo]
    if (a === undefined || b === undefined) {
      console.log(`FALHA ${tema}: token ausente em ${frente} sobre ${fundo}`)
      falhas++
      continue
    }
    const razao = contraste(a, b)
    const ok = razao >= minimo
    if (!ok) falhas++
    const linha = `${tema.padEnd(6)} ${frente.padEnd(26)} sobre ${fundo.padEnd(18)} ${razao.toFixed(2)}:1 (mínimo ${String(minimo)}:1)`
    console.log(`${ok ? 'ok   ' : 'FALHA'} ${linha}`)
  }
}
if (falhas > 0) {
  console.error(`${String(falhas)} par(es) abaixo do mínimo`)
  process.exit(1)
}
