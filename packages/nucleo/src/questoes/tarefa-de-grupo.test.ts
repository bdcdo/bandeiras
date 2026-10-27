import { describe, expect, it } from 'vitest'
import { catalogoDe, catalogoFixo } from '../apoio-a-testes/catalogo-de-teste'
import { estadoDeTeste } from '../apoio-a-testes/estado-de-teste'
import { desembrulhar } from '../base/resultado'
import { sorteioComSemente } from '../base/sorteio-com-semente'
import type { Catalogo, Direcao, IdGrupo, IdItem } from '../catalogo/tipos'
import { topicoDeItem, type IdTopico } from '../grafo/topico'
import type { EstadoMemoria } from '../memoria'
import { PARAMETROS_PADRAO as P, resolverParametros, type Parametros } from '../memoria/parametros'
import { contextoDeSessao, type ContextoDeSessao } from './contexto-de-sessao'
import { opcoesDe, type Questao } from './questao'
import { gerarQuestoesDeGrupo } from './tarefa-de-grupo'

const ids = (texto: string): IdItem[] => texto.split('') as IdItem[]
const GRUPO_1 = 'grupo-1' as IdGrupo
const GRUPO_2 = 'grupo-2' as IdGrupo
const VAZIO = contextoDeSessao({})
const CINCO = desembrulhar(resolverParametros({ opcoesMinimasDeGrupo: 5 }))

/** Estado de cada item com a acurácia de cada direção, na ordem reconhecer, produzir, recordar. */
function memorias(
  acuracias: Readonly<Record<string, readonly [number, number, number]>>,
): Map<IdTopico, EstadoMemoria> {
  return new Map(
    Object.entries(acuracias).map(([id, [reconhecer, produzir, recordar]]) => [
      topicoDeItem(id as IdItem).id,
      estadoDeTeste({ porDirecao: { reconhecer, produzir, recordar } }),
    ]),
  )
}
const neutras = (texto: string) => memorias(Object.fromEntries(ids(texto).map((id) => [id, [0.85, 0.85, 0.85]])))

function gerar(
  grupo: IdGrupo,
  alvos: string,
  m = neutras('abcdefghijkl'),
  parametros: Parametros = P,
  ctx: ContextoDeSessao = VAZIO,
  catalogo: Catalogo = catalogoFixo(),
) {
  return gerarQuestoesDeGrupo(grupo, ids(alvos), m, catalogo, ctx, sorteioComSemente('grupo'), parametros)
}
const exibidos = (q: Questao | undefined): Set<IdItem> =>
  new Set(q?.contexto.tipo === 'grupo' ? q.contexto.exibidos : [])
const direcaoDe = (q: Questao): Direcao | 'grupo-membros' => {
  switch (q.formato.tipo) {
    case 'rotulo-digitado':
      return 'recordar'
    case 'estimulo-para-rotulo':
      return 'reconhecer'
    case 'rotulo-para-estimulo':
      return 'produzir'
    default:
      return 'grupo-membros'
  }
}

describe('gerarQuestoesDeGrupo: exibidos', () => {
  it('mostra os membros sem o parceiro de um alvo, completados com vizinhos até as opções mínimas', () => {
    // Alvo c: a entra e barra b, o parceiro dele; d entra; faltando um para quatro, vem g, vizinho de c.
    const [q] = desembrulhar(gerar(GRUPO_1, 'c'))
    expect(exibidos(q)).toEqual(new Set(ids('acdg')))
    expect(q?.contexto).toMatchObject({ tipo: 'grupo', grupo: GRUPO_1 })
  })

  it('completa um grupo de dois membros pelos vizinhos de cada membro, na ordem, até o mínimo ajustado', () => {
    // e e f; vizinhos de e: a e g; de f: h e i. Com mínimo quatro param em g, com cinco chegam a h.
    expect(exibidos(desembrulhar(gerar(GRUPO_2, 'e'))[0])).toEqual(new Set(ids('efag')))
    expect(exibidos(desembrulhar(gerar(GRUPO_2, 'e', neutras('ef'), CINCO))[0])).toEqual(new Set(ids('efagh')))
  })

  it('deixa de fora quem ainda não foi apresentado', () => {
    const ctx = contextoDeSessao({ pendentesNovas: ids('ag') })
    expect(exibidos(desembrulhar(gerar(GRUPO_2, 'e', neutras('ef'), P, ctx))[0])).toEqual(new Set(ids('efhi')))
  })

  it('recusa o grupo que nem com os vizinhos chega ao mínimo', () => {
    const oito = desembrulhar(resolverParametros({ opcoesMinimasDeGrupo: 8 }))
    expect(gerar(GRUPO_2, 'e', neutras('ef'), oito)).toEqual({
      ok: false,
      erro: {
        codigo: 'DISTRATORES_INSUFICIENTES',
        detalhe: "grupo 'grupo-2': 6 exibidos com os vizinhos, e o mínimo é 8",
      },
    })
  })
})

