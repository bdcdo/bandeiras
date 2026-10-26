// chaveDeOpcoes e criarQuestao ficam de fora: são o formato interno do contexto e do id, que só esta camada monta.
export {
  contextoDeSessao,
  registrarApresentacao,
  registrarLicaoConcluida,
  registrarQuestao,
  type ContextoDeSessao,
} from './contexto-de-sessao'
export * from './distratores'
export * from './gerar-questao'
export * from './pares'
export {
  direcaoDoFormato,
  FORMATOS_DE_QUESTAO,
  opcoesDe,
  TIPOS_DE_TAREFA,
  type ContextoDeQuestao,
  type ErroDeQuestao,
  type FormatoDeQuestao,
  type Questao,
  type TipoDeFormato,
  type TipoDeTarefa,
} from './questao'
export * from './tarefa-de-grupo'
