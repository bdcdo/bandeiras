import type { Parametros, QualidadeDeResposta } from '../memoria'

const chutes = (qualidades: readonly QualidadeDeResposta[]): number => qualidades.filter((q) => q === 'chute').length

/**
 * A tarefa foi feita no chute de propósito: `chutesNaTarefaSistematico` chutes nela, ou `chutesNasUltimasSistematico`
 * entre as `janelaChuteSistematico` respostas mais recentes, contadas as da tarefa. É o que aciona a penalidade de XP
 * (The Math Academy Way, p. 313-314): um chute isolado é distração, e a penalidade mira quem chuta para acumular XP sem
 * esforço.
 *
 * `ultimasQualidades` são as respostas anteriores à tarefa, da mais antiga para a mais recente; a janela se mede sobre
 * elas seguidas das da tarefa, e termina na última resposta dela.
 */
export function chuteSistematico(
  qualidadesDaTarefa: readonly QualidadeDeResposta[],
  ultimasQualidades: readonly QualidadeDeResposta[],
  parametros: Parametros,
): boolean {
  if (chutes(qualidadesDaTarefa) >= parametros.chutesNaTarefaSistematico) return true
  const janela = [...ultimasQualidades, ...qualidadesDaTarefa].slice(-parametros.janelaChuteSistematico)
  return chutes(janela) >= parametros.chutesNasUltimasSistematico
}
