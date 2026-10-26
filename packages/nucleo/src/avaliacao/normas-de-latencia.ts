import type { Milis } from '../base/tempo'
import type { Tecnicas } from '../catalogo/tecnicas'
import { prontoParaCronometrar, type EstadoMemoria, type Parametros } from '../memoria'
import type { Questao, TipoDeFormato } from '../questoes'
import type { Avaliacao, Resposta } from './tipos'

/**
 * Latências das últimas respostas certas da pessoa, por formato de questão, da mais antiga para a mais recente. A
 * janela, `janelaNormasDeLatencia`, faz a mediana acompanhar a pessoa de agora, e não a do primeiro dia.
 *
 * Por formato, e não por item, porque digitar um rótulo leva mais tempo que apontar uma opção, e o que a mediana mede é
 * a fluência da pessoa naquele modo de responder. Lista simples, e não estrutura com índice, para o estado caber em
 * JSON tal como é.
 */
export type NormasDeLatencia = Readonly<Record<TipoDeFormato, readonly Milis[]>>

/**
 * Normas de quem ainda não respondeu nada: todo formato sem amostra. Os formatos estão escritos um a um, e não tirados
 * de `FORMATOS_DE_QUESTAO`, para o compilador conferir a lista: o `Record` exige uma chave por formato, e um formato
 * novo sem chave aqui não compila.
 */
export const NORMAS_DE_LATENCIA_VAZIAS: NormasDeLatencia = Object.freeze({
  'estimulo-para-rotulo': [],
  'rotulo-para-estimulo': [],
  'rotulo-digitado': [],
  'grupo-membros': [],
  associacao: [],
})

/**
 * Normas com a latência desta resposta, se ela conta. Conta a resposta explícita certa, de escolha ou de texto: o erro
 * fica fora porque a mediana é o ritmo de quem sabe, e o chute é sempre erro (a avaliação nunca chama acerto de chute),
 * então nenhum chute entra. Devolve as mesmas normas quando a resposta não conta.
 */
export function registrarLatencia(
  normas: NormasDeLatencia,
  questao: Questao,
  resposta: Resposta,
  avaliacao: Avaliacao,
  parametros: Parametros,
): NormasDeLatencia {
  if (!avaliacao.correta || (resposta.tipo !== 'escolha' && resposta.tipo !== 'texto')) return normas
  const formato = questao.formato.tipo
  const amostras = [...normas[formato], resposta.latencia].slice(-parametros.janelaNormasDeLatencia)
  return Object.freeze({ ...normas, [formato]: Object.freeze(amostras) })
}

/**
 * Mediana das latências do formato, ou `undefined` com menos de `amostrasMinimasDeLatencia` amostras: com poucas, uma
 * resposta distraída moveria a régua de todas as seguintes. Com número par de amostras, a média das duas do meio.
 */
export function medianaDoFormato(
  normas: NormasDeLatencia,
  formato: TipoDeFormato,
  parametros: Parametros,
): Milis | undefined {
  const amostras = normas[formato]
  if (amostras.length < parametros.amostrasMinimasDeLatencia) return undefined
  // A faixa de `amostrasMinimasDeLatencia` começa em 1, então aqui há pelo menos uma amostra; os `?? 0` só satisfazem o
  // acesso por índice, que o compilador trata como possivelmente ausente.
  const ordenadas = [...amostras].sort((a, b) => a - b)
  const meio = Math.floor(ordenadas.length / 2)
  const alta = ordenadas[meio] ?? 0
  const mediana = ordenadas.length % 2 === 1 ? alta : ((ordenadas[meio - 1] ?? 0) + alta) / 2
  return mediana as Milis
}

/**
 * Limite de tempo para a próxima questão do tópico naquele formato, ou `undefined` quando ela vai sem cronômetro.
 *
 * Sem cronômetro com a técnica `cronometragem` desligada e enquanto o tópico não tem as repetições e a acurácia mínimas:
 * o livro só cronometra depois de a pessoa acertar sem tempo (The Math Academy Way, p. 289). Pronto o tópico, o limite é
 * `fatorLimiteCronometrado` vezes a mediana própria do formato, com o piso `limiteCronometradoMinMs`; sem amostras
 * bastantes para a mediana, vale o piso.
 *
 * A camada `questoes` fica abaixo desta e não vê as normas; quem planeja a tarefa chama esta função e passa o resultado
 * a `gerarQuestao`.
 */
export function limiteCronometrado(
  memoria: EstadoMemoria,
  normas: NormasDeLatencia,
  formato: TipoDeFormato,
  parametros: Parametros,
  tecnicas: Tecnicas,
): Milis | undefined {
  if (!tecnicas.cronometragem || !prontoParaCronometrar(memoria, parametros)) return undefined
  const mediana = medianaDoFormato(normas, formato, parametros)
  if (mediana === undefined) return parametros.limiteCronometradoMinMs as Milis
  return Math.max(parametros.limiteCronometradoMinMs, parametros.fatorLimiteCronometrado * mediana) as Milis
}
