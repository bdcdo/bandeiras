import { somarDias, type Dias, type Instante } from '../base/tempo'
import type { IdItem } from '../catalogo/tipos'
import { aplicarRespostaIsolada } from '../fire'
import { lerTopico, topicoDeItem, type IdTopico } from '../grafo'
import { reagendar } from '../memoria'
import {
  contextoDeSessao,
  direcaoDoFormato,
  registrarApresentacao,
  registrarLicaoConcluida,
  registrarQuestao,
} from '../questoes'
import { registrarLatencia } from '../avaliacao'
import { diaLocal } from '../gamificacao'
import type { Evento, EventoDoTipo } from '../eventos'
import { chaveDePar, confusaoQueConta } from './confusoes'
import type { ContextoDeReducao } from './contexto'
import { contextoDePropagacao, garantirMemoria, medir, repetirLicao, trocarMemorias } from './memoria-do-rascunho'
import { concluidos, escrever, rascunhoDoPerfil, type Absorver, type Rascunho } from './rascunho'
import { abrirTarefa, fecharSeCompleta, fecharTarefa, interromperTarefa, ligarResposta } from './tarefa'

// A redução de um evento no rascunho, o único caminho por que o estado muda. `reduzir` e `reconstruir` chamam esta
// função, e só ela, e por isso o estado vivo e o reconstruído são iguais por construção.
//
// O redutor é total: todo evento que o leitor aceita se reduz. O que não combina com o estado, como uma sessão encerrada
// sem sessão aberta, vindo da união de dois aparelhos, aplica a parte que tem sentido isolado e absorve o resto, com o
// motivo contado (`MOTIVOS_DE_ABSORCAO`). O redutor nunca fabrica evento nem chama o gerador de questões, a avaliação ou
// o planejador: toda escolha de que uma redução futura dependa já está gravada no evento.

const UM_DIA = 1 as Dias

const noGrafo = (ctx: ContextoDeReducao, t: IdTopico): boolean => ctx.grafo.topicos.has(t)

/**
 * Aplica o evento ao rascunho. O perfil reiniciado troca o rascunho inteiro pelo do perfil, porque nada atravessa um
 * reinício; todo outro evento conta (`nEventos`, `ultimoEventoId` e `ultimoEm`) antes do efeito. `ultimoEm` é o maior
 * instante reduzido, e o evento com instante anterior se reduz com o próprio instante.
 */
export function aplicarNoRascunho(ctx: ContextoDeReducao, r: Rascunho, e: Evento, absorver: Absorver): void {
  if (e.tipo === 'perfil-reiniciado') {
    Object.assign(r, rascunhoDoPerfil(ctx, e))
    return
  }
  r.nEventos += 1
  r.ultimoEventoId = e.id
  r.ultimoEm = Math.max(r.ultimoEm, e.em) as Instante
  switch (e.tipo) {
    case 'perfil-criado':
      absorver('perfil-criado-na-epoca')
      return
    case 'sessao-iniciada':
      iniciarSessao(ctx, r, e, absorver)
      return
    case 'sessao-encerrada':
      interromperTarefa(ctx, r, e, absorver)
      if (r.sessao === undefined) absorver('sessao-encerrada-sem-sessao')
      r.sessao = undefined
      return
    case 'diagnostico-iniciado':
      transitarDiagnostico(r, 'nao-iniciado', 'em-curso', absorver)
      return
    case 'diagnostico-pulado':
      transitarDiagnostico(r, 'nao-iniciado', 'pulado', absorver)
      return
    case 'diagnostico-encerrado':
      transitarDiagnostico(r, 'em-curso', 'encerrado', absorver)
      return
    case 'tarefa-iniciada':
      if (r.tarefa !== undefined) {
        absorver('tarefa-sobre-tarefa-aberta')
        interromperTarefa(ctx, r, e, absorver)
      }
      abrirTarefa(r, e)
      return
    case 'apresentacao-vista':
      apresentar(ctx, r, e, absorver)
      return
    case 'resposta-registrada':
      responder(ctx, r, e, absorver)
      return
    case 'licao-concluida':
      concluirLicao(ctx, r, e, absorver)
      return
    case 'licao-adiada':
      adiarLicao(ctx, r, e, absorver)
      return
    case 'remediacao-concluida':
      remediar(r, e, absorver)
      return
    case 'meta-diaria-alterada':
      escrever(r.metaPorDia).set(diaLocal(e.em, e.fusoMinutos, ctx.parametros), e.xp)
      r.metaDiariaXp = e.xp
      return
  }
}

function transitarDiagnostico(
  r: Rascunho,
  de: Rascunho['diagnostico'],
  para: Rascunho['diagnostico'],
  absorver: Absorver,
): void {
  if (r.diagnostico === de) r.diagnostico = para
  else absorver('diagnostico-fora-de-ordem')
}

/**
 * A sessão nova substitui a aberta, se houver, e interrompe a tarefa dela. O contexto nasce com as novas previstas que
 * ainda não têm lição concluída como pendentes e com os itens de lição concluída como aprendidos, na ordem em que foram
 * concluídos.
 */
