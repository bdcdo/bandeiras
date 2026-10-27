import type { Instante } from '../base/tempo'
import type { Direcao } from '../catalogo/tipos'
import type { ContextoDePropagacao, Memorias } from '../fire'
import type { IdTopico } from '../grafo'
import {
  acuraciaInicial,
  aplicarRepeticao,
  atualizarAcuracia,
  estadoMemoriaInicial,
  velocidade,
  type EstadoMemoria,
} from '../memoria'
import type { ContextoDeReducao } from './contexto'
import { escrever, type Copiavel, type Rascunho } from './rascunho'

// Os efeitos de memória da redução, todos sobre o mapa do rascunho. Cada um lê o estado do tópico no rascunho, aplica uma
// função de memoria/ ou de fire/ e grava o resultado de volta; nenhum lê ou escreve campo de EstadoMemoria, que é
// assunto dessas duas camadas.

/** O contexto que as funções de fire/ leem, com o instante do evento como agora. */
export function contextoDePropagacao(ctx: ContextoDeReducao, agora: Instante): ContextoDePropagacao {
  return { grafo: ctx.grafo, parametros: ctx.parametros, tecnicas: ctx.tecnicas, agora, dificuldade: ctx.dificuldade }
}

/**
 * O estado com que `t` começa: a acurácia que a vizinhança prevê sobre as memórias dadas. Quem chama passa as memórias do
 * rascunho no ponto do log em que o tópico nasce, e por isso a previsão do vivo e a da reconstrução são a mesma.
 */
export function memoriaInicial(ctx: ContextoDeReducao, t: IdTopico, memorias: Memorias): EstadoMemoria {
  return estadoMemoriaInicial(acuraciaInicial(t, ctx.catalogo, memorias, ctx.parametros))
}

/**
 * Cria o estado de `t` se ele ainda não tem, e o devolve. Roda antes de todo efeito que mede ou repete o tópico, para a
 * evidência não se perder: a propagação pula tópico sem estado como nunca estudado.
 */
export function garantirMemoria(ctx: ContextoDeReducao, r: Rascunho, t: IdTopico): EstadoMemoria {
  const atual = r.memorias.atual.get(t)
  if (atual !== undefined) return atual
  const inicial = memoriaInicial(ctx, t, r.memorias.atual)
  escrever(r.memorias).set(t, inicial)
  return inicial
}

/**
 * A resposta só mede: a acurácia geral e a da direção recebem o acerto, com peso 1, sem repetição nem propagação. É o
 * efeito da lição, em que a pergunta vem logo depois da apresentação, e o de toda resposta sobre tópico sem lição
 * concluída, para a repetição dela não ser descontada pela precocidade quando a lição concluir minutos depois.
 */
export function medir(ctx: ContextoDeReducao, r: Rascunho, t: IdTopico, acerto: boolean, direcao: Direcao): void {
  const e = garantirMemoria(ctx, r, t)
  escrever(r.memorias).set(t, atualizarAcuracia(e, acerto, 1, ctx.parametros, direcao))
}

/**
 * A repetição da lição concluída: explícita, com o rawDelta da resposta perfeita, a velocidade do momento e o instante do
 * evento, sem propagação. A lição não tem tentativa explícita anterior, então a precocidade não desconta nada, e o
 * tópico vence perto de um intervalo ideal depois, que é a revisão seguinte à lição.
 */
export function repetirLicao(ctx: ContextoDeReducao, r: Rascunho, t: IdTopico, agora: Instante): void {
  const e = garantirMemoria(ctx, r, t)
  const { parametros, tecnicas } = ctx
  const repeticao = {
    deltaBruto: parametros.deltaBruto.perfeita,
    agora,
    velocidade: velocidade(e, ctx.dificuldade(t), parametros, tecnicas),
    origem: 'explicita' as const,
  }
  escrever(r.memorias).set(t, aplicarRepeticao(e, repeticao, parametros))
}

/**
 * As memórias que uma função de fire/ pode ler ou escrever ao partir das origens dadas: as do alcance de cada origem
 * (`ContextoDeReducao.alcance`) que têm estado. Fora do alcance a propagação não lê nem escreve nada, e por isso a
 * função sobre o submapa dá, em cada tópico dele, o mesmo que sobre o mapa inteiro. A diferença é o custo: cada função
 * de fire/ copia o mapa que recebe, e copiar um item e os grupos dele a cada resposta, em vez das memórias todas, é o
 * que separa a reconstrução de um log longo do teto de tempo dela.
 */
export function submapa(
  ctx: ContextoDeReducao,
  memorias: Memorias,
  origens: readonly IdTopico[],
): Map<IdTopico, EstadoMemoria> {
  const sub = new Map<IdTopico, EstadoMemoria>()
  for (const origem of origens) {
    for (const t of ctx.alcance(origem)) {
      const e = memorias.get(t)
      if (e !== undefined) sub.set(t, e)
    }
  }
  return sub
}

/**
 * Grava no mapa do rascunho o que uma função de fire/ devolveu sobre um submapa, só as entradas que mudaram. Tópico que
 * já tinha estado fica na posição dele, e o que nasceu no submapa entra no fim, como entraria se a função tivesse rodado
 * sobre o mapa inteiro: assim a ordem do mapa, que o instantâneo do estado compara, também não muda com o submapa. Na
 * reconstrução o rascunho é dono do mapa, e a escrita é no lugar.
 */
export function devolver(memorias: Copiavel<IdTopico, EstadoMemoria>, depois: Memorias): void {
  for (const [t, e] of depois) if (memorias.atual.get(t) !== e) escrever(memorias).set(t, e)
}
