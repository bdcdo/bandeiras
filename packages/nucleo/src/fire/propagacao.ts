import type { Instante } from '../base/tempo'
import type { Tecnicas } from '../catalogo/tecnicas'
import type { ArestaEncompassing, Grafo } from '../grafo/grafo'
import type { IdTopico } from '../grafo/topico'
import { atualizarAcuracia } from '../memoria/acuracia'
import type { EstadoMemoria } from '../memoria/estado-memoria'
import { limitar } from '../memoria/limitar'
import { aplicarRepeticao } from '../memoria/modelo'
import type { Dificuldade, Parametros } from '../memoria/parametros'
import { ehTopicoLento, velocidade } from '../memoria/velocidade'

// FIRe, Fractional Implicit Repetition (The Math Academy Way, cap. 29, p. 363-367): o acerto num tópico avançado desce
// como repetição implícita aos tópicos que ele encompassa, e o erro num tópico simples sobe como penalidade aos que o
// encompassam. As funções daqui só cuidam dos outros tópicos; a repetição explícita do tópico respondido é de quem chama.

/** O que a propagação lê e não muda: o grafo, os parâmetros, as técnicas, o instante e a dificuldade de cada tópico. */
export type ContextoDePropagacao = Readonly<{
  grafo: Grafo
  parametros: Parametros
  tecnicas: Tecnicas
  agora: Instante
  dificuldade: (topico: IdTopico) => Dificuldade
}>

export type Memorias = ReadonlyMap<IdTopico, EstadoMemoria>

/** O tópico que errou e os ascendentes que a penalidade dele alcançou. */
export type Culpa = ReadonlySet<IdTopico>

type Sentido = 'desce' | 'sobe'

/**
 * Fator com que a propagação chega a cada tópico alcançado a partir de `origem`, sem a própria origem: o maior produto,
 * entre os caminhos que levam até ele, de peso da aresta vezes `passagem` do tópico de chegada. Passagem 0 barra o
 * tópico: ele não recebe nada e não deixa passar para os seguintes, e assim um ramo inteiro se corta.
 *
 * Num grafo em árvore isto é a busca em largura que esmaece a cada camada. Num DAG em que dois caminhos chegam ao mesmo
 * tópico, ele recebe uma vez, pelo caminho mais forte: somar os caminhos daria a um tópico mais de uma repetição pela
 * mesma resposta, e o fator passaria de 1. A ordem topológica do grafo garante que, quando um tópico é lido, todos os
 * caminhos até ele já foram contados, e o resultado não depende da ordem das arestas.
 */
function fatoresAlcancados(
  grafo: Grafo,
  origem: IdTopico,
  sentido: Sentido,
  passagem: (t: IdTopico) => number,
): Map<IdTopico, number> {
  const ordem = sentido === 'desce' ? grafo.ordem : [...grafo.ordem].reverse()
  const arestas = sentido === 'desce' ? grafo.arestasAbaixo : grafo.arestasAcima
  const destino = (a: ArestaEncompassing): IdTopico => (sentido === 'desce' ? a.para : a.de)
  const fatores = new Map<IdTopico, number>([[origem, 1]])
  for (const t of ordem) {
    const chegada = fatores.get(t)
    if (chegada === undefined) continue
    for (const a of arestas.get(t) ?? []) {
      const proximo = destino(a)
      const fator = chegada * a.peso * passagem(proximo)
      if (fator > (fatores.get(proximo) ?? 0)) fatores.set(proximo, fator)
    }
  }
  fatores.delete(origem)
  return fatores
}

/** A repetição implícita e a evidência de acurácia de um tópico alcançado, com o fator do caminho que o alcançou. */
function aplicarImplicita(
  ctx: ContextoDePropagacao,
  e: EstadoMemoria,
  topico: IdTopico,
  deltaBruto: number,
  pesoDaAcuracia: number,
): EstadoMemoria {
  const v = velocidade(e, ctx.dificuldade(topico), ctx.parametros, ctx.tecnicas)
  const repetido = aplicarRepeticao(
    e,
    { deltaBruto, agora: ctx.agora, velocidade: v, origem: 'implicita' },
    ctx.parametros,
  )
  return atualizarAcuracia(repetido, deltaBruto > 0, pesoDaAcuracia, ctx.parametros)
}

export type Credito = Readonly<{
  origem: IdTopico
  /** rawDelta do acerto na origem. Só delta positivo desce. */
  deltaBruto: number
  /**
   * Fator de exposição de cada tópico na tarefa, em [0, 1]: 1 para o que a pergunta mostrou como alvo, menos para o que
   * só apareceu, 0 para o que não apareceu. Valor fora de [0, 1] é trazido para dentro.
   */
  exposicao: (topico: IdTopico) => number
}>

/**
 * Crédito implícito de um acerto, descendo pelos tópicos que a origem encompassa. Cada descendente alcançado recebe uma
 * repetição implícita com `deltaBruto * fator`, em que o fator é o produto de peso e exposição pelo caminho mais forte
 * (ver `fatoresAlcancados`), e uma evidência de acerto na acurácia com `forcaAcuraciaImplicita` vezes o fator: o acerto
 * desce com meia força (p. 370).
 *
 * Exposição 0 corta o ramo. Tópico lento (p. 263-264) também: ele recusa crédito implícito e só melhora por revisão
 * explícita. Tópico sem estado no mapa nunca foi estudado e também não recebe nem passa adiante.
 *
 * Com `fire` desligado, ou com delta que não é positivo, devolve o próprio mapa.
 */
