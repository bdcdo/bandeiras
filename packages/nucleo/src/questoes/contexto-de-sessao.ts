import type { IdItem } from '../catalogo/tipos'
import type { Questao } from './questao'

/**
 * O que a geração de questões precisa saber da sessão para não vazar a resposta:
 *
 * - `pendentesNovas`: itens de lição pendente que ainda não foram apresentados. Nenhum deles é opção antes da
 *   apresentação, senão a pessoa veria o item como resposta errada antes de aprendê-lo, e o descartaria depois por
 *   lembrar que era errado.
 * - `usosComoDistrator`: quantas vezes cada item já foi opção errada numa questão isolada. Passado o limite dos
 *   parâmetros, o item sai do pool: visto muitas vezes como errado, ele seria descartado por familiaridade.
 * - `conjuntosUsados`: os conjuntos de opções já mostrados, pela chave de `chaveDeOpcoes`. A nova tentativa de um
 *   knowledge point traz opções novas, e não as mesmas em outra ordem.
 * - `aprendidos`: itens com lição concluída. Os distratores dissimilares os preferem.
 *
 * A tarefa de grupo não mexe em `usosComoDistrator` nem em `conjuntosUsados`: as opções dela são o próprio grupo,
 * completado com vizinhos, mais os parceiros e os chamarizes do `grupo-membros`, e não o sorteio de distratores da
 * questão isolada.
 *
 * O contexto é imutável; cada função abaixo devolve um contexto novo.
 */
export type ContextoDeSessao = Readonly<{
  pendentesNovas: ReadonlySet<IdItem>
  aprendidos: ReadonlySet<IdItem>
  usosComoDistrator: ReadonlyMap<IdItem, number>
  conjuntosUsados: ReadonlySet<string>
}>

/** Contexto do início de uma sessão: nenhum distrator usado, nenhum conjunto mostrado. */
export function contextoDeSessao(campos: {
  pendentesNovas?: Iterable<IdItem>
  aprendidos?: Iterable<IdItem>
}): ContextoDeSessao {
  return {
    pendentesNovas: new Set(campos.pendentesNovas ?? []),
    aprendidos: new Set(campos.aprendidos ?? []),
    usosComoDistrator: new Map(),
    conjuntosUsados: new Set(),
  }
}

/**
 * Chave de um conjunto de opções: os ids em ordem de unidade de código, para a mesma escolha em outra ordem dar a mesma
 * chave. O separador é um caractere de controle, que nenhum id de catálogo tem, para `['a|b', 'c']` e `['a', 'b|c']` não
 * se confundirem.
 */
export function chaveDeOpcoes(opcoes: readonly IdItem[]): string {
  return [...opcoes].sort().join('\u001f')
}

/**
 * Contexto depois de a questão ser mostrada. Numa questão isolada de múltipla escolha, cada opção que não é o alvo conta
 * um uso como distrator, e o conjunto de opções entra nos usados. Texto digitado e tarefa de grupo não mudam o contexto.
 */
export function registrarQuestao(ctx: ContextoDeSessao, questao: Questao): ContextoDeSessao {
  const { formato, contexto } = questao
  if (contexto.tipo !== 'isolada') return ctx
  if (formato.tipo !== 'estimulo-para-rotulo' && formato.tipo !== 'rotulo-para-estimulo') return ctx
  const usos = new Map(ctx.usosComoDistrator)
  for (const opcao of formato.opcoes) {
    if (opcao !== questao.itemAlvo) usos.set(opcao, (usos.get(opcao) ?? 0) + 1)
  }
  return {
    ...ctx,
    usosComoDistrator: usos,
    conjuntosUsados: new Set([...ctx.conjuntosUsados, chaveDeOpcoes(formato.opcoes)]),
  }
}

/** Contexto depois da apresentação de um item novo: a partir daqui ele pode ser opção. */
export function registrarApresentacao(ctx: ContextoDeSessao, item: IdItem): ContextoDeSessao {
  const pendentesNovas = new Set(ctx.pendentesNovas)
  pendentesNovas.delete(item)
  return { ...ctx, pendentesNovas }
}

/**
 * Contexto depois de uma lição concluída: o item passa a ser aprendido e deixa de ser pendente. A lição acelerada pela
 * sondagem conclui sem apresentação, e o item dela também pode ser opção daí em diante.
 */
export function registrarLicaoConcluida(ctx: ContextoDeSessao, item: IdItem): ContextoDeSessao {
  return { ...registrarApresentacao(ctx, item), aprendidos: new Set([...ctx.aprendidos, item]) }
}
