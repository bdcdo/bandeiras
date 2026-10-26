import { diasEntre, somarDias, type Dias, type Instante } from '../base/tempo'
import type { EstadoMemoria } from './estado-memoria'
import { limitar } from './limitar'
import type { Parametros } from './parametros'

// O modelo de repetição espaçada do livro, lido ao pé da letra (The Math Academy Way, cap. 29, p. 372-374). Os nomes do
// livro e os daqui: repNum é numRepeticoes, memory é a memória, interval é intervaloIdeal, speed é a velocidade, decay é
// decaimentoPorAtraso, rawDelta é deltaBruto e failed é a resposta que está sendo aplicada ter sido erro.

/**
 * interval: dias ideais entre a repetição `numRepeticoes` e a seguinte. Cresce em progressão geométrica a partir de
 * `intervaloBaseDias`, até `intervaloMaximoDias`. É contínuo em `numRepeticoes`, que soma frações do crédito implícito.
 */
export function intervaloIdeal(numRepeticoes: number, parametros: Parametros): Dias {
  const { intervaloBaseDias, crescimentoIntervalo, intervaloMaximoDias } = parametros
  return Math.min(intervaloMaximoDias, intervaloBaseDias * crescimentoIntervalo ** (numRepeticoes - 1)) as Dias
}

/**
 * memory agora: a memória da última repetição, multiplicada por limiar / teto a cada intervalo ideal. Assim ela cai do
 * teto ao limiar em exatamente um intervalo, quaisquer que sejam os dois; com os padrões, 1 e 0,5, cai pela metade.
 * Zero para quem nunca repetiu.
 *
 * Um instante anterior à última repetição dá memória acima da base, de propósito: é a mesma curva estendida para trás, e
 * é ela que faz `memoriaEm(e, devidoEm(e))` valer o limiar mesmo quando a base já está abaixo dele.
 */
export function memoriaEm(e: EstadoMemoria, agora: Instante, parametros: Parametros): number {
  if (e.ultimaRepEm === undefined) return 0
  const { limiarDevido, tetoMemoria } = parametros
  const intervalos = diasEntre(e.ultimaRepEm, agora) / intervaloIdeal(e.numRepeticoes, parametros)
  return e.memoriaBase * (limiarDevido / tetoMemoria) ** intervalos
}

/**
 * Instante em que a memória cai ao limiar e a repetição vence, ou `undefined` para quem nunca repetiu. Memória zero
 * vence na hora da última repetição. É a inversa de `memoriaEm`: com memória base b, limiar L, teto T e intervalo I, a
 * memória chega ao limiar depois de I * log(b / L) / log(T / L) dias, e por isso base abaixo do limiar dá vencimento no
 * passado. Com T / L = 2, como nos padrões, o divisor log2(T / L) vale 1 exatamente.
 */
export function devidoEm(e: EstadoMemoria, parametros: Parametros): Instante | undefined {
  if (e.ultimaRepEm === undefined) return undefined
  if (e.memoriaBase <= 0) return e.ultimaRepEm
  const { limiarDevido, tetoMemoria } = parametros
  const intervalos = Math.log2(e.memoriaBase / limiarDevido) / Math.log2(tetoMemoria / limiarDevido)
  return somarDias(e.ultimaRepEm, (intervaloIdeal(e.numRepeticoes, parametros) * intervalos) as Dias)
}

/**
 * Desconto do rawDelta de um acerto feito cedo (p. 373), entre 0 e 1. É o menor de dois termos.
 *
 * O primeiro mede a precocidade pela memória, entre o limiar e o teto: 0 com a memória no teto ou acima (acabou de
 * acertar), 1 com a memória no limiar ou abaixo (venceu). Medir contra memória 1 com um teto abaixo de 1 deixaria esse
 * termo acima de 0 logo depois de um acerto, e o crédito implícito, que não grava tentativa, somaria repetições a cada
 * minuto. O segundo mede pelo tempo desde a última tentativa explícita, em intervalos ideais, e vale 1 quando não houve
 * tentativa explícita. É ele que faz o reteste dentro da mesma sessão, logo depois de um erro, contar como prática e
 * quase nada como repetição: o erro derruba a memória e zera o primeiro termo, mas não o segundo.
 */
export function fatorPrecocidade(e: EstadoMemoria, agora: Instante, parametros: Parametros): number {
  const m = memoriaEm(e, agora, parametros)
  const { limiarDevido, tetoMemoria } = parametros
  const pelaMemoria = limitar((tetoMemoria - m) / (tetoMemoria - limiarDevido), 0, 1)
  if (e.ultimaTentativaEm === undefined) return pelaMemoria
  const intervalo = intervaloIdeal(e.numRepeticoes, parametros)
  return Math.min(pelaMemoria, limitar(diasEntre(e.ultimaTentativaEm, agora) / intervalo, 0, 1))
}

