import { erro, ok, type Resultado } from '../base/resultado'
import type { SorteioComSemente } from '../base/sorteio-com-semente'
import type { Catalogo, Direcao, IdGrupo, IdItem } from '../catalogo/tipos'
import { topicoDeItem, type IdTopico } from '../grafo/topico'
import { acuraciaNaDirecao, type EstadoMemoria, type Parametros } from '../memoria'
import type { ContextoDeSessao } from './contexto-de-sessao'
import { parceirosIndiscerniveis } from './pares'
import {
  criarQuestao,
  type ContextoDeQuestao,
  type ErroDeQuestao,
  type FormatoDeQuestao,
  type Questao,
  type TipoDeFormato,
} from './questao'

// Ordem de desempate entre direções de mesma acurácia: recordar primeiro, porque é a evidência mais forte e a única que
// não se acerta ao acaso.
const ORDEM_DE_DESEMPATE: readonly Direcao[] = ['recordar', 'reconhecer', 'produzir']

// Ordem das questões na tarefa, por formato. O `rotulo-digitado` vem primeiro porque é a recordação, a única questão que
// dá crédito explícito cheio: depois de uma questão que listou os rótulos dos exibidos, digitar o de outro alvo viraria
// reconhecimento entre rótulos que acabaram de aparecer na tela. O `rotulo-para-estimulo` mostra só o rótulo do próprio
// alvo. O `grupo-membros` vem antes do `estimulo-para-rotulo`, que lista só os rótulos dos exibidos: antes dele, essa
// lista diria quais rótulos do `grupo-membros` não têm estímulo na fileira, sem a pessoa precisar reconhecer nenhum.
const ORDEM_NA_TAREFA: readonly TipoDeFormato[] = [
  'rotulo-digitado',
  'rotulo-para-estimulo',
  'grupo-membros',
  'estimulo-para-rotulo',
]

function direcaoMaisFraca(e: EstadoMemoria): Direcao {
  return ORDEM_DE_DESEMPATE.reduce((fraca, d) => (acuraciaNaDirecao(e, d) < acuraciaNaDirecao(e, fraca) ? d : fraca))
}

/** O que impede os alvos de formar uma tarefa, cada problema numa frase. */
function problemasDosAlvos(
  membros: readonly IdItem[],
  alvos: readonly IdItem[],
  memorias: ReadonlyMap<IdTopico, EstadoMemoria>,
  catalogo: Catalogo,
  ctx: ContextoDeSessao,
): string[] {
  const conjunto = new Set(alvos)
  return [
    ...(alvos.length === 0 ? ['tarefa sem alvo'] : []),
    ...alvos.filter((a, k) => alvos.indexOf(a) !== k).map((a) => `alvo repetido: '${a}'`),
    ...alvos.filter((a) => !membros.includes(a)).map((a) => `alvo que não é membro do grupo: '${a}'`),
    ...alvos.filter((a) => !memorias.has(topicoDeItem(a).id)).map((a) => `alvo sem estado de memória: '${a}'`),
    ...alvos.filter((a) => ctx.pendentesNovas.has(a)).map((a) => `alvo ainda não apresentado: '${a}'`),
    // O parceiro de um alvo de par é opção certa do `grupo-membros`, e não pode ser algo que a pessoa ainda não viu.
    ...alvos
      .filter((a) => [...parceirosIndiscerniveis(a, catalogo)].some((p) => ctx.pendentesNovas.has(p)))
      .map((a) => `parceiro ainda não apresentado do alvo '${a}'`),
    // Os dois itens de um par como alvos não cabem: o parceiro de um alvo nunca é mostrado ao lado dele, e o outro alvo
    // precisaria estar na tela.
    ...alvos
      .filter((a) => [...parceirosIndiscerniveis(a, catalogo)].some((p) => conjunto.has(p) && p > a))
      .map((a) => `alvos que formam um par indiscernível: '${a}' e o parceiro`),
  ]
}

/**
 * Estímulos mostrados lado a lado na tarefa: os alvos, os outros membros do grupo e, se faltar para `opcoesMinimasDeGrupo`,
 * os vizinhos dos membros, na ordem de parecença de cada um. Ficam de fora o parceiro indiscernível de um alvo, que
 * nunca aparece ao lado dele, o segundo item de um par sem alvo, porque dois estímulos iguais na tela não são opções
 * distintas, e quem ainda não foi apresentado. Devolve a lista na ordem de inclusão.
 */
