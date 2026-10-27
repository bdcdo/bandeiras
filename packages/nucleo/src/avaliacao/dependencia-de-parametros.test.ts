import { describe, expect, it } from 'vitest'
import { catalogoFixo } from '../apoio-a-testes/catalogo-de-teste'
import { estadoDeTeste } from '../apoio-a-testes/estado-de-teste'
import { caminhosLidos, mudaASaida, variacoes, type Formula } from '../apoio-a-testes/regua-de-parametros'
import type { Milis } from '../base/tempo'
import { TECNICAS_TODAS_LIGADAS } from '../catalogo/tecnicas'
import type { IdItem } from '../catalogo/tipos'
import type { EstadoMemoria } from '../memoria'
import { QUALIDADES_DE_RESPOSTA, type CaminhoDeParametro, type QualidadeDeResposta } from '../memoria/parametros'
import { criarQuestao, type Questao } from '../questoes/questao'
import { avaliarResposta } from './avaliar-resposta'
import { chuteSistematico } from './chute-sistematico'
import {
  limiteCronometrado,
  medianaDoFormato,
  NORMAS_DE_LATENCIA_VAZIAS,
  registrarLatencia,
} from './normas-de-latencia'
import type { Avaliacao, Resposta } from './tipos'

// A régua das fórmulas da camada `avaliacao`; o que ela confere e o que não pega está em
// `apoio-a-testes/regua-de-parametros.ts`. A troca entre dois deltas de mesmo padrão, que ela não pega, fica com o caso
// de deltas ajustados de `avaliar-resposta.test.ts`.

const catalogo = catalogoFixo()
const ids = (texto: string): IdItem[] => texto.split('') as IdItem[]
const [A, C] = ids('ac') as [IdItem, IdItem]
const ms = (n: number) => n as Milis
const OITO = [1000, 1100, 1200, 1400, 1600, 1800, 1900, 2000]
// O texto digitado leva o dobro das latências da múltipla escolha: com os mesmos números nos dois formatos, uma fórmula
// que lesse a mediana do formato errado daria a mesma saída.
const normasCom = (latencias: readonly number[]) => ({
  ...NORMAS_DE_LATENCIA_VAZIAS,
  'estimulo-para-rotulo': latencias.map(ms),
  'rotulo-digitado': latencias.map((x) => ms(2 * x)),
})
const epr = (limiteMs?: number): Questao =>
  criarQuestao(
    A,
    { tipo: 'estimulo-para-rotulo', opcoes: ids('aceg') },
    { tipo: 'isolada' },
    limiteMs as Milis | undefined,
  )
const escolha = (id: IdItem, latencia: number): Resposta => ({
  tipo: 'escolha',
  escolhidas: [id],
  latencia: ms(latencia),
})
const pronto = (repeticoes: number, acuracia: number): EstadoMemoria => estadoDeTeste({ repeticoes, acuracia })
/** Qualidades por letra: c é chute e p é perfeita. */
const q = (texto: string): QualidadeDeResposta[] => texto.split('').map((l) => (l === 'c' ? 'chute' : 'perfeita'))

const DELTAS = QUALIDADES_DE_RESPOSTA.map((x): CaminhoDeParametro => `deltaBruto.${x}`)

const FORMULAS: readonly Formula[] = [
  {
    nome: 'avaliarResposta',
    dependeDe: [...DELTAS, 'latenciaChuteMs', 'amostrasMinimasDeLatencia'],
    // Um cenário por qualidade, com as oito amostras do mínimo padrão e mediana 1500 ms.
    cenarios: (
      [
        [epr(), escolha(A, 1000)],
        [epr(), escolha(A, 1700)],
        [epr(5000), escolha(A, 1700)],
        [epr(), escolha(C, 1000)],
        [epr(), escolha(C, 100)],
        [epr(), { tipo: 'nao-sei' }],
        [epr(5000), { tipo: 'tempo-esgotado' }],
      ] as const
    ).map(
      ([questao, resposta]) =>
        (p) =>
          avaliarResposta(questao, resposta, catalogo, normasCom(OITO), p),
    ),
  },
  {
    nome: 'registrarLatencia',
    dependeDe: ['janelaNormasDeLatencia'],
    cenarios: [
      (p) => {
        const certa: Avaliacao = { correta: true, qualidade: 'perfeita', direcao: 'reconhecer', deltaBruto: 1 }
        const cheias = normasCom(Array.from({ length: 20 }, (_, i) => 1000 + i))
        return registrarLatencia(cheias, epr(), escolha(A, 999), certa, p)
      },
    ],
  },
  {
    nome: 'medianaDoFormato',
    dependeDe: ['amostrasMinimasDeLatencia'],
    cenarios: [(p) => medianaDoFormato(normasCom(OITO), 'rotulo-digitado', p)],
  },
  {
    nome: 'limiteCronometrado',
    dependeDe: [
      'numRepeticoesMinimaCronometrada',
      'acuraciaMinimaCronometrada',
      'limiteCronometradoMinMs',
      'fatorLimiteCronometrado',
      'amostrasMinimasDeLatencia',
    ],
    // Mediana de 3000 ms no texto digitado, acima do piso depois do fator; sem amostras; e um tópico abaixo da acurácia
    // mínima, que só a acurácia mínima menor deixa cronometrar.
    cenarios: [
      (p) => limiteCronometrado(pronto(3, 0.9), normasCom(OITO), 'rotulo-digitado', p, TECNICAS_TODAS_LIGADAS),
      (p) =>
        limiteCronometrado(pronto(3, 0.9), NORMAS_DE_LATENCIA_VAZIAS, 'rotulo-digitado', p, TECNICAS_TODAS_LIGADAS),
      (p) => limiteCronometrado(pronto(5, 0.8), normasCom(OITO), 'rotulo-digitado', p, TECNICAS_TODAS_LIGADAS),
    ],
  },
  {
    nome: 'chuteSistematico',
    dependeDe: ['chutesNaTarefaSistematico', 'chutesNasUltimasSistematico', 'janelaChuteSistematico'],
    cenarios: [
      (p) => chuteSistematico(q('cc'), [], p),
      (p) => chuteSistematico(q('pc'), q('cpppppc'), p),
      (p) => chuteSistematico(q('pc'), q('cpppppppc'), p),
    ],
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
