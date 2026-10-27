import type { Instante } from '../base/tempo'
import { aplicarTarefaDeGrupo } from '../fire'
import { preRequisitos, topicoDeGrupo, topicoDeItem } from '../grafo'
import { diaLocal, somarXpDoDia, xpDaTarefa, type DiaLocal } from '../gamificacao'
import { direcaoDoFormato } from '../questoes'
import type { EventoDoTipo, Evento } from '../eventos'
import type { ContextoDeReducao } from './contexto'
import { contextoDePropagacao, devolver, memoriaInicial, submapa } from './memoria-do-rascunho'
import { concluidos, escrever, type Absorver, type Rascunho } from './rascunho'
import type { RespostaLigada, TarefaAberta } from './tipos'
import { xpDeTarefaNaoConcluida } from './xp'

// A tarefa em curso: a resposta se liga a um passo dela, e ela fecha por contagem, pelo evento de lição ou pela
// interrupção. O fechamento é onde a tarefa de grupo muda a memória e onde o XP entra no dia, uma vez por tarefa.

/** Há passo de questão ainda sem resposta? A tarefa adaptativa, sem passos, nunca fecha por contagem. */
function faltaResposta(aberta: TarefaAberta): boolean {
  const questoes = aberta.tarefa.passos.filter((p) => p.tipo === 'questao').length
  return questoes === 0 || aberta.respostas.size < questoes
}

/**
 * Liga a resposta ao passo da tarefa aberta e devolve se ligou. Liga quando o `tarefaId` é o da aberta e o passo ainda
 * não tem resposta: na tarefa adaptativa, o passo é o ordinal da resposta; na de passos fixos, é um passo de questão com
 * a mesma questão. Fora disso a resposta é avulsa, e quem chama conta o motivo.
 */
export function ligarResposta(
  r: Rascunho,
  e: EventoDoTipo<'resposta-registrada'>,
  avaliacao: RespostaLigada['avaliacao'],
): boolean {
  const aberta = r.tarefa
  if (aberta === undefined || aberta.tarefa.id !== e.tarefaId || aberta.respostas.has(e.passo)) return false
  const { passos } = aberta.tarefa
  if (passos.length === 0) {
    if (e.passo !== aberta.respostas.size) return false
  } else {
    const passo = passos[e.passo]
    if (passo?.tipo !== 'questao' || passo.questao.id !== e.questao.id) return false
  }
  const ligada: RespostaLigada = { em: e.em, uso: e.uso, questao: e.questao, avaliacao }
  r.tarefa = { ...aberta, respostas: new Map(aberta.respostas).set(e.passo, ligada) }
  return true
}

/** Abre a tarefa, com as normas e as qualidades de antes dela. Tarefa de passos fixos sem questão já nasce concluída. */
export function abrirTarefa(r: Rascunho, e: EventoDoTipo<'tarefa-iniciada'>): void {
  const { passos } = e.tarefa
  if (passos.length > 0 && passos.every((p) => p.tipo !== 'questao')) return
  r.tarefa = {
    tarefa: e.tarefa,
    iniciadaEm: e.em,
    respostas: new Map(),
    normasAntes: r.normas,
    qualidadesAntes: r.ultimasQualidades,
  }
}

/** Fecha a tarefa de passos fixos que acabou de receber a resposta ao último passo de questão. */
export function fecharSeCompleta(ctx: ContextoDeReducao, r: Rascunho, e: Evento, absorver: Absorver): void {
  const aberta = r.tarefa
  if (aberta === undefined || aberta.tarefa.passos.length === 0 || faltaResposta(aberta)) return
  fecharTarefa(ctx, r, e, { concluida: true, acelerada: false }, absorver)
}

/** Interrompe a tarefa aberta, se houver: fecha sem concluir, no evento que a interrompe. */
export function interromperTarefa(ctx: ContextoDeReducao, r: Rascunho, e: Evento, absorver: Absorver): void {
  if (r.tarefa !== undefined) fecharTarefa(ctx, r, e, { concluida: false, acelerada: false }, absorver)
}

/**
 * Fecha a tarefa aberta no evento `e`: aplica a tarefa de grupo, se houve resposta de grupo ligada, e soma o XP no dia
 * local de `e`, no fuso gravado nele. A tarefa concluída rende o XP das respostas consideradas; a que não se conclui,
 * pela lição adiada ou pela interrupção, rende só a penalidade (`xpDeTarefaNaoConcluida`).
 *
 * As respostas consideradas no XP são as ligadas; na lição adaptativa concluída, só as de uso `licao` na normal e só as
 * de sondagem na acelerada, para a sondagem fracassada antes de uma lição limpa não tirar XP dela.
 */
