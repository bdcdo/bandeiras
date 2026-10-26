import type { Instante } from '../base/tempo'
import { DIRECOES, type Direcao } from '../catalogo/tipos'

/**
 * Estado de memória de um tópico, no modelo de repetição espaçada do livro (The Math Academy Way, cap. 29).
 *
 * Só `memoria/` e `fire/` leem e escrevem estes campos; o resto do núcleo recebe o tipo pelo índice da camada e chama as
 * funções dela. É a costura que mantém o modelo de memória trocável sem mexer em quem o usa.
 *
 * O que é derivado (intervalo ideal, memória agora, vencimento e fase) nunca é guardado: sai de `modelo.ts` a cada
 * leitura, e por isso não há como o estado guardar um vencimento que discorde da memória.
 */
export type EstadoMemoria = Readonly<{
  /** repNum: rodadas de repetição bem-sucedidas acumuladas. Real, e não inteiro, porque o crédito implícito soma frações. */
  numRepeticoes: number
  /**
   * memory logo depois da última repetição, que decai a partir de `ultimaRepEm`. Toda saída de `aplicarRepeticao` fica
   * entre 0 e `tetoMemoria`; `reagendar` pode gravar acima dele para empurrar o vencimento.
   */
  memoriaBase: number
  /** Instante da última repetição, explícita ou implícita: o zero de onde a memória decai. Ausente se nunca houve uma. */
  ultimaRepEm?: Instante
  /** Instante da última resposta explícita, certa ou errada; alimenta o fator de precocidade. O crédito implícito não o toca. */
  ultimaTentativaEm?: Instante
  /** Acurácia recente, em média exponencial, de 0 a 1. */
  acuracia: number
  /** Quantas evidências já entraram na acurácia; 0 quer dizer que ela ainda é a estimativa da vizinhança, não medida. */
  nAvaliacoes: number
  /** Acurácia recente por direção de pergunta; escolhe a direção mais fraca de cada alvo numa tarefa de grupo. */
  acuraciaPorDirecao: Readonly<Record<Direcao, number>>
  /** Concluído por inferência do diagnóstico, no limite: um erro o devolve à fila de lições. */
  condicional: boolean
}>

/** Estado de quem nunca repetiu o tópico: sem memória, com a acurácia estimada em todas as direções. */
export function estadoMemoriaInicial(acuracia: number): EstadoMemoria {
  return {
    numRepeticoes: 0,
    memoriaBase: 0,
    acuracia,
    nAvaliacoes: 0,
    acuraciaPorDirecao: Object.fromEntries(DIRECOES.map((d) => [d, acuracia])) as Record<Direcao, number>,
    condicional: false,
  }
}
