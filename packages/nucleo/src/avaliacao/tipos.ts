import type { Milis } from '../base/tempo'
import type { Direcao, IdItem } from '../catalogo/tipos'
import type { QualidadeDeResposta } from '../memoria'

/**
 * O que a casca manda de volta para uma questão ou tarefa. `continuar` fecha uma apresentação e nunca responde questão;
 * `nao-sei` e `tempo-esgotado` não trazem latência, porque não há escolha nem texto para medir. A latência conta do
 * instante em que a última opção termina de aparecer, e o texto vai cru: quem o resolve é o núcleo, com a normalização
 * do catálogo, e a casca nunca manda um id resolvido no lugar dele.
 */
export type Resposta =
  | Readonly<{ tipo: 'continuar' }>
  | Readonly<{ tipo: 'escolha'; escolhidas: readonly IdItem[]; latencia: Milis }>
  | Readonly<{ tipo: 'texto'; texto: string; latencia: Milis }>
  | Readonly<{ tipo: 'nao-sei' }>
  | Readonly<{ tipo: 'tempo-esgotado' }>

/** As qualidades de acerto, tiradas da lista única de `memoria/parametros.ts`. */
export type QualidadeDeAcerto = Extract<QualidadeDeResposta, 'perfeita' | 'boa' | 'lenta'>
/** O resto da lista: toda qualidade que não é acerto é erro. */
export type QualidadeDeErro = Exclude<QualidadeDeResposta, QualidadeDeAcerto>

/**
 * Avaliação de uma resposta. A união por `correta` é o que impede, no tipo, um acerto `chute` ou um erro `perfeita`.
 * `deltaBruto` é o de `parametros.deltaBruto` para a qualidade, já lido, e é o que a memória aplica. `confundidaCom` só
 * existe no erro: o item que a pessoa escolheu ou digitou no lugar do alvo, quando há um.
 */
export type Avaliacao =
  | Readonly<{ correta: true; qualidade: QualidadeDeAcerto; direcao: Direcao; deltaBruto: number }>
  | Readonly<{
      correta: false
      qualidade: QualidadeDeErro
      direcao: Direcao
      deltaBruto: number
      confundidaCom?: IdItem
    }>

/**
 * `RESPOSTA_INCOMPATIVEL` é a resposta que não serve à questão: o tipo errado para o formato, um id fora das opções, uma
 * latência que não é duração. É defeito de quem chama, e por isso erro e não avaliação: contar como resposta errada
 * puniria a memória da pessoa por um engano da casca.
 */
export type ErroDeAvaliacao = Readonly<{
  codigo: 'RESPOSTA_INCOMPATIVEL' | 'FORMATO_NAO_SUPORTADO' | 'ITEM_INEXISTENTE'
  detalhe: string
}>
