/**
 * XP que entra no dia quando a tarefa não se conclui, pela lição adiada ou pela tarefa interrompida, dado o XP que as
 * respostas ligadas até ali valeriam. Decisão do mantenedor: `min(0, xp)`. A tarefa não concluída não ganha XP, mas o
 * chute sistemático tira, até o piso do dia.
 *
 * O livro criou a penalidade para quem responde ao acaso para sair reprovado da tarefa difícil (The Math Academy Way,
 * p. 312-313); com XP zero na tarefa reprovada, esse caminho sairia de graça. A alternativa descartada era 0 sempre;
 * trocar a regra é mudar só esta função e o caso de teste que a fixa.
 */
export function xpDeTarefaNaoConcluida(xp: number): number {
  return Math.min(0, xp)
}