function montarExibidos(
  membros: readonly IdItem[],
  alvos: readonly IdItem[],
  catalogo: Catalogo,
  ctx: ContextoDeSessao,
  opcoesMinimas: number,
): IdItem[] {
  const exibidos: IdItem[] = []
  const barrados = new Set<IdItem>()
  const incluir = (id: IdItem): void => {
    if (exibidos.includes(id) || barrados.has(id) || ctx.pendentesNovas.has(id)) return
    exibidos.push(id)
    for (const parceiro of parceirosIndiscerniveis(id, catalogo)) barrados.add(parceiro)
  }
  for (const alvo of alvos) incluir(alvo)
  for (const membro of membros) incluir(membro)
  for (const membro of membros) {
    for (const vizinho of catalogo.itens.get(membro)?.vizinhos ?? []) {
      if (exibidos.length >= opcoesMinimas) return exibidos
      incluir(vizinho)
    }
  }
  return exibidos
}

/**
 * Rótulos errados de itens fora da fileira para o `grupo-membros`, `quantos` deles. O parceiro de um alvo de par nunca
 * está na fileira; sem chamarizes, o rótulo dele seria a única opção sem estímulo na tela e sempre certa, e quem
 * reconhece os exibidos acertaria o par por eliminação, sem saber qual é o parceiro.
 *
 * Vêm primeiro os vizinhos dos membros que não entraram na fileira, os mais parecidos com o grupo; depois os membros que
 * ficaram de fora por serem par de um exibido; depois o resto do catálogo, cada camada em ordem sorteada. Ficam de fora
 * os exibidos, os parceiros dos alvos, que são opções certas, e quem ainda não foi apresentado.
 */
function chamarizes(
  membros: readonly IdItem[],
  exibidos: readonly IdItem[],
  parceirosDosAlvos: readonly IdItem[],
  catalogo: Catalogo,
  ctx: ContextoDeSessao,
  sorteio: SorteioComSemente,
  quantos: number,
): IdItem[] {
  // Começa com quem fica de fora, e cada camada acrescenta os seus, para nenhum item entrar em duas.
  const usados = new Set<IdItem>([...exibidos, ...parceirosDosAlvos, ...ctx.pendentesNovas])
  const camadas = [membros.flatMap((m) => catalogo.itens.get(m)?.vizinhos ?? []), membros, [...catalogo.itens.keys()]]
  return camadas
    .flatMap((camada) => {
      const novos = [...new Set(camada)].filter((id) => !usados.has(id))
      for (const id of novos) usados.add(id)
      return sorteio.embaralhar(novos)
    })
    .slice(0, quantos)
}

/**
 * Direção de cada alvo que não é de par: a de menor acurácia, com pelo menos metade dos alvos da tarefa, arredondada
 * para cima, em `recordar`. Faltando, passam a recordar os alvos de menor acurácia em recordar, na ordem dos alvos no
 * empate. Alvo de par não recorda, porque a pergunta dele é `grupo-membros`; com muitos alvos de par, a metade pode não
 * ser alcançável, e todos os outros recordam.
 */
function direcoes(
  semPar: readonly { alvo: IdItem; estado: EstadoMemoria }[],
  totalDeAlvos: number,
): ReadonlyMap<IdItem, Direcao> {
  const escolhidas = new Map(semPar.map(({ alvo, estado }) => [alvo, direcaoMaisFraca(estado)]))
  const faltam = Math.ceil(totalDeAlvos / 2) - [...escolhidas.values()].filter((d) => d === 'recordar').length
  // O sort do JavaScript é estável: no empate, a ordem dos alvos decide.
  const candidatos = semPar
    .filter(({ alvo }) => escolhidas.get(alvo) !== 'recordar')
    .sort((x, y) => acuraciaNaDirecao(x.estado, 'recordar') - acuraciaNaDirecao(y.estado, 'recordar'))
  for (const { alvo } of candidatos.slice(0, Math.max(0, faltam))) escolhidas.set(alvo, 'recordar')
  return escolhidas
}

/**
 * Questões da tarefa de grupo, uma por alvo, todas com o mesmo contexto: os exibidos de `montarExibidos`, em ordem
 * sorteada. Saem na ordem de `ORDEM_NA_TAREFA`, e no mesmo formato, na ordem dos alvos.
 *
 * Alvo de par indiscernível recebe `grupo-membros`: o estímulo dele destacado e, como opções, os rótulos dos exibidos,
 * dos parceiros de todos os alvos de par e dos `chamarizes`, para marcar o alvo e o parceiro. Os outros alvos recebem a
 * direção de `direcoes`: `rotulo-digitado` com o alvo destacado entre os exibidos, ou múltipla escolha com os exibidos
 * como opções, reembaralhados a cada questão. A múltipla escolha não leva o parceiro de um alvo de par, que poria os dois
 * itens do par entre as opções; quem protege o `grupo-membros` da lista dela é a ordem da tarefa.
 *
 * Recusa com `ALVOS_INVALIDOS` alvo ausente, repetido, fora do grupo, sem estado de memória, ainda não apresentado ou par
 * de outro alvo; com `DISTRATORES_INSUFICIENTES` o grupo que nem com os vizinhos chega às opções mínimas, ou que não
 * tem um chamariz por parceiro; e com `ALVOS_DEMAIS` mais alvos que exibidos menos dois, porque com uma opção só
 * sobrando o último alvo sairia por eliminação. Quais alvos entram é escolha de quem monta a tarefa.
 */
