import type { Direcao } from '../catalogo/tipos'
import { fechoAscendente } from '../grafo/consultas'
import type { IdTopico } from '../grafo/topico'
import { atualizarAcuracia } from '../memoria/acuracia'
import { deltaExplicito, repeticaoExplicita } from './explicita'
import {
  propagarCredito,
  propagarPenalidade,
  type ContextoDePropagacao,
  type Memorias,
  type ResultadoDePenalidade,
} from './propagacao'

/** Uma resposta a uma questão isolada, de revisão, quiz, remediação ou discriminação. */
export type RespostaIsolada = Readonly<{
  alvo: IdTopico
  /** Direção da pergunta. `recordar` é texto digitado; as outras são múltipla escolha. */
  direcao: Direcao
  /** rawDelta da resposta: positivo no acerto, negativo no erro. */
  deltaBruto: number
  /** Ascendentes que a penalidade do erro pode alcançar; ver `Penalidade.elegiveis`. */
  elegiveis: ReadonlySet<IdTopico>
}>

const temArestas = (arestas: ReadonlyMap<IdTopico, readonly unknown[]>, t: IdTopico): boolean =>
  (arestas.get(t)?.length ?? 0) > 0

function algumElegivel(fecho: ReadonlySet<IdTopico>, elegiveis: ReadonlySet<IdTopico>): boolean {
  for (const t of fecho) if (elegiveis.has(t)) return true
  return false
}

/**
 * Atualiza a memória depois de uma resposta isolada, em ordem fixa:
 *
 * 1. O alvo recebe a repetição explícita com o rawDelta do formato (`deltaExplicito`: a múltipla escolha vale
 *    `fatorMultiplaEscolha`) e a velocidade de antes da resposta; depois, a acurácia geral e a da direção recebem o
 *    acerto ou o erro, com peso 1.
 * 2. O acerto desce como crédito implícito, com exposição 1, aos tópicos que o alvo encompassa; o erro sobe como
 *    penalidade aos ascendentes elegíveis. As duas levam o rawDelta do passo 1, já com o fator do formato, como a
 *    penalidade de cada alvo da tarefa de grupo: a resposta que mostra menos do alvo mostra menos também do que ele
 *    encompassa.
 *
 * A propagação só roda quando o alvo tem aresta no sentido dela e, no erro, quando algum ascendente é elegível. Sem
 * aresta, ou sem elegível no fecho ascendente, ela não mudaria ninguém e daria o mesmo mapa e a mesma culpa; pular é só
 * para não percorrer a ordem topológica inteira a cada resposta, que é o custo que domina a reconstrução de um log
 * longo. O fecho de um item costuma ter um ou dois grupos, e percorrê-lo custa menos que a propagação que ele evita.
 *
 * A culpa é a de `propagarPenalidade` no erro e vazia no acerto. Alvo sem estado de memória não muda nada: quem chama
 * cria o estado antes, quando a resposta conta para a memória.
 */
export function aplicarRespostaIsolada(
  ctx: ContextoDePropagacao,
  memorias: Memorias,
  r: RespostaIsolada,
): ResultadoDePenalidade {
  const e = memorias.get(r.alvo)
  if (e === undefined) return { memorias, culpa: new Set(), condicionaisPenalizados: [] }
  const { parametros, grafo } = ctx
  const delta = deltaExplicito(r.deltaBruto, r.direcao, parametros)
  const acerto = r.deltaBruto > 0
  const depois = new Map(memorias)
  depois.set(r.alvo, atualizarAcuracia(repeticaoExplicita(ctx, e, r.alvo, delta), acerto, 1, parametros, r.direcao))
  if (acerto) {
    const finais = temArestas(grafo.arestasAbaixo, r.alvo)
      ? propagarCredito(ctx, depois, { origem: r.alvo, deltaBruto: delta, exposicao: () => 1 })
      : depois
    return { memorias: finais, culpa: new Set(), condicionaisPenalizados: [] }
  }
  if (!temArestas(grafo.arestasAcima, r.alvo) || !algumElegivel(fechoAscendente(grafo, r.alvo), r.elegiveis)) {
    return { memorias: depois, culpa: new Set([r.alvo]), condicionaisPenalizados: [] }
  }
  return propagarPenalidade(ctx, depois, { origem: r.alvo, deltaBruto: delta, elegiveis: r.elegiveis })
}
