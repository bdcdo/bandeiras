import { erro, ok, type Resultado } from '../base/resultado'
import type { AjustesDeParametros } from '../catalogo/dominio'
import type { Item } from '../catalogo/tipos'

/** Dificuldade a priori de um tópico, na escala que o domínio declara para os itens. */
export type Dificuldade = Item['dificuldadeAPriori']

/**
 * Qualidades de resposta que dão um rawDelta próprio. As três primeiras são acerto e as outras quatro, erro; a camada de
 * avaliação, acima desta, decide a qualidade de cada resposta e lê o delta daqui.
 */
export const QUALIDADES_DE_RESPOSTA = [
  'perfeita',
  'boa',
  'lenta',
  'errada',
  'chute',
  'nao-sei',
  'tempo-esgotado',
] as const
export type QualidadeDeResposta = (typeof QUALIDADES_DE_RESPOSTA)[number]

/**
 * Parâmetros do modelo de memória e das camadas que dependem dele. O tipo traz a tabela inteira, inclusive o que só
 * camadas futuras leem, para ele não precisar ser reaberto a cada camada nova. O significado de cada um está no
 * comentário do valor padrão, com o termo do livro quando há um e a página de The Math Academy Way de onde vem, e a
 * faixa aceita, em `FAIXAS`.
 */
export type Parametros = Readonly<{
  intervaloBaseDias: number
  crescimentoIntervalo: number
  intervaloMaximoDias: number
  limiarDevido: number
  tetoMemoria: number
  alfaAcuracia: number
  acuraciaNeutra: number
  ganhoAceleracao: number
  aceleracaoMin: number
  aceleracaoMax: number
  desaceleracaoPorDificuldade: Readonly<Record<Dificuldade, number>>
  velocidadeMin: number
  velocidadeMax: number
  limiarTopicoLento: number
  kDecaimentoPorAtraso: number
  tetoDecaimentoPorAtraso: number
  deltaBruto: Readonly<Record<QualidadeDeResposta, number>>
  fatorExposicaoDistrator: number
  fatorMultiplaEscolha: number
  forcaAcuraciaImplicita: number
  pesoAnelGrupo: number
  pesoAnelSubcategoria: number
  pesoAnelGlobal: number
  tetoNumRepeticoesDiagnostico: number
  novasPorSessaoMax: number
  cotaLicaoMin: number
  numRepeticoesSaiDoAprendizado: number
  numRepeticoesDominado: number
  janelaAntecipacaoDias: number
  orcamentoPadraoMin: number
  latenciaChuteMs: number
  quizACada: number
  topicosMinimosParaQuiz: number
  numRepeticoesMinimaParaQuiz: number
  tamanhoQuiz: number
  numRepeticoesMinimaCronometrada: number
  acuraciaMinimaCronometrada: number
  limiteCronometradoMinMs: number
  fatorLimiteCronometrado: number
}>

/** Congela o objeto e cada objeto dentro dele, para nenhum chamador mexer nos valores padrão de todos. */
function congelar<T extends object>(objeto: T): T {
  for (const valor of Object.values(objeto)) if (typeof valor === 'object' && valor !== null) congelar(valor)
  return Object.freeze(objeto)
}

