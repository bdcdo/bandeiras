import { describe, expect, it } from 'vitest'
import { catalogoDe, catalogoFixo } from '../apoio-a-testes/catalogo-de-teste'
import { desembrulhar } from '../base/resultado'
import { sorteioComSemente } from '../base/sorteio-com-semente'
import type { IdItem } from '../catalogo/tipos'
import { PARAMETROS_PADRAO as P, resolverParametros } from '../memoria/parametros'
import { chaveDeOpcoes, contextoDeSessao, registrarQuestao, type ContextoDeSessao } from './contexto-de-sessao'
import { escolherDistratores, type ModoDeDistratores } from './distratores'
import { gerarQuestao } from './gerar-questao'
import { opcoesDe } from './questao'

const catalogo = catalogoFixo()
const ids = (texto: string): IdItem[] => texto.split('') as IdItem[]
const [A, B, C, D] = ids('abcd') as [IdItem, IdItem, IdItem, IdItem]
const VAZIO = contextoDeSessao({})

function escolher(
  alvo: IdItem,
  modo: ModoDeDistratores,
  n: number,
  ctx: ContextoDeSessao = VAZIO,
  parametros = P,
  semente = 'distratores',
) {
  return escolherDistratores(alvo, modo, n, catalogo, ctx, sorteioComSemente(semente), parametros)
}
const conjunto = (r: ReturnType<typeof escolher>): Set<IdItem> => new Set(desembrulhar(r))

describe('escolherDistratores em dissimilares', () => {
  it('tira o grupo, os vizinhos e a classe do alvo, e prefere outra categoria', () => {
    // c: classe 1, categoria 2, grupo-1 com a, b e d, vizinho g. Sobram e, i e k na categoria 1 e f, h, j e l na 2.
    expect(conjunto(escolher(C, 'dissimilares', 3))).toEqual(new Set(ids('eik')))
    expect(conjunto(escolher(C, 'dissimilares', 7))).toEqual(new Set(ids('eikfhjl')))
  })

  it('tira quem tem o alvo como vizinho e quem divide vizinhança com ele', () => {
    // e tem a entre os vizinhos; i e j dividem a vizinhanca-1. Para a: sobram f, h, j e l na categoria 2, i e k na 1.
    expect(conjunto(escolher(A, 'dissimilares', 6))).toEqual(new Set(ids('fhjlik')))
    expect(desembrulhar(escolher(ids('i')[0] as IdItem, 'dissimilares', 7))).not.toContain('j')
  })

  it('dentro da categoria preferida, prefere quem tem lição concluída', () => {
    const ctx = contextoDeSessao({ aprendidos: ids('k') })
    expect(desembrulhar(escolher(C, 'dissimilares', 1, ctx))).toEqual(ids('k'))
    // Aprendido de mesma categoria não passa na frente de não aprendido de outra.
    const soDaMesma = contextoDeSessao({ aprendidos: ids('fh') })
    expect(conjunto(escolher(C, 'dissimilares', 3, soDaMesma))).toEqual(new Set(ids('eik')))
  })

  it('devolve erro quando o pool não rende os distratores pedidos', () => {
    expect(escolher(A, 'dissimilares', 7)).toEqual({
      ok: false,
      erro: {
        codigo: 'DISTRATORES_INSUFICIENTES',
        detalhe: "'a' em modo dissimilares: o pool rende 6 distratores, e são pedidos 7",
      },
    })
  })
})

