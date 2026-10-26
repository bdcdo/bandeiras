import { erro, ok, type Resultado } from '../base/resultado'
import type { Tecnicas } from '../catalogo/tecnicas'
import type { Catalogo } from '../catalogo/tipos'
import { topicoDeGrupo, topicoDeItem, type IdTopico, type Topico } from './topico'

/**
 * Aresta de encompassing, do tópico avançado (`de`) para o tópico que ele exercita (`para`). O peso é a fração do tópico
 * simples praticada no avançado (The Math Academy Way, p. 366): 1 é encompassing total, e um peso menor faz o crédito
 * esmaecer ao descer.
 */
export type ArestaEncompassing = { de: IdTopico; para: IdTopico; peso: number }

// Membro privado que o spread não copia, como em Catalogo: só montarGrafo produz um Grafo, e quem tem um tem a garantia
// de que toda aresta liga tópicos existentes com peso válido e de que não há ciclo.
declare class MarcaDeGrafo {
  private readonly validado: true
}

/**
 * Grafo de tópicos validado. As arestas ficam indexadas nos dois sentidos, para o crédito descer e a penalidade subir sem
 * varrer a lista inteira. `ordem` é topológica: todo tópico vem antes dos que ele encompassa, e entre tópicos sem
 * relação vale a ordem em que foram dados.
 */
export type Grafo = {
  topicos: ReadonlyMap<IdTopico, Topico>
  /** Arestas que saem de cada tópico, para os que ele encompassa. Todo tópico tem entrada, vazia se não encompassa nada. */
  arestasAbaixo: ReadonlyMap<IdTopico, readonly ArestaEncompassing[]>
  /** Arestas que chegam a cada tópico, dos que o encompassam. */
  arestasAcima: ReadonlyMap<IdTopico, readonly ArestaEncompassing[]>
  ordem: readonly IdTopico[]
} & MarcaDeGrafo

export type CodigoDeErroDeGrafo =
  'TOPICO_REPETIDO' | 'ARESTA_COM_TOPICO_INEXISTENTE' | 'ARESTA_REPETIDA' | 'PESO_INVALIDO' | 'GRAFO_CICLICO'

export type ErroDeGrafo = { codigo: CodigoDeErroDeGrafo; detalhe: string }

const aspas = (texto: string): string => `'${texto}'`
const descrever = (a: ArestaEncompassing): string => `${aspas(a.de)} -> ${aspas(a.para)}`

/** Cada valor que aparece mais de uma vez, uma vez só, na ordem da primeira repetição. */
function repetidos(valores: readonly string[]): string[] {
  const vistos = new Set<string>()
  const achados = new Set<string>()
  for (const valor of valores) {
    if (vistos.has(valor)) achados.add(valor)
    vistos.add(valor)
  }
  return [...achados]
}

/**
 * Valida os tópicos e as arestas e monta o grafo. Genérico: aceita qualquer DAG de tópicos, e não só o de grupos sobre
 * itens que `construirGrafo` produz.
 *
 * As verificações vão em ordem, e a primeira violada é a que se relata, com todas as ocorrências dela no `detalhe`:
 * tópico repetido, aresta para tópico que não existe, aresta repetida, peso inválido e ciclo. A ordem importa porque cada
 * uma pressupõe as anteriores; com aresta para tópico inexistente, por exemplo, nem dá para dizer se há ciclo.
 *
 * O peso precisa ser finito e estar em (0, 1]. O livro define o peso como fração (p. 366), e um peso acima de 1 faria o
 * crédito implícito de um tópico passar o explícito que o originou. Aresta repetida é recusada em vez de somada, porque
 * duas arestas entre o mesmo par não dizem qual peso vale.
 */
export function montarGrafo(
  topicos: readonly Topico[],
  arestas: readonly ArestaEncompassing[],
): Resultado<Grafo, ErroDeGrafo> {
  const topicosRepetidos = repetidos(topicos.map((t) => t.id))
  if (topicosRepetidos.length > 0) {
    return erro({ codigo: 'TOPICO_REPETIDO', detalhe: `tópico repetido: ${topicosRepetidos.map(aspas).join('; ')}` })
  }
  const porId = new Map(topicos.map((t) => [t.id, t]))

  const quebradas = arestas.filter((a) => !porId.has(a.de) || !porId.has(a.para))
  if (quebradas.length > 0) {
    return erro({
      codigo: 'ARESTA_COM_TOPICO_INEXISTENTE',
      detalhe: `aresta com tópico que não existe: ${quebradas.map(descrever).join('; ')}`,
    })
  }

  // O par vira chave por JSON, e não pela descrição legível, para dois pares distintos nunca darem o mesmo texto quando um
  // id contém a própria seta.
  const arestasRepetidas = repetidos(arestas.map((a) => JSON.stringify([a.de, a.para])))
  if (arestasRepetidas.length > 0) {
    const descricoes = arestasRepetidas.map((chave) => {
      const [de, para] = JSON.parse(chave) as [IdTopico, IdTopico]
      return descrever({ de, para, peso: 0 })
    })
    return erro({ codigo: 'ARESTA_REPETIDA', detalhe: `aresta repetida: ${descricoes.join('; ')}` })
  }

  const pesosInvalidos = arestas.filter((a) => !(Number.isFinite(a.peso) && a.peso > 0 && a.peso <= 1))
  if (pesosInvalidos.length > 0) {
    return erro({
      codigo: 'PESO_INVALIDO',
      detalhe: `peso fora de (0, 1]: ${pesosInvalidos.map((a) => `${descrever(a)} = ${String(a.peso)}`).join('; ')}`,
    })
  }

  const arestasAbaixo = new Map<IdTopico, ArestaEncompassing[]>(topicos.map((t) => [t.id, []]))
  const arestasAcima = new Map<IdTopico, ArestaEncompassing[]>(topicos.map((t) => [t.id, []]))
  for (const a of arestas) {
    arestasAbaixo.get(a.de)?.push({ ...a })
    arestasAcima.get(a.para)?.push({ ...a })
  }

  const ordem = ordemTopologica(topicos, arestasAbaixo, arestasAcima)
  if (ordem.length < topicos.length) {
    const ciclo = umCiclo(topicos, new Set(ordem), arestasAcima)
    return erro({ codigo: 'GRAFO_CICLICO', detalhe: `ciclo: ${ciclo.map(aspas).join(' -> ')}` })
  }

  const campos: Pick<Grafo, keyof Grafo> = { topicos: porId, arestasAbaixo, arestasAcima, ordem }
  return ok(campos as Grafo)
}

