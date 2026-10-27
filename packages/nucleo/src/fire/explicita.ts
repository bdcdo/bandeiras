import type { Direcao } from '../catalogo/tipos'
import type { IdTopico } from '../grafo/topico'
import type { EstadoMemoria } from '../memoria/estado-memoria'
import { aplicarRepeticao } from '../memoria/modelo'
import type { Parametros } from '../memoria/parametros'
import { velocidade } from '../memoria/velocidade'
import type { ContextoDePropagacao } from './propagacao'

// A repetição explícita do tópico respondido, que as funções de propagação deixam a quem chama. Mora aqui, fora do
// índice da camada, para a resposta isolada e a tarefa de grupo aplicarem a mesma regra.

/**
 * rawDelta que a resposta aplica ao próprio alvo: cheio no texto digitado, e vezes `fatorMultiplaEscolha` na múltipla
 * escolha, porque reconhecer entre opções vale menos que recordar o rótulo. A direção `recordar` é a do texto digitado;
 * as outras duas são de múltipla escolha.
 */
export function deltaExplicito(deltaBruto: number, direcao: Direcao, parametros: Parametros): number {
  return deltaBruto * (direcao === 'recordar' ? 1 : parametros.fatorMultiplaEscolha)
}

/**
 * Repetição explícita de `topico` no instante do contexto, com a velocidade do estado de antes da resposta: a acurácia
 * que a mesma resposta vai mover entra só depois, para a velocidade medir quem a pessoa era ao responder.
 */
export function repeticaoExplicita(
  ctx: ContextoDePropagacao,
  e: EstadoMemoria,
  topico: IdTopico,
  deltaBruto: number,
): EstadoMemoria {
  const { parametros, tecnicas, agora } = ctx
  return aplicarRepeticao(
    e,
    {
      deltaBruto,
      agora,
      velocidade: velocidade(e, ctx.dificuldade(topico), parametros, tecnicas),
      origem: 'explicita',
    },
    parametros,
  )
}
