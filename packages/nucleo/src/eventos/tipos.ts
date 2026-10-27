import type { NaoVazio } from '../base/nao-vazio'
import type { Instante, Minutos } from '../base/tempo'
import type { IdItem } from '../catalogo/tipos'
import type { IdTopico } from '../grafo/topico'
import type { Avaliacao, Resposta, RespostaDeAssociacao } from '../avaliacao'
import type { Questao, TipoDeTarefa, UsoDeQuestao } from '../questoes'

// O log de eventos é o contrato persistido do núcleo: fica no aparelho e no servidor, e o estado do motor é refeito dele
// a cada abertura. Por isso a união abaixo evolui só por adição:
//
// - tipo novo e campo opcional novo são permitidos;
// - renomear, remover, tornar obrigatório ou mudar o sentido de um campo existente é proibido, e um sentido novo ganha
//   um tipo novo.
//
// Um log gravado por uma versão anterior continua lendo igual, e um aparelho com o app antigo reconhece o evento de tipo
// novo como vindo de uma versão mais nova, em vez de chamá-lo de corrompido. `eventos/log-de-referencia.json` trava o
// formato: ele não se edita, e um tipo novo entra num segundo log de referência.
//
// O estado do motor, ao contrário, não é contrato: nunca é gravado, e estendê-lo é refatoração, desde que cada campo novo
// derive de eventos já definidos.

/** Como uma sessão termina: o orçamento acabou, a pessoa saiu, não havia tarefa, ou a casca a fechou para sincronizar. */
export const MOTIVOS_DE_FIM_DE_SESSAO = ['orcamento', 'usuario', 'sem-tarefas', 'sincronizacao'] as const
export type MotivoDeFimDeSessao = (typeof MOTIVOS_DE_FIM_DE_SESSAO)[number]

/** Como o diagnóstico termina. Pular depois de começar é encerrar com `abandonado`. */
export const MOTIVOS_DE_FIM_DO_DIAGNOSTICO = ['concluido', 'abandonado'] as const
export type MotivoDeFimDoDiagnostico = (typeof MOTIVOS_DE_FIM_DO_DIAGNOSTICO)[number]

/**
 * Por que uma remediação foi aberta: a lição reprovada, a falha numa tarefa de grupo, o erro num quiz, ou a confusão
 * repetida de um par fora da lição.
 */
export const MOTIVOS_DE_REMEDIACAO = ['licao', 'grupo', 'quiz', 'confusao'] as const
export type MotivoDeRemediacao = (typeof MOTIVOS_DE_REMEDIACAO)[number]

/** Um passo de uma tarefa registrada: os itens mostrados lado a lado, ou uma questão já gerada com o uso dela. */
export type PassoRegistrado =
  | Readonly<{ tipo: 'apresentacao'; itens: NaoVazio<IdItem> }>
  | Readonly<{ tipo: 'questao'; questao: Questao; uso: UsoDeQuestao }>

/**
 * A tarefa como o planejador a montou, gravada no início dela. Com os passos no log, recarregar no meio de um quiz ou de
 * uma tarefa de grupo devolve as mesmas questões, e o redutor sabe quando a tarefa acabou. `passos` vazio marca a tarefa
 * adaptativa, a lição de item, cujas questões dependem das respostas e vêm uma a uma. `motivo` só existe na remediação.
 *
 * O `id` sai do conteúdo, por `idDeTarefa`, e é o `tarefaId` que os eventos seguintes da tarefa levam.
 */
export type TarefaRegistrada = Readonly<{
  id: string
  tipo: TipoDeTarefa
  alvos: readonly IdTopico[]
  motivo?: MotivoDeRemediacao
  passos: readonly PassoRegistrado[]
}>

/** O que o perfil fixa para a época que ele abre: a semente de todo sorteio, o catálogo e a versão da união de eventos. */
type DadosDoPerfil = Readonly<{ semente: string; catalogoHash: string; versaoModelo: number }>

