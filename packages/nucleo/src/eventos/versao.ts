/**
 * Versão da união de eventos, gravada só nos eventos que abrem perfil e copiada para o estado. Sobe quando a união muda
 * depois de publicada; a calibração dos parâmetros não a muda, porque vale para o passado inteiro do log.
 *
 * Na reconstrução, um perfil de versão maior que esta é de um app mais novo, e o aparelho pede atualização em vez de
 * tratar o log como corrompido. Versão menor reconstrói sob o redutor atual, que a evolução só por adição mantém
 * compatível (ver `eventos/tipos.ts`).
 */
export const VERSAO_MODELO = 1
