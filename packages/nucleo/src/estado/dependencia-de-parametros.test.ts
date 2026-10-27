import { describe, expect, it } from 'vitest'
import {
  questaoDeEscolha,
  questaoDigitada,
  respostaCerta,
  respostaErrada,
  tarefaRegistrada,
} from '../apoio-a-testes/cena-do-estado'
import { estadoDeTeste } from '../apoio-a-testes/estado-de-teste'
import { instantaneoDoEstado } from '../apoio-a-testes/instantaneo-do-estado'
import { caminhosLidos, mudaASaida, variacoes, type Formula } from '../apoio-a-testes/regua-de-parametros'
import { desembrulhar } from '../base/resultado'
import type { Instante, Milis } from '../base/tempo'
import { carregarCatalogo } from '../catalogo/carregar-catalogo'
import { TECNICAS_TODAS_LIGADAS } from '../catalogo/tecnicas'
import type { DadosDeCatalogo, IdGrupo, IdItem, ItemBruto } from '../catalogo/tipos'
import { criarEvento, VERSAO_MODELO, type CorpoDeEvento, type Evento } from '../eventos'
import { topicoDeGrupo, topicoDeItem, type IdTopico } from '../grafo'
import {
  aplicarRepeticao,
  atualizarAcuracia,
  PARAMETROS_PADRAO as P,
  type CaminhoDeParametro,
  type EstadoMemoria,
  type Parametros,
  type QualidadeDeResposta,
} from '../memoria'
import type { Questao, UsoDeQuestao } from '../questoes'
import { criarContextoDeReducao } from './contexto'
import { estadoDoPerfil, reduzir } from './reduzir'
import type { EstadoMotor, RespostaLigada } from './tipos'

// A régua da redução, sobre `reduzir` com o contexto montado com os parâmetros de cada variação; o que a régua confere
// e o que não pega está em `apoio-a-testes/regua-de-parametros.ts`. A redução lê os parâmetros pelas fórmulas de
// memoria/, fire/, avaliacao/ e gamificacao/, cada uma com régua própria; esta pega a troca na composição, como a
// repetição da lição lendo o rawDelta de outra qualidade, que com os padrões coincide (perfeita e boa valem 1).
//
// O estado de partida é montado à mão, com memórias onde cada parâmetro age: acurácias extremas e médias, dificuldades
// 1, 2 e 3, muitas repetições, vizinhos medidos para os anéis da acurácia inicial, normas e janela cheias.

function item(
  id: string,
  subcategoria: string,
  dificuldadeAPriori: 1 | 2 | 3,
  grupos: readonly string[] = [],
): ItemBruto {
  return {
    id,
    rotulo: `Item ${id}`,
    aliases: [],
    categoria: 'categoria-1',
    subcategoria,
    grupos,
    dificuldadeAPriori,
    descricao: `Descrição de ${id}`,
    classe: 'classe-1',
    vizinhos: [],
  }
}

// O grupo-1 tem a, b e f; a, c e e dividem a subcategoria-1, e b, d e f a subcategoria-2. As dificuldades a priori são
// 3 (a, e), 2 (c, f) e 1 (b, d), e a do grupo, a maior dos membros, 3.
const catalogo = desembrulhar(
  carregarCatalogo({
    itens: [
      item('a', 'subcategoria-1', 3, ['grupo-1']),
      item('b', 'subcategoria-2', 1, ['grupo-1']),
      item('c', 'subcategoria-1', 2),
      item('d', 'subcategoria-2', 1),
      item('e', 'subcategoria-1', 3),
      item('f', 'subcategoria-2', 2, ['grupo-1']),
    ],
    grupos: [
      { id: 'grupo-1', nome: 'Grupo 1', membros: ['a', 'b', 'f'], tracoDistintivo: { a: 'ta', b: 'tb', f: 'tf' } },
    ],
    vizinhancas: [],
    classes: ['classe-1'],
    categorias: [
      {
        id: 'categoria-1',
        nome: 'Categoria 1',
        subcategorias: [
          { id: 'subcategoria-1', nome: 'Sub 1' },
          { id: 'subcategoria-2', nome: 'Sub 2' },
        ],
      },
    ],
  } satisfies DadosDeCatalogo),
)
const contexto = (p: Parametros) =>
  desembrulhar(criarContextoDeReducao({ catalogo, tecnicas: TECNICAS_TODAS_LIGADAS, parametros: p }))

