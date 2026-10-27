/**
 * O que o armazenamento enxerga de um evento: o id, o tipo, o instante e o aparelho. O resto do objeto é opaco e volta
 * como foi gravado. A casca valida só o envelope e une eventos remotos no armazenamento local sem passar pelo leitor do
 * núcleo, por isso a interface fala de envelope; todo `Evento` é um `EnvelopeDeEvento`.
 */
export type EnvelopeDeEvento = Readonly<{ id: string; tipo: string; em: number; dispositivo: string }>

/**
 * O log de eventos de um aparelho, só de inserção. O IndexedDB da casca e a fake em memória o implementam, e as duas
 * passam pela mesma suíte de contrato, em `apoio-a-testes/contrato-de-armazenamento.ts`.
 *
 * - `anexar` é idempotente por id: um id já gravado, nesta chamada ou numa anterior, fica com o primeiro conteúdo, mesmo
 *   que o novo seja diferente.
 * - `ler` devolve na ordem de `compararEventos`. Com `desde`, só os eventos depois do par `(em, id)` dado, exclusivo: só
 *   o par é cursor sem ambiguidade quando dois aparelhos gravam no mesmo instante.
 * - Nada se apaga; `contar` é o tamanho de `ler()`.
 */
export interface ArmazenamentoDeEventos {
  anexar(eventos: readonly EnvelopeDeEvento[]): Promise<void>
  ler(desde?: Readonly<{ em: number; id: string }>): Promise<readonly EnvelopeDeEvento[]>
  contar(): Promise<number>
}
