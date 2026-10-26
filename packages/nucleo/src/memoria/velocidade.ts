import type { Tecnicas } from '../catalogo/tecnicas'
import type { EstadoMemoria } from './estado-memoria'
import { limitar } from './limitar'
import type { Dificuldade, Parametros } from './parametros'

/**
 * speed do aluno no tópico (The Math Academy Way, p. 370): a razão entre o ganho pela habilidade e a perda pela dificuldade. A habilidade é a
 * acurácia recente no próprio tópico, comparada com a neutra; a dificuldade é a do tópico. Com `velocidadeAdaptativa`
 * desligada, todo tópico anda na velocidade 1.
 *
 *     aceleracao = limitar(1 + ganhoAceleracao * (acuracia - acuraciaNeutra), aceleracaoMin, aceleracaoMax)
 *     velocidade = limitar(aceleracao / desaceleracaoPorDificuldade[dificuldade], velocidadeMin, velocidadeMax)
 */
export function velocidade(
  e: EstadoMemoria,
  dificuldade: Dificuldade,
  parametros: Parametros,
  tecnicas: Tecnicas,
): number {
  if (!tecnicas.velocidadeAdaptativa) return 1
  const { ganhoAceleracao, acuraciaNeutra, aceleracaoMin, aceleracaoMax, velocidadeMin, velocidadeMax } = parametros
  const aceleracao = limitar(1 + ganhoAceleracao * (e.acuracia - acuraciaNeutra), aceleracaoMin, aceleracaoMax)
  return limitar(aceleracao / parametros.desaceleracaoPorDificuldade[dificuldade], velocidadeMin, velocidadeMax)
}

/**
 * Tópico lento (p. 263-264): velocidade abaixo do limiar. Ele só recebe revisão explícita e recusa crédito implícito,
 * porque quem ainda erra o tópico sozinho não mostra que o sabe ao acertar um tópico que o contém. Com
 * `velocidadeAdaptativa` desligada, nenhum tópico é lento, mesmo que o limiar passe de 1.
 */
export function ehTopicoLento(
  e: EstadoMemoria,
  dificuldade: Dificuldade,
  parametros: Parametros,
  tecnicas: Tecnicas,
): boolean {
  return (
    tecnicas.velocidadeAdaptativa && velocidade(e, dificuldade, parametros, tecnicas) < parametros.limiarTopicoLento
  )
}
