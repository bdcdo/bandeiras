import { erro, ok, type Resultado } from '../base/resultado'
import type { Direcao } from '../catalogo/tipos'
import { preRequisitos } from '../grafo/consultas'
import type { IdTopico } from '../grafo/topico'
import { atualizarAcuracia } from '../memoria/acuracia'
import type { EstadoMemoria } from '../memoria/estado-memoria'
import { aplicarRepeticao } from '../memoria/modelo'
import { velocidade } from '../memoria/velocidade'
import {
  aplicarPenalidades,
  planejarPenalidade,
  propagarCredito,
  type ContextoDePropagacao,
  type Memorias,
  type ResultadoDePenalidade,
} from './propagacao'

/** A resposta a uma pergunta de uma tarefa de grupo, sobre um dos membros. */
export type RespostaDeAlvo = Readonly<{
  alvo: IdTopico
  /** Direção da pergunta. `recordar` é texto digitado; as outras são múltipla escolha. */
  direcao: Direcao
  /** rawDelta da resposta: positivo no acerto, negativo no erro. */
  deltaBruto: number
}>

export type TarefaDeGrupo = Readonly<{
  grupo: IdTopico
  respostas: readonly RespostaDeAlvo[]
  /** Membros mostrados na tela sem serem alvo de pergunta. Só eles recebem crédito implícito, como distratores. */
  exibidos: ReadonlySet<IdTopico>
  /** Ascendentes que a penalidade de um alvo pode alcançar; ver `Penalidade.elegiveis`. */
  elegiveis: ReadonlySet<IdTopico>
}>

export type ErroDeTarefaDeGrupo = { codigo: 'TAREFA_DE_GRUPO_INVALIDA'; detalhe: string }

const aspas = (texto: string): string => `'${texto}'`

function problemas(ctx: ContextoDePropagacao, memorias: Memorias, tarefa: TarefaDeGrupo): string[] {
  const membros = new Set(preRequisitos(ctx.grafo, tarefa.grupo))
  const alvos = tarefa.respostas.map((r) => r.alvo)
  return [
    ...(memorias.has(tarefa.grupo) ? [] : [`grupo sem estado de memória: ${aspas(tarefa.grupo)}`]),
    ...(alvos.length === 0 ? ['tarefa sem alvo'] : []),
    ...alvos.filter((a, k) => alvos.indexOf(a) !== k).map((a) => `alvo repetido: ${aspas(a)}`),
    ...alvos.filter((a) => !membros.has(a)).map((a) => `alvo que o grupo não encompassa: ${aspas(a)}`),
    ...alvos.filter((a) => !memorias.has(a)).map((a) => `alvo sem estado de memória: ${aspas(a)}`),
  ]
}

/**
 * Atualiza a memória depois de uma tarefa de grupo F com k alvos, em três passos de ordem fixa:
 *
 * 1. Cada alvo recebe a repetição explícita da própria pergunta. Na múltipla escolha, o rawDelta entra multiplicado por
 *    `fatorMultiplaEscolha`, porque reconhecer entre opções vale menos que recordar; texto digitado entra cheio. A
 *    acurácia do alvo e a da direção da pergunta recebem a resposta. O erro de cada alvo sobe como penalidade aos
 *    ascendentes elegíveis, menos F.
 * 2. F recebe uma única repetição explícita, com rawDelta `2 * acertos / k - 1`: 1 se acertou todos, -1 se errou todos.
 * 3. Se esse rawDelta for positivo, o crédito implícito desce de F só aos membros exibidos que não foram alvo, com
 *    `fatorExposicaoDistrator`. O alvo já teve a evidência dele no passo 1, e nada conta duas vezes.
 *
 * O resultado não depende da ordem das respostas. As repetições do passo 1 leem só o estado de antes da tarefa, cada uma
 * no próprio alvo. Um ascendente alcançado pelo erro de mais de um alvo recebe uma penalidade só, a mais forte entre
 * elas: aplicar uma por alvo em sequência daria resultado diferente conforme a ordem, porque o decay da segunda depende
 * da memória que a primeira deixou, e somá-las penalizaria o ascendente mais que um erro explícito nele.
 *
 * Com `fire` desligado, só os alvos e F mudam. Tarefa sem alvo, com alvo repetido, com alvo que F não encompassa ou com
 * tópico sem estado de memória é recusada com `TAREFA_DE_GRUPO_INVALIDA`.
 */