export const PARAMETROS_PADRAO: Parametros = congelar({
  // interval do livro para repNum = 1, em dias. Com o crescimento abaixo, os primeiros intervalos ideais são 1; 2,2;
  // 4,84 e 10,65 dias, e a partir do nono vale o teto de um ano; o teste de `intervaloIdeal` fixa esses valores.
  intervaloBaseDias: 1,
  // Razão entre intervalos ideais consecutivos: cada repetição bem-sucedida multiplica o intervalo seguinte por 2,2.
  crescimentoIntervalo: 2.2,
  // Teto do interval: ninguém espera mais de um ano por uma revisão, por mais repetições que tenha.
  intervaloMaximoDias: 365,
  // Limiar de memory abaixo do qual a repetição vence. A memória decai do teto ao limiar em exatamente um intervalo
  // ideal, e com o teto 1 isso é cair pela metade.
  limiarDevido: 0.5,
  // Teto de memory depois de uma repetição. Um acerto no dia devido com delta de pelo menos teto - limiar devolve a
  // memória ao teto, e o espaçamento real é o do intervalo ideal. Um acerto parcial, como o lento em múltipla escolha ou
  // o crédito implícito com fator baixo, deixa a memória abaixo do teto e antecipa o vencimento seguinte. Sem o teto,
  // um acerto perfeito no dia devido deixaria a memória em 1,5 e esticaria o intervalo seguinte.
  tetoMemoria: 1,
  // Peso da resposta nova na média exponencial da acurácia: a média esquece em cerca de 5 avaliações.
  alfaAcuracia: 0.3,
  // Acurácia de quem não tem informação; com ela e dificuldade 2, a speed vale 1.
  acuraciaNeutra: 0.85,
  // Speedup por habilidade (p. 370): cada ponto de acurácia acima da neutra acelera 2,5 pontos.
  ganhoAceleracao: 2.5,
  // Limites do speedup por habilidade, antes de dividir pela dificuldade.
  aceleracaoMin: 0.5,
  aceleracaoMax: 1.4,
  // Slowdown por dificuldade do tópico (p. 370-372): item único e fácil acelera, parecido em grupo grande desacelera.
  desaceleracaoPorDificuldade: { 1: 0.8, 2: 1, 3: 1.3 },
  // Limites da speed. 2 quer dizer que um acerto vale duas repetições, como no livro.
  velocidadeMin: 0.25,
  velocidadeMax: 2,
  // Abaixo desta speed o tópico é lento (p. 263-264): só revisão explícita, nenhum crédito implícito.
  limiarTopicoLento: 1,
  // Inclinação do decay pela memória: memória na metade do limiar dá decay 1,5, e num quarto dá 2.
  kDecaimentoPorAtraso: 0.5,
  // Teto do decay, para um tópico esquecido de todo não voltar ao zero de uma vez.
  tetoDecaimentoPorAtraso: 3,
  // rawDelta por qualidade de resposta (p. 373): positivo no acerto e negativo no erro, maior em módulo quanto melhor o
  // acerto ou pior o erro. Tempo esgotado em questão cronometrada é evidência fraca de erro; "não sei" vale como erro,
  // mas não leva a penalidade de chute no XP.
  deltaBruto: {
    perfeita: 1,
    boa: 1,
    lenta: 0.6,
    errada: -1,
    chute: -1,
    'nao-sei': -1,
    'tempo-esgotado': -0.5,
  },
  // Fator de exposição de um membro mostrado como opção e descartado: descartar vale metade de recordar.
  fatorExposicaoDistrator: 0.5,
  // Fator da questão de múltipla escolha no repNum: reconhecer entre opções vale metade de recordar o rótulo.
  fatorMultiplaEscolha: 0.5,
  // Fração do peso com que um acerto implícito entra na acurácia do tópico encompassado (p. 370): o acerto desce com
  // meia força, porque mostra a habilidade do tópico simples só dentro do avançado.
  forcaAcuraciaImplicita: 0.5,
  // Pesos dos três anéis da acurácia inicial de um tópico novo (p. 371): grupos do item, subcategoria e tudo. Anel sem
  // tópico medido cede o peso aos outros.
  pesoAnelGrupo: 0.5,
  pesoAnelSubcategoria: 0.3,
  pesoAnelGlobal: 0.2,
  // Teto do repNum gravado pelo diagnóstico (p. 379): repetições iguais ao saldo, mas abaixo de "dominado", porque o
  // diagnóstico mede a borda conservadora do que se sabe.
  tetoNumRepeticoesDiagnostico: 3,
  // Lições novas por sessão: quatro lições de cerca de um minuto e meio.
  novasPorSessaoMax: 4,
  // Fração mínima do tempo da sessão em lição nova, mesmo com fila de revisões (p. 314).
  cotaLicaoMin: 0.25,
  // repNum a partir do qual o tópico sai da fase de aprendizado: a lição e uma revisão em outro dia.
  numRepeticoesSaiDoAprendizado: 2,
  // repNum a partir do qual o tópico conta como dominado.
  numRepeticoesDominado: 4,
  // Janela em que uma tarefa de grupo antecipa revisões que vencem logo, em dias.
  janelaAntecipacaoDias: 2,
  // Orçamento padrão da sessão, em minutos. O XP é calibrado em minutos, e a meta diária padrão vale o mesmo número.
  orcamentoPadraoMin: 15,
  // Resposta errada mais rápida que isto é chute. Só qualifica erro: acertar rápido é automaticidade, a meta do livro.
  latenciaChuteMs: 600,
  // Um quiz a cada tantas sessões, curto e frequente, desde que haja tópicos bastante avançados para ele.
  quizACada: 3,
  topicosMinimosParaQuiz: 20,
  numRepeticoesMinimaParaQuiz: 3,
  tamanhoQuiz: 8,
  // Uma questão é cronometrada só em tópico com estas repetições e esta acurácia: acurácia antes de velocidade.
  numRepeticoesMinimaCronometrada: 3,
  acuraciaMinimaCronometrada: 0.9,
  // Limite da questão cronometrada: o maior entre este piso e o fator vezes a mediana do próprio usuário no formato.
  limiteCronometradoMinMs: 3000,
  fatorLimiteCronometrado: 1.5,
})

