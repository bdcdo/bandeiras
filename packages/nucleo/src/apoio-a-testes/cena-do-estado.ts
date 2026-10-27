import { desembrulhar } from '../base/resultado'
import type { Instante, Milis, Minutos } from '../base/tempo'
import { TECNICAS_TODAS_LIGADAS, type Tecnicas } from '../catalogo/tecnicas'
import type { AjustesDeParametros } from '../catalogo/dominio'
import type { Catalogo, IdItem } from '../catalogo/tipos'
import { topicoDeItem } from '../grafo'
import { PARAMETROS_PADRAO, resolverParametros, type Parametros, type QualidadeDeResposta } from '../memoria'
import { direcaoDoFormato, type ContextoDeQuestao, type Questao, type UsoDeQuestao } from '../questoes'
import { criarQuestao, type FormatoDeQuestao } from '../questoes/questao'
import type { QualidadeDeAcerto, QualidadeDeErro } from '../avaliacao'
import {
  idDeTarefa,
  VERSAO_MODELO,
  type CorpoDeEvento,
  type CorpoDeResposta,
  type Evento,
  type PassoRegistrado,
  type TarefaRegistrada,
} from '../eventos'
import { criarContextoDeReducao, emitir, iniciarPerfil, type ContextoDeReducao, type EstadoMotor } from '../estado'
import { catalogoFixo } from './catalogo-de-teste'

// Cenas dos casos fixos da camada estado: um perfil, o relógio de um aparelho e os eventos emitidos, como o motor os
// emitiria, por `iniciarPerfil` e `emitir`. Os corpos são montados à mão, com a avaliação que o caso quer, e não por
// `avaliarResposta`: o redutor lê o julgamento gravado, e o caso escolhe a qualidade sem depender das normas de latência.

export const INICIO_DA_CENA = 1_760_000_000_000 as Instante
export const MINUTO = 60_000
export const HORA = 60 * MINUTO
export const DIA = 24 * HORA

export type Cena = {
  readonly ctx: ContextoDeReducao
  estado: EstadoMotor
  readonly eventos: Evento[]
  /** O agora do relógio do aparelho, que cada emissão avança `passoDoRelogio`. */
  agora: number
  /** Quanto o relógio anda a cada emissão: um segundo, ou zero para o relógio parado. */
  passoDoRelogio: number
  fusoMinutos: number
  dispositivo: string
}

/** Uma cena com o perfil criado no agora dado, no fuso 180 e no aparelho 'aparelho-a', a menos do que se pedir. */
export function novaCena(
  ctx: ContextoDeReducao,
  campos: Readonly<{ agora?: number; fusoMinutos?: number; dispositivo?: string; semente?: string }> = {},
): Cena {
  const agora = campos.agora ?? INICIO_DA_CENA
  const fusoMinutos = campos.fusoMinutos ?? 180
  const dispositivo = campos.dispositivo ?? 'aparelho-a'
  const corpo = {
    tipo: 'perfil-criado',
    semente: campos.semente ?? 'semente',
    catalogoHash: ctx.catalogo.hash,
    versaoModelo: VERSAO_MODELO,
  } as const
  const t = desembrulhar(iniciarPerfil(ctx, corpo, { dispositivo, agora: agora as Instante, fusoMinutos }))
  return {
    ctx,
    estado: t.estado,
    eventos: [...t.eventos],
    agora: agora + 1000,
    passoDoRelogio: 1000,
    fusoMinutos,
    dispositivo,
  }
}

/**
 * Emite os corpos numa transição, no agora, no fuso e no aparelho da cena, e avança o relógio. Devolve os
 * eventos criados. Lança se o leitor recusar um corpo, porque a cena de um caso fixo é sempre válida.
 */
export function emitirNaCena(cena: Cena, corpo: CorpoDeEvento, ...resto: readonly CorpoDeEvento[]): readonly Evento[] {
  const origem = { dispositivo: cena.dispositivo, agora: cena.agora as Instante, fusoMinutos: cena.fusoMinutos }
  const t = desembrulhar(emitir(cena.ctx, cena.estado, [corpo, ...resto], origem))
  cena.estado = t.estado
  cena.eventos.push(...t.eventos)
  cena.agora += cena.passoDoRelogio
  return t.eventos
}