/**
 * A resposta a uma questão, com a questão inteira, para a redução não depender de a tarefa ser gerada de novo. `passo` é
 * o índice do passo na tarefa de passos fixos, e o ordinal da resposta na tarefa adaptativa: questões iguais da mesma
 * tarefa têm o mesmo id, e só a posição as distingue.
 *
 * Grava-se o fato: a resposta crua e, nas que se avaliam, a avaliação do momento. A associação do diagnóstico não tem
 * avaliação (ver `RespostaDeAssociacao`), e a união amarra isso no tipo.
 */
export type CorpoDeResposta = Readonly<{
  tipo: 'resposta-registrada'
  tarefaId: string
  passo: number
  uso: UsoDeQuestao
  questao: Questao
}> &
  (
    | Readonly<{
        resposta: Exclude<Resposta, Readonly<{ tipo: 'continuar' }> | RespostaDeAssociacao>
        avaliacao: Avaliacao
      }>
    | Readonly<{ resposta: RespostaDeAssociacao; avaliacao?: never }>
  )

/** O conteúdo de cada tipo de evento, sem o envelope. */
export type CorpoDeEvento =
  | (Readonly<{ tipo: 'perfil-criado' }> & DadosDoPerfil)
  | (Readonly<{ tipo: 'perfil-reiniciado' }> & DadosDoPerfil)
  | Readonly<{ tipo: 'sessao-iniciada'; orcamentoMin: Minutos; novasPrevistas: readonly IdItem[] }>
  | Readonly<{ tipo: 'sessao-encerrada'; motivo: MotivoDeFimDeSessao }>
  | Readonly<{ tipo: 'diagnostico-iniciado' }>
  | Readonly<{ tipo: 'diagnostico-pulado' }>
  | Readonly<{ tipo: 'diagnostico-encerrado'; motivo: MotivoDeFimDoDiagnostico }>
  | Readonly<{ tipo: 'tarefa-iniciada'; tarefa: TarefaRegistrada }>
  | Readonly<{ tipo: 'apresentacao-vista'; tarefaId: string; itens: NaoVazio<IdItem> }>
  | CorpoDeResposta
  | Readonly<{ tipo: 'licao-adiada'; tarefaId: string; topico: IdTopico; kp: 1 | 2 | 3 }>
  | Readonly<{ tipo: 'licao-concluida'; tarefaId: string; topico: IdTopico; acelerada: boolean }>
  | Readonly<{ tipo: 'remediacao-concluida'; tarefaId: string; motivo: MotivoDeRemediacao; alvos: NaoVazio<IdTopico> }>
  | Readonly<{ tipo: 'meta-diaria-alterada'; xp: number }>

export type TipoDeEvento = CorpoDeEvento['tipo']

/**
 * Os tipos de evento, na ordem em que a união os declara. O teste confere, com um registro escrito à mão sobre
 * `TipoDeEvento`, que a lista e a união têm os mesmos tipos.
 */
export const TIPOS_DE_EVENTO = [
  'perfil-criado',
  'perfil-reiniciado',
  'sessao-iniciada',
  'sessao-encerrada',
  'diagnostico-iniciado',
  'diagnostico-pulado',
  'diagnostico-encerrado',
  'tarefa-iniciada',
  'apresentacao-vista',
  'resposta-registrada',
  'licao-adiada',
  'licao-concluida',
  'remediacao-concluida',
  'meta-diaria-alterada',
] as const satisfies readonly TipoDeEvento[]

export type CorpoDoTipo<T extends TipoDeEvento> = Extract<CorpoDeEvento, Readonly<{ tipo: T }>>

/**
 * O que a origem do evento carimba nele: o instante, em milissegundos inteiros; o aparelho; e o fuso, em minutos na
 * convenção de `getTimezoneOffset` (positivo a oeste de Greenwich), para todo dia local do evento sair do fuso de quem o
 * gravou, e não do de quem reconstrói.
 */
export type CabecalhoDeEvento = Readonly<{ em: Instante; dispositivo: string; fusoMinutos: number }>

/** O evento antes do id: é sobre ele que `idDeEvento` calcula o hash. */
export type EventoSemId = CabecalhoDeEvento & CorpoDeEvento

/** Um evento do log: o id, o cabeçalho e o corpo de um dos tipos. */
export type Evento = Readonly<{ id: string }> & EventoSemId

export type EventoDoTipo<T extends TipoDeEvento> = Extract<Evento, Readonly<{ tipo: T }>>
