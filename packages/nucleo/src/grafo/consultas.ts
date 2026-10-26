import type { ArestaEncompassing, Grafo } from './grafo'
import type { IdTopico } from './topico'

/** Busca em largura a partir de `t` por um dos dois índices de arestas, sem o próprio `t`, na ordem em que se alcança. */
function fecho(
  arestas: ReadonlyMap<IdTopico, readonly ArestaEncompassing[]>,
  t: IdTopico,
  vizinho: (a: ArestaEncompassing) => IdTopico,
): ReadonlySet<IdTopico> {
  const alcancados = new Set<IdTopico>()
  const fila: IdTopico[] = [t]
  for (let i = 0; i < fila.length; i++) {
    for (const a of arestas.get(fila[i] as IdTopico) ?? []) {
      const proximo = vizinho(a)
      if (proximo !== t && !alcancados.has(proximo)) {
        alcancados.add(proximo)
        fila.push(proximo)
      }
    }
  }
  return alcancados
}

/** Tópicos que `t` encompassa, direta ou indiretamente: por onde o crédito de um acerto em `t` desce. */
export function fechoDescendente(grafo: Grafo, t: IdTopico): ReadonlySet<IdTopico> {
  return fecho(grafo.arestasAbaixo, t, (a) => a.para)
}

/** Tópicos que encompassam `t`, direta ou indiretamente: por onde a penalidade de um erro em `t` sobe. */
export function fechoAscendente(grafo: Grafo, t: IdTopico): ReadonlySet<IdTopico> {
  return fecho(grafo.arestasAcima, t, (a) => a.de)
}

/**
 * Pré-requisitos de `t`: os tópicos que ele encompassa diretamente. Um grupo tem os membros; um item não tem nenhum. A
 * discriminação de um grupo só faz sentido depois que cada membro foi aprendido, e por isso encompassar e exigir são a
 * mesma aresta.
 */
export function preRequisitos(grafo: Grafo, t: IdTopico): readonly IdTopico[] {
  return (grafo.arestasAbaixo.get(t) ?? []).map((a) => a.para)
}

/**
 * Tópicos ainda não concluídos cujos pré-requisitos estão todos concluídos, na ordem em que o grafo os recebeu. É a
 * fronteira só pelo grafo: o bloqueio por não-interferência, as cotas de lição e a ordem das vagas são da camada
 * `compressao`, que parte desta lista.
 */
export function fronteira(grafo: Grafo, concluidos: ReadonlySet<IdTopico>): readonly IdTopico[] {
  return [...grafo.topicos.keys()].filter(
    (t) => !concluidos.has(t) && preRequisitos(grafo, t).every((p) => concluidos.has(p)),
  )
}
