import { erro, ok, type Resultado } from '../base/resultado'
import type { Catalogo, IdItem, Item } from '../catalogo/tipos'
import type { Questao } from '../questoes'
import type { Avaliacao, ErroDeAvaliacao } from './tipos'

/**
 * O que a casca mostra depois da resposta, como dado. Revela a resposta certa e, no erro, o item confundido, e nada
 * mais: as outras opções seguem sem rótulo, para a próxima questão que as use não chegar com a resposta dada. O parceiro
 * indiscernível também fica de fora, embora valha como acerto, porque nomeá-lo seria ensinar um item que a questão não
 * pediu.
 */
export type Feedback = Readonly<{
  correta: boolean
  respostaCerta: Readonly<{ item: IdItem; rotulo: string; aliases: readonly string[]; descricao: string }>
  /** O que separa o alvo dos parecidos, quando a questão tem com quem compará-lo. */
  tracoDistintivo?: string
  confundidaCom?: Readonly<{ item: IdItem; rotulo: string; descricao: string }>
}>

/**
 * O traço distintivo que cabe na questão: o do grupo, na tarefa de grupo; na questão isolada com confusão, o do
 * primeiro grupo do alvo que também tem o item confundido e, sem grupo em comum, o da primeira vizinhança dos dois.
 * Sem confusão, a questão isolada não tem com quem comparar o alvo, e o traço fica de fora.
 */
function tracoDaQuestao(questao: Questao, alvo: Item, confundida: Item | undefined, catalogo: Catalogo) {
  if (questao.contexto.tipo === 'grupo') return catalogo.grupos.get(questao.contexto.grupo)?.tracoDistintivo[alvo.id]
  if (confundida === undefined) return undefined
  const grupo = alvo.grupos.find((id) => confundida.grupos.includes(id))
  if (grupo !== undefined) return catalogo.grupos.get(grupo)?.tracoDistintivo[alvo.id]
  const vizinhanca = [...catalogo.vizinhancas.values()].find(
    (v) => v.membros.includes(alvo.id) && v.membros.includes(confundida.id),
  )
  return vizinhanca?.tracoDistintivo[alvo.id]
}

/** Monta o feedback da questão avaliada. Erro só se a questão ou a avaliação citam item fora do catálogo. */
export function feedbackDe(
  questao: Questao,
  avaliacao: Avaliacao,
  catalogo: Catalogo,
): Resultado<Feedback, ErroDeAvaliacao> {
  const alvo = catalogo.itens.get(questao.itemAlvo)
  if (alvo === undefined)
    return erro({ codigo: 'ITEM_INEXISTENTE', detalhe: `item que não existe: '${questao.itemAlvo}'` })
  const idConfundida = avaliacao.correta ? undefined : avaliacao.confundidaCom
  const confundida = idConfundida === undefined ? undefined : catalogo.itens.get(idConfundida)
  if (idConfundida !== undefined && confundida === undefined) {
    return erro({ codigo: 'ITEM_INEXISTENTE', detalhe: `item que não existe: '${idConfundida}'` })
  }
  const traco = tracoDaQuestao(questao, alvo, confundida, catalogo)
  return ok({
    correta: avaliacao.correta,
    respostaCerta: { item: alvo.id, rotulo: alvo.rotulo, aliases: alvo.aliases, descricao: alvo.descricao },
    ...(traco === undefined ? {} : { tracoDistintivo: traco }),
    ...(confundida === undefined
      ? {}
      : { confundidaCom: { item: confundida.id, rotulo: confundida.rotulo, descricao: confundida.descricao } }),
  })
}
