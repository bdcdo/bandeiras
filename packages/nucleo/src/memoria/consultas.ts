import type { Direcao } from '../catalogo/tipos'
import type { EstadoMemoria } from './estado-memoria'
import type { Parametros } from './parametros'

// Leituras do estado de memória para as camadas de cima. Fora de `memoria/` e `fire/` ninguém lê os campos de
// `EstadoMemoria` direto: passa por aqui, e trocar o modelo de memória é reescrever estas funções, não quem as chama.

/** Acurácia recente do tópico numa direção de pergunta; a tarefa de grupo a usa para escolher a direção de cada alvo. */
export function acuraciaNaDirecao(e: EstadoMemoria, direcao: Direcao): number {
  return e.acuraciaPorDirecao[direcao]
}

/**
 * O tópico já pode receber questão cronometrada: tem as repetições e a acurácia mínimas. O livro põe o teste
 * cronometrado só depois de a pessoa acertar sem tempo (The Math Academy Way, p. 289), acurácia antes de velocidade.
 */
export function prontoParaCronometrar(e: EstadoMemoria, parametros: Parametros): boolean {
  return (
    e.numRepeticoes >= parametros.numRepeticoesMinimaCronometrada && e.acuracia >= parametros.acuraciaMinimaCronometrada
  )
}
