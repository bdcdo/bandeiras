// planejarPenalidade e aplicarPenalidades ficam de fora: são as duas metades de propagarPenalidade que a tarefa de grupo
// recompõe, e quem está fora da camada chama a função inteira.
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
export * from './tarefa-de-grupo'
