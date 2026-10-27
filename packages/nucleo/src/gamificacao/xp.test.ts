import { describe, expect, it } from 'vitest'
import { NORMAS_DE_LATENCIA_VAZIAS, type NormasDeLatencia } from '../avaliacao/normas-de-latencia'
import type { Avaliacao } from '../avaliacao/tipos'
import { desembrulhar } from '../base/resultado'
import type { Milis } from '../base/tempo'
import { TECNICAS_TODAS_LIGADAS, type Tecnicas } from '../catalogo/tecnicas'
import type { IdGrupo, IdItem } from '../catalogo/tipos'
import { PARAMETROS_PADRAO as P, resolverParametros, type QualidadeDeResposta } from '../memoria/parametros'
import { criarQuestao, type ContextoDeQuestao, type Questao, type TipoDeTarefa } from '../questoes/questao'
import { xpDaTarefa, type TarefaParaXp } from './xp'

// Parâmetros ajustados para nenhum número do XP coincidir com outro nem com o padrão: no padrão, a faixa de 50%, o
// multiplicador dela e os minutos da lição acelerada valem todos 0,5, e trocar um pelo outro não mudaria nenhum caso.
// Os limiares do chute sistemático e as amostras mínimas, também lidos pelo XP, ficam no padrão (2, 3, 10 e 8), e
// nenhum valor ajustado repete um deles.
const AJUSTADOS = desembrulhar(
  resolverParametros({
    minutosLicao: 2.4,
    minutosLicaoAcelerada: 0.3,
    minutosPorQuestao: 0.2,
    folgaSobreMedianaMs: 2000,
    multiplicadorXpPerfeita: 1.3,
    acertoMinimoXpCheio: 0.75,
    multiplicadorXpCheio: 0.9,
    acertoMinimoXpParcial: 0.6,
    multiplicadorXpParcial: 0.4,
    multiplicadorXpInsuficiente: 0.1,
    multiplicadorXpChute: -0.7,
  }),
)

const questao = (k: number): Questao =>
  criarQuestao(`item-${String(k)}` as IdItem, { tipo: 'rotulo-digitado' }, { tipo: 'isolada' })
const questoes = (n: number): Questao[] => Array.from({ length: n }, (_, k) => questao(k))
const certa: Avaliacao = { correta: true, qualidade: 'perfeita', direcao: 'recordar', deltaBruto: 1 }
const errada: Avaliacao = { correta: false, qualidade: 'errada', direcao: 'recordar', deltaBruto: -1 }
const chute: Avaliacao = { correta: false, qualidade: 'chute', direcao: 'recordar', deltaBruto: -1 }
/** Avaliações por letra: c é certa, e é errada, x é chute. */
const av = (texto: string): Avaliacao[] => texto.split('').map((l) => (l === 'c' ? certa : l === 'x' ? chute : errada))

const xp = (
  tarefa: TarefaParaXp,
  avaliacoes: readonly Avaliacao[],
  ultimas: readonly QualidadeDeResposta[] = [],
  normas: NormasDeLatencia = NORMAS_DE_LATENCIA_VAZIAS,
  tecnicas: Tecnicas = TECNICAS_TODAS_LIGADAS,
) => xpDaTarefa(tarefa, avaliacoes, ultimas, normas, AJUSTADOS, tecnicas)
const tarefa = (tipo: TipoDeTarefa, n: number, acelerada?: boolean): TarefaParaXp =>
  acelerada === undefined ? { tipo, questoes: questoes(n) } : { tipo, acelerada, questoes: questoes(n) }