type Escalar = { [K in keyof Parametros]: Parametros[K] extends number ? K : never }[keyof Parametros]
type Aninhado = {
  [K in keyof Parametros]: Parametros[K] extends number ? never : `${K}.${keyof Parametros[K] & (string | number)}`
}[keyof Parametros]

/**
 * Nome de um parâmetro em `AjustesDeParametros`: o próprio nome para os escalares e o caminho com ponto para os
 * aninhados, como `desaceleracaoPorDificuldade.3` e `deltaBruto.lenta`.
 */
export type CaminhoDeParametro = Escalar | Aninhado

type Faixa = { descricao: string; aceita: (valor: number) => boolean }

const POSITIVO: Faixa = { descricao: 'maior que zero', aceita: (x) => x > 0 }
const NAO_NEGATIVO: Faixa = { descricao: 'maior ou igual a zero', aceita: (x) => x >= 0 }
const ATE_UM: Faixa = { descricao: 'entre 0 e 1', aceita: (x) => x >= 0 && x <= 1 }
const POSITIVO_ATE_UM: Faixa = { descricao: 'maior que 0 e no máximo 1', aceita: (x) => x > 0 && x <= 1 }
const ENTRE_ZERO_E_UM: Faixa = { descricao: 'maior que 0 e menor que 1', aceita: (x) => x > 0 && x < 1 }
const PELO_MENOS_UM: Faixa = { descricao: 'maior ou igual a 1', aceita: (x) => x >= 1 }
const INTEIRO_POSITIVO: Faixa = { descricao: 'inteiro maior que zero', aceita: (x) => Number.isInteger(x) && x > 0 }
const INTEIRO_NAO_NEGATIVO: Faixa = {
  descricao: 'inteiro maior ou igual a zero',
  aceita: (x) => Number.isInteger(x) && x >= 0,
}
const NEGATIVO_ATE_MENOS_UM: Faixa = { descricao: 'menor que 0 e no mínimo -1', aceita: (x) => x < 0 && x >= -1 }

/**
 * Faixa aceita por parâmetro. O tipo obriga a tabela a cobrir todo caminho de `Parametros`. As faixas que não são só
 * "positivo" existem porque uma fórmula depende delas: o limiar fica acima de 0 porque `devidoEm` toma o logaritmo da
 * memória sobre ele; o crescimento é pelo menos 1 para o intervalo nunca encolher com mais repetições; o decay nunca
 * fica abaixo de 1; e o rawDelta de acerto fica em (0, 1] e o de erro em [-1, 0), porque uma repetição perfeita vale uma
 * repetição inteira, e o limite do reteste depende disso. O que o limiar e o teto exigem um do outro está em `RELACOES`.
 */
