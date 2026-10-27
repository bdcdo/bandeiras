// O rascunho, a redução de um evento e os efeitos de memória e de tarefa ficam de fora: são o caminho único por dentro de
// `reduzir` e `reconstruir`, e quem está fora muda o estado só por elas, por `iniciarPerfil` e por `emitir`.
export { chaveDePar } from './confusoes'
export { metaDoDia, statusDaLicao } from './consultas'
export { criarContextoDeReducao, type ContextoDeReducao } from './contexto'
export { emitir, iniciarPerfil, type Origem } from './emitir'
export { conferirInvariantes } from './invariantes'
export { reconstruir } from './reconstruir'
export { estadoDoPerfil, reduzir } from './reduzir'
export { sorteioDoEstado } from './sorteio'
export type * from './tipos'
export { ESTADOS_DO_DIAGNOSTICO, MOTIVOS_DE_ABSORCAO } from './tipos'
