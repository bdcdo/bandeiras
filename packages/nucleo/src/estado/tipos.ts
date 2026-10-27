import type { Instante, Minutos } from '../base/tempo'
import type { IdTopico } from '../grafo/topico'
import type { EstadoMemoria, QualidadeDeResposta } from '../memoria'
import type { ContextoDeSessao, Questao, UsoDeQuestao } from '../questoes'
import type { Avaliacao, NormasDeLatencia } from '../avaliacao'
import type { DiaLocal, XpPorDia } from '../gamificacao'
import type { Evento, TarefaRegistrada } from '../eventos'

// O estado do motor é função do log e do contexto, e nunca é gravado: a casca o refaz a cada abertura por `reconstruir`.
// Por isso ele não é contrato, e estender um campo é refatoração, desde que o campo novo derive de eventos já definidos.
// Os parâmetros, o catálogo, o grafo e as técnicas não moram aqui: vêm do `ContextoDeReducao`, e um estado com cópia
// deles seria uma segunda fonte que pode discordar do contexto.

/**
 * Situação da lição de um tópico. O mapa `licoes` do estado só guarda as que não são pendentes; `statusDaLicao` lê a
 * ausência como pendente. `adiada` guarda quando a lição volta a ser oferecida, quantas vezes foi adiada e em que
 * knowledge point a última falhou; `concluida`, quando, se pela sondagem e se pelo diagnóstico.
 */
export type StatusLicao =
  | Readonly<{ status: 'pendente' }>
  | Readonly<{ status: 'adiada'; liberadoEm: Instante; tentativas: number; kpDaFalha: 1 | 2 | 3 }>
  | Readonly<{ status: 'concluida'; em: Instante; acelerada: boolean; viaDiagnostico: boolean }>

/**
 * Onde o diagnóstico está. Sai de `nao-iniciado` por `diagnostico-iniciado` (para `em-curso`) ou por
 * `diagnostico-pulado` (para `pulado`), e de `em-curso` por `diagnostico-encerrado`. Pular depois de começar é encerrar
 * com o motivo `abandonado`, e por isso `pulado` só sai de `nao-iniciado`.
 */
export const ESTADOS_DO_DIAGNOSTICO = ['nao-iniciado', 'em-curso', 'pulado', 'encerrado'] as const
export type EstadoDoDiagnostico = (typeof ESTADOS_DO_DIAGNOSTICO)[number]

/** A sessão aberta. Há uma só por perfil, venham os eventos de qual aparelho vierem. */
export type SessaoAberta = Readonly<{ iniciadaEm: Instante; orcamentoMin: Minutos; contexto: ContextoDeSessao }>

/** Uma resposta ligada a um passo da tarefa aberta, com o que o fechamento da tarefa lê dela. */
export type RespostaLigada = Readonly<{ em: Instante; uso: UsoDeQuestao; questao: Questao; avaliacao: Avaliacao }>

/**
 * A tarefa aberta: a registrada no `tarefa-iniciada`, as respostas ligadas por passo, e as normas e as qualidades de
 * antes dela. O XP do fechamento lê as de antes, porque a janela do chute sistemático se mede sobre as respostas
 * anteriores à tarefa seguidas das dela, e a janela corrente, numa tarefa de várias questões, já traz as da tarefa.
 */
export type TarefaAberta = Readonly<{
  tarefa: TarefaRegistrada
  iniciadaEm: Instante
  respostas: ReadonlyMap<number, RespostaLigada>
  normasAntes: NormasDeLatencia
  qualidadesAntes: readonly QualidadeDeResposta[]
}>

/**
 * O estado do motor depois de reduzir a época do log.
 *
 * - `semente`, `catalogoHash` e `versaoModelo` vêm do perfil que abriu a época; `inicioDaEpoca` é o instante dele.
 * - `nEventos` conta os eventos únicos da época, o perfil inclusive; `ultimoEventoId` é o do último reduzido, e
 *   `ultimoEm` o maior instante reduzido. Os três entram no sorteio (`sorteioDoEstado`).
 * - `confusoes` conta, por par de itens (`chaveDePar`), as respostas que confundiram um com o outro, e
 *   `confusoesRemediadas` guarda a contagem do par na última remediação dele.
 * - `ultimasQualidades` são as qualidades das respostas mais recentes fora do diagnóstico, até a janela do chute
 *   sistemático.
 * - `xpPorDia` e `metaPorDia` são por dia local, no fuso do evento que os gravou; `metaDiariaXp` é a meta vigente.
 */
export type EstadoMotor = Readonly<{
  versaoModelo: number
  catalogoHash: string
  semente: string
  inicioDaEpoca: Instante
  ultimoEm: Instante
  nEventos: number
  ultimoEventoId: string
  diagnostico: EstadoDoDiagnostico
  memorias: ReadonlyMap<IdTopico, EstadoMemoria>
  licoes: ReadonlyMap<IdTopico, StatusLicao>
  sessao?: SessaoAberta
  sessoesIniciadas: number
  tarefa?: TarefaAberta
  normas: NormasDeLatencia
  ultimasQualidades: readonly QualidadeDeResposta[]
  confusoes: ReadonlyMap<string, number>
  confusoesRemediadas: ReadonlyMap<string, number>
  xpPorDia: XpPorDia
  metaPorDia: ReadonlyMap<DiaLocal, number>
  metaDiariaXp: number
}>

