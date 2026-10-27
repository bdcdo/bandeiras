import type { IdItem } from '../catalogo/tipos'
import type { UsoDeQuestao } from '../questoes'
import type { Avaliacao } from '../avaliacao'

/**
 * Chave de um par de itens no mapa de confusões: os dois ids em ordem de unidade de código, para `a` confundido com `b`
 * e `b` com `a` caírem na mesma chave. O separador é o mesmo caractere de controle de `chaveDeOpcoes`, que nenhum id de
 * catálogo tem, para `('a|b', 'c')` e `('a', 'b|c')` não colidirem.
 */
export function chaveDePar(x: IdItem, y: IdItem): string {
  return [x, y].sort().join('\u001f')
}

// Usos cuja resposta errada conta como confusão: os que perguntam um item já aprendido, fora da lição.
const USOS_QUE_CONTAM: ReadonlySet<UsoDeQuestao['tipo']> = new Set([
  'revisao',
  'remediacao',
  'quiz',
  'discriminacao',
  'grupo',
])

/**
 * O item com que a resposta confundiu o alvo, se ela conta como confusão; senão, `undefined`. Decisão do mantenedor:
 * conta só a resposta errada, sem chute, com `confundidaCom`, nos usos revisão, remediação, quiz, discriminação e grupo.
 *
 * A lição, a sondagem e o diagnóstico ficam de fora: o KP1 e o KP2 erram entre distratores dissimilares logo depois da
 * apresentação, e a confusão da lição já tem remédio próprio, a remediação de lição, que lê as falhas dos KPs. O chute
 * fica de fora porque, na múltipla escolha, ele traz a opção escolhida ao acaso como `confundidaCom`. A alternativa
 * descartada era contar todo erro com `confundidaCom` fora do diagnóstico; trocar a regra é mudar só esta função e o
 * caso de teste que a fixa.
 */
export function confusaoQueConta(uso: UsoDeQuestao, avaliacao: Avaliacao): IdItem | undefined {
  if (avaliacao.correta || avaliacao.qualidade === 'chute' || !USOS_QUE_CONTAM.has(uso.tipo)) return undefined
  return avaliacao.confundidaCom
}
