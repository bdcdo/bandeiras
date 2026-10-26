import type { Catalogo, Direcao, IdItem } from '../catalogo/tipos'
import { lerTopico, topicoDeItem, type IdTopico } from '../grafo/topico'
import type { EstadoMemoria } from './estado-memoria'
import { limitar } from './limitar'
import type { Parametros } from './parametros'

/**
 * Uma evidência a mais na acurácia, em média exponencial: `acuracia' = (1 - a) * acuracia + a * (correta ? 1 : 0)`, com
 * `a = alfaAcuracia * peso`. O peso é 1 para a resposta ao próprio tópico e menor para a evidência que chega pelo grafo.
 * Com a direção, a acurácia dela recebe a mesma evidência; as outras direções ficam como estavam.
 *
 * `a` é limitado a [0, 1] para a média nunca sair de [0, 1], qualquer que seja o peso recebido.
 */
export function atualizarAcuracia(
  e: EstadoMemoria,
  correta: boolean,
  peso: number,
  parametros: Parametros,
  direcao?: Direcao,
): EstadoMemoria {
  const a = limitar(parametros.alfaAcuracia * peso, 0, 1)
  const media = (atual: number): number => (1 - a) * atual + a * (correta ? 1 : 0)
  return {
    ...e,
    acuracia: media(e.acuracia),
    nAvaliacoes: e.nAvaliacoes + 1,
    ...(direcao === undefined
      ? {}
      : { acuraciaPorDirecao: { ...e.acuraciaPorDirecao, [direcao]: media(e.acuraciaPorDirecao[direcao]) } }),
  }
}

const media = (xs: readonly number[]): number => xs.reduce((s, x) => s + x, 0) / xs.length

/**
 * Previsão da acurácia de um item novo pela vizinhança dele (The Math Academy Way, p. 371), em três anéis: os outros membros dos grupos do
 * item, os itens da mesma subcategoria e todos os itens. Cada anel conta só tópicos de item já medidos (`nAvaliacoes`
 * maior que zero) e nunca o próprio item. A previsão é a média dos anéis ponderada pelos pesos dos parâmetros; um anel
 * sem tópico medido sai da conta e o peso dele se divide entre os outros na proporção deles, e sem anel nenhum vale a
 * acurácia neutra. Os anéis podem se sobrepor: um membro do grupo da mesma subcategoria entra nos dois, porque está
 * perto do item pelos dois critérios.
 */
function acuraciaInicialDeItem(
  id: IdItem,
  catalogo: Catalogo,
  memorias: ReadonlyMap<IdTopico, EstadoMemoria>,
  parametros: Parametros,
): number {
  const item = catalogo.itens.get(id)
  if (item === undefined) return parametros.acuraciaNeutra
  const medidas = (ids: Iterable<IdItem>): number[] =>
    [...ids].flatMap((outro) => {
      const e = outro === id ? undefined : memorias.get(topicoDeItem(outro).id)
      return e !== undefined && e.nAvaliacoes > 0 ? [e.acuracia] : []
    })
  const todos = [...catalogo.itens.values()]
  const aneis = [
    {
      peso: parametros.pesoAnelGrupo,
      acuracias: medidas(new Set(item.grupos.flatMap((g) => catalogo.grupos.get(g)?.membros ?? []))),
    },
    {
      peso: parametros.pesoAnelSubcategoria,
      // A subcategoria só é única dentro da categoria, por isso o anel compara as duas.
      acuracias: medidas(
        todos.filter((i) => i.categoria === item.categoria && i.subcategoria === item.subcategoria).map((i) => i.id),
      ),
    },
    { peso: parametros.pesoAnelGlobal, acuracias: medidas(todos.map((i) => i.id)) },
  ].filter((anel) => anel.acuracias.length > 0)
  if (aneis.length === 0) return parametros.acuraciaNeutra
  const pesoTotal = aneis.reduce((s, anel) => s + anel.peso, 0)
  return aneis.reduce((s, anel) => s + anel.peso * media(anel.acuracias), 0) / pesoTotal
}

/**
 * Acurácia com que um tópico novo começa. Para um item, a previsão pela vizinhança acima. Para um grupo, a média dos
 * membros: a acurácia que cada um já tem no estado ou, sem estado, a prevista para ele. Tópico que o catálogo não
 * conhece começa na neutra.
 */
export function acuraciaInicial(
  id: IdTopico,
  catalogo: Catalogo,
  memorias: ReadonlyMap<IdTopico, EstadoMemoria>,
  parametros: Parametros,
): number {
  const topico = lerTopico(id)
  if (topico.tipo === 'item') return acuraciaInicialDeItem(topico.item, catalogo, memorias, parametros)
  const grupo = catalogo.grupos.get(topico.grupo)
  if (grupo === undefined) return parametros.acuraciaNeutra
  return media(
    grupo.membros.map(
      (m) => memorias.get(topicoDeItem(m).id)?.acuracia ?? acuraciaInicialDeItem(m, catalogo, memorias, parametros),
    ),
  )
}