/**
 * decay (p. 373): quanto um erro faz recuar, relativo ao avanço de um acerto. Vale 1 com a memória no limiar ou acima
 * (falhar no dia devido não é atraso) e cresce com o logaritmo de quanto a memória caiu abaixo dele, até o teto. Memória
 * zero vale o teto, sem dividir por zero.
 */
export function decaimentoPorAtraso(memoria: number, parametros: Parametros): number {
  const { limiarDevido, kDecaimentoPorAtraso, tetoDecaimentoPorAtraso } = parametros
  if (memoria >= limiarDevido) return 1
  if (memoria <= 0) return tetoDecaimentoPorAtraso
  return Math.min(tetoDecaimentoPorAtraso, 1 + kDecaimentoPorAtraso * Math.log2(limiarDevido / memoria))
}

/**
 * Explícita é a resposta a uma pergunta sobre o próprio tópico; implícita é o crédito ou a penalidade que chega pelo
 * grafo, de uma pergunta sobre outro tópico.
 */
export type OrigemDeRepeticao = 'explicita' | 'implicita'

export type Repeticao = Readonly<{
  /** rawDelta da resposta, antes do desconto por precocidade: positivo no acerto, negativo no erro. */
  deltaBruto: number
  agora: Instante
  velocidade: number
  origem: OrigemDeRepeticao
}>

/**
 * Aplica uma repetição ao estado (p. 373-374):
 *
 *     m             = memoriaEm(e, agora)
 *     delta         = deltaBruto > 0 ? deltaBruto * fatorPrecocidade(e, agora) : deltaBruto
 *     numRepeticoes = max(0, numRepeticoes + velocidade * decaimentoPorAtraso(m) ^ failed * delta)
 *     memoriaBase   = limitar(m + delta, 0, tetoMemoria)
 *
 * `failed` é 1 quando a resposta aplicada agora é erro, e não quando a anterior foi: o decay só multiplica o recuo, e um
 * acerto depois de um erro avança na velocidade normal. Só o acerto é descontado pela precocidade.
 *
 * A memória base passa a ser a memória de agora mais o delta, e por isso `ultimaRepEm` vira `agora` em toda repetição,
 * acerto ou erro, explícita ou implícita: a base nova só vale a partir daqui. `ultimaTentativaEm` muda só na explícita;
 * o crédito implícito não conta como tentativa, senão uma tarefa de grupo descontaria o acerto seguinte de cada membro.
 */
export function aplicarRepeticao(e: EstadoMemoria, repeticao: Repeticao, parametros: Parametros): EstadoMemoria {
  const { deltaBruto, agora, velocidade, origem } = repeticao
  const m = memoriaEm(e, agora, parametros)
  const falhou = deltaBruto < 0 ? 1 : 0
  const delta = deltaBruto > 0 ? deltaBruto * fatorPrecocidade(e, agora, parametros) : deltaBruto
  return {
    ...e,
    numRepeticoes: Math.max(0, e.numRepeticoes + velocidade * decaimentoPorAtraso(m, parametros) ** falhou * delta),
    memoriaBase: limitar(m + delta, 0, parametros.tetoMemoria),
    ultimaRepEm: agora,
    ...(origem === 'explicita' ? { ultimaTentativaEm: agora } : {}),
  }
}

/**
 * Move o vencimento para `dias` depois de `agora`, sem mexer em `numRepeticoes`. Como o vencimento é derivado, o único
 * jeito de movê-lo é trocar a memória base: com base L * (T / L)^(dias / I), a memória chega ao limiar L exatamente em
 * `dias`. Com `dias` acima de um intervalo, a base passa do teto T, e um acerto antecipado não ganha crédito até a
 * memória cair ao teto, porque o fator de precocidade vale 0 enquanto ela estiver acima dele.
 */
export function reagendar(e: EstadoMemoria, agora: Instante, dias: Dias, parametros: Parametros): EstadoMemoria {
  const { limiarDevido, tetoMemoria } = parametros
  const memoriaBase =
    limiarDevido * (tetoMemoria / limiarDevido) ** (dias / intervaloIdeal(e.numRepeticoes, parametros))
  return { ...e, ultimaRepEm: agora, memoriaBase }
}

export const FASES_DE_MEMORIA = ['nao-iniciado', 'aprendendo', 'revisando', 'dominado'] as const
export type FaseDeMemoria = (typeof FASES_DE_MEMORIA)[number]

/**
 * Fase do tópico pela memória: sem repetição nenhuma, não iniciado; depois, pelas faixas de `numRepeticoes` que os
 * parâmetros declaram. A fase "adiado" depende do estado da lição, que esta camada não vê, e fica com a camada `estado`.
 */
export function fase(e: EstadoMemoria, parametros: Parametros): FaseDeMemoria {
  if (e.ultimaRepEm === undefined) return 'nao-iniciado'
  if (e.numRepeticoes < parametros.numRepeticoesSaiDoAprendizado) return 'aprendendo'
  if (e.numRepeticoes < parametros.numRepeticoesDominado) return 'revisando'
  return 'dominado'
}
