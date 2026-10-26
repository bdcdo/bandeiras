import { erro, ok, type Resultado } from '../base/resultado'
import type { SorteioComSemente } from '../base/sorteio-com-semente'
import type { Catalogo, IdItem, Item } from '../catalogo/tipos'
import type { Parametros } from '../memoria/parametros'
import { chaveDeOpcoes, type ContextoDeSessao } from './contexto-de-sessao'
import { parceirosIndiscerniveis } from './pares'
import type { ErroDeQuestao } from './questao'

/**
 * Como os distratores se parecem com o alvo. `dissimilares` servem ao andaime da lição, logo depois da apresentação, em
 * que a pessoa ainda não distingue o alvo dos parecidos; `parecidos` servem à sondagem e à discriminação, em que
 * distinguir é o que se testa.
 */
export type ModoDeDistratores = 'dissimilares' | 'parecidos'

/** O que liga um candidato ao alvo, do mais forte para o mais fraco. */
type Relacao = 'grupo' | 'vizinho' | 'classe' | 'categoria' | 'nenhuma'

function relacionador(alvo: Item, catalogo: Catalogo): (c: Item) => Relacao {
  const grupos = new Set(alvo.grupos)
  const vizinhancas = [...catalogo.vizinhancas.values()].filter((v) => v.membros.includes(alvo.id))
  return (c) => {
    if (c.grupos.some((g) => grupos.has(g))) return 'grupo'
    if (
      alvo.vizinhos.includes(c.id) ||
      c.vizinhos.includes(alvo.id) ||
      vizinhancas.some((v) => v.membros.includes(c.id))
    )
      return 'vizinho'
    if (c.classe === alvo.classe) return 'classe'
    if (c.categoria === alvo.categoria) return 'categoria'
    return 'nenhuma'
  }
}

const POSTO_PARECIDO: Readonly<Record<Relacao, number>> = { grupo: 0, vizinho: 1, classe: 2, categoria: 3, nenhuma: 4 }

/**
 * Posto do candidato no modo: menor é preferido, e `undefined` tira o candidato do pool.
 *
 * Dissimilar é quem não tem relação forte com o alvo: nenhum grupo em comum, não é vizinho nem divide vizinhança, e é de
 * outra classe. Entre esses, prefere outra categoria e, dentro dela, quem já tem lição concluída. Parecido segue a ordem
 * da relação (grupo, vizinho, classe, categoria) e completa com os dissimilares de outra categoria, aprendidos antes.
 */
function posto(modo: ModoDeDistratores, relacao: Relacao, aprendido: boolean): number | undefined {
  const naoAprendido = aprendido ? 0 : 1
  if (modo === 'parecidos') return POSTO_PARECIDO[relacao] + (relacao === 'nenhuma' ? naoAprendido : 0)
  if (relacao === 'nenhuma') return naoAprendido
  if (relacao === 'categoria') return 2 + naoAprendido
  return undefined
}

/**
 * Quantos dos candidatos cabem juntos entre as opções, sem os dois itens de um par indiscernível: o tamanho do maior
 * subconjunto deles sem par dentro.
 *
 * Quase todo candidato não tem parceiro entre os outros e conta um. Os que têm se resolvem em ordem. Candidato com um
 * parceiro só entre os restantes entra sempre: num subconjunto maior que o tenha deixado de fora, trocar o parceiro por
 * ele dá outro do mesmo tamanho. Só quando todo candidato com parceiro tem dois ou mais, o que exige pares fechando um
 * ciclo (a com b num grupo, b com c em outro, c com a num terceiro), a conta ramifica entre deixar o primeiro deles de
 * fora e pô-lo sem os parceiros. Com os pares que um catálogo costuma declarar, um ou outro e quase nunca encadeados, a
 * conta não ramifica.
 */
function cabemJuntos(candidatos: ReadonlySet<IdItem>, catalogo: Catalogo): number {
  const comParceiro = [...candidatos].flatMap((id) => {
    const parceiros = [...parceirosIndiscerniveis(id, catalogo)].filter((p) => candidatos.has(p))
    return parceiros.length === 0 ? [] : [{ id, parceiros }]
  })
  const escolhido = comParceiro.find((c) => c.parceiros.length === 1) ?? comParceiro[0]
  if (escolhido === undefined) return candidatos.size
  const sem = (fora: readonly IdItem[]): Set<IdItem> => new Set([...candidatos].filter((id) => !fora.includes(id)))
  const comEle = 1 + cabemJuntos(sem([escolhido.id, ...escolhido.parceiros]), catalogo)
  if (escolhido.parceiros.length === 1) return comEle
  return Math.max(comEle, cabemJuntos(sem([escolhido.id]), catalogo))
}