/** O estado depois de uma ação do motor e os eventos que ela gerou, na ordem em que foram reduzidos. */
export type Transicao = Readonly<{ estado: EstadoMotor; eventos: readonly Evento[] }>

/**
 * Por que o redutor deixou de lado, inteiro ou em parte, um evento válido que não combina com o estado. O redutor é
 * total: aplica o que tem sentido isolado, absorve o resto sem erro e conta o motivo no relato da reconstrução. Assim um
 * defeito do motor que gere sequência incoerente aparece no relato, em vez de sumir na absorção.
 *
 * - `perfil-criado-na-epoca`: perfil criado depois do que abriu a época, como o de um segundo aparelho unido; só conta.
 * - `sessao-sobre-sessao-aberta`: sessão iniciada com outra aberta, que ela substitui.
 * - `sessao-encerrada-sem-sessao`: encerramento sem sessão aberta; só conta, mas interrompe a tarefa aberta.
 * - `diagnostico-fora-de-ordem`: evento do diagnóstico fora das transições de `EstadoDoDiagnostico`; só conta.
 * - `tarefa-sobre-tarefa-aberta`: tarefa iniciada com outra aberta, que ela interrompe.
 * - `item-fora-do-catalogo` e `topico-fora-do-grafo`: referência que o catálogo do contexto não tem, porque ele mudou
 *   depois do log, ou porque a técnica `grupos` está desligada. A parte do evento que a cita não tem efeito.
 * - `fora-da-sessao`: apresentação, resposta ou lição concluída sem sessão aberta; tem efeito, mas não toca o contexto
 *   de sessão.
 * - `resposta-avulsa`: resposta que não liga a um passo da tarefa aberta. Mede e tem o efeito isolado do uso, mas não
 *   rende XP, não fecha tarefa e, no uso `grupo`, não muda a memória.
 * - `tarefa-de-grupo-sem-alvo-valido` e `tarefa-de-grupo-recusada`: o fechamento de uma tarefa de grupo sem resposta
 *   sobre membro de lição concluída, ou que `aplicarTarefaDeGrupo` recusou; a memória da tarefa não muda.
 * - `licao-ja-concluida`: lição concluída ou adiada de um tópico já concluído; só conta, sem segunda repetição.
 * - `licao-de-outra-tarefa`: lição concluída ou adiada com `tarefaId` que não é o da tarefa aberta; tem efeito, mas não
 *   fecha a aberta.
 * - `remediacao-sem-par-confundido`: remediação concluída sem par de alvos com confusão; só conta. Acontece também no
 *   fluxo normal, na remediação de um alvo só.
 */
export const MOTIVOS_DE_ABSORCAO = [
  'perfil-criado-na-epoca',
  'sessao-sobre-sessao-aberta',
  'sessao-encerrada-sem-sessao',
  'diagnostico-fora-de-ordem',
  'tarefa-sobre-tarefa-aberta',
  'item-fora-do-catalogo',
  'topico-fora-do-grafo',
  'fora-da-sessao',
  'resposta-avulsa',
  'tarefa-de-grupo-sem-alvo-valido',
  'tarefa-de-grupo-recusada',
  'licao-ja-concluida',
  'licao-de-outra-tarefa',
  'remediacao-sem-par-confundido',
] as const
export type MotivoDeAbsorcao = (typeof MOTIVOS_DE_ABSORCAO)[number]

/**
 * O que a reconstrução deixou de fora ou estranhou, para o motor decidir se mostra. `duplicados` conta as cópias de
 * mesmo conteúdo de um id já lido; `divergentes`, os ids com mais de um conteúdo; `anterioresAEpoca`, os eventos antes
 * do perfil que abre a época, ignorados; `catalogoTrocado`, se o catálogo do perfil não é o do contexto; `absorvidos`,
 * só os motivos que aconteceram, com a contagem de cada um.
 */
export type RelatoDeReconstrucao = Readonly<{
  duplicados: number
  divergentes: number
  anterioresAEpoca: number
  catalogoTrocado: boolean
  absorvidos: Readonly<Partial<Record<MotivoDeAbsorcao, number>>>
}>

export type Reconstrucao = Readonly<{ estado: EstadoMotor; relato: RelatoDeReconstrucao }>

/**
 * Por que o log não reconstrói. `ocorrencias` lista todas as da primeira regra violada, na ordem: envelope malformado
 * (`EVENTO_MALFORMADO`), nenhum perfil (`SEM_PERFIL`), versão futura do modelo ou tipo desconhecido na época
 * (`VERSAO_DE_MODELO_FUTURA`), corpo malformado na época (`EVENTO_MALFORMADO`). O índice é a posição na lista recebida.
 */
export type ErroDeReconstrucao = Readonly<{
  codigo: 'EVENTO_MALFORMADO' | 'SEM_PERFIL' | 'VERSAO_DE_MODELO_FUTURA'
  detalhe: string
  ocorrencias: readonly Readonly<{ indice: number; id?: string; motivo: string }>[]
}>