/** O único evento da emissão de um corpo. */
export function emitirUm(cena: Cena, corpo: CorpoDeEvento): Evento {
  const [evento] = emitirNaCena(cena, corpo)
  if (evento === undefined) throw new Error('a emissão de um corpo não criou evento')
  return evento
}

export function tarefaRegistrada(
  tipo: TarefaRegistrada['tipo'],
  alvos: TarefaRegistrada['alvos'],
  passos: readonly PassoRegistrado[] = [],
): TarefaRegistrada {
  const semId = { tipo, alvos, passos }
  return { id: idDeTarefa(semId), ...semId }
}

const ISOLADA: ContextoDeQuestao = { tipo: 'isolada' }

/** Questão de rótulo digitado, que exercita recordar. */
export function questaoDigitada(item: IdItem, contexto: ContextoDeQuestao = ISOLADA): Questao {
  return criarQuestao(item, { tipo: 'rotulo-digitado' }, contexto)
}

/** Questão de múltipla escolha do estímulo para o rótulo, que exercita reconhecer. */
export function questaoDeEscolha(
  item: IdItem,
  opcoes: readonly IdItem[],
  contexto: ContextoDeQuestao = ISOLADA,
): Questao {
  const formato: FormatoDeQuestao = {
    tipo: 'estimulo-para-rotulo',
    opcoes: [item, ...opcoes.filter((o) => o !== item)],
  }
  return criarQuestao(item, formato, contexto)
}

/** Passo de questão de uma tarefa de passos fixos. */
export const passoDe = (questao: Questao, uso: UsoDeQuestao): PassoRegistrado => ({ tipo: 'questao', questao, uso })

type Julgamento = Readonly<{ tarefaId: string; passo: number; uso: UsoDeQuestao; questao: Questao }>

/** O deltaBruto que `avaliarResposta` gravaria com os parâmetros padrão; o redutor lê o dos parâmetros vigentes. */
const deltaGravado = (qualidade: QualidadeDeResposta): number => PARAMETROS_PADRAO.deltaBruto[qualidade]

/** Resposta certa, com dois segundos de latência e a qualidade escolhida pelo caso. */
export function respostaCerta(j: Julgamento, qualidade: QualidadeDeAcerto = 'perfeita'): CorpoDeResposta {
  const { questao } = j
  const latencia = 2000 as Milis
  const resposta =
    questao.formato.tipo === 'rotulo-digitado'
      ? ({ tipo: 'texto', texto: questao.itemAlvo, latencia } as const)
      : ({ tipo: 'escolha', escolhidas: [questao.itemAlvo], latencia } as const)
  const direcao = direcaoDoFormato(questao.formato.tipo)
  return {
    tipo: 'resposta-registrada',
    ...j,
    resposta,
    avaliacao: { correta: true, qualidade, direcao, deltaBruto: deltaGravado(qualidade) },
  }
}

/**
 * Resposta errada. Com `confundidaCom`, a pessoa escolheu ou digitou aquele item; `nao-sei` e `tempo-esgotado` têm a
 * resposta do próprio tipo, sem latência.
 */
export function respostaErrada(
  j: Julgamento,
  qualidade: QualidadeDeErro = 'errada',
  confundidaCom?: IdItem,
): CorpoDeResposta {
  const { questao } = j
  const outro = confundidaCom ?? ('fora' as IdItem)
  const latencia = (qualidade === 'chute' ? 300 : 4000) as Milis
  const resposta =
    qualidade === 'nao-sei' || qualidade === 'tempo-esgotado'
      ? ({ tipo: qualidade } as const)
      : questao.formato.tipo === 'rotulo-digitado'
        ? ({ tipo: 'texto', texto: outro, latencia } as const)
        : ({ tipo: 'escolha', escolhidas: [outro], latencia } as const)
  const direcao = direcaoDoFormato(questao.formato.tipo)
  const avaliacao = {
    correta: false,
    qualidade,
    direcao,
    deltaBruto: deltaGravado(qualidade),
    ...(confundidaCom === undefined ? {} : { confundidaCom }),
  } as const
  return { tipo: 'resposta-registrada', ...j, resposta, avaliacao }
}

