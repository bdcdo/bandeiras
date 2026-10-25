/**
 * Tipo nominal sobre um tipo estrutural: `Marca<string, 'IdItem'>` continua sendo uma string em runtime, mas o
 * compilador não aceita uma string qualquer onde se pede `IdItem`, nem um `IdGrupo` no lugar dele.
 *
 * O campo `__marca` nunca existe no objeto; ele só diferencia os tipos. Por isso o valor marcado nasce de um cast
 * explícito (`texto as IdItem`) num ponto único de fronteira, onde a validação acabou de garantir o que a marca promete:
 * `carregarCatalogo` para os ids, o relógio da casca para `Instante`.
 */
export type Marca<T, Nome extends string> = T & { readonly __marca: Nome }
