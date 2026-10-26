import { describe, expect, it } from 'vitest'
import { caminhosLidos, mudaASaida, variacoes, type Formula } from '../apoio-a-testes/regua-de-parametros'
import { desembrulhar } from '../base/resultado'
import { somarDias, type Dias, type Instante } from '../base/tempo'
import { carregarCatalogo } from '../catalogo/carregar-catalogo'
import { TECNICAS_TODAS_LIGADAS } from '../catalogo/tecnicas'
import type { DadosDeCatalogo, IdItem, ItemBruto } from '../catalogo/tipos'
import { topicoDeItem, type IdTopico } from '../grafo/topico'
import { acuraciaInicial, atualizarAcuracia } from './acuracia'
import { prontoParaCronometrar } from './consultas'
import { estadoMemoriaInicial, type EstadoMemoria } from './estado-memoria'
import {
  aplicarRepeticao,
  decaimentoPorAtraso,
  devidoEm,
  fase,
  fatorPrecocidade,
  intervaloIdeal,
  memoriaEm,
  reagendar,
} from './modelo'
import { PARAMETROS_PADRAO as P, type CaminhoDeParametro } from './parametros'
import { ehTopicoLento, velocidade } from './velocidade'

// A régua das fórmulas da camada `memoria`; o que ela confere e o que não pega está em
// `apoio-a-testes/regua-de-parametros.ts`. As trocas parciais ficam com casos fixos em `modelo.test.ts`, como o da guarda
// de `decaimentoPorAtraso`, e com as propriedades de parâmetros sorteados.

const T0 = 1_700_000_000_000 as Instante
const em = (dias: number): Instante => somarDias(T0, dias as Dias)
const repetido = (numRepeticoes: number, memoriaBase: number): EstadoMemoria => ({
  ...estadoMemoriaInicial(P.acuraciaNeutra),
  numRepeticoes,
  memoriaBase,
  ultimaRepEm: T0,
})
const com = (acuracia: number): EstadoMemoria => estadoMemoriaInicial(acuracia)
const LIGADA = TECNICAS_TODAS_LIGADAS

function item(id: string, subcategoria: string, grupos: readonly string[] = []): ItemBruto {
  return {
    id,
    rotulo: `Item ${id}`,
    aliases: [],
    categoria: 'categoria-1',
    subcategoria,
    grupos,
    dificuldadeAPriori: 2,
    descricao: `Descrição de ${id}`,
    classe: 'classe-1',
    vizinhos: [],
  }
}

// 'a' e 'b' formam o grupo-1, e 'a' e 'c' dividem a subcategoria-1. Para 'a', os três anéis têm médias diferentes:
// grupo 0,6 (b), subcategoria 0,9 (c) e global 0,533 (b, c e d).
const catalogo = desembrulhar(
  carregarCatalogo({
    itens: [
      item('a', 'subcategoria-1', ['grupo-1']),
      item('b', 'subcategoria-2', ['grupo-1']),
      item('c', 'subcategoria-1'),
      item('d', 'subcategoria-2'),
    ],
    grupos: [{ id: 'grupo-1', nome: 'Grupo 1', membros: ['a', 'b'], tracoDistintivo: { a: 'ta', b: 'tb' } }],
    vizinhancas: [],
    classes: ['classe-1'],
    categorias: [
      {
        id: 'categoria-1',
        nome: 'Categoria 1',
        subcategorias: [
          { id: 'subcategoria-1', nome: 'Sub 1' },
          { id: 'subcategoria-2', nome: 'Sub 2' },
        ],
      },
    ],
  } satisfies DadosDeCatalogo),
)
const topico = (id: string): IdTopico => topicoDeItem(id as IdItem).id
const medidas: ReadonlyMap<IdTopico, EstadoMemoria> = new Map(
  Object.entries({ b: 0.6, c: 0.9, d: 0.1 }).map(([id, a]) => [topico(id), { ...com(a), nAvaliacoes: 3 }]),
)

const DO_INTERVALO = [
  'intervaloBaseDias',
  'crescimentoIntervalo',
  'intervaloMaximoDias',
] as const satisfies readonly CaminhoDeParametro[]
const DA_MEMORIA = [...DO_INTERVALO, 'limiarDevido', 'tetoMemoria'] as const satisfies readonly CaminhoDeParametro[]
const DA_VELOCIDADE = [
  'ganhoAceleracao',
  'acuraciaNeutra',
  'aceleracaoMin',
  'aceleracaoMax',
  'desaceleracaoPorDificuldade.1',
  'desaceleracaoPorDificuldade.2',
  'desaceleracaoPorDificuldade.3',
  'velocidadeMin',
  'velocidadeMax',
] as const satisfies readonly CaminhoDeParametro[]

