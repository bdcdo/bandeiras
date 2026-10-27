import { describe, expect, it } from 'vitest'
import { caminhosLidos, mudaASaida, variacoes, type Formula } from '../apoio-a-testes/regua-de-parametros'
import { NORMAS_DE_LATENCIA_VAZIAS } from '../avaliacao/normas-de-latencia'
import type { Avaliacao } from '../avaliacao/tipos'
import type { Instante, Milis } from '../base/tempo'
import { TECNICAS_TODAS_LIGADAS } from '../catalogo/tecnicas'
import type { IdItem } from '../catalogo/tipos'
import type { CaminhoDeParametro, Parametros, QualidadeDeResposta } from '../memoria/parametros'
import { criarQuestao, type TipoDeTarefa } from '../questoes/questao'
import { diaLocal } from './dia-local'
import { xpDaTarefa } from './xp'

// A régua das fórmulas da camada `gamificacao`; o que ela confere e o que não pega está em
// `apoio-a-testes/regua-de-parametros.ts`. As trocas entre a faixa de 50%, o multiplicador dela e os minutos da lição
// acelerada, os três de padrão 0,5, ficam com os casos de parâmetros ajustados de `xp.test.ts`.

const questoes = (n: number) =>
  Array.from({ length: n }, (_, k) =>
    criarQuestao(`item-${String(k)}` as IdItem, { tipo: 'rotulo-digitado' }, { tipo: 'isolada' }),
  )
const certa: Avaliacao = { correta: true, qualidade: 'perfeita', direcao: 'recordar', deltaBruto: 1 }
const errada: Avaliacao = { correta: false, qualidade: 'errada', direcao: 'recordar', deltaBruto: -1 }
const chute: Avaliacao = { correta: false, qualidade: 'chute', direcao: 'recordar', deltaBruto: -1 }
/** Avaliações por letra: c é certa, e é errada, x é chute. */
const av = (texto: string): Avaliacao[] => texto.split('').map((l) => (l === 'c' ? certa : l === 'x' ? chute : errada))
/** Qualidades anteriores por letra: x é chute, p é perfeita. */
const q = (texto: string): QualidadeDeResposta[] => texto.split('').map((l) => (l === 'x' ? 'chute' : 'perfeita'))
const MEDIANA_6S = { ...NORMAS_DE_LATENCIA_VAZIAS, 'rotulo-digitado': Array.from({ length: 8 }, () => 6000 as Milis) }

const xp =
  (tipo: TipoDeTarefa, avaliacoes: string, anteriores = '', normas = NORMAS_DE_LATENCIA_VAZIAS, acelerada = false) =>
  (p: Parametros) =>
    xpDaTarefa(
      { tipo, acelerada, questoes: questoes(avaliacoes.length) },
      av(avaliacoes),
      q(anteriores),
      normas,
      p,
      TECNICAS_TODAS_LIGADAS,
    )

const FORMULAS: readonly Formula[] = [
  {
    nome: 'xpDaTarefa',
    dependeDe: [
      'minutosLicao',
      'minutosLicaoAcelerada',
      'minutosPorQuestao',
      'folgaSobreMedianaMs',
      'amostrasMinimasDeLatencia',
      'multiplicadorXpPerfeita',
      'acertoMinimoXpCheio',
      'multiplicadorXpCheio',
      'acertoMinimoXpParcial',
      'multiplicadorXpParcial',
      'multiplicadorXpInsuficiente',
      'multiplicadorXpChute',
      'chutesNaTarefaSistematico',
      'chutesNasUltimasSistematico',
      'janelaChuteSistematico',
    ],
    // Uma tarefa por faixa e por base de minutos, e as três formas de chegar ao chute sistemático: dois chutes na tarefa,
    // três nas últimas dez, e um que só a janela maior alcança.
    cenarios: [
      xp('licao', 'ccc'),
      xp('licao', 'ccc', '', NORMAS_DE_LATENCIA_VAZIAS, true),
      xp('revisao-grupo', 'cccce'),
      xp('revisao-grupo', 'cccce', '', MEDIANA_6S),
      xp('quiz', 'cceec'),
      xp('quiz', 'ceeec'),
      xp('quiz', 'cxcx'),
      xp('quiz', 'cccx', 'xx'),
      xp('quiz', 'cccx', 'xppppppx'),
    ],
  },
  {
    nome: 'diaLocal',
    dependeDe: ['horaViradaDoDia'],
    // 3h59 em Brasília: dia anterior com a virada às 4h, o próprio dia com ela mais cedo.
    cenarios: [(p) => diaLocal(Date.UTC(2026, 9, 26, 6, 59) as Instante, 180, p)],
  },
]

describe.each(FORMULAS)('$nome depende dos parâmetros que declara', (formula) => {
  it('lê exatamente esses caminhos de parâmetro', () => {
    expect(caminhosLidos(formula)).toEqual(new Set(formula.dependeDe))
  })

  it.each(formula.dependeDe)('muda a saída quando só %s muda', (caminho: CaminhoDeParametro) => {
    expect(variacoes(caminho).length).toBeGreaterThan(0)
    expect(mudaASaida(formula, caminho)).toBe(true)
  })
})