/**
 * Distratores para uma questão de múltipla escolha sobre `alvo`: `n` itens, do mais preferido para o menos.
 *
 * O pool é o catálogo sem o alvo, sem os pendentes ainda não apresentados, sem quem já foi distrator o máximo de vezes na
 * sessão e sem os parceiros indiscerníveis do alvo, que nunca são opção junto dele: em `rotulo-para-estimulo` e na
 * discriminação o estímulo do parceiro é igual ao do alvo, e em `estimulo-para-rotulo` o rótulo do parceiro também
 * estaria certo. Pela mesma razão, dois itens de um mesmo par nunca entram juntos: duas opções iguais na tela dizem que
 * nenhuma delas é a resposta.
 *
 * O pool vai para camadas pelo posto do modo (ver `posto`); cada camada é embaralhada pelo sorteio e os distratores saem
 * das camadas em ordem. Se o conjunto de opções, com o alvo, já foi mostrado na sessão, sorteia de novo, até
 * `tentativasDeOpcoesNovas` sorteios ao todo; esgotadas as tentativas, fica o último, porque repetir o conjunto em outra
 * ordem é melhor que não ter questão. Pool que não rende `n` distratores devolve `DISTRATORES_INSUFICIENTES`, e não uma
 * lista curta; o que o pool rende é o que `cabemJuntos` conta, e não depende da ordem do sorteio.
 */
export function escolherDistratores(
  alvo: IdItem,
  modo: ModoDeDistratores,
  n: number,
  catalogo: Catalogo,
  ctx: ContextoDeSessao,
  sorteio: SorteioComSemente,
  parametros: Parametros,
): Resultado<readonly IdItem[], ErroDeQuestao> {
  if (!Number.isInteger(n) || n < 0) {
    // Fora do contrato, como no `inteiro` do sorteio: é defeito de quem chama, e não dado de fora.
    throw new RangeError(`escolherDistratores com n = ${String(n)}: n precisa ser inteiro maior ou igual a zero`)
  }
  const item = catalogo.itens.get(alvo)
  if (item === undefined) return erro({ codigo: 'ITEM_INEXISTENTE', detalhe: `item que não existe: '${alvo}'` })
  const parceirosDoAlvo = parceirosIndiscerniveis(alvo, catalogo)
  const pool = [...catalogo.itens.values()].filter(
    (c) =>
      c.id !== alvo &&
      !ctx.pendentesNovas.has(c.id) &&
      (ctx.usosComoDistrator.get(c.id) ?? 0) < parametros.usosMaximosComoDistrator &&
      !parceirosDoAlvo.has(c.id),
  )

  const relacao = relacionador(item, catalogo)
  const porPosto = new Map<number, IdItem[]>()
  for (const c of pool) {
    const p = posto(modo, relacao(c), ctx.aprendidos.has(c.id))
    if (p !== undefined) porPosto.set(p, [...(porPosto.get(p) ?? []), c.id])
  }
  const camadas = [...porPosto].sort(([a], [b]) => a - b).map(([, ids]) => ids)
  const rende = cabemJuntos(new Set(camadas.flat()), catalogo)
  if (rende < n) {
    return erro({
      codigo: 'DISTRATORES_INSUFICIENTES',
      detalhe: `'${alvo}' em modo ${modo}: o pool rende ${String(rende)} distratores, e são pedidos ${String(n)}`,
    })
  }

  // Quem entra barra os parceiros. Um item em pares de dois grupos barra dois, e pô-lo pode deixar o sorteio curto
  // embora outra escolha rendesse `n`. Por isso o candidato com parceiro ainda livre só entra se, tirados ele e os
  // parceiros, os candidatos livres que faltam ver ainda completam `n`. O candidato recusado assim não está em nenhuma
  // escolha que complete `n` com os já escolhidos, e como o pool rende `n`, o sorteio chega sempre a `n`. Candidato sem
  // parceiro livre entra direto, sem conta, e aí o sorteio é o mesmo que seria sem a conferência.
  const sortear = (): IdItem[] => {
    const escolhidos: IdItem[] = []
    const barrados = new Set<IdItem>()
    const naoVistos = new Set(camadas.flat())
    const livre = (c: IdItem): boolean => naoVistos.has(c) && !barrados.has(c)
    for (const camada of camadas) {
      if (escolhidos.length === n) break
      for (const id of sorteio.embaralhar(camada)) {
        naoVistos.delete(id)
        if (barrados.has(id)) continue
        const parceiros = parceirosIndiscerniveis(id, catalogo)
        if ([...parceiros].some(livre)) {
          const semEle = new Set([...naoVistos].filter((c) => livre(c) && !parceiros.has(c)))
          if (cabemJuntos(semEle, catalogo) < n - escolhidos.length - 1) continue
        }
        escolhidos.push(id)
        for (const parceiro of parceiros) barrados.add(parceiro)
        if (escolhidos.length === n) break
      }
    }
    return escolhidos
  }

  let escolhidos = sortear()
  for (
    let tentativa = 1;
    tentativa < parametros.tentativasDeOpcoesNovas && ctx.conjuntosUsados.has(chaveDeOpcoes([alvo, ...escolhidos]));
    tentativa++
  ) {
    escolhidos = sortear()
  }
  return ok(escolhidos)
}