function iniciarSessao(
  ctx: ContextoDeReducao,
  r: Rascunho,
  e: EventoDoTipo<'sessao-iniciada'>,
  absorver: Absorver,
): void {
  interromperTarefa(ctx, r, e, absorver)
  if (r.sessao !== undefined) absorver('sessao-sobre-sessao-aberta')
  const feitos = concluidos(r)
  const pendentesNovas: IdItem[] = []
  for (const item of e.novasPrevistas) {
    if (!ctx.catalogo.itens.has(item)) absorver('item-fora-do-catalogo')
    else if (!feitos.has(topicoDeItem(item).id)) pendentesNovas.push(item)
  }
  const aprendidos: IdItem[] = []
  for (const [t, s] of r.licoes.atual) {
    const topico = lerTopico(t)
    if (s.status === 'concluida' && topico.tipo === 'item') aprendidos.push(topico.item)
  }
  r.sessao = {
    iniciadaEm: e.em,
    orcamentoMin: e.orcamentoMin,
    contexto: contextoDeSessao({ pendentesNovas, aprendidos }),
  }
  r.sessoesIniciadas += 1
}

/** Cada item apresentado ganha estado de memória e deixa de ser pendente no contexto da sessão. */
function apresentar(
  ctx: ContextoDeReducao,
  r: Rascunho,
  e: EventoDoTipo<'apresentacao-vista'>,
  absorver: Absorver,
): void {
  for (const item of e.itens) {
    if (!ctx.catalogo.itens.has(item)) {
      absorver('item-fora-do-catalogo')
      continue
    }
    garantirMemoria(ctx, r, topicoDeItem(item).id)
    if (r.sessao !== undefined) r.sessao = { ...r.sessao, contexto: registrarApresentacao(r.sessao.contexto, item) }
  }
  if (r.sessao === undefined) absorver('fora-da-sessao')
}

/**
 * A resposta, em ordem fixa: as normas de latência; fora do diagnóstico, a janela de qualidades, a confusão e o contexto
 * da sessão; a ligação à tarefa aberta; o efeito na memória conforme o uso; e o fechamento da tarefa, se ela acabou.
 *
 * O efeito na memória lê o julgamento gravado (acerto, qualidade e confusão da avaliação) e o número vigente: o rawDelta
 * sai de `parametros.deltaBruto` pela qualidade, e não do `deltaBruto` gravado na avaliação, para a calibração valer
 * também para o passado. Por uso:
 *
 * - diagnóstico e sondagem: nada, porque medem sem ensinar;
 * - lição: só mede (`medir`), porque a pergunta vem logo depois da apresentação;
 * - grupo: nada agora; a tarefa de grupo inteira entra no fechamento, e a resposta avulsa de grupo não muda a memória;
 * - revisão, quiz, remediação e discriminação: a resposta isolada (`aplicarRespostaIsolada`) sobre tópico de lição
 *   concluída, e só a medida sobre os outros. O erro de quiz em tópico concluído ainda reagenda o tópico para um dia
 *   depois.
 */
function responder(
  ctx: ContextoDeReducao,
  r: Rascunho,
  e: EventoDoTipo<'resposta-registrada'>,
  absorver: Absorver,
): void {
  const { questao, uso, avaliacao } = e
  const { parametros } = ctx
  if (!noGrafo(ctx, questao.alvo)) {
    absorver('topico-fora-do-grafo')
    return
  }
  if (avaliacao === undefined) return
  r.normas = registrarLatencia(r.normas, questao, e.resposta, avaliacao, parametros)
  if (uso.tipo === 'diagnostico') return

  r.ultimasQualidades = [...r.ultimasQualidades, avaliacao.qualidade].slice(-parametros.janelaChuteSistematico)
  const confundido = confusaoQueConta(uso, avaliacao)
  if (confundido !== undefined) {
    if (ctx.catalogo.itens.has(confundido)) {
      const chave = chaveDePar(questao.itemAlvo, confundido)
      escrever(r.confusoes).set(chave, (r.confusoes.atual.get(chave) ?? 0) + 1)
    } else absorver('item-fora-do-catalogo')
  }
  if (r.sessao !== undefined) r.sessao = { ...r.sessao, contexto: registrarQuestao(r.sessao.contexto, questao) }
  else absorver('fora-da-sessao')
  if (!ligarResposta(r, e, avaliacao)) absorver('resposta-avulsa')

  const direcao = direcaoDoFormato(questao.formato.tipo)
  switch (uso.tipo) {
    case 'sondagem':
    case 'grupo':
      break
    case 'licao':
      medir(ctx, r, questao.alvo, avaliacao.correta, direcao)
      break
    case 'revisao':
    case 'quiz':
    case 'remediacao':
    case 'discriminacao':
      if (!concluidos(r).has(questao.alvo)) {
        medir(ctx, r, questao.alvo, avaliacao.correta, direcao)
        break
      }
      responderIsolada(ctx, r, e.em, questao.alvo, direcao, parametros.deltaBruto[avaliacao.qualidade])
      if (uso.tipo === 'quiz' && !avaliacao.correta) {
        const depois = r.memorias.atual.get(questao.alvo)
        if (depois !== undefined) escrever(r.memorias).set(questao.alvo, reagendar(depois, e.em, UM_DIA, parametros))
      }
      break
  }
  fecharSeCompleta(ctx, r, e, absorver)
}