// O cenário com 50 repetições existe porque o intervalo máximo só age com o intervalo ideal no teto.
const FORMULAS: readonly Formula[] = [
  {
    nome: 'intervaloIdeal',
    dependeDe: DO_INTERVALO,
    cenarios: [(p) => intervaloIdeal(2, p), (p) => intervaloIdeal(50, p)],
  },
  {
    nome: 'memoriaEm',
    dependeDe: DA_MEMORIA,
    cenarios: [(p) => memoriaEm(repetido(2, 0.9), em(1), p), (p) => memoriaEm(repetido(50, 0.9), em(100), p)],
  },
  {
    nome: 'devidoEm',
    dependeDe: DA_MEMORIA,
    cenarios: [(p) => devidoEm(repetido(2, 0.9), p), (p) => devidoEm(repetido(50, 0.9), p)],
  },
  {
    nome: 'fatorPrecocidade',
    dependeDe: DA_MEMORIA,
    cenarios: [(p) => fatorPrecocidade(repetido(2, 1), em(1), p), (p) => fatorPrecocidade(repetido(50, 1), em(100), p)],
  },
  {
    nome: 'decaimentoPorAtraso',
    dependeDe: ['limiarDevido', 'kDecaimentoPorAtraso', 'tetoDecaimentoPorAtraso'],
    cenarios: [(p) => decaimentoPorAtraso(0.2, p)],
  },
  {
    nome: 'aplicarRepeticao',
    dependeDe: [...DA_MEMORIA, 'kDecaimentoPorAtraso', 'tetoDecaimentoPorAtraso'],
    cenarios: [
      // Erro bem depois do vencimento, com a memória abaixo do limiar: o decay multiplica o recuo.
      (p) => aplicarRepeticao(repetido(3, 1), { deltaBruto: -1, agora: em(20), velocidade: 1, origem: 'explicita' }, p),
      // Acerto cedo com o intervalo no teto: a precocidade desconta o avanço.
      (p) =>
        aplicarRepeticao(repetido(50, 1), { deltaBruto: 1, agora: em(100), velocidade: 1, origem: 'explicita' }, p),
    ],
  },
  {
    nome: 'reagendar',
    dependeDe: DA_MEMORIA,
    cenarios: [
      (p) => reagendar(repetido(2, 0.9), T0, 3 as Dias, p),
      (p) => reagendar(repetido(50, 0.9), T0, 100 as Dias, p),
    ],
  },
  {
    nome: 'fase',
    dependeDe: ['numRepeticoesSaiDoAprendizado', 'numRepeticoesDominado'],
    cenarios: [(p) => fase(repetido(1.9, 1), p), (p) => fase(repetido(3.9, 1), p)],
  },
  {
    nome: 'velocidade',
    dependeDe: DA_VELOCIDADE,
    // Acurácia 0 põe a aceleração no piso, e acurácia 1 a deixa logo abaixo do teto.
    cenarios: [
      (p) => velocidade(com(0), 3, p, LIGADA),
      (p) => velocidade(com(1), 1, p, LIGADA),
      (p) => velocidade(com(P.acuraciaNeutra), 2, p, LIGADA),
    ],
  },
  {
    nome: 'ehTopicoLento',
    dependeDe: [...DA_VELOCIDADE, 'limiarTopicoLento'],
    // A saída é booleana e só muda quando um ajuste leva a velocidade para o outro lado do limiar. Por isso há cenários
    // dos dois lados, perto de onde cada parâmetro age; nos padrões, a velocidade deles vale 0,385, 0,625, 1, 1,058 e
    // 0,975, nesta ordem.
    cenarios: [
      (p) => ehTopicoLento(com(0), 3, p, LIGADA),
      (p) => ehTopicoLento(com(0), 1, p, LIGADA),
      (p) => ehTopicoLento(com(P.acuraciaNeutra), 2, p, LIGADA),
      (p) => ehTopicoLento(com(1), 3, p, LIGADA),
      (p) => ehTopicoLento(com(0.84), 2, p, LIGADA),
    ],
  },
  {
    nome: 'atualizarAcuracia',
    dependeDe: ['alfaAcuracia'],
    cenarios: [(p) => atualizarAcuracia(com(0.85), true, 1, p)],
  },
  {
    nome: 'acuraciaInicial',
    dependeDe: ['pesoAnelGrupo', 'pesoAnelSubcategoria', 'pesoAnelGlobal', 'acuraciaNeutra'],
    cenarios: [
      (p) => acuraciaInicial(topico('a'), catalogo, medidas, p),
      (p) => acuraciaInicial(topico('a'), catalogo, new Map(), p),
    ],
  },
  {
    nome: 'prontoParaCronometrar',
    dependeDe: ['numRepeticoesMinimaCronometrada', 'acuraciaMinimaCronometrada'],
    // Na borda das repetições mínimas, subi-las tira o tópico do cronômetro; com acurácia 0,8, só baixar a mínima dela
    // (a faixa não deixa subir muito acima de 0,9) o põe lá.
    cenarios: [
      (p) => prontoParaCronometrar({ ...com(0.9), numRepeticoes: 3 }, p),
      (p) => prontoParaCronometrar({ ...com(0.8), numRepeticoes: 5 }, p),
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