describe('escolherDistratores em parecidos', () => {
  it('vai do grupo aos vizinhos, à classe, à categoria e completa com o resto', () => {
    // a: o parceiro b sai; grupo c e d; vizinho e; classe 1 g; categoria 1 i e k; resto f, h, j e l.
    expect(conjunto(escolher(A, 'parecidos', 2))).toEqual(new Set(ids('cd')))
    expect(conjunto(escolher(A, 'parecidos', 3))).toEqual(new Set(ids('cde')))
    expect(conjunto(escolher(A, 'parecidos', 4))).toEqual(new Set(ids('cdeg')))
    expect(conjunto(escolher(A, 'parecidos', 6))).toEqual(new Set(ids('cdegik')))
    expect(desembrulhar(escolher(A, 'parecidos', 10))).toHaveLength(10)
  })

  it('nunca põe o parceiro indiscernível do alvo entre os distratores', () => {
    for (const semente of ['s1', 's2', 's3', 's4', 's5']) {
      expect(desembrulhar(escolher(A, 'parecidos', 10, VAZIO, P, semente))).not.toContain(B)
      expect(desembrulhar(escolher(B, 'parecidos', 10, VAZIO, P, semente))).not.toContain(A)
    }
  })

  it('nunca põe os dois itens de um par juntos, e conta o par como um no tamanho do pool', () => {
    // c: no grupo há a, b e d, mas a e b são um par, e só um deles entra antes do vizinho g.
    for (const semente of ['s1', 's2', 's3', 's4', 's5']) {
      const r = conjunto(escolher(C, 'parecidos', 3, VAZIO, P, semente))
      expect(r.has(D)).toBe(true)
      expect(r.has(ids('g')[0] as IdItem)).toBe(true)
      expect(Number(r.has(A)) + Number(r.has(B))).toBe(1)
    }
    // Onze itens além de c, menos um pelo par.
    expect(desembrulhar(escolher(C, 'parecidos', 10))).toHaveLength(10)
    expect(escolher(C, 'parecidos', 11)).toMatchObject({ ok: false, erro: { codigo: 'DISTRATORES_INSUFICIENTES' } })
  })
})

describe('escolherDistratores e o contexto da sessão', () => {
  it('tira os pendentes ainda não apresentados', () => {
    const ctx = contextoDeSessao({ pendentesNovas: ids('cd') })
    expect(conjunto(escolher(A, 'parecidos', 2, ctx))).toEqual(new Set(ids('eg')))
  })

  it('tira quem já foi distrator o máximo de vezes, com o máximo ajustado', () => {
    // Máximo 3: com 2 usos o item ainda entra, com 3 sai.
    const p = desembrulhar(resolverParametros({ usosMaximosComoDistrator: 3 }))
    const comUsos = (usos: number): ContextoDeSessao => ({ ...VAZIO, usosComoDistrator: new Map([[C, usos]]) })
    expect(conjunto(escolher(A, 'parecidos', 2, comUsos(2), p))).toEqual(new Set(ids('cd')))
    expect(conjunto(escolher(A, 'parecidos', 2, comUsos(3), p))).toEqual(new Set(ids('de')))
  })

  it('sorteia de novo o conjunto já mostrado, até o número de tentativas, e depois o aceita', () => {
    // Em parecidos com n = 1, a recebe c ou d. Com {a, c} já mostrado, quatro tentativas acham d com esta semente;
    // com uma tentativa só, fica o primeiro sorteio, que nesta semente é c.
    const usado: ContextoDeSessao = { ...VAZIO, conjuntosUsados: new Set([chaveDeOpcoes([A, C])]) }
    const quatro = desembrulhar(resolverParametros({ tentativasDeOpcoesNovas: 4 }))
    const uma = desembrulhar(resolverParametros({ tentativasDeOpcoesNovas: 1 }))
    expect(desembrulhar(escolher(A, 'parecidos', 1, VAZIO, uma, 'repete'))).toEqual([C])
    expect(desembrulhar(escolher(A, 'parecidos', 1, usado, uma, 'repete'))).toEqual([C])
    expect(desembrulhar(escolher(A, 'parecidos', 1, usado, quatro, 'repete'))).toEqual([D])
    // Os dois conjuntos possíveis já mostrados: as tentativas se esgotam e fica um deles, sem erro.
    const todos: ContextoDeSessao = {
      ...VAZIO,
      conjuntosUsados: new Set([chaveDeOpcoes([A, C]), chaveDeOpcoes([D, A])]),
    }
    expect([[C], [D]]).toContainEqual(desembrulhar(escolher(A, 'parecidos', 1, todos, quatro, 'repete')))
  })
})

