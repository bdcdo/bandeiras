import type { Vocabulario } from '@bandeiras/nucleo'

/**
 * As palavras com que a casca fala das bandeiras. O item é a bandeira e o rótulo é o país: a pessoa vê a bandeira e
 * responde com o nome do país. `{rotulo}` é marcador que a casca substitui pelo rótulo do item da pergunta.
 */
export const VOCABULARIO = {
  item: 'bandeira',
  itens: 'bandeiras',
  rotulo: 'país',
  rotulos: 'países',
  grupo: 'família',
  grupos: 'famílias',
  categoria: 'região',
  perguntaReconhecer: 'Qual é o país?',
  perguntaProduzir: 'Qual é a bandeira de {rotulo}?',
  perguntaRecordar: 'De que país é esta bandeira? Digite o nome.',
  tituloCatalogo: 'Mapa',
} as const satisfies Vocabulario