export function gerarQuestoesDeGrupo(
  grupo: IdGrupo,
  alvos: readonly IdItem[],
  memorias: ReadonlyMap<IdTopico, EstadoMemoria>,
  catalogo: Catalogo,
  ctx: ContextoDeSessao,
  sorteio: SorteioComSemente,
  parametros: Parametros,
): Resultado<readonly Questao[], ErroDeQuestao> {
  const g = catalogo.grupos.get(grupo)
  if (g === undefined) return erro({ codigo: 'GRUPO_INEXISTENTE', detalhe: `grupo que não existe: '${grupo}'` })
  const problemas = problemasDosAlvos(g.membros, alvos, memorias, catalogo, ctx)
  if (problemas.length > 0) return erro({ codigo: 'ALVOS_INVALIDOS', detalhe: problemas.join('; ') })

  const exibidos = montarExibidos(g.membros, alvos, catalogo, ctx, parametros.opcoesMinimasDeGrupo)
  if (exibidos.length < parametros.opcoesMinimasDeGrupo) {
    return erro({
      codigo: 'DISTRATORES_INSUFICIENTES',
      detalhe: `grupo '${grupo}': ${String(exibidos.length)} exibidos com os vizinhos, e o mínimo é ${String(parametros.opcoesMinimasDeGrupo)}`,
    })
  }
  if (alvos.length > exibidos.length - 2) {
    return erro({
      codigo: 'ALVOS_DEMAIS',
      detalhe: `grupo '${grupo}': ${String(alvos.length)} alvos para ${String(exibidos.length)} exibidos; o máximo é ${String(exibidos.length - 2)}`,
    })
  }

  const parceiros = new Map(alvos.map((a) => [a, [...parceirosIndiscerniveis(a, catalogo)]]))
  const semPar = alvos.flatMap((alvo) => {
    const estado = memorias.get(topicoDeItem(alvo).id)
    return parceiros.get(alvo)?.length === 0 && estado !== undefined ? [{ alvo, estado }] : []
  })
  const direcaoDe = direcoes(semPar, alvos.length)

  // Um chamariz por parceiro: entre os rótulos sem estímulo na fileira, os errados são ao menos tantos quanto os certos.
  const doPar = [...new Set([...parceiros.values()].flat())]
  const errados = doPar.length === 0 ? [] : chamarizes(g.membros, exibidos, doPar, catalogo, ctx, sorteio, doPar.length)
  if (errados.length < doPar.length) {
    return erro({
      codigo: 'DISTRATORES_INSUFICIENTES',
      detalhe: `grupo '${grupo}': ${String(errados.length)} de ${String(doPar.length)} rótulos errados fora da fileira, um por parceiro de alvo`,
    })
  }
  // Toda questão `grupo-membros` da tarefa tem as mesmas opções, em ordem sorteada a cada uma.
  const opcoesDeGrupoMembros = [...exibidos, ...doPar, ...errados]
  const contexto: ContextoDeQuestao = { tipo: 'grupo', grupo, exibidos: sorteio.embaralhar(exibidos) }

  const formatoDe = (a: IdItem): FormatoDeQuestao => {
    if ((parceiros.get(a) ?? []).length > 0) {
      return { tipo: 'grupo-membros', opcoes: sorteio.embaralhar(opcoesDeGrupoMembros) }
    }
    const direcao = direcaoDe.get(a)
    if (direcao === 'reconhecer') return { tipo: 'estimulo-para-rotulo', opcoes: sorteio.embaralhar(exibidos) }
    if (direcao === 'produzir') return { tipo: 'rotulo-para-estimulo', opcoes: sorteio.embaralhar(exibidos) }
    return { tipo: 'rotulo-digitado' }
  }
  const questoes = alvos.map((a) => criarQuestao(a, formatoDe(a), contexto))
  // O sort do JavaScript é estável: no mesmo formato, fica a ordem dos alvos.
  const posicao = (q: Questao): number => ORDEM_NA_TAREFA.indexOf(q.formato.tipo)
  return ok(questoes.sort((x, y) => posicao(x) - posicao(y)))
}