const FAIXAS: Readonly<Record<CaminhoDeParametro, Faixa>> = {
  intervaloBaseDias: POSITIVO,
  crescimentoIntervalo: PELO_MENOS_UM,
  intervaloMaximoDias: POSITIVO,
  limiarDevido: ENTRE_ZERO_E_UM,
  tetoMemoria: POSITIVO,
  alfaAcuracia: POSITIVO_ATE_UM,
  acuraciaNeutra: ATE_UM,
  ganhoAceleracao: NAO_NEGATIVO,
  aceleracaoMin: POSITIVO,
  aceleracaoMax: POSITIVO,
  'desaceleracaoPorDificuldade.1': POSITIVO,
  'desaceleracaoPorDificuldade.2': POSITIVO,
  'desaceleracaoPorDificuldade.3': POSITIVO,
  velocidadeMin: POSITIVO,
  velocidadeMax: POSITIVO,
  limiarTopicoLento: NAO_NEGATIVO,
  kDecaimentoPorAtraso: NAO_NEGATIVO,
  tetoDecaimentoPorAtraso: PELO_MENOS_UM,
  'deltaBruto.perfeita': POSITIVO_ATE_UM,
  'deltaBruto.boa': POSITIVO_ATE_UM,
  'deltaBruto.lenta': POSITIVO_ATE_UM,
  'deltaBruto.errada': NEGATIVO_ATE_MENOS_UM,
  'deltaBruto.chute': NEGATIVO_ATE_MENOS_UM,
  'deltaBruto.nao-sei': NEGATIVO_ATE_MENOS_UM,
  'deltaBruto.tempo-esgotado': NEGATIVO_ATE_MENOS_UM,
  fatorExposicaoDistrator: ATE_UM,
  fatorMultiplaEscolha: ATE_UM,
  forcaAcuraciaImplicita: ATE_UM,
  pesoAnelGrupo: POSITIVO,
  pesoAnelSubcategoria: POSITIVO,
  pesoAnelGlobal: POSITIVO,
  tetoNumRepeticoesDiagnostico: NAO_NEGATIVO,
  novasPorSessaoMax: INTEIRO_NAO_NEGATIVO,
  cotaLicaoMin: ATE_UM,
  numRepeticoesSaiDoAprendizado: POSITIVO,
  numRepeticoesDominado: POSITIVO,
  janelaAntecipacaoDias: NAO_NEGATIVO,
  orcamentoPadraoMin: POSITIVO,
  latenciaChuteMs: NAO_NEGATIVO,
  quizACada: INTEIRO_POSITIVO,
  topicosMinimosParaQuiz: INTEIRO_NAO_NEGATIVO,
  numRepeticoesMinimaParaQuiz: NAO_NEGATIVO,
  tamanhoQuiz: INTEIRO_POSITIVO,
  numRepeticoesMinimaCronometrada: NAO_NEGATIVO,
  acuraciaMinimaCronometrada: ATE_UM,
  limiteCronometradoMinMs: POSITIVO,
  fatorLimiteCronometrado: POSITIVO,
}

/**
 * Relações entre parâmetros que a faixa de cada um sozinha não garante. Um limite mínimo acima do máximo deixaria o
 * `limitar` sem sentido. O teto de memória fica acima do limiar porque a memória decai do teto ao limiar e
 * `fatorPrecocidade` divide por teto - limiar; com o teto no limiar ou abaixo, todo tópico venceria logo depois de um
 * acerto. E fica no máximo um rawDelta perfeito acima do limiar, senão nem o acerto perfeito no dia devido devolveria a
 * memória ao teto, e o espaçamento real ficaria abaixo do intervalo ideal em toda repetição.
 */
