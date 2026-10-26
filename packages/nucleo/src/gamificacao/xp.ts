import type { Tecnicas } from '../catalogo/tecnicas'
import { chuteSistematico, medianaDoFormato, type Avaliacao, type NormasDeLatencia } from '../avaliacao'
import type { Parametros, QualidadeDeResposta } from '../memoria'
import type { Questao, TipoDeTarefa } from '../questoes'

const MILIS_POR_MINUTO = 60_000

/** O que o XP lê de uma tarefa: o tipo, se a lição foi acelerada e as questões que ela fez. */
export type TarefaParaXp = Readonly<{ tipo: TipoDeTarefa; acelerada?: boolean; questoes: readonly Questao[] }>

/**
 * Minutos de trabalho que a tarefa vale antes do desempenho. O XP é calibrado em minutos de trabalho focado (The Math
 * Academy Way, p. 310): a lição vale os minutos dela, a acelerada menos; as outras tarefas somam por questão. Com amostras
 * bastantes nas normas do formato, a questão vale o tempo que a própria pessoa leva nele, a mediana, mais a folga de ler
 * o feedback; sem elas, os minutos por questão da média.
 */
function minutosBase(tarefa: TarefaParaXp, normas: NormasDeLatencia, parametros: Parametros): number {
  if (tarefa.tipo === 'licao')
    return tarefa.acelerada === true ? parametros.minutosLicaoAcelerada : parametros.minutosLicao
  return tarefa.questoes.reduce((soma, questao) => {
    const mediana = medianaDoFormato(normas, questao.formato.tipo, parametros)
    const minutos =
      mediana === undefined
        ? parametros.minutosPorQuestao
        : (mediana + parametros.folgaSobreMedianaMs) / MILIS_POR_MINUTO
    return soma + minutos
  }, 0)
}

/**
 * Multiplicador pelo desempenho na tarefa, nas faixas do livro (p. 312): bônus para a tarefa perfeita, XP cheio a partir
 * de quase perfeita, parte dele na passável e nada abaixo da barra. O chute sistemático vem antes e tira XP (p. 313-314):
 * sem penalidade, chutar rende XP sem esforço.
 */
function multiplicador(
  avaliacoes: readonly Avaliacao[],
  ultimasQualidades: readonly QualidadeDeResposta[],
  parametros: Parametros,
): number {
  if (
    chuteSistematico(
      avaliacoes.map((a) => a.qualidade),
      ultimasQualidades,
      parametros,
    )
  ) {
    return parametros.multiplicadorXpChute
  }
  const acerto = avaliacoes.filter((a) => a.correta).length / avaliacoes.length
  if (acerto === 1) return parametros.multiplicadorXpPerfeita
  if (acerto >= parametros.acertoMinimoXpCheio) return parametros.multiplicadorXpCheio
  if (acerto >= parametros.acertoMinimoXpParcial) return parametros.multiplicadorXpParcial
  return parametros.multiplicadorXpInsuficiente
}

/**
 * XP da tarefa concluída: os minutos-base vezes o multiplicador do desempenho. Pode ser negativo, no chute sistemático;
 * quem soma ao dia é `somarXpDoDia`, que não deixa o dia abaixo de zero.
 *
 * Vale 0 com a técnica `gamificacao` desligada, no diagnóstico, que mede sem ensinar, e na tarefa sem resposta avaliada.
 * A remediação conta como revisão, por questão. `ultimasQualidades` são as respostas anteriores à tarefa, da mais antiga
 * para a mais recente, como em `chuteSistematico`.
 */
export function xpDaTarefa(
  tarefa: TarefaParaXp,
  avaliacoes: readonly Avaliacao[],
  ultimasQualidades: readonly QualidadeDeResposta[],
  normas: NormasDeLatencia,
  parametros: Parametros,
  tecnicas: Tecnicas,
): number {
  if (!tecnicas.gamificacao || tarefa.tipo === 'diagnostico' || avaliacoes.length === 0) return 0
  return minutosBase(tarefa, normas, parametros) * multiplicador(avaliacoes, ultimasQualidades, parametros)
}