describe('escolherDistratores com um item em pares de dois grupos', () => {
  // a, de classe e categoria próprias, é o alvo; b, c e d são dissimilares dele. b faz par com c no grupo-1 e com d no
  // grupo-2: pôr b barra os outros dois, e só {c, d} rende dois distratores.
  const encadeado = catalogoDe({
    classes: [1, 2, 2, 2],
    categorias: [1, 2, 2, 2],
    aliases: [],
    vizinhos: [],
    grupos: [
      { membros: [1, 2], par: true },
      { membros: [1, 3], par: true },
    ],
    vizinhancas: [],
  })
  const sementes = Array.from({ length: 40 }, (_, k) => `encadeado-${String(k)}`)
  const escolherEm = (ctx: ContextoDeSessao, semente: string) =>
    escolherDistratores(A, 'dissimilares', 2, encadeado, ctx, sorteioComSemente(semente), P)

  it('chega a n com qualquer semente, deixando de fora o item que barraria os dois', () => {
    for (const semente of sementes) expect(conjunto(escolherEm(VAZIO, semente)), semente).toEqual(new Set([C, D]))
  })

  it('com o único conjunto completo já mostrado, repete-o, e nunca devolve lista curta', () => {
    const usado: ContextoDeSessao = { ...VAZIO, conjuntosUsados: new Set([chaveDeOpcoes([A, C, D])]) }
    for (const semente of sementes) expect(conjunto(escolherEm(usado, semente)), semente).toEqual(new Set([C, D]))
  })

  it('a questão sai com as opções pedidas mesmo depois de mostrar o único conjunto completo', () => {
    const tres = desembrulhar(resolverParametros({ opcoesMultiplaEscolha: 3 }))
    for (const semente of sementes) {
      const sorteio = sorteioComSemente(semente)
      const pedido = { tipo: 'licao', item: A, kp: 1 } as const
      const primeira = desembrulhar(gerarQuestao(pedido, encadeado, VAZIO, sorteio, tres))
      const segunda = desembrulhar(gerarQuestao(pedido, encadeado, registrarQuestao(VAZIO, primeira), sorteio, tres))
      expect(opcoesDe(segunda.formato), semente).toHaveLength(3)
    }
  })

  it('com os pares fechando um ciclo, conta só um dos três', () => {
    // b com c, c com d e d com b: qualquer dois deles formam um par, e o pool de a rende um.
    const ciclo = catalogoDe({
      classes: [1, 2, 2, 2],
      categorias: [1, 2, 2, 2],
      aliases: [],
      vizinhos: [],
      grupos: [
        { membros: [1, 2], par: true },
        { membros: [2, 3], par: true },
        { membros: [3, 1], par: true },
      ],
      vizinhancas: [],
    })
    const escolherNoCiclo = (n: number) =>
      escolherDistratores(A, 'dissimilares', n, ciclo, VAZIO, sorteioComSemente('ciclo'), P)
    expect(desembrulhar(escolherNoCiclo(1))).toHaveLength(1)
    expect(escolherNoCiclo(2)).toEqual({
      ok: false,
      erro: {
        codigo: 'DISTRATORES_INSUFICIENTES',
        detalhe: "'a' em modo dissimilares: o pool rende 1 distratores, e são pedidos 2",
      },
    })
  })
})

describe('escolherDistratores fora do contrato', () => {
  it('devolve erro para alvo que não existe', () => {
    expect(escolher('zz' as IdItem, 'parecidos', 1)).toEqual({
      ok: false,
      erro: { codigo: 'ITEM_INEXISTENTE', detalhe: "item que não existe: 'zz'" },
    })
  })

  it('lança com n que não é inteiro maior ou igual a zero', () => {
    expect(() => escolher(A, 'parecidos', -1)).toThrow(RangeError)
    expect(() => escolher(A, 'parecidos', 1.5)).toThrow(RangeError)
    expect(desembrulhar(escolher(A, 'parecidos', 0))).toEqual([])
  })
})