const RELACOES: readonly { descricao: string; vale: (p: Parametros) => boolean }[] = [
  { descricao: 'intervaloBaseDias <= intervaloMaximoDias', vale: (p) => p.intervaloBaseDias <= p.intervaloMaximoDias },
  { descricao: 'limiarDevido < tetoMemoria', vale: (p) => p.limiarDevido < p.tetoMemoria },
  {
    descricao: 'tetoMemoria <= limiarDevido + deltaBruto.perfeita',
    vale: (p) => p.tetoMemoria <= p.limiarDevido + p.deltaBruto.perfeita,
  },
  { descricao: 'aceleracaoMin <= aceleracaoMax', vale: (p) => p.aceleracaoMin <= p.aceleracaoMax },
  { descricao: 'velocidadeMin <= velocidadeMax', vale: (p) => p.velocidadeMin <= p.velocidadeMax },
  {
    descricao: 'numRepeticoesSaiDoAprendizado <= numRepeticoesDominado',
    vale: (p) => p.numRepeticoesSaiDoAprendizado <= p.numRepeticoesDominado,
  },
]

export type ErroDeParametros = { codigo: 'PARAMETRO_DESCONHECIDO' | 'PARAMETRO_INVALIDO'; detalhe: string }

const ehCaminho = (chave: string): chave is CaminhoDeParametro => Object.hasOwn(FAIXAS, chave)

/** O mesmo valor com um caminho trocado. O caminho com ponto troca a chave dentro do objeto aninhado. */
function comAjuste(p: Parametros, caminho: CaminhoDeParametro, valor: number): Parametros {
  const ponto = caminho.indexOf('.')
  if (ponto === -1) return { ...p, [caminho]: valor }
  const chave = caminho.slice(0, ponto) as Exclude<keyof Parametros, Escalar>
  return { ...p, [chave]: { ...p[chave], [caminho.slice(ponto + 1)]: valor } }
}

/**
 * Parâmetros padrão com os ajustes do domínio aplicados. Recusa, nesta ordem, chave que não é parâmetro
 * (`PARAMETRO_DESCONHECIDO`) e valor que não é número finito, fora da faixa do parâmetro ou que quebra uma relação entre
 * parâmetros (`PARAMETRO_INVALIDO`). Como no catálogo, o erro lista todas as ocorrências da primeira regra violada.
 */
export function resolverParametros(ajustes: AjustesDeParametros = {}): Resultado<Parametros, ErroDeParametros> {
  const entradas = Object.entries(ajustes)
  const desconhecidas = entradas.filter(([chave]) => !ehCaminho(chave)).map(([chave]) => `'${chave}'`)
  if (desconhecidas.length > 0) {
    return erro({ codigo: 'PARAMETRO_DESCONHECIDO', detalhe: `parâmetro que não existe: ${desconhecidas.join('; ')}` })
  }
  const invalidos = entradas.flatMap(([chave, valor]) => {
    const faixa = ehCaminho(chave) ? FAIXAS[chave] : undefined
    if (faixa === undefined || (Number.isFinite(valor) && faixa.aceita(valor))) return []
    return [`${chave} = ${String(valor)} (precisa ser número finito ${faixa.descricao})`]
  })
  if (invalidos.length > 0) {
    return erro({ codigo: 'PARAMETRO_INVALIDO', detalhe: `parâmetro fora da faixa: ${invalidos.join('; ')}` })
  }
  const resolvidos = entradas.reduce(
    (p, [chave, valor]) => (ehCaminho(chave) ? comAjuste(p, chave, valor) : p),
    PARAMETROS_PADRAO,
  )
  const quebradas = RELACOES.filter((r) => !r.vale(resolvidos)).map((r) => r.descricao)
  if (quebradas.length > 0) {
    return erro({ codigo: 'PARAMETRO_INVALIDO', detalhe: `relação entre parâmetros quebrada: ${quebradas.join('; ')}` })
  }
  return ok(resolvidos)
}