/**
 * Algoritmo de Kahn: sai primeiro quem nenhum tópico encompassa, e cada tópico sai quando todos os que o encompassam já
 * saíram. A fila anda na ordem em que os tópicos foram dados, o que torna a ordem determinística. Tópico preso num ciclo
 * nunca chega a zero aresta de entrada pendente e fica de fora, e é assim que o ciclo se detecta.
 */
function ordemTopologica(
  topicos: readonly Topico[],
  arestasAbaixo: ReadonlyMap<IdTopico, readonly ArestaEncompassing[]>,
  arestasAcima: ReadonlyMap<IdTopico, readonly ArestaEncompassing[]>,
): IdTopico[] {
  const pendentes = new Map(topicos.map((t) => [t.id, arestasAcima.get(t.id)?.length ?? 0]))
  const ordem = topicos.filter((t) => pendentes.get(t.id) === 0).map((t) => t.id)
  for (let i = 0; i < ordem.length; i++) {
    const atual = ordem[i] as IdTopico
    for (const a of arestasAbaixo.get(atual) ?? []) {
      const restantes = (pendentes.get(a.para) ?? 0) - 1
      pendentes.set(a.para, restantes)
      if (restantes === 0) ordem.push(a.para)
    }
  }
  return ordem
}

/**
 * Um ciclo entre os tópicos que a ordenação deixou de fora, no sentido das arestas e com o primeiro tópico repetido no
 * fim. Todo tópico que ficou de fora tem aresta de entrada vinda de outro que também ficou, senão teria saído; subir por
 * essas arestas a partir de qualquer um deles acaba repetindo um tópico, e o trecho entre as duas visitas é um ciclo.
 */
function umCiclo(
  topicos: readonly Topico[],
  ordenados: ReadonlySet<IdTopico>,
  arestasAcima: ReadonlyMap<IdTopico, readonly ArestaEncompassing[]>,
): IdTopico[] {
  const presos = topicos.map((t) => t.id).filter((id) => !ordenados.has(id))
  const caminho: IdTopico[] = []
  const posicao = new Map<IdTopico, number>()
  let atual = presos[0]
  while (atual !== undefined && !posicao.has(atual)) {
    posicao.set(atual, caminho.length)
    caminho.push(atual)
    atual = arestasAcima.get(atual)?.find((a) => !ordenados.has(a.de))?.de
  }
  if (atual === undefined) return caminho
  // O caminho subiu pelas arestas, do encompassado para quem o encompassa; invertido, fica no sentido delas.
  const ciclo = caminho.slice(posicao.get(atual)).reverse()
  return [...ciclo, ciclo[0] ?? atual]
}

/**
 * Grafo de um catálogo: um tópico por item, na ordem do catálogo, e, com a técnica `grupos` ligada, um tópico por grupo
 * com uma aresta para cada membro, de peso `pesos[membro]` ou 1. Com `grupos` desligada, só os tópicos de item e nenhuma
 * aresta: os grupos do catálogo continuam servindo a distratores e à dificuldade a priori, mas não viram tópico.
 *
 * O resultado passa por `montarGrafo` como qualquer outro. Um catálogo carregado já garante membros existentes e pesos
 * positivos, e grupo só encompassa item, então não há ciclo; o que pode falhar é um peso acima de 1, que o catálogo aceita
 * e o grafo não.
 */
export function construirGrafo(catalogo: Catalogo, tecnicas: Tecnicas): Resultado<Grafo, ErroDeGrafo> {
  const topicosDeItem = [...catalogo.itens.keys()].map(topicoDeItem)
  if (!tecnicas.grupos) return montarGrafo(topicosDeItem, [])
  const grupos = [...catalogo.grupos.values()]
  // Object.hasOwn, e não indexação direta, porque um id de item pode coincidir com uma chave herdada de
  // Object.prototype (`constructor`), e aí o peso viraria uma função.
  const peso = (pesos: Readonly<Record<string, number>> | undefined, membro: string): number =>
    pesos !== undefined && Object.hasOwn(pesos, membro) ? (pesos[membro] ?? 1) : 1
  const arestas = grupos.flatMap((g) =>
    g.membros.map((membro): ArestaEncompassing => ({
      de: topicoDeGrupo(g.id).id,
      para: topicoDeItem(membro).id,
      peso: peso(g.pesos, membro),
    })),
  )
  return montarGrafo([...topicosDeItem, ...grupos.map((g) => topicoDeGrupo(g.id))], arestas)
}