const DIA = 86_400_000
// O fechamento da lição cai às 04:30 de 2025-10-10 em UTC-3 (fuso 180), meia hora depois da virada do dia, onde a hora
// da virada move o dia do XP; T0 fica vinte dias antes.
const T0 = (Date.UTC(2025, 9, 10, 7, 30) - 20 * DIA) as Instante
const em = (dias: number): Instante => (T0 + dias * DIA) as Instante
const I = (id: string): IdItem => id as IdItem
const T = (id: string): IdTopico => topicoDeItem(I(id)).id
const GRUPO = topicoDeGrupo('grupo-1' as IdGrupo).id

/**
 * Um estado com a acurácia medida uma vez, `repeticoes` repetições e a última em T0, pelas funções da memória: a medida
 * faz o tópico contar nos anéis da acurácia inicial, e a repetição faz o vencimento existir.
 */
function repetido(acuracia: number, repeticoes: number): EstadoMemoria {
  const medido = atualizarAcuracia(estadoDeTeste({ acuracia, repeticoes }), acuracia >= 0.5, 1, P)
  return aplicarRepeticao(medido, { deltaBruto: 1, agora: T0, velocidade: 1, origem: 'explicita' }, P)
}

const evento = (dias: number, corpo: CorpoDeEvento): Evento =>
  desembrulhar(criarEvento({ em: em(dias), dispositivo: 'aparelho-a', fusoMinutos: 180 }, corpo))

const perfil = evento(-1, {
  tipo: 'perfil-criado',
  semente: 's',
  catalogoHash: catalogo.hash,
  versaoModelo: VERSAO_MODELO,
})
if (perfil.tipo !== 'perfil-criado') throw new Error('perfil esperado')
const doPerfil = estadoDoPerfil(contexto(P), perfil)
const concluida = { status: 'concluida', em: T0, acelerada: false, viaDiagnostico: false } as const
const amostras = (n: number) => Array.from({ length: n }, (_, k) => (1500 + 100 * k) as Milis)

/** O estado de partida: as memórias dadas, a, b, c e o grupo com lição concluída, e normas e janela cheias. */
function partida(memorias: ReadonlyMap<IdTopico, EstadoMemoria>): EstadoMotor {
  return {
    ...doPerfil,
    memorias,
    licoes: new Map([T('a'), T('b'), T('c'), GRUPO].map((t) => [t, concluida])),
    normas: { ...doPerfil.normas, 'rotulo-digitado': amostras(12), 'estimulo-para-rotulo': amostras(12) },
    ultimasQualidades: Array.from({ length: 10 }, (_, k): QualidadeDeResposta => (k % 4 === 0 ? 'lenta' : 'perfeita')),
  }
}

// As acurácias dos extremos põem a velocidade perto dos limites dela, e as médias, longe; o grupo e o e com 50
// repetições levam o intervalo ideal ao teto.
const EXTREMOS = new Map([
  [GRUPO, repetido(0, 3)],
  [T('a'), repetido(1, 2)],
  [T('b'), repetido(0.84, 2)],
  [T('c'), repetido(1, 2)],
  [T('d'), repetido(0.6, 1)],
  [T('e'), repetido(0.3, 1)],
])
const MEDIOS = new Map([
  [GRUPO, repetido(0.95, 50)],
  [T('a'), repetido(0.2, 3)],
  [T('b'), repetido(0.97, 2)],
  [T('c'), repetido(0.5, 3)],
  [T('d'), repetido(0.9, 1)],
  [T('e'), repetido(0.1, 50)],
])

const avulsa = (uso: UsoDeQuestao, questao: Questao) => ({ tarefaId: 'avulsa', passo: 0, uso, questao })
const REVISAO = { tipo: 'revisao' } as const
const saida = (estado: EstadoMotor): Readonly<Record<string, unknown>> => instantaneoDoEstado(estado)

