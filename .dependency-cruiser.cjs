/**
 * O DAG de camadas e as fronteiras entre pacotes como regra executada, não como convenção.
 *
 * Camadas do núcleo, da mais baixa para a mais alta. Cada uma só importa das anteriores. A última, apoio-a-testes,
 * monta o que quiser, e nada de produção depende dela.
 */
const CAMADAS_DO_NUCLEO = [
  'base',
  'catalogo',
  'grafo',
  'memoria',
  'fire',
  'questoes',
  'avaliacao',
  'gamificacao',
  'eventos',
  'diagnostico',
  'remediacao',
  'estado',
  'compressao',
  'planejador',
  'projecoes',
  'motor',
  'apoio-a-testes',
]

const TESTE = '\\.test\\.tsx?$'

/**
 * Uma regra por camada: módulo da camada N não importa de camada acima. Teste fica de fora: a camada restringe o
 * produto, não o que o verifica.
 * @param {string} camada
 * @param {number} indice
 * @returns {import('dependency-cruiser').IForbiddenRuleType[]}
 */
function regraDeCamada(camada, indice) {
  const proibidas = CAMADAS_DO_NUCLEO.slice(indice + 1)
  if (proibidas.length === 0) return []
  return [
    {
      name: `nucleo-camada-${camada}`,
      severity: 'error',
      comment: `nucleo/${camada} não importa de camada acima (${proibidas.join(', ')})`,
      from: { path: `^packages/nucleo/src/${camada}/`, pathNot: TESTE },
      to: { path: `^packages/nucleo/src/(${proibidas.join('|')})/` },
    },
  ]
}
const regrasDeCamada = CAMADAS_DO_NUCLEO.flatMap(regraDeCamada)

/** @type {import('dependency-cruiser').IConfiguration} */
module.exports = {
  forbidden: [
    ...regrasDeCamada,
    {
      name: 'nucleo-importa-so-de-si',
      severity: 'error',
      comment:
        'O núcleo só importa do núcleo: nenhuma dependência de runtime, nenhum pacote do workspace. Tempo, sorteio e ids entram por porta injetada.',
      from: { path: '^packages/nucleo/src/', pathNot: TESTE },
      to: { pathNot: '^packages/nucleo/src/' },
    },
    {
      name: 'so-memoria-e-fire-tocam-estado-memoria',
      severity: 'error',
      comment:
        'Os campos de EstadoMemoria são mexidos só em memoria/ e fire/, e nos testes por apoio-a-testes/estado-de-teste.ts; o resto importa o tipo pelo índice de memoria/. É a costura estreita que mantém o modelo de memória trocável. Esta regra só vê o import; o acesso aos campos fica com o no-restricted-syntax do eslint.config.js.',
      from: { path: '^packages/nucleo/src/', pathNot: '^packages/nucleo/src/(memoria|fire)/' },
      to: { path: '^packages/nucleo/src/memoria/estado-memoria\\.ts$' },
    },
    {
      name: 'nada-de-producao-importa-apoio-a-testes',
      severity: 'error',
      comment:
        'apoio-a-testes (cenários, aprendiz sintético, simulador, suites de contrato) só é importado por testes.',
      from: { path: '^packages/nucleo/src/(?!apoio-a-testes/)', pathNot: TESTE },
      to: { path: '^packages/nucleo/src/apoio-a-testes/' },
    },
    {
      name: 'dominio-importa-so-do-nucleo',
      severity: 'error',
      comment:
        'O domínio das bandeiras importa do próprio pacote e do núcleo (tipos e a camada catalogo); nada da casca, nada de biblioteca em src/. Os scripts/ ficam fora: rodam no Node e usam svgo, sharp e resvg.',
      from: { path: '^packages/dominio-bandeiras/src/', pathNot: TESTE },
      to: { pathNot: '^(packages/dominio-bandeiras/|packages/nucleo/src/|@bandeiras/nucleo)' },
    },
    {
      name: 'web-importa-dominio-so-em-dominio-ts',
      severity: 'error',
      comment:
        'A casca conhece o domínio por um único arquivo, src/dominio.ts; o resto recebe a interface Dominio por contexto. Trocar de domínio é trocar uma linha.',
      from: { path: '^apps/web/src/', pathNot: '^apps/web/src/dominio\\.ts$' },
      to: { path: '^(packages/dominio-bandeiras/|@bandeiras/dominio-bandeiras)' },
    },
    {
      name: 'clerk-so-em-autenticacao',
      severity: 'error',
      comment: 'O Clerk fica atrás da porta Autenticacao, em src/autenticacao/.',
      from: { path: '^apps/web/src/', pathNot: '^apps/web/src/autenticacao/' },
      to: { path: '(^|/)@clerk/' },
    },
    {
      name: 'supabase-so-em-sincronizacao',
      severity: 'error',
      comment: 'O Supabase fica atrás da interface Remoto, em src/sincronizacao/.',
      from: { path: '^apps/web/src/', pathNot: '^apps/web/src/sincronizacao/' },
      to: { path: '(^|/)@supabase/' },
    },
    {
      name: 'web-nao-importa-node',
      severity: 'error',
      comment: 'A casca roda no navegador: nenhum módulo do Node em src/.',
      from: { path: '^apps/web/src/' },
      to: { dependencyTypes: ['core'] },
    },
    {
      name: 'no-circular',
      severity: 'error',
      comment: 'Import circular torna a camada inaplicável.',
      from: {},
      to: { circular: true },
    },
    {
      name: 'no-unresolvable',
      severity: 'error',
      comment:
        'Import que o dependency-cruiser não resolve é invisível para toda regra de caminho acima; é buraco na checagem, não só import quebrado.',
      from: {},
      to: { couldNotResolve: true },
    },
    {
      name: 'no-orphans',
      severity: 'warn',
      from: {
        orphan: true,
        // Fora da regra: dados e tipos, o service worker, os e2e e plugins (entradas próprias), configs, scripts do
        // gerador e o setup do Vitest (apontado por vitest.config.ts, não importado).
        pathNot: [
          '\\.(json|d\\.ts|css|svg|webp)$',
          '^apps/web/(sw|e2e|plugins)/',
          'config\\.ts$',
          '^packages/dominio-bandeiras/scripts/',
          '^apps/web/src/teste/configurar\\.ts$',
        ],
      },
      to: {},
    },
  ],
  options: {
    doNotFollow: { path: 'node_modules' },
    exclude: { path: '(^|/)(node_modules|dist|coverage|test-results|playwright-report|\\.claude)/' },
    // Sem `tsConfig` de propósito: o dependency-cruiser resolve a cadeia de extends a partir do próprio cwd e tropeça na
    // base compartilhada. O resolvedor TypeScript dele lida com esta árvore sem isso.
    tsPreCompilationDeps: true,
    enhancedResolveOptions: {
      exportsFields: ['exports'],
      conditionNames: ['import', 'require', 'node', 'default', 'types'],
      extensions: ['.js', '.ts', '.tsx', '.json'],
    },
  },
}