export function propagarCredito(ctx: ContextoDePropagacao, memorias: Memorias, credito: Credito): Memorias {
  const { parametros, tecnicas } = ctx
  if (!tecnicas.fire || !(credito.deltaBruto > 0)) return memorias
  const fatores = fatoresAlcancados(ctx.grafo, credito.origem, 'desce', (t) => {
    const e = memorias.get(t)
    if (e === undefined || ehTopicoLento(e, ctx.dificuldade(t), parametros, tecnicas)) return 0
    return limitar(credito.exposicao(t), 0, 1)
  })
  const novas = new Map(memorias)
  for (const [t, fator] of fatores) {
    const e = memorias.get(t)
    if (e === undefined) continue
    novas.set(t, aplicarImplicita(ctx, e, t, credito.deltaBruto * fator, parametros.forcaAcuraciaImplicita * fator))
  }
  return novas
}

export type Penalidade = Readonly<{
  origem: IdTopico
  /** rawDelta do erro na origem. Só delta negativo sobe. */
  deltaBruto: number
  /**
   * Ascendentes que podem ser penalizados. Na camada `estado`, são os de lição concluída ou concluída condicionalmente:
   * tópico que ainda não foi aprendido não tem repetição a perder.
   */
  elegiveis: ReadonlySet<IdTopico>
  /** Ascendentes que não recebem esta penalidade, como o grupo de uma tarefa de grupo, que recebe a própria evidência. */
  excluir?: ReadonlySet<IdTopico>
}>

export type ResultadoDePenalidade = Readonly<{
  memorias: Memorias
  culpa: Culpa
  /** Ascendentes penalizados que estavam concluídos por inferência do diagnóstico e voltam à fila de lições. */
  condicionaisPenalizados: readonly IdTopico[]
}>

/** Delta e peso de acurácia que a penalidade de cada ascendente recebe, antes de aplicada. */
type PenalidadePlanejada = { deltaBruto: number; fator: number }

/**
 * Penalidade que cada ascendente elegível de `origem` receberia, pelo caminho mais forte: `deltaBruto * fator`, com o
 * fator só de pesos (a exposição não entra; o erro no tópico simples mostra o que falta ao avançado, esteja ele na tela ou
 * não). Ascendente fora dos elegíveis, excluído ou sem estado não recebe, mas a penalidade passa por ele até os de cima.
 */
export function planejarPenalidade(
  ctx: ContextoDePropagacao,
  memorias: Memorias,
  penalidade: Penalidade,
): Map<IdTopico, PenalidadePlanejada> {
  const planejadas = new Map<IdTopico, PenalidadePlanejada>()
  if (!ctx.tecnicas.fire || !(penalidade.deltaBruto < 0)) return planejadas
  for (const [t, fator] of fatoresAlcancados(ctx.grafo, penalidade.origem, 'sobe', () => 1)) {
    const recebe = penalidade.elegiveis.has(t) && penalidade.excluir?.has(t) !== true && memorias.has(t)
    if (recebe) planejadas.set(t, { deltaBruto: penalidade.deltaBruto * fator, fator })
  }
  return planejadas
}

/**
 * Aplica penalidades já planejadas: uma repetição implícita negativa e uma evidência de erro na acurácia com peso igual ao
 * fator do caminho. A culpa e os condicionais saem na ordem topológica do grafo, para não dependerem da ordem em que as
 * origens e o plano chegaram; origem fora do grafo, que não alcança ninguém, vai no fim.
 */
export function aplicarPenalidades(
  ctx: ContextoDePropagacao,
  memorias: Memorias,
  origens: readonly IdTopico[],
  planejadas: ReadonlyMap<IdTopico, PenalidadePlanejada>,
): ResultadoDePenalidade {
  const novas = new Map(memorias)
  const condicionais = new Set<IdTopico>()
  for (const [t, { deltaBruto, fator }] of planejadas) {
    const e = memorias.get(t)
    if (e === undefined) continue
    if (e.condicional) condicionais.add(t)
    novas.set(t, aplicarImplicita(ctx, e, t, deltaBruto, fator))
  }
  const culpados = new Set([...origens, ...planejadas.keys()])
  const foraDoGrafo = [...culpados].filter((t) => !ctx.grafo.topicos.has(t))
  return {
    memorias: novas,
    culpa: new Set([...ctx.grafo.ordem.filter((t) => culpados.has(t)), ...foraDoGrafo]),
    condicionaisPenalizados: ctx.grafo.ordem.filter((t) => condicionais.has(t)),
  }
}

/**
 * Penalidade implícita de um erro, subindo pelos tópicos que encompassam a origem (p. 364-365): cada ascendente
 * elegível alcançado recebe uma repetição implícita com `deltaBruto * fator`, o fator sendo o produto dos pesos pelo
 * caminho mais forte, e uma evidência de erro na acurácia com o mesmo fator como peso. A penalidade nunca desce, e o
 * tópico lento recebe como qualquer outro: o corte por lentidão vale só para crédito.
 *
 * Devolve a culpa (a origem e os ascendentes penalizados) e quais deles estavam concluídos condicionalmente, para a
 * camada `estado` devolvê-los à fila de lições. Com `fire` desligado, ou com delta que não é negativo, o mapa volta
 * intacto e a culpa é só a origem.
 */
export function propagarPenalidade(
  ctx: ContextoDePropagacao,
  memorias: Memorias,
  penalidade: Penalidade,
): ResultadoDePenalidade {
  if (!ctx.tecnicas.fire || !(penalidade.deltaBruto < 0)) {
    return { memorias, culpa: new Set([penalidade.origem]), condicionaisPenalizados: [] }
  }
  return aplicarPenalidades(ctx, memorias, [penalidade.origem], planejarPenalidade(ctx, memorias, penalidade))
}
