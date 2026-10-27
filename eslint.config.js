// Lint com informação de tipo nos três pacotes e fronteiras entre eles como regra executada. O projectService acha o
// tsconfig.json mais próximo de cada arquivo e segue as referências, como o editor; por isso todo tsconfig.json é só de
// solução e nenhum arquivo versionado fica fora de um projeto-folha.
import js from '@eslint/js'
import { defineConfig, globalIgnores } from 'eslint/config'
import jsxA11y from 'eslint-plugin-jsx-a11y'
import reactHooks from 'eslint-plugin-react-hooks'
import globals from 'globals'
import tseslint from 'typescript-eslint'

const TESTES = ['**/*.test.ts', '**/*.test.tsx', '**/teste/**', '**/apoio-a-testes/**']

/**
 * Restrições de import da casca. Cada pasta tem um conjunto diferente de pacotes proibidos, e o ESLint substitui (não
 * mescla) as opções de uma regra entre blocos de configuração; por isso cada combinação vira um bloco inteiro.
 * @param {{ dominio: boolean; clerk: boolean; supabase: boolean }} proibir
 */
function restricoesDaCasca(proibir) {
  const patterns = [
    {
      regex:
        '^(node:|fs$|path$|os$|crypto$|child_process$|url$|util$|stream$|buffer$|events$|http$|https$|net$|process$)',
      message: 'A casca roda no navegador: nenhum módulo do Node em apps/web/src.',
    },
  ]
  if (proibir.dominio) {
    patterns.push({
      regex: '^@bandeiras/dominio-bandeiras',
      message: 'A casca conhece o domínio só por src/dominio.ts; o resto recebe a interface Dominio por contexto.',
    })
  }
  if (proibir.clerk) {
    patterns.push({ regex: '^@clerk/', message: 'O Clerk fica atrás da porta Autenticacao, em src/autenticacao/.' })
  }
  if (proibir.supabase) {
    patterns.push({
      regex: '^@supabase/',
      message: 'O Supabase fica atrás da interface Remoto, em src/sincronizacao/.',
    })
  }
  return /** @type {import('eslint').Linter.RulesRecord} */ ({
    '@typescript-eslint/no-restricted-imports': ['error', { patterns }],
  })
}