export function fecharTarefa(
  ctx: ContextoDeReducao,
  r: Rascunho,
  e: Evento,
  fim: Readonly<{ concluida: boolean; acelerada: boolean }>,
  absorver: Absorver,
): void {
  const aberta = r.tarefa
  if (aberta === undefined) return
  r.tarefa = undefined
  const ligadas = [...aberta.respostas.values()]

  const deGrupo = ligadas.filter((l) => l.uso.tipo === 'grupo')
  const ultima = deGrupo.at(-1)
  if (ultima !== undefined) aplicarGrupo(ctx, r, deGrupo, fim.concluida ? e.em : ultima.em, absorver)

  const adaptativa = aberta.tarefa.passos.length === 0
  const usoConsiderado = fim.acelerada ? 'sondagem' : 'licao'
  const consideradas = adaptativa && fim.concluida ? ligadas.filter((l) => l.uso.tipo === usoConsiderado) : ligadas
  const xp = xpDaTarefa(
    { tipo: aberta.tarefa.tipo, acelerada: fim.acelerada, questoes: consideradas.map((l) => l.questao) },
    consideradas.map((l) => l.avaliacao),
    aberta.qualidadesAntes,
    aberta.normasAntes,
    ctx.parametros,
    ctx.tecnicas,
  )
  const valor = fim.concluida ? xp : xpDeTarefaNaoConcluida(xp)
  if (valor !== 0) somarXp(r, diaLocal(e.em, e.fusoMinutos, ctx.parametros), valor)
}

/**
 * Soma ao dia, pela regra do piso de `somarXpDoDia`. A função recebe só a entrada do dia e não o mapa inteiro, que ela
 * copiaria a cada tarefa; a regra continua num lugar só.
 */
function somarXp(r: Rascunho, dia: DiaLocal, xp: number): void {
  const doDia = somarXpDoDia(new Map([[dia, r.xpPorDia.atual.get(dia) ?? 0]]), dia, xp).get(dia) ?? 0
  escrever(r.xpPorDia).set(dia, doDia)
}

/**
 * A tarefa de grupo de uma vez, por `aplicarTarefaDeGrupo`, para F receber uma atualização só e o resultado não depender
 * da ordem das respostas. F é o grupo do contexto da primeira resposta de grupo. Entram as respostas sobre membros de F
 * com lição concluída, a mesma regra da resposta isolada; os exibidos são os do contexto, e os elegíveis, os tópicos de
 * lição concluída. Sem resposta que entre, ou com a função recusando a tarefa, a memória fica como estava.
 *
 * A função recebe o submapa de F e dos alvos. O estado de F, se falta, nasce nele, e só entra no rascunho se a função
 * aceitar a tarefa.
 */
function aplicarGrupo(
  ctx: ContextoDeReducao,
  r: Rascunho,
  ligadas: readonly RespostaLigada[],
  agora: Instante,
  absorver: Absorver,
): void {
  const contexto = ligadas.find((l) => l.questao.contexto.tipo === 'grupo')?.questao.contexto
  if (contexto?.tipo !== 'grupo') {
    absorver('tarefa-de-grupo-sem-alvo-valido')
    return
  }
  const grupo = topicoDeGrupo(contexto.grupo).id
  if (!ctx.grafo.topicos.has(grupo)) {
    absorver('topico-fora-do-grafo')
    return
  }
  const membros = new Set(preRequisitos(ctx.grafo, grupo))
  const feitos = concluidos(r)
  const memorias = r.memorias.atual
  const validas = ligadas.filter(
    ({ questao }) =>
      questao.contexto.tipo === 'grupo' &&
      questao.contexto.grupo === contexto.grupo &&
      membros.has(questao.alvo) &&
      feitos.has(questao.alvo) &&
      memorias.has(questao.alvo),
  )
  if (validas.length === 0) {
    absorver('tarefa-de-grupo-sem-alvo-valido')
    return
  }
  const sub = submapa(ctx, memorias, [grupo, ...validas.map(({ questao }) => questao.alvo)])
  if (!sub.has(grupo)) sub.set(grupo, memoriaInicial(ctx, grupo, memorias))
  const feita = aplicarTarefaDeGrupo(contextoDePropagacao(ctx, agora), sub, {
    grupo,
    respostas: validas.map(({ questao, avaliacao }) => ({
      alvo: questao.alvo,
      direcao: direcaoDoFormato(questao.formato.tipo),
      deltaBruto: ctx.parametros.deltaBruto[avaliacao.qualidade],
    })),
    exibidos: new Set(contexto.exibidos.map((i) => topicoDeItem(i).id)),
    elegiveis: feitos,
  })
  if (!feita.ok) {
    absorver('tarefa-de-grupo-recusada')
    return
  }
  devolver(r.memorias, feita.valor.memorias)
}