/**
 * A lição adaptativa de um item, inteira: a tarefa, a apresentação, um KP por resposta digitada, na ordem de `acertos`
 * (um erro seguido do acerto refaz o KP), e a lição concluída na mesma transição da última resposta. Devolve o id da
 * tarefa. Sem `concluir`, a lição fica aberta depois da última resposta.
 */
export function licaoDeItem(
  cena: Cena,
  item: IdItem,
  campos: Readonly<{ acertos?: readonly boolean[]; concluir?: boolean }> = {},
): string {
  const acertos = campos.acertos ?? [true, true, true]
  const topico = topicoDeItem(item).id
  const tarefa = tarefaRegistrada('licao', [topico])
  emitirNaCena(
    cena,
    { tipo: 'tarefa-iniciada', tarefa },
    { tipo: 'apresentacao-vista', tarefaId: tarefa.id, itens: [item] },
  )
  let kp: 1 | 2 | 3 = 1
  const questao = questaoDigitada(item)
  acertos.forEach((certo, passo) => {
    const j = { tarefaId: tarefa.id, passo, uso: { tipo: 'licao', kp } as const, questao }
    const corpo = certo ? respostaCerta(j) : respostaErrada(j)
    const ultima = passo === acertos.length - 1 && campos.concluir !== false
    if (ultima) emitirNaCena(cena, corpo, { tipo: 'licao-concluida', tarefaId: tarefa.id, topico, acelerada: false })
    else emitirNaCena(cena, corpo)
    if (certo && kp < 3) kp = (kp + 1) as 2 | 3
  })
  return tarefa.id
}

/** Abre uma sessão de quinze minutos com as novas previstas dadas. */
export function abrirSessaoNaCena(cena: Cena, novasPrevistas: readonly IdItem[] = []): Evento {
  return emitirUm(cena, { tipo: 'sessao-iniciada', orcamentoMin: 15 as Minutos, novasPrevistas })
}

/**
 * Os ajustes dos casos fixos. Vários padrões coincidem (há muitos 0,5 e 1), e um caso rodado com os padrões passaria com
 * a fórmula lendo um parâmetro no lugar de outro de mesmo valor; cada valor daqui difere do padrão do próprio parâmetro
 * e de todo outro número de `PARAMETROS_DOS_CASOS`, e o teste ao lado reprova o ajuste que coincidir. A janela de chute
 * fica em 7, e não em 3, porque 3 é o padrão de `chutesNasUltimasSistematico`, que a conta do chute lê junto com ela, e
 * `RELACOES` pede a janela de pelo menos esse tamanho.
 */
export const AJUSTES_DOS_CASOS = {
  fatorMultiplaEscolha: 0.4,
  fatorExposicaoDistrator: 0.7,
  intervaloBaseDias: 1.15,
  minutosLicao: 1.7,
  multiplicadorXpChute: -0.6,
  janelaChuteSistematico: 7,
} as const satisfies AjustesDeParametros

/** `AJUSTES_DOS_CASOS` com os ajustes a mais que o caso pede. */
export function parametrosDosCasos(ajustes: AjustesDeParametros = {}): Parametros {
  return desembrulhar(resolverParametros({ ...AJUSTES_DOS_CASOS, ...ajustes }))
}

export const PARAMETROS_DOS_CASOS: Parametros = parametrosDosCasos()

/** O contexto dos casos fixos: o catálogo fixo, todas as técnicas e `PARAMETROS_DOS_CASOS`, a menos do que se pedir. */
export function contextoDosCasos(
  campos: Readonly<{ catalogo?: Catalogo; tecnicas?: Tecnicas; parametros?: Parametros }> = {},
): ContextoDeReducao {
  return desembrulhar(
    criarContextoDeReducao({
      catalogo: campos.catalogo ?? catalogoFixo(),
      tecnicas: campos.tecnicas ?? TECNICAS_TODAS_LIGADAS,
      parametros: campos.parametros ?? PARAMETROS_DOS_CASOS,
    }),
  )
}