export default defineConfig(
  globalIgnores([
    '**/node_modules/',
    '**/dist/',
    '**/coverage/',
    '**/test-results/',
    '**/playwright-report/',
    '.claude/',
    'packages/dominio-bandeiras/gerado/',
    'packages/dominio-bandeiras/imagens/',
  ]),
  js.configs.recommended,
  tseslint.configs.strictTypeChecked,
  {
    languageOptions: {
      parserOptions: {
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
      },
    },
  },

  // Arquivos de configuração e scripts da raiz rodam no Node.
  {
    files: [
      '*.js',
      '*.mjs',
      '*.cjs',
      '*.ts',
      'scripts/**/*.mjs',
      'apps/web/*.ts',
      'apps/web/plugins/**',
      'apps/web/e2e/**',
    ],
    languageOptions: { globals: globals.node },
  },
  { files: ['**/*.cjs'], languageOptions: { sourceType: 'commonjs' } },

  // Núcleo: puro por construção. Fora de testes, só import relativo (nenhuma dependência de runtime, nenhum pacote do
  // workspace) e nenhuma fonte de tempo, acaso ou identidade: elas entram pelas portas Relogio, Sorteio e GeradorDeIds.
  // crypto e performance já não compilam, porque tsconfig.src.json tem types: [] e lib sem DOM; Date e Math.random existem
  // no ES2023 e dependem destas regras. no-restricted-globals compara nomes de identificadores e nunca casa com um acesso
  // a propriedade, por isso Math.random vai em no-restricted-properties.
  {
    files: ['packages/nucleo/src/**/*.ts'],
    ignores: TESTES,
    rules: {
      '@typescript-eslint/no-restricted-imports': [
        'error',
        { patterns: [{ regex: '^[^.]', message: 'O núcleo só importa do núcleo, por caminho relativo.' }] },
      ],
      'no-restricted-globals': [
        'error',
        { name: 'Date', message: 'Tempo entra pela porta Relogio.' },
        { name: 'crypto', message: 'Acaso e identidade entram pelas portas Sorteio e GeradorDeIds.' },
        { name: 'performance', message: 'Tempo entra pela porta Relogio.' },
        { name: 'globalThis', message: 'O núcleo não lê o ambiente.' },
      ],
      'no-restricted-properties': [
        'error',
        { object: 'Math', property: 'random', message: 'Acaso entra pela porta Sorteio.' },
      ],
    },
  },

  // Costura do modelo de memória: fora de memoria/, fire/ e do construtor de estado dos testes, nenhum código do núcleo,
  // teste incluído, lê ou escreve campo de EstadoMemoria. O dependency-cruiser só vê o import, e o tipo chega pelo índice
  // de memoria/ sem acusar nada; esta regra vê o acesso. Os campos estão em memoria/estado-memoria.ts. Fica de fora só
  // `acuracia`, nome de uso geral que o núcleo usa em outros objetos, como o pedido do construtor.
  {
    files: ['packages/nucleo/src/**/*.ts'],
    ignores: [
      'packages/nucleo/src/memoria/**',
      'packages/nucleo/src/fire/**',
      'packages/nucleo/src/apoio-a-testes/estado-de-teste.ts',
    ],
    rules: {
      'no-restricted-syntax': [
        'error',
        ...['Property[key.name', 'MemberExpression[property.name'].map((no) => ({
          selector: `${no}=/^(numRepeticoes|memoriaBase|ultimaRepEm|ultimaTentativaEm|nAvaliacoes|acuraciaPorDirecao|condicional)$/]`,
          message: 'Campo de EstadoMemoria: use as funções de memoria/ e, em teste, apoio-a-testes/estado-de-teste.ts.',
        })),
      ],
    },
  },

  // Domínio: em src/, só o próprio pacote e o núcleo. Os scripts/ ficam fora da regra: rodam no Node com svgo, sharp e
  // resvg.
  {
    files: ['packages/dominio-bandeiras/src/**/*.ts'],
    ignores: TESTES,
    rules: {
      '@typescript-eslint/no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              regex: '^(?!\\.|@bandeiras/nucleo($|/))',
              message: 'O domínio importa só do próprio pacote e de @bandeiras/nucleo.',
            },
          ],
        },
      ],
    },
  },
  { files: ['packages/dominio-bandeiras/scripts/**/*.ts'], languageOptions: { globals: globals.node } },

  // Casca: navegador, React e acessibilidade.
  {
    files: ['apps/web/src/**/*.{ts,tsx}'],
    languageOptions: { globals: globals.browser },
  },
  { ...reactHooks.configs['recommended-latest'], files: ['apps/web/src/**/*.{ts,tsx}'] },
  { ...jsxA11y.flatConfigs.strict, files: ['apps/web/src/**/*.tsx'] },
  { files: ['apps/web/src/**/*.{ts,tsx}'], rules: restricoesDaCasca({ dominio: true, clerk: true, supabase: true }) },
  { files: ['apps/web/src/dominio.ts'], rules: restricoesDaCasca({ dominio: false, clerk: true, supabase: true }) },
  {
    files: ['apps/web/src/autenticacao/**'],
    rules: restricoesDaCasca({ dominio: true, clerk: false, supabase: true }),
  },
  {
    files: ['apps/web/src/sincronizacao/**'],
    rules: restricoesDaCasca({ dominio: true, clerk: true, supabase: false }),
  },
  { files: ['apps/web/sw/**/*.ts'], languageOptions: { globals: globals.serviceworker } },
)
