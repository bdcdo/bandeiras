import { hashFnv1a } from '../base/hash'
import type { Milis } from '../base/tempo'
import type { Direcao, IdGrupo, IdItem } from '../catalogo/tipos'
import { topicoDeItem, type IdTopico } from '../grafo/topico'

/**
 * Formatos de questão. Os três primeiros são as três direções de um tópico de item; `grupo-membros` pergunta, na tarefa de
 * grupo, quais itens têm o estímulo de um alvo de par indiscernível; `associacao` liga os estímulos de um grupo aos
 * rótulos no diagnóstico.
 */
export const FORMATOS_DE_QUESTAO = [
  'estimulo-para-rotulo',
  'rotulo-para-estimulo',
  'rotulo-digitado',
  'grupo-membros',
  'associacao',
] as const
export type TipoDeFormato = (typeof FORMATOS_DE_QUESTAO)[number]

/**
 * O formato com as opções. Opção é id de item: a casca mostra o rótulo dele em `estimulo-para-rotulo` e `grupo-membros`,
 * e o estímulo em `rotulo-para-estimulo`.
 *
 * `grupo-membros` não diz quantas opções marcar, de propósito: o que a questão testa é saber que o estímulo é de dois
 * itens, e quais. Na `associacao`, cada linha é um estímulo, e uma linha com dois ids é um par indiscernível que aceita
 * qualquer dos dois rótulos.
 */
export type FormatoDeQuestao =
  | Readonly<{ tipo: 'estimulo-para-rotulo'; opcoes: readonly IdItem[] }>
  | Readonly<{ tipo: 'rotulo-para-estimulo'; opcoes: readonly IdItem[] }>
  | Readonly<{ tipo: 'rotulo-digitado' }>
  | Readonly<{ tipo: 'grupo-membros'; opcoes: readonly IdItem[] }>
  | Readonly<{ tipo: 'associacao'; linhas: readonly (readonly IdItem[])[]; rotulos: readonly IdItem[] }>

/**
 * Onde a questão aparece. Isolada é a questão de lição, sondagem, revisão, remediação, quiz ou discriminação. Na tarefa
 * de grupo, `exibidos` são os estímulos mostrados lado a lado durante a tarefa inteira, o alvo inclusive; é a mesma lista
 * que o FIRe usa para o fator de exposição dos membros que não foram alvo.
 */
export type ContextoDeQuestao =
  Readonly<{ tipo: 'isolada' }> | Readonly<{ tipo: 'grupo'; grupo: IdGrupo; exibidos: readonly IdItem[] }>

/**
 * Uma questão pronta para a casca. `alvo` é o tópico do item perguntado, que recebe a repetição explícita. `limiteMs`,
 * presente, faz a questão cronometrada.
 *
 * O `id` sai do conteúdo pelo FNV-1a, e não de um contador: a mesma questão gerada de novo, na reconstrução do log, tem o
 * mesmo id. Duas questões de conteúdo igual, como dois `rotulo-digitado` do mesmo item, têm o mesmo id; quem as distingue
 * é a posição na tarefa.
 */
export type Questao = Readonly<{
  id: string
  alvo: IdTopico
  itemAlvo: IdItem
  formato: FormatoDeQuestao
  contexto: ContextoDeQuestao
  limiteMs?: Milis
}>

/** Tipos de tarefa. O objeto da tarefa, com passos e alvos, fica com a camada que monta as tarefas. */
export const TIPOS_DE_TAREFA = ['licao', 'revisao', 'revisao-grupo', 'quiz', 'diagnostico', 'remediacao'] as const
export type TipoDeTarefa = (typeof TIPOS_DE_TAREFA)[number]

/**
 * Direção do tópico que o formato exercita. `grupo-membros` mostra o estímulo e pede rótulos, e por isso é reconhecer;
 * `associacao` também vai do estímulo ao rótulo.
 */
export function direcaoDoFormato(tipo: TipoDeFormato): Direcao {
  switch (tipo) {
    case 'rotulo-para-estimulo':
      return 'produzir'
    case 'rotulo-digitado':
      return 'recordar'
    case 'estimulo-para-rotulo':
    case 'grupo-membros':
    case 'associacao':
      return 'reconhecer'
  }
}

/** As opções do formato, ou lista vazia para o que não tem opções. */
export function opcoesDe(formato: FormatoDeQuestao): readonly IdItem[] {
  switch (formato.tipo) {
    case 'estimulo-para-rotulo':
    case 'rotulo-para-estimulo':
    case 'grupo-membros':
      return formato.opcoes
    case 'rotulo-digitado':
      return []
    case 'associacao':
      return formato.rotulos
  }
}

/**
 * Monta a questão e o id dela. O texto que vai ao hash é uma lista em ordem fixa, montada campo a campo, e não o JSON do
 * objeto: assim o id não depende da ordem em que as chaves foram escritas em quem chama.
 */
export function criarQuestao(
  itemAlvo: IdItem,
  formato: FormatoDeQuestao,
  contexto: ContextoDeQuestao,
  limiteMs?: Milis,
): Questao {
  const camposDoFormato =
    formato.tipo === 'associacao' ? [formato.tipo, formato.linhas, formato.rotulos] : [formato.tipo, opcoesDe(formato)]
  const camposDoContexto =
    contexto.tipo === 'grupo' ? [contexto.tipo, contexto.grupo, contexto.exibidos] : [contexto.tipo]
  const id = hashFnv1a(JSON.stringify([itemAlvo, camposDoFormato, camposDoContexto, limiteMs ?? null]))
  return {
    id,
    alvo: topicoDeItem(itemAlvo).id,
    itemAlvo,
    formato,
    contexto,
    ...(limiteMs === undefined ? {} : { limiteMs }),
  }
}

/** Erro esperado da geração de questões. */
export type ErroDeQuestao = {
  codigo:
    | 'ITEM_INEXISTENTE'
    | 'GRUPO_INEXISTENTE'
    | 'DISTRATORES_INSUFICIENTES'
    | 'ALVOS_INVALIDOS'
    | 'ALVOS_DEMAIS'
    | 'LIMITE_INVALIDO'
  detalhe: string
}