describe('gerarQuestoesDeGrupo: alvos', () => {
  const TRES = desembrulhar(resolverParametros({ opcoesMinimasDeGrupo: 3 }))
  const opcoes = (q: Questao | undefined): Set<IdItem> => new Set(q === undefined ? [] : opcoesDe(q.formato))

  it('pergunta ao alvo de par quais itens têm o estímulo dele, com o parceiro e um chamariz fora da fileira', () => {
    // Com mínimo três, a fileira é a, c e d; b é o parceiro, e o chamariz é g, vizinho de c que ficou de fora.
    const [q] = desembrulhar(gerar(GRUPO_1, 'a', undefined, TRES))
    expect(q?.formato.tipo).toBe('grupo-membros')
    expect(exibidos(q)).toEqual(new Set(ids('acd')))
    expect(opcoes(q)).toEqual(new Set(ids('abcdg')))
  })

  it('tira o chamariz do resto do catálogo quando os vizinhos estão na fileira ou não foram apresentados', () => {
    // Com o mínimo padrão, g entra na fileira; com mínimo três e g pendente, g não pode ser opção. Nos dois casos o
    // chamariz é um item de fora do grupo e da vizinhança dele.
    for (const [parametros, ctx] of [
      [P, VAZIO],
      [TRES, contextoDeSessao({ pendentesNovas: ids('g') })],
    ] as const) {
      const [q] = desembrulhar(gerar(GRUPO_1, 'a', undefined, parametros, ctx))
      const fora = [...opcoes(q)].filter((o) => !exibidos(q).has(o) && !ids('b').includes(o))
      expect(fora).toHaveLength(1)
      expect(ids('efhijkl')).toContain(fora[0])
    }
  })

  it('prefere como chamariz o membro que ficou de fora por ser par de um exibido', () => {
    // a e b formam par no grupo-1, c e d no grupo-2, e os dois pares estão no grupo-1. Com alvo a, a fileira é a, c e e;
    // b é o parceiro, e d, barrado por c, vem antes de f e g, de fora do grupo.
    const doisPares = catalogoDe({
      classes: [1, 1, 1, 1, 1, 2, 2],
      categorias: [1, 1, 1, 1, 1, 1, 1],
      aliases: [],
      vizinhos: [],
      grupos: [
        { membros: [0, 1, 2, 3, 4], par: true },
        { membros: [2, 3], par: true },
      ],
      vizinhancas: [],
    })
    const [q] = desembrulhar(gerar(GRUPO_1, 'a', neutras('a'), TRES, VAZIO, doisPares))
    expect(exibidos(q)).toEqual(new Set(ids('ace')))
    expect(opcoes(q)).toEqual(new Set(ids('abcde')))
  })

  it('dá as mesmas opções a todo grupo-membros da tarefa, com um chamariz por parceiro', () => {
    // Alvos a e c, de pares diferentes: os parceiros b e d ficam fora da fileira, e os dois chamarizes são h e i.
    const doisPares = catalogoDe({
      classes: [1, 1, 1, 1, 1, 1, 1, 2, 2],
      categorias: [1, 1, 1, 1, 1, 1, 1, 1, 1],
      aliases: [],
      vizinhos: [],
      grupos: [
        { membros: [0, 1, 2, 3, 4, 5, 6], par: true },
        { membros: [2, 3], par: true },
      ],
      vizinhancas: [],
    })
    const questoes = desembrulhar(gerar(GRUPO_1, 'ac', neutras('ac'), P, VAZIO, doisPares))
    expect(questoes.map((q) => q.formato.tipo)).toEqual(['grupo-membros', 'grupo-membros'])
    expect(exibidos(questoes[0])).toEqual(new Set(ids('acefg')))
    for (const q of questoes) expect(opcoes(q)).toEqual(new Set(ids('abcdefghi')))
  })

  it('recusa o alvo de par sem rótulo errado de fora da fileira para servir de chamariz', () => {
    const quatro = catalogoDe({
      classes: [1, 1, 1, 1],
      categorias: [1, 1, 1, 1],
      aliases: [],
      vizinhos: [],
      grupos: [{ membros: [0, 1, 2, 3], par: true }],
      vizinhancas: [],
    })
    expect(gerar(GRUPO_1, 'a', neutras('a'), TRES, VAZIO, quatro)).toEqual({
      ok: false,
      erro: {
        codigo: 'DISTRATORES_INSUFICIENTES',
        detalhe: "grupo 'grupo-1': 0 de 1 rótulos errados fora da fileira, um por parceiro de alvo",
      },
    })
  })

  it('recusa alvos com os dois itens de um par, alvo fora do grupo, repetido, sem estado ou não apresentado', () => {
    const codigo = (r: ReturnType<typeof gerar>) => (r.ok ? undefined : r.erro.codigo)
    expect(gerar(GRUPO_1, 'ab')).toEqual({
      ok: false,
      erro: { codigo: 'ALVOS_INVALIDOS', detalhe: "alvos que formam um par indiscernível: 'a' e o parceiro" },
    })
    expect(codigo(gerar(GRUPO_1, ''))).toBe('ALVOS_INVALIDOS')
    expect(codigo(gerar(GRUPO_1, 'cg'))).toBe('ALVOS_INVALIDOS')
    expect(codigo(gerar(GRUPO_1, 'cc'))).toBe('ALVOS_INVALIDOS')
    expect(codigo(gerar(GRUPO_1, 'cd', neutras('c')))).toBe('ALVOS_INVALIDOS')
    expect(codigo(gerar(GRUPO_1, 'c', undefined, P, contextoDeSessao({ pendentesNovas: ids('c') })))).toBe(
      'ALVOS_INVALIDOS',
    )
    expect(codigo(gerar(GRUPO_1, 'a', undefined, P, contextoDeSessao({ pendentesNovas: ids('b') })))).toBe(
      'ALVOS_INVALIDOS',
    )
    expect(codigo(gerar('grupo-9' as IdGrupo, 'c'))).toBe('GRUPO_INEXISTENTE')
  })

  it('recusa mais alvos que exibidos menos dois, para o último não sair por eliminação', () => {
    expect(gerar(GRUPO_1, 'acd')).toEqual({
      ok: false,
      erro: { codigo: 'ALVOS_DEMAIS', detalhe: "grupo 'grupo-1': 3 alvos para 4 exibidos; o máximo é 2" },
    })
    expect(desembrulhar(gerar(GRUPO_1, 'cd'))).toHaveLength(2)
  })

  it('usa a mesma lista de exibidos em toda a tarefa e a reembaralha nas opções', () => {
    // c reconhece e d recorda. Pedidos na ordem c, d, o digitado de d sai antes: depois da múltipla escolha de c, que
    // lista o rótulo de d, digitá-lo seria escolher entre rótulos que acabaram de aparecer.
    const m = memorias({ c: [0.2, 0.9, 0.9], d: [0.2, 0.9, 0.3] })
    const questoes = desembrulhar(gerar(GRUPO_1, 'cd', m))
    expect(questoes.map((q) => [q.itemAlvo, q.formato.tipo])).toEqual([
      ['d', 'rotulo-digitado'],
      ['c', 'estimulo-para-rotulo'],
    ])
    const listas = questoes.map((q) => (q.contexto.tipo === 'grupo' ? q.contexto.exibidos : []))
    expect(listas[0]).toEqual(listas[1])
    for (const q of questoes) {
      if (q.formato.tipo === 'estimulo-para-rotulo') expect(new Set(q.formato.opcoes)).toEqual(exibidos(q))
    }
  })
})

