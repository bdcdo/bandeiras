import { erro, ok, type Resultado } from '../base/resultado'
import type { Catalogo, IdItem, Item } from '../catalogo/tipos'
import { parceirosIndiscerniveis, type Questao } from '../questoes'
import type { Avaliacao, ErroDeAvaliacao } from './tipos'

/** Um item revelado pelo feedback, com o rótulo oficial e a descrição. */
export type ItemRevelado = Readonly<{ item: IdItem; rotulo: string; descricao: string }>

/**
 * O que a casca mostra depois da resposta, como dado. Revela a resposta certa e, no erro, o item confundido, e nada
 * mais: as outras opções seguem sem rótulo, para a próxima questão que as use não chegar com a resposta dada.
 *
 * O parceiro indiscernível do alvo fica de fora onde a pergunta é só sobre o alvo, embora valha como acerto, porque
 * nomeá-lo ali seria ensinar um item que a questão não pediu. Em `grupo-membros` é o contrário: a resposta certa é o
 * alvo junto dos parceiros, e eles vêm em `tambemCertas`. Sem eles, quem marcasse só o alvo veria como resposta certa o
 * que marcou, sem saber o que faltou, e quem marcasse só o parceiro leria que ele estava errado.
 */
export type Feedback = Readonly<{
  correta: boolean
  respostaCerta: Readonly<{ item: IdItem; rotulo: string; aliases: readonly string[]; descricao: string }>
  /** Só em `grupo-membros`: os parceiros indiscerníveis do alvo, que a resposta certa também marca. */
  tambemCertas?: readonly ItemRevelado[]
  /**
   * O que separa o alvo dos parecidos, quando a questão tem com quem compará-lo. Não nomeia outro item, porque
   * `carregarCatalogo` recusa traço que cite o rótulo ou um alias de outro.
   */
  tracoDistintivo?: string
  confundidaCom?: ItemRevelado
}>

const revelado = (item: Item): ItemRevelado => ({ item: item.id, rotulo: item.rotulo, descricao: item.descricao })

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
  // O `flatMap` só atende ao tipo do `get`: num catálogo carregado todo parceiro é item, porque o par só aceita membros
  // do grupo.
  const tambemCertas =
    questao.formato.tipo === 'grupo-membros'
      ? [...parceirosIndiscerniveis(alvo.id, catalogo)].flatMap((id) => {
          const parceiro = catalogo.itens.get(id)
          return parceiro === undefined ? [] : [revelado(parceiro)]
        })
      : []
  const traco = tracoDaQuestao(questao, alvo, confundida, catalogo)
  return ok({
    correta: avaliacao.correta,
    respostaCerta: { item: alvo.id, rotulo: alvo.rotulo, aliases: alvo.aliases, descricao: alvo.descricao },
    ...(tambemCertas.length === 0 ? {} : { tambemCertas }),
    ...(traco === undefined ? {} : { tracoDistintivo: traco }),
    ...(confundida === undefined ? {} : { confundidaCom: revelado(confundida) }),
  })
}
