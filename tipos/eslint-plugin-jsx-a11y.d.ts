// eslint-plugin-jsx-a11y 6.10.2 não publica tipos, e o pacote @types correspondente arrasta um segundo ESLint (a 9) para
// a árvore. Declaração mínima, só do que eslint.config.js usa.
declare module 'eslint-plugin-jsx-a11y' {
  import type { Linter } from 'eslint'

  const plugin: { flatConfigs: { recommended: Linter.Config; strict: Linter.Config } }
  export default plugin
}