const QUALIDADES_DE_ERRO = ['errada', 'chute', 'nao-sei', 'tempo-esgotado'] as const
const QUALIDADES_DE_ACERTO = ['perfeita', 'boa', 'lenta'] as const

/** Cenários da resposta avulsa sobre o estado de partida com as memórias dadas. */
function cenariosDaResposta(memorias: ReadonlyMap<IdTopico, EstadoMemoria>): ((p: Parametros) => unknown)[] {
  const base = partida(memorias)
  const responder = (dias: number, corpo: CorpoDeEvento) => (p: Parametros) =>
    saida(reduzir(contexto(p), base, evento(dias, corpo)))
  const escolhaEmA = questaoDeEscolha(I('a'), [I('b'), I('c'), I('d')])
  return [
    // Acerto de múltipla escolha em a, cedo, e digitado em b e c, tarde, com cada qualidade de acerto.
    ...QUALIDADES_DE_ACERTO.map((q) => responder(4, respostaCerta(avulsa(REVISAO, escolhaEmA), q))),
    ...QUALIDADES_DE_ACERTO.map((q) => responder(100, respostaCerta(avulsa(REVISAO, questaoDigitada(I('b'))), q))),
    responder(100, respostaCerta(avulsa(REVISAO, questaoDigitada(I('c'))))),
    // Erro muito depois do vencimento, com cada qualidade de erro: o decay multiplica o recuo, e a penalidade sobe.
    ...QUALIDADES_DE_ERRO.map((q) => responder(20, respostaErrada(avulsa(REVISAO, questaoDigitada(I('a'))), q))),
    // O erro de quiz reagenda.
    responder(3, respostaErrada(avulsa({ tipo: 'quiz' }, questaoDigitada(I('b'))))),
    // Resposta sobre f, sem memória e sem lição: a acurácia inicial pelos três anéis, e a medida.
    responder(3, respostaCerta(avulsa(REVISAO, questaoDigitada(I('f'))))),
  ]
}

/**
 * Cenários do fechamento da lição de `alvo` por licao-concluida, com as respostas ligadas na ordem dada: a repetição
 * da lição e o XP da tarefa, no dia local do evento, e o estado depois de uma revisão errada três dias depois, com a
 * lição já vencida: a repetição perfeita da lição sobre memória nenhuma chega ao teto com qualquer intervalo, e é a
 * revisão que faz os parâmetros do intervalo e do decay moverem a saída.
 */
function cenarioDaLicao(
  memorias: ReadonlyMap<IdTopico, EstadoMemoria>,
  alvo: string,
  acertos: readonly boolean[],
  acelerada = false,
): (p: Parametros) => unknown {
  const tarefa = tarefaRegistrada('licao', [T(alvo)])
  const questao = questaoDigitada(I(alvo))
  const respostas = new Map(
    acertos.map((certo, passo): [number, RespostaLigada] => {
      const uso: UsoDeQuestao = acelerada
        ? { tipo: 'sondagem', etapa: passo === 0 ? 'recordar' : 'confirmar' }
        : { tipo: 'licao', kp: 1 }
      const corpo = (certo ? respostaCerta : respostaErrada)({ tarefaId: tarefa.id, passo, uso, questao })
      if (corpo.avaliacao === undefined) throw new Error('avaliação esperada')
      return [passo, { em: em(19.9), uso, questao, avaliacao: corpo.avaliacao }]
    }),
  )
  const base: EstadoMotor = {
    ...partida(memorias),
    tarefa: { tarefa, iniciadaEm: em(19.9), respostas, normasAntes: doPerfil.normas, qualidadesAntes: [] },
  }
  const fim = evento(20, { tipo: 'licao-concluida', tarefaId: tarefa.id, topico: T(alvo), acelerada })
  const revisao = evento(23, respostaErrada(avulsa(REVISAO, questao)))
  return (p) => {
    const ctx = contexto(p)
    const depois = reduzir(ctx, base, fim)
    return [saida(depois), saida(reduzir(ctx, depois, revisao))]
  }
}

