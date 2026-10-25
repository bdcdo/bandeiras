import { createHash } from 'node:crypto'
import { readdirSync, readFileSync } from 'node:fs'
import { join, relative } from 'node:path'
import { fileURLToPath } from 'node:url'
import ts from 'typescript'
import type { Plugin } from 'vite'

/**
 * Gera `sw.js` no build a partir de `sw/sw.ts`, com a lista de tudo que o build emitiu mais os arquivos de `public/`.
 *
 * Por que não vite-plugin-pwa: ele depende de workbox-build, cuja árvore traz um pacote pré-release sem proveniência que a
 * trava trustPolicy do pnpm recusa como possível tomada de pacote. Um service worker curto, sob controle do repositório,
 * custa menos que afrouxar a trava.
 *
 * A transpilação usa o próprio TypeScript (`transpileModule`), já presente como devDependency, em vez de depender da API
 * de transformação do Vite, que mudou entre as versões 7 e 8.
 */
export function serviceWorker(): Plugin {
  let base = '/'
  let publicDir = ''
  return {
    name: 'bandeiras:service-worker',
    apply: 'build',
    configResolved(config) {
      base = config.base
      publicDir = config.publicDir
    },
    generateBundle(_opcoes, bundle) {
      const emitidos = Object.keys(bundle).filter((nome) => nome !== 'sw.js' && !nome.endsWith('.html'))
      // Os arquivos de public/ são copiados depois deste gancho e não aparecem em `bundle`.
      const publicos = publicDir === '' ? [] : listarRecursivo(publicDir).map((caminho) => relative(publicDir, caminho))
      // A base é a URL que o navegador pede numa navegação, e é ela que o worker devolve offline no lugar de index.html.
      const precache = [base, ...[...emitidos, ...publicos].map((nome) => base + nome)]
      const versao = createHash('sha256').update(precache.join('\n')).digest('hex').slice(0, 16)
      // sw.ts declara __PRECACHE__ e __VERSAO__ só para o tipo (`declare const`, apagado na transpilação); os valores
      // entram aqui, prefixados ao código gerado, para nenhuma substituição textual tocar o fonte.
      const fonte = readFileSync(fileURLToPath(new URL('../sw/sw.ts', import.meta.url)), 'utf8')
      const { outputText } = ts.transpileModule(fonte, {
        compilerOptions: { target: ts.ScriptTarget.ES2023, module: ts.ModuleKind.ESNext },
      })
      const valores = `const __PRECACHE__ = ${JSON.stringify(precache)};\nconst __VERSAO__ = ${JSON.stringify(versao)};\n`
      this.emitFile({ type: 'asset', fileName: 'sw.js', source: valores + outputText })
    },
  }
}

function listarRecursivo(pasta: string): string[] {
  return readdirSync(pasta, { withFileTypes: true }).flatMap((entrada) => {
    const caminho = join(pasta, entrada.name)
    return entrada.isDirectory() ? listarRecursivo(caminho) : [caminho]
  })
}
