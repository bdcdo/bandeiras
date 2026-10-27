import { describe, expect, it } from 'vitest'
import { catalogoFixo } from '../apoio-a-testes/catalogo-de-teste'
import { caminhosLidos, mudaASaida, variacoes, type Formula } from '../apoio-a-testes/regua-de-parametros'
import { sorteioComSemente } from '../base/sorteio-com-semente'
import type { IdGrupo, IdItem } from '../catalogo/tipos'
import { topicoDeItem } from '../grafo/topico'
import { estadoMemoriaInicial } from '../memoria'
import { PARAMETROS_PADRAO, type CaminhoDeParametro } from '../memoria/parametros'
import { chaveDeOpcoes, contextoDeSessao, type ContextoDeSessao } from './contexto-de-sessao'
import { escolherDistratores } from './distratores'
import { gerarQuestao } from './gerar-questao'
import { gerarQuestoesDeGrupo } from './tarefa-de-grupo'

// A régua das fórmulas da camada `questoes`; o que ela confere e o que não pega está em
// `apoio-a-testes/regua-de-parametros.ts`.

const catalogo = catalogoFixo()
const ids = (texto: string): IdItem[] => texto.split('') as IdItem[]
const [A, C, E] = ids('ace') as [IdItem, IdItem, IdItem]
const VAZIO = contextoDeSessao({})
const sorteio = () => sorteioComSemente('regua')

// c com dois usos: no máximo padrão, 2, sai do pool de a; com o máximo maior, volta.
const COM_USOS: ContextoDeSessao = { ...VAZIO, usosComoDistrator: new Map([[C, 2]]) }
// Toda escolha de k dissimilares de a já mostrada com ele: f, h, j e l, da categoria preferida. As tentativas se
// esgotam, e o que sai é o sorteio da última, que muda com o número delas.
const DISSIMILARES_DE_A = ids('fhjl')
function combinacoes(itens: readonly IdItem[], k: number): IdItem[][] {
  if (k === 0) return [[]]
  return itens.flatMap((x, i) => combinacoes(itens.slice(i + 1), k - 1).map((resto) => [x, ...resto]))
}
const tudoMostrado = (k: number): ContextoDeSessao => ({
  ...VAZIO,
  conjuntosUsados: new Set(combinacoes(DISSIMILARES_DE_A, k).map((c) => chaveDeOpcoes([A, ...c]))),
})
// Duas escolhas para o pedido direto de dois distratores, três para a questão de quatro opções do padrão.
const TUDO_MOSTRADO = tudoMostrado(2)
const TUDO_MOSTRADO_NA_QUESTAO = tudoMostrado(3)

const DOS_DISTRATORES = [
  'usosMaximosComoDistrator',
  'tentativasDeOpcoesNovas',
] as const satisfies readonly CaminhoDeParametro[]

const FORMULAS: readonly Formula[] = [
  {
    nome: 'escolherDistratores',
    dependeDe: DOS_DISTRATORES,
    cenarios: [
      (p) => escolherDistratores(A, 'parecidos', 2, catalogo, COM_USOS, sorteio(), p),
      (p) => escolherDistratores(A, 'dissimilares', 2, catalogo, TUDO_MOSTRADO, sorteio(), p),
    ],
  },
  {
    nome: 'gerarQuestao',
    dependeDe: ['opcoesMultiplaEscolha', ...DOS_DISTRATORES],
    cenarios: [
      (p) => gerarQuestao({ tipo: 'licao', item: C, kp: 1 }, catalogo, VAZIO, sorteio(), p),
      (p) => gerarQuestao({ tipo: 'discriminacao', item: A }, catalogo, COM_USOS, sorteio(), p),
      (p) => gerarQuestao({ tipo: 'licao', item: A, kp: 2 }, catalogo, TUDO_MOSTRADO_NA_QUESTAO, sorteio(), p),
    ],
  },
  {
    nome: 'gerarQuestoesDeGrupo',
    dependeDe: ['opcoesMinimasDeGrupo'],
    // O grupo-2 tem dois membros e é completado com vizinhos até as opções mínimas.
    cenarios: [
      (p) =>
        gerarQuestoesDeGrupo(
          'grupo-2' as IdGrupo,
          [E],
          new Map([[topicoDeItem(E).id, estadoMemoriaInicial(0.85)]]),
          catalogo,
          VAZIO,
          sorteio(),
          p,
        ),
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

it('todo cenário da régua gera questão com os parâmetros padrão', () => {
  // Um cenário que só devolve erro mediria a mudança de um erro para outro, e não a da questão.
  for (const { cenarios } of FORMULAS) {
    for (const cenario of cenarios) expect(cenario(PARAMETROS_PADRAO)).toMatchObject({ ok: true })
  }
})