export function aplicarTarefaDeGrupo(
  ctx: ContextoDePropagacao,
  memorias: Memorias,
  tarefa: TarefaDeGrupo,
): Resultado<ResultadoDePenalidade, ErroDeTarefaDeGrupo> {
  const achados = problemas(ctx, memorias, tarefa)
  if (achados.length > 0) return erro({ codigo: 'TAREFA_DE_GRUPO_INVALIDA', detalhe: achados.join('; ') })
  const { parametros, tecnicas, agora } = ctx
  const explicita = (e: EstadoMemoria, topico: IdTopico, deltaBruto: number): EstadoMemoria =>
    aplicarRepeticao(
      e,
      {
        deltaBruto,
        agora,
        velocidade: velocidade(e, ctx.dificuldade(topico), parametros, tecnicas),
        origem: 'explicita',
      },
      parametros,
    )

  // Passo 1: a repetição explícita de cada alvo, e a penalidade que o erro dele levaria a cada ascendente.
  const depoisDosAlvos = new Map(memorias)
  const maisForte = new Map<IdTopico, { deltaBruto: number; fator: number }>()
  for (const r of tarefa.respostas) {
    const e = memorias.get(r.alvo)
    if (e === undefined) continue
    const deltaBruto = r.deltaBruto * (r.direcao === 'recordar' ? 1 : parametros.fatorMultiplaEscolha)
    const repetido = explicita(e, r.alvo, deltaBruto)
    depoisDosAlvos.set(r.alvo, atualizarAcuracia(repetido, r.deltaBruto > 0, 1, parametros, r.direcao))
    const planejadas = planejarPenalidade(ctx, memorias, {
      origem: r.alvo,
      deltaBruto,
      elegiveis: tarefa.elegiveis,
      excluir: new Set([tarefa.grupo]),
    })
    for (const [t, p] of planejadas) {
      const atual = maisForte.get(t)
      // Mais forte é o delta mais negativo; no empate, o maior fator, para a escolha depender só dos valores.
      const vence =
        atual === undefined ||
        p.deltaBruto < atual.deltaBruto ||
        (p.deltaBruto === atual.deltaBruto && p.fator > atual.fator)
      if (vence) maisForte.set(t, p)
    }
  }
  const errados = tarefa.respostas.filter((r) => r.deltaBruto < 0).map((r) => r.alvo)
  const penalizado = aplicarPenalidades(ctx, depoisDosAlvos, errados, maisForte)

  // Passo 2: a evidência sobre o grupo, uma vez só.
  const acertos = tarefa.respostas.filter((r) => r.deltaBruto > 0).length
  const deltaDoGrupo = (2 * acertos) / tarefa.respostas.length - 1
  const depoisDoGrupo = new Map(penalizado.memorias)
  const eGrupo = penalizado.memorias.get(tarefa.grupo)
  if (eGrupo !== undefined) {
    const repetido = explicita(eGrupo, tarefa.grupo, deltaDoGrupo)
    depoisDoGrupo.set(tarefa.grupo, atualizarAcuracia(repetido, deltaDoGrupo > 0, 1, parametros))
  }

  // Passo 3: o crédito implícito aos membros exibidos que não foram alvo.
  const alvos = new Set(tarefa.respostas.map((r) => r.alvo))
  const finais = propagarCredito(ctx, depoisDoGrupo, {
    origem: tarefa.grupo,
    deltaBruto: deltaDoGrupo,
    exposicao: (t) => (!alvos.has(t) && tarefa.exibidos.has(t) ? parametros.fatorExposicaoDistrator : 0),
  })
  return ok({ ...penalizado, memorias: finais })
}
