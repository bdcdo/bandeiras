import type { Direcao } from '../catalogo/tipos'
import { estadoMemoriaInicial, type EstadoMemoria } from '../memoria'

/**
 * Estado de memória de um tópico para os testes das camadas acima de `memoria/` e `fire/`. Fora dessas duas camadas, é o
 * único lugar que escreve campos de `EstadoMemoria`: os testes de cima dizem o que querem do tópico, e uma troca do
 * modelo de memória reescreve este arquivo, e não cada teste que o chama.
 *
 * Sem nada pedido, é o estado inicial com acurácia 0,85. `porDirecao` substitui a acurácia de cada direção, que no
 * estado inicial é a acurácia geral.
 */
export function estadoDeTeste(
  pedido: Readonly<{ acuracia?: number; repeticoes?: number; porDirecao?: Readonly<Record<Direcao, number>> }> = {},
): EstadoMemoria {
  const inicial = estadoMemoriaInicial(pedido.acuracia ?? 0.85)
  return {
    ...inicial,
    numRepeticoes: pedido.repeticoes ?? inicial.numRepeticoes,
    acuraciaPorDirecao: pedido.porDirecao ?? inicial.acuraciaPorDirecao,
  }
}
