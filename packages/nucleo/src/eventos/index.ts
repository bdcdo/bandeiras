// lerEnvelope e lerEventoSemId ficam de fora: são etapas do leitor que a reconstrução e criarEvento usam por dentro do
// núcleo. Quem está fora lê o evento inteiro.
export * from './armazenamento'
export * from './armazenamento-em-memoria'
export { criarEvento, idDeEvento, idDeTarefa, type ErroDeLeitura } from './id'
export { lerEvento, type ProblemaDeLeitura } from './ler-evento'
export * from './ordem'
export { textoSeguroParaLog } from './texto-seguro'
export type * from './tipos'
export {
  MOTIVOS_DE_FIM_DE_SESSAO,
  MOTIVOS_DE_FIM_DO_DIAGNOSTICO,
  MOTIVOS_DE_REMEDIACAO,
  TIPOS_DE_EVENTO,
} from './tipos'
export * from './versao'