/** A resposta isolada sobre tópico de lição concluída, com os tópicos de lição concluída como elegíveis da penalidade. */
function responderIsolada(
  ctx: ContextoDeReducao,
  r: Rascunho,
  agora: Instante,
  alvo: IdTopico,
  direcao: ReturnType<typeof direcaoDoFormato>,
  deltaBruto: number,
): void {
  const resultado = aplicarRespostaIsolada(contextoDePropagacao(ctx, agora), r.memorias.atual, {
    alvo,
    direcao,
    deltaBruto,
    elegiveis: concluidos(r),
  })
  trocarMemorias(r, resultado.memorias)
}

/**
 * A lição concluída, de item ou de grupo. A de item recebe a repetição da lição (`repetirLicao`) e entra nos aprendidos
 * da sessão; a de grupo só grava o status, com o estado criado se faltar, porque a tarefa de grupo da lição de família
 * já deu ao grupo a atualização única. Lição já concluída só conta, sem segunda repetição. A tarefa adaptativa aberta
 * com o mesmo id fecha concluída; outra aberta continua.
 */
function concluirLicao(
  ctx: ContextoDeReducao,
  r: Rascunho,
  e: EventoDoTipo<'licao-concluida'>,
  absorver: Absorver,
): void {
  const t = e.topico
  if (!noGrafo(ctx, t)) {
    absorver('topico-fora-do-grafo')
    return
  }
  if (concluidos(r).has(t)) {
    absorver('licao-ja-concluida')
    return
  }
  const topico = lerTopico(t)
  if (topico.tipo === 'item') repetirLicao(ctx, r, t, e.em)
  else garantirMemoria(ctx, r, t)
  escrever(r.licoes).set(t, { status: 'concluida', em: e.em, acelerada: e.acelerada, viaDiagnostico: false })
  concluidos(r).add(t)
  if (topico.tipo === 'item') {
    if (r.sessao !== undefined) {
      r.sessao = { ...r.sessao, contexto: registrarLicaoConcluida(r.sessao.contexto, topico.item) }
    } else absorver('fora-da-sessao')
  }
  fecharLicao(ctx, r, e, { concluida: true, acelerada: e.acelerada }, absorver)
}

/**
 * A lição adiada: volta a ser oferecida 24 horas depois, que não dependem de fuso, com a contagem de adiamentos e o KP da
 * falha. Lição já concluída não se adia.
 */
function adiarLicao(ctx: ContextoDeReducao, r: Rascunho, e: EventoDoTipo<'licao-adiada'>, absorver: Absorver): void {
  const t = e.topico
  if (!noGrafo(ctx, t)) {
    absorver('topico-fora-do-grafo')
    return
  }
  if (concluidos(r).has(t)) {
    absorver('licao-ja-concluida')
    return
  }
  const antes = r.licoes.atual.get(t)
  const tentativas = antes?.status === 'adiada' ? antes.tentativas + 1 : 1
  escrever(r.licoes).set(t, { status: 'adiada', liberadoEm: somarDias(e.em, UM_DIA), tentativas, kpDaFalha: e.kp })
  fecharLicao(ctx, r, e, { concluida: false, acelerada: false }, absorver)
}

/** Fecha a tarefa adaptativa aberta com o id do evento de lição. Outra tarefa aberta continua, e o motivo conta. */
function fecharLicao(
  ctx: ContextoDeReducao,
  r: Rascunho,
  e: EventoDoTipo<'licao-concluida' | 'licao-adiada'>,
  fim: Readonly<{ concluida: boolean; acelerada: boolean }>,
  absorver: Absorver,
): void {
  const aberta = r.tarefa
  if (aberta === undefined) return
  if (aberta.tarefa.id !== e.tarefaId) absorver('licao-de-outra-tarefa')
  else if (aberta.tarefa.passos.length === 0) fecharTarefa(ctx, r, e, fim, absorver)
}

/**
 * A remediação concluída marca como remediado cada par de itens entre os alvos que tem confusão, com a contagem de agora,
 * qualquer que seja o motivo da remediação: assim a remediação de lição, que põe os itens lado a lado, não é seguida de
 * uma remediação de confusão do mesmo par.
 */
function remediar(r: Rascunho, e: EventoDoTipo<'remediacao-concluida'>, absorver: Absorver): void {
  const itens = e.alvos.flatMap((t) => {
    const topico = lerTopico(t)
    return topico.tipo === 'item' ? [topico.item] : []
  })
  const pares = itens.flatMap((x, i) => itens.slice(i + 1).map((y) => chaveDePar(x, y)))
  const confundidos = pares.filter((chave) => r.confusoes.atual.has(chave))
  for (const chave of confundidos) escrever(r.confusoesRemediadas).set(chave, r.confusoes.atual.get(chave) ?? 0)
  if (confundidos.length === 0) absorver('remediacao-sem-par-confundido')
}