const DA_MEMORIA = [
  'intervaloBaseDias',
  'crescimentoIntervalo',
  'intervaloMaximoDias',
  'limiarDevido',
  'tetoMemoria',
] as const satisfies readonly CaminhoDeParametro[]
const DA_VELOCIDADE = [
  'ganhoAceleracao',
  'acuraciaNeutra',
  'aceleracaoMin',
  'aceleracaoMax',
  'desaceleracaoPorDificuldade.1',
  'desaceleracaoPorDificuldade.2',
  'desaceleracaoPorDificuldade.3',
  'velocidadeMin',
  'velocidadeMax',
] as const satisfies readonly CaminhoDeParametro[]

const FORMULAS: readonly Formula[] = [
  {
    nome: 'reduzir: resposta-registrada',
    // A resposta isolada sobre item não lê `forcaAcuraciaImplicita` nem `limiarTopicoLento`: o crédito desce do alvo,
    // e item não encompassa ninguém.
    dependeDe: [
      ...DA_MEMORIA,
      ...DA_VELOCIDADE,
      'kDecaimentoPorAtraso',
      'tetoDecaimentoPorAtraso',
      'alfaAcuracia',
      'fatorMultiplaEscolha',
      'deltaBruto.perfeita',
      'deltaBruto.boa',
      'deltaBruto.lenta',
      'deltaBruto.errada',
      'deltaBruto.chute',
      'deltaBruto.nao-sei',
      'deltaBruto.tempo-esgotado',
      'pesoAnelGrupo',
      'pesoAnelSubcategoria',
      'pesoAnelGlobal',
      'janelaChuteSistematico',
      'janelaNormasDeLatencia',
    ],
    cenarios: [...cenariosDaResposta(EXTREMOS), ...cenariosDaResposta(MEDIOS)],
  },
  {
    nome: 'reduzir: licao-concluida',
    // Sem chute nas respostas, o chute sistemático não lê os parâmetros dele; o rawDelta da lição é só o da perfeita,
    // e o da revisão seguinte, o da errada.
    dependeDe: [
      ...DA_MEMORIA,
      ...DA_VELOCIDADE,
      'deltaBruto.perfeita',
      'minutosLicao',
      'minutosLicaoAcelerada',
      'multiplicadorXpPerfeita',
      'acertoMinimoXpCheio',
      'multiplicadorXpCheio',
      'acertoMinimoXpParcial',
      'multiplicadorXpParcial',
      'multiplicadorXpInsuficiente',
      'horaViradaDoDia',
      'kDecaimentoPorAtraso',
      'tetoDecaimentoPorAtraso',
      'pesoAnelGrupo',
      'pesoAnelSubcategoria',
      'pesoAnelGlobal',
      'alfaAcuracia',
      'deltaBruto.errada',
      'janelaChuteSistematico',
    ],
    cenarios: [
      ...[EXTREMOS, MEDIOS].flatMap((memorias) => [
        cenarioDaLicao(memorias, 'd', [true, true, true]),
        cenarioDaLicao(memorias, 'e', [true, true, true]),
        cenarioDaLicao(memorias, 'f', [true, true, true]),
      ]),
      cenarioDaLicao(MEDIOS, 'd', [true, true, true, true, false]),
      cenarioDaLicao(MEDIOS, 'd', [true, false, true]),
      cenarioDaLicao(MEDIOS, 'd', [true, false]),
      cenarioDaLicao(MEDIOS, 'd', [false, false, false]),
      cenarioDaLicao(MEDIOS, 'd', [true, true], true),
    ],
  },
]

describe.each(FORMULAS)('$nome depende dos parâmetros que declara', (formula) => {
  it('lê exatamente esses caminhos de parâmetro', () => {
    expect(caminhosLidos(formula)).toEqual(new Set(formula.dependeDe))
  })

  it.each(formula.dependeDe)('muda a saída quando só %s muda', (caminho: CaminhoDeParametro) => {
    expect(variacoes(caminho).length).toBeGreaterThan(0)
    expect(mudaASaida(formula, caminho)).toBe(true)
  })
})
