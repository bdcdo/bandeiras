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
 *
 * A janela só conta quando a tarefa tem ao menos um chute. Sem essa condição, três chutes antigos tirariam o XP de cada
 * tarefa feita com esforço até saírem da janela, e os mesmos chutes seriam cobrados de novo em cada uma. Quem chuta uma
 * vez por tarefa, de tarefa em tarefa, continua pego pela janela.
 */
export function chuteSistematico(
  qualidadesDaTarefa: readonly QualidadeDeResposta[],
  ultimasQualidades: readonly QualidadeDeResposta[],
  parametros: Parametros,
): boolean {
  const naTarefa = chutes(qualidadesDaTarefa)
  if (naTarefa === 0) return false
  if (naTarefa >= parametros.chutesNaTarefaSistematico) return true
  const janela = [...ultimasQualidades, ...qualidadesDaTarefa].slice(-parametros.janelaChuteSistematico)
  return chutes(janela) >= parametros.chutesNasUltimasSistematico
}