describe('gerarQuestoesDeGrupo: direção de cada alvo', () => {
  // Seis membros sem par, de a a f, e dois itens fora do grupo: até quatro alvos.
  const grande = catalogoDe({
    classes: [1, 1, 1, 1, 1, 1, 2, 2],
    categorias: [1, 1, 1, 1, 1, 1, 1, 1],
    aliases: [],
    vizinhos: [],
    grupos: [{ membros: [0, 1, 2, 3, 4, 5], par: false }],
    vizinhancas: [],
  })
  // As direções na ordem dos alvos pedidos, e não na das questões, que vêm ordenadas por formato.
  const direcoes = (m: Map<IdTopico, EstadoMemoria>, alvos: string): (Direcao | 'grupo-membros' | undefined)[] => {
    const porAlvo = new Map(desembrulhar(gerar(GRUPO_1, alvos, m, P, VAZIO, grande)).map((q) => [q.itemAlvo, q]))
    return ids(alvos).map((a) => {
      const q = porAlvo.get(a)
      return q === undefined ? undefined : direcaoDe(q)
    })
  }

  it('pergunta na direção mais fraca de cada alvo quando metade já recorda', () => {
    const m = memorias({ a: [0.9, 0.9, 0.2], b: [0.3, 0.9, 0.8], c: [0.9, 0.4, 0.8], d: [0.9, 0.9, 0.5] })
    expect(direcoes(m, 'abcd')).toEqual(['recordar', 'reconhecer', 'produzir', 'recordar'])
  })

  it('completa a metade com os alvos de menor acurácia em recordar', () => {
    // Só a recorda; faltam um de quatro: entre b (0,8), c (0,6) e d (0,7) em recordar, vai c.
    const m = memorias({ a: [0.9, 0.9, 0.2], b: [0.3, 0.9, 0.8], c: [0.9, 0.4, 0.6], d: [0.5, 0.9, 0.7] })
    expect(direcoes(m, 'abcd')).toEqual(['recordar', 'reconhecer', 'recordar', 'reconhecer'])
    // Com três alvos, a metade arredonda para dois.
    expect(direcoes(m, 'bcd')).toEqual(['reconhecer', 'recordar', 'recordar'])
  })

  it('conta a metade sobre todos os alvos, os de par inclusive', () => {
    // Seis membros com o par a e b, e dois itens fora do grupo. a pergunta em grupo-membros; c e d, sem par, têm reconhecer
    // como direção mais fraca. Três alvos pedem dois recordando, e como só c e d podem, os dois recordam; contar a metade
    // só sobre os alvos sem par pediria um.
    const comPar = catalogoDe({
      classes: [1, 1, 1, 1, 1, 1, 2, 2],
      categorias: [1, 1, 1, 1, 1, 1, 1, 1],
      aliases: [],
      vizinhos: [],
      grupos: [{ membros: [0, 1, 2, 3, 4, 5], par: true }],
      vizinhancas: [],
    })
    const m = memorias({ a: [0.85, 0.85, 0.85], c: [0.2, 0.9, 0.9], d: [0.2, 0.9, 0.9] })
    const questoes = desembrulhar(gerar(GRUPO_1, 'acd', m, P, VAZIO, comPar))
    expect(Object.fromEntries(questoes.map((q) => [q.itemAlvo, direcaoDe(q)]))).toEqual({
      a: 'grupo-membros',
      c: 'recordar',
      d: 'recordar',
    })
  })

  it('ordena as questões pelo formato: digitado, rótulo para estímulo, grupo-membros e estímulo para rótulo', () => {
    // Nove membros com o par a e b, e um item fora do grupo: oito exibidos, até seis alvos. c reconhece e d produz, com
    // recordar alto; e, f e g recordam. Pedidos na ordem c, a, d, e, f, g, saem os três digitados, na ordem dos alvos,
    // depois d, a e c.
    const nove = catalogoDe({
      classes: [1, 1, 1, 1, 1, 1, 1, 1, 1, 2],
      categorias: [1, 1, 1, 1, 1, 1, 1, 1, 1, 1],
      aliases: [],
      vizinhos: [],
      grupos: [{ membros: [0, 1, 2, 3, 4, 5, 6, 7, 8], par: true }],
      vizinhancas: [],
    })
    const m = memorias({
      a: [0.85, 0.85, 0.85],
      c: [0.2, 0.9, 0.9],
      d: [0.9, 0.2, 0.9],
      e: [0.9, 0.9, 0.2],
      f: [0.9, 0.9, 0.3],
      g: [0.9, 0.9, 0.4],
    })
    const questoes = desembrulhar(gerar(GRUPO_1, 'cadefg', m, P, VAZIO, nove))
    expect(questoes.map((q) => [q.itemAlvo, q.formato.tipo])).toEqual([
      ['e', 'rotulo-digitado'],
      ['f', 'rotulo-digitado'],
      ['g', 'rotulo-digitado'],
      ['d', 'rotulo-para-estimulo'],
      ['a', 'grupo-membros'],
      ['c', 'estimulo-para-rotulo'],
    ])
  })

  it('no empate entre direções recorda, e no empate entre alvos vale a ordem deles', () => {
    expect(direcoes(neutras('abcd'), 'abcd')).toEqual(['recordar', 'recordar', 'recordar', 'recordar'])
    const m = memorias({ a: [0.5, 0.5, 0.9], b: [0.6, 0.6, 0.9] })
    expect(direcoes(m, 'ab')).toEqual(['recordar', 'reconhecer'])
  })
})
