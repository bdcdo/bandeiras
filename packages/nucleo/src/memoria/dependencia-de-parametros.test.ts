import { describe, expect, it } from 'vitest'
import { desembrulhar } from '../base/resultado'
import { somarDias, type Dias, type Instante } from '../base/tempo'
import { carregarCatalogo } from '../catalogo/carregar-catalogo'
import { TECNICAS_TODAS_LIGADAS } from '../catalogo/tecnicas'
import type { DadosDeCatalogo, IdItem, ItemBruto } from '../catalogo/tipos'
import { topicoDeItem, type IdTopico } from '../grafo/topico'
import { acuraciaInicial, atualizarAcuracia } from './acuracia'
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
import { PARAMETROS_PADRAO as P, resolverParametros, type CaminhoDeParametro, type Parametros } from './parametros'
import { ehTopicoLento, velocidade } from './velocidade'

// Régua de uma classe de defeito: a fórmula que lê um parâmetro no lugar de outro. Vários parâmetros têm o mesmo valor
// padrão, e uma troca entre dois deles dá os mesmos números em todo teste que roda com os padrões. A régua declara, para
// cada fórmula da camada, de quais caminhos de parâmetro ela depende, inclusive pelas fórmulas que chama, e confere duas
// coisas. Primeiro, que a fórmula lê exatamente esses caminhos, registrados por um Proxy; segundo, que cada um deles,
// ajustado sozinho por `resolverParametros`, muda a saída em ao menos um dos cenários fixos. Uma troca reprova as duas: o
// caminho trocado deixa de mover a saída, e o que entrou no lugar dele aparece entre os lidos sem estar declarado. Uma
// fórmula que passe a ler um caminho novo reprova a primeira até ele entrar na lista dela, com um cenário em que mova a
// saída.

/**
 * Os parâmetros, com cada caminho lido anotado em `lidos`. O Proxy envolve uma cópia rasa de cada nível, e não o objeto
 * congelado: sobre uma propriedade congelada, o Proxy é obrigado a devolver o próprio valor dela, e não poderia devolver
 * o espião do objeto aninhado no lugar.
 */
function espiao(p: Parametros, lidos: Set<string>): Parametros {
  const espiar = (alvo: object, prefixo: string): object =>
    new Proxy(
      { ...alvo },
      {
        get(copia, chave) {
          const valor: unknown = Reflect.get(copia, chave)
          if (typeof chave !== 'string') return valor
          if (typeof valor === 'object' && valor !== null) return espiar(valor, `${prefixo}${chave}.`)
          lidos.add(`${prefixo}${chave}`)
          return valor
        },
      },
    )
  return espiar(p, '') as Parametros
}

function valorPadrao(caminho: CaminhoDeParametro): number {
  const [chave = '', sub] = caminho.split('.')
  const valor: unknown = Reflect.get(P, chave)
  const folha: unknown = sub === undefined ? valor : Reflect.get(valor as object, sub)
  if (typeof folha !== 'number') throw new Error(`caminho sem valor numérico: ${caminho}`)
  return folha
}

/**
 * Múltiplos do valor padrão tentados em cada caminho; os que `resolverParametros` recusa, pela faixa ou por uma relação,
 * ficam de fora. Os múltiplos longe de 1 existem porque alguns parâmetros só agem longe do padrão, como os limites da
 * velocidade, que a razão nunca alcança com os padrões.
 */
const FATORES = [0.25, 0.5, 0.8, 1.25, 2, 4]

const variacoes = (caminho: CaminhoDeParametro): Parametros[] =>
  FATORES.flatMap((fator) => {
    const r = resolverParametros({ [caminho]: valorPadrao(caminho) * fator })
    return r.ok ? [r.valor] : []
  })

// A saída de toda fórmula aqui é número, booleano, texto ou estado de números, e o JSON compara todos bit a bit.
const mesmaSaida = (a: unknown, b: unknown): boolean => JSON.stringify(a) === JSON.stringify(b)

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

type Formula = Readonly<{
  nome: string
  dependeDe: readonly CaminhoDeParametro[]
  /** Cenários fixos; cada caminho de `dependeDe` precisa mover a saída em ao menos um deles. */
  cenarios: readonly ((p: Parametros) => unknown)[]
}>

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
]

describe.each(FORMULAS)('$nome depende dos parâmetros que declara', ({ dependeDe, cenarios }) => {
  it('lê exatamente esses caminhos de parâmetro', () => {
    const lidos = new Set<string>()
    for (const cenario of cenarios) cenario(espiao(P, lidos))
    expect(lidos).toEqual(new Set(dependeDe))
  })

  it.each(dependeDe)('muda a saída quando só %s muda', (caminho) => {
    const ajustes = variacoes(caminho)
    expect(ajustes.length).toBeGreaterThan(0)
    const mudou = cenarios.some((cenario) => ajustes.some((p) => !mesmaSaida(cenario(p), cenario(P))))
    expect(mudou).toBe(true)
  })
})