describe('xpDaTarefa: casos fixos', () => {
  it('lição perfeita vale os minutos da lição vezes o bônus, e a acelerada, os minutos dela', () => {
    // 2,4 minutos x 1,3 = 3,12; acelerada, 0,3 x 1,3 = 0,39. O número de questões não conta na lição.
    expect(xp(tarefa('licao', 3), av('ccc'))).toBeCloseTo(3.12, 10)
    expect(xp(tarefa('licao', 3, true), av('ccc'))).toBeCloseTo(0.39, 10)
    expect(xp(tarefa('licao', 6), av('cccccc'))).toBeCloseTo(3.12, 10)
  })

  it('revisão com 80% de acerto vale o XP cheio dos minutos por questão', () => {
    // Cinco questões de 0,2 minuto, 4 de 5 certas: 0,8 >= 0,75, então 1,0 x 0,9 = 0,9.
    expect(xp(tarefa('revisao-grupo', 5), av('ccecc'))).toBeCloseTo(0.9, 10)
    expect(xp(tarefa('revisao', 5), av('cccce'))).toBeCloseTo(0.9, 10)
  })

  it('com amostras bastantes, cada questão vale a mediana própria do formato mais a folga', () => {
    // Mediana 4000 ms e folga 2000 ms: 6 s, um décimo de minuto por questão; cinco questões, 80%: 0,5 x 0,9 = 0,45.
    const normas = { ...NORMAS_DE_LATENCIA_VAZIAS, 'rotulo-digitado': Array.from({ length: 8 }, () => 4000 as Milis) }
    expect(xp(tarefa('revisao-grupo', 5), av('ccecc'), [], normas)).toBeCloseTo(0.45, 10)
  })

  it('numa revisão de grupo com formatos misturados, cada questão vale a mediana do próprio formato', () => {
    // Medianas de 1000 ms em estimulo-para-rotulo e de 7000 ms em rotulo-digitado, com a folga de 2000 ms: 0,05 e 0,15
    // minuto. O grupo-membros não tem amostras e vale os minutos por questão, 0,2. Quatro questões perfeitas:
    // (0,2 + 0,05 + 2 x 0,15) x 1,3 = 0,715.
    const oito = (latencia: number) => Array.from({ length: 8 }, () => latencia as Milis)
    const normas = { ...NORMAS_DE_LATENCIA_VAZIAS, 'estimulo-para-rotulo': oito(1000), 'rotulo-digitado': oito(7000) }
    const ids = (texto: string) => texto.split('') as IdItem[]
    const grupo: ContextoDeQuestao = { tipo: 'grupo', grupo: 'grupo-1' as IdGrupo, exibidos: ids('acde') }
    const mistas = [
      criarQuestao('a' as IdItem, { tipo: 'grupo-membros', opcoes: ids('abcde') }, grupo),
      criarQuestao('c' as IdItem, { tipo: 'estimulo-para-rotulo', opcoes: ids('acde') }, grupo),
      criarQuestao('d' as IdItem, { tipo: 'rotulo-digitado' }, grupo),
      criarQuestao('e' as IdItem, { tipo: 'rotulo-digitado' }, grupo),
    ]
    expect(xp({ tipo: 'revisao-grupo', questoes: mistas }, av('cccc'), [], normas)).toBeCloseTo(0.715, 10)
  })

  it('as faixas de 60% e abaixo dela dão o multiplicador parcial e o insuficiente', () => {
    // 3 de 5 = 0,6 >= 0,6: 1,0 x 0,4 = 0,4. 2 de 5 = 0,4 < 0,6: 1,0 x 0,1 = 0,1.
    expect(xp(tarefa('quiz', 5), av('cceec'))).toBeCloseTo(0.4, 10)
    expect(xp(tarefa('quiz', 5), av('ceeec'))).toBeCloseTo(0.1, 10)
  })

  it('tarefa com chute sistemático tira XP', () => {
    // Dois chutes num quiz de quatro: 0,8 x -0,7 = -0,56, mesmo com metade certa.
    expect(xp(tarefa('quiz', 4), av('cxcx'))).toBeCloseTo(-0.56, 10)
    // Um chute na tarefa e dois nas respostas anteriores: três nas últimas dez.
    expect(xp(tarefa('quiz', 4), av('cccx'), ['chute', 'perfeita', 'chute'])).toBeCloseTo(-0.56, 10)
    // Um chute só é distração: 3 de 4 = 0,75, XP cheio.
    expect(xp(tarefa('quiz', 4), av('cccx'))).toBeCloseTo(0.72, 10)
  })

  it('diagnóstico e tarefa sem resposta valem 0, e remediação vale como revisão', () => {
    expect(xp(tarefa('diagnostico', 10), av('cccccccccc'))).toBe(0)
    expect(xp(tarefa('revisao', 1), [])).toBe(0)
    expect(xp(tarefa('remediacao', 2), av('cc'))).toBeCloseTo(xp(tarefa('revisao', 2), av('cc')), 10)
    expect(xp(tarefa('remediacao', 2), av('cc'))).toBeCloseTo(0.52, 10)
  })

  it('com os parâmetros padrão, a lição perfeita vale 1,8 e a revisão de uma questão certa, 0,204', () => {
    expect(
      xpDaTarefa(tarefa('licao', 3), av('ccc'), [], NORMAS_DE_LATENCIA_VAZIAS, P, TECNICAS_TODAS_LIGADAS),
    ).toBeCloseTo(1.8, 10)
    expect(
      xpDaTarefa(tarefa('revisao', 1), av('c'), [], NORMAS_DE_LATENCIA_VAZIAS, P, TECNICAS_TODAS_LIGADAS),
    ).toBeCloseTo(0.204, 10)
  })
})

describe('interruptor gamificacao', () => {
  // O mesmo cenário ligado e desligado: uma lição perfeita, uma revisão de grupo com 80% e um quiz no chute.
  const cenario = (tecnicas: Tecnicas) => [
    xp(tarefa('licao', 3), av('ccc'), [], NORMAS_DE_LATENCIA_VAZIAS, tecnicas),
    xp(tarefa('revisao-grupo', 5), av('ccecc'), [], NORMAS_DE_LATENCIA_VAZIAS, tecnicas),
    xp(tarefa('quiz', 4), av('cxcx'), [], NORMAS_DE_LATENCIA_VAZIAS, tecnicas),
  ]

  it('ligada, cada tarefa rende o XP do desempenho', () => {
    const [licao, revisao, quiz] = cenario(TECNICAS_TODAS_LIGADAS)
    expect(licao).toBeCloseTo(3.12, 10)
    expect(revisao).toBeCloseTo(0.9, 10)
    expect(quiz).toBeCloseTo(-0.56, 10)
  })

  it('desligada, toda tarefa vale 0', () => {
    expect(cenario({ ...TECNICAS_TODAS_LIGADAS, gamificacao: false })).toEqual([0, 0, 0])
  })
})
