import { FORMATOS_DE_QUESTAO } from '../questoes'
import { lerTopico } from '../grafo'
import { fase } from '../memoria'
import type { ContextoDeReducao } from './contexto'
import type { EstadoMotor, TarefaAberta } from './tipos'

const finitoPositivo = (x: number): boolean => Number.isFinite(x) && x > 0

/** Os problemas das respostas da tarefa aberta: passo que não existe e tarefa de passos fixos já toda respondida. */
function problemasDaTarefa(aberta: TarefaAberta): string[] {
  const { passos, id } = aberta.tarefa
  const achados: string[] = []
  for (const passo of aberta.respostas.keys()) {
    const existe =
      passos.length === 0
        ? Number.isInteger(passo) && passo >= 0 && passo < aberta.respostas.size
        : passos[passo]?.tipo === 'questao'
    if (!existe) achados.push(`tarefa '${id}' com resposta no passo ${String(passo)}, que não é passo de questão`)
  }
  const questoes = passos.filter((p) => p.tipo === 'questao').length
  if (passos.length > 0 && aberta.respostas.size >= questoes) {
    achados.push(`tarefa '${id}' de passos fixos aberta com todos os passos de questão respondidos`)
  }
  return achados
}

/**
 * O que precisa valer em todo estado que a redução produz, como lista de problemas, vazia quando tudo vale. O redutor é
 * total e não falha; estas são a prova de que a absorção funcionou, e as propriedades as conferem depois de cada
 * reconstrução. O redutor não as chama.
 *
 * - Toda chave de `memorias` e de `licoes` é tópico do grafo.
 * - Todo tópico de lição concluída tem memória, e o de item já tem repetição: a lição concluída repete o tópico.
 * - A contagem remediada de cada par é de um par com confusão, e não passa da contagem dele.
 * - O XP de cada dia é finito e não negativo; as metas, finitas e positivas.
 * - Há ao menos um evento, e o último instante não vem antes do início da época; a sessão aberta começou entre os dois.
 * - A tarefa aberta só tem resposta em passo de questão que existe, uma por passo (o mapa por passo garante), e, se é de
 *   passos fixos, ainda tem passo de questão sem resposta, senão já teria fechado.
 * - A janela de qualidades e as normas de cada formato não passam do tamanho da janela delas.
 */
export function conferirInvariantes(ctx: ContextoDeReducao, estado: EstadoMotor): readonly string[] {
  const { grafo, parametros } = ctx
  const achados: string[] = []
  for (const t of [...estado.memorias.keys(), ...estado.licoes.keys()]) {
    if (!grafo.topicos.has(t)) achados.push(`tópico fora do grafo no estado: '${t}'`)
  }
  for (const [t, s] of estado.licoes) {
    if (s.status !== 'concluida') continue
    const e = estado.memorias.get(t)
    if (e === undefined) achados.push(`lição concluída sem memória: '${t}'`)
    else if (lerTopico(t).tipo === 'item' && fase(e, parametros) === 'nao-iniciado') {
      achados.push(`lição de item concluída sem repetição: '${t}'`)
    }
  }
  for (const [par, n] of estado.confusoesRemediadas) {
    const confusoes = estado.confusoes.get(par)
    if (confusoes === undefined || n > confusoes) achados.push(`par remediado além das confusões: '${par}'`)
  }
  for (const [dia, xp] of estado.xpPorDia) {
    if (!Number.isFinite(xp) || xp < 0) achados.push(`XP inválido no dia ${dia}: ${String(xp)}`)
  }
  for (const [dia, meta] of estado.metaPorDia) {
    if (!finitoPositivo(meta)) achados.push(`meta inválida no dia ${dia}: ${String(meta)}`)
  }
  if (!finitoPositivo(estado.metaDiariaXp)) achados.push(`meta vigente inválida: ${String(estado.metaDiariaXp)}`)
  if (estado.nEventos < 1) achados.push(`nEventos abaixo de 1: ${String(estado.nEventos)}`)
  if (estado.ultimoEm < estado.inicioDaEpoca) achados.push('último instante antes do início da época')
  const { sessao, tarefa } = estado
  if (sessao !== undefined && (sessao.iniciadaEm < estado.inicioDaEpoca || sessao.iniciadaEm > estado.ultimoEm)) {
    achados.push('sessão iniciada fora da época')
  }
  if (tarefa !== undefined) achados.push(...problemasDaTarefa(tarefa))
  if (estado.ultimasQualidades.length > parametros.janelaChuteSistematico) {
    achados.push(`janela de qualidades com ${String(estado.ultimasQualidades.length)} respostas`)
  }
  for (const formato of FORMATOS_DE_QUESTAO) {
    if (estado.normas[formato].length > parametros.janelaNormasDeLatencia) {
      achados.push(`normas de '${formato}' com ${String(estado.normas[formato].length)} amostras`)
    }
  }
  return achados
}
