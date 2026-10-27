// planejarPenalidade e aplicarPenalidades ficam de fora: são as duas metades de propagarPenalidade que a tarefa de grupo
// recompõe, e quem está fora da camada chama a função inteira. A repetição explícita de explicita.ts também fica: quem
// está fora aplica uma resposta inteira, isolada ou de tarefa de grupo.
export {
  propagarCredito,
  propagarPenalidade,
  type ContextoDePropagacao,
  type Credito,
  type Culpa,
  type Memorias,
  type Penalidade,
  type ResultadoDePenalidade,
} from './propagacao'
export { aplicarRespostaIsolada, type RespostaIsolada } from './resposta-isolada'
export * from './tarefa-de-grupo'
