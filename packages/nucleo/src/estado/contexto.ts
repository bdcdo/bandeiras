import { ok, type Resultado } from '../base/resultado'
import type { Tecnicas } from '../catalogo/tecnicas'
import type { Catalogo } from '../catalogo/tipos'
import {
  construirGrafo,
  fechoAscendente,
  fechoDescendente,
  topicoDeGrupo,
  topicoDeItem,
  type ErroDeGrafo,
  type Grafo,
  type IdTopico,
} from '../grafo'
import type { Dificuldade, Parametros } from '../memoria'

/**
 * O que a redução lê e não vem do log: o catálogo, o grafo, as técnicas e os parâmetros, que o motor recebe ao ser
 * criado, e a dificuldade de cada tópico. Fora deste contexto, o estado é função só do log. Não há fuso aqui: todo dia
 * local da redução sai do fuso gravado no próprio evento, para reconstruir em outro fuso não mudar um dia passado.
 */
export type ContextoDeReducao = Readonly<{
  catalogo: Catalogo
  grafo: Grafo
  tecnicas: Tecnicas
  parametros: Parametros
  dificuldade: (topico: IdTopico) => Dificuldade
  /**
   * O tópico e os fechos ascendente e descendente dele, sem repetição: tudo o que uma função de fire/ que parte dele pode
   * ler ou escrever, porque a propagação só anda por aresta. Uso interno da redução, que passa a fire/ só essas memórias
   * (`submapa`); tópico fora do grafo alcança só a si mesmo.
   */
  alcance: (topico: IdTopico) => readonly IdTopico[]
}>

// Dificuldade de um tópico que o catálogo não conhece. Ele nunca chega à memória, porque o redutor absorve a referência,
// mas a função precisa ser total; 2 é o meio da escala, em que a velocidade com a acurácia neutra vale 1.
const DIFICULDADE_NEUTRA: Dificuldade = 2

/**
 * Monta o contexto, com o grafo do catálogo sob as técnicas. A dificuldade de um tópico de item é a a priori do item; a
 * de um tópico de grupo, que o catálogo não dá, é a do membro mais difícil, porque discriminar os membros é tão difícil
 * quanto o mais difícil deles. A tabela sai pronta daqui, uma vez por contexto, e a compressão e o planejador leem a
 * mesma função. O alcance de cada tópico também sai daqui, uma vez, e não a cada resposta.
 */
export function criarContextoDeReducao(
  campos: Readonly<{ catalogo: Catalogo; tecnicas: Tecnicas; parametros: Parametros }>,
): Resultado<ContextoDeReducao, ErroDeGrafo> {
  const { catalogo, tecnicas, parametros } = campos
  const grafo = construirGrafo(catalogo, tecnicas)
  if (!grafo.ok) return grafo
  const porTopico = new Map<IdTopico, Dificuldade>()
  for (const item of catalogo.itens.values()) porTopico.set(topicoDeItem(item.id).id, item.dificuldadeAPriori)
  for (const g of catalogo.grupos.values()) {
    const dosMembros = g.membros.map((m) => catalogo.itens.get(m)?.dificuldadeAPriori ?? DIFICULDADE_NEUTRA)
    porTopico.set(topicoDeGrupo(g.id).id, Math.max(...dosMembros) as Dificuldade)
  }
  const alcances = new Map<IdTopico, readonly IdTopico[]>()
  for (const t of grafo.valor.topicos.keys()) {
    alcances.set(t, [t, ...fechoAscendente(grafo.valor, t), ...fechoDescendente(grafo.valor, t)])
  }
  return ok({
    catalogo,
    grafo: grafo.valor,
    tecnicas,
    parametros,
    dificuldade: (t) => porTopico.get(t) ?? DIFICULDADE_NEUTRA,
    alcance: (t) => alcances.get(t) ?? [t],
  })
}
