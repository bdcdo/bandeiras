import { describe, expect, it } from 'vitest'
import { catalogoFixo } from '../apoio-a-testes/catalogo-de-teste'
import { desembrulhar } from '../base/resultado'
import type { Milis } from '../base/tempo'
import type { IdGrupo, IdItem } from '../catalogo/tipos'
import { PARAMETROS_PADRAO as P, resolverParametros, type Parametros } from '../memoria/parametros'
import { criarQuestao, type ContextoDeQuestao, type FormatoDeQuestao, type Questao } from '../questoes/questao'
import { avaliarResposta } from './avaliar-resposta'
import { NORMAS_DE_LATENCIA_VAZIAS, type NormasDeLatencia } from './normas-de-latencia'
import type { Avaliacao, Resposta } from './tipos'

const catalogo = catalogoFixo()
const ids = (texto: string): IdItem[] => texto.split('') as IdItem[]
const [A, B, C, E, G] = ids('abceg') as [IdItem, IdItem, IdItem, IdItem, IdItem]
const ms = (n: number) => n as Milis
const ISOLADA: ContextoDeQuestao = { tipo: 'isolada' }

const epr = (opcoes = ids('aceg'), limiteMs?: number): Questao =>
  criarQuestao(A, { tipo: 'estimulo-para-rotulo', opcoes }, ISOLADA, limiteMs as Milis | undefined)
const rpe = (opcoes = ids('aceg')): Questao => criarQuestao(A, { tipo: 'rotulo-para-estimulo', opcoes }, ISOLADA)
const digitado = (limiteMs?: number): Questao =>
  criarQuestao(A, { tipo: 'rotulo-digitado' }, ISOLADA, limiteMs as Milis | undefined)
const membros = (): Questao =>
  criarQuestao(
    A,
    { tipo: 'grupo-membros', opcoes: ids('abcdg') },
    { tipo: 'grupo', grupo: 'grupo-1' as IdGrupo, exibidos: ids('acdg') },
  )
const escolha = (escolhidas: string, latencia = 2000): Resposta => ({
  tipo: 'escolha',
  escolhidas: ids(escolhidas),
  latencia: ms(latencia),
})
const texto = (t: string, latencia = 2000): Resposta => ({ tipo: 'texto', texto: t, latencia: ms(latencia) })

/** Normas com estas latências no formato; o resto vazio. */
const normasCom = (formato: FormatoDeQuestao['tipo'], latencias: readonly number[]): NormasDeLatencia => ({
  ...NORMAS_DE_LATENCIA_VAZIAS,
  [formato]: latencias.map(ms),
})
// Oito amostras, o mínimo padrão, com mediana 1500.
const OITO = [1000, 1100, 1200, 1400, 1600, 1800, 1900, 2000]

const avaliar = (questao: Questao, resposta: Resposta, normas = NORMAS_DE_LATENCIA_VAZIAS, parametros = P) =>
  desembrulhar(avaliarResposta(questao, resposta, catalogo, normas, parametros))
const codigo = (questao: Questao, resposta: Resposta): string | undefined => {
  const r = avaliarResposta(questao, resposta, catalogo, NORMAS_DE_LATENCIA_VAZIAS, P)
  return r.ok ? undefined : r.erro.codigo
}

describe('avaliarResposta: escolha', () => {
  it('na escolha do rótulo, aceita o alvo e o parceiro indiscernível, que o estímulo não distingue', () => {
    expect(avaliar(epr(), escolha('a'))).toEqual({
      correta: true,
      qualidade: 'perfeita',
      direcao: 'reconhecer',
      deltaBruto: P.deltaBruto.perfeita,
    })
    expect(avaliar(epr(ids('abce')), escolha('b'))).toMatchObject({ correta: true, qualidade: 'perfeita' })
    expect(avaliar(epr(), escolha('c'))).toEqual({
      correta: false,
      qualidade: 'errada',
      direcao: 'reconhecer',
      deltaBruto: P.deltaBruto.errada,
      confundidaCom: C,
    })
  })

  it('na escolha do estímulo, aceita só o alvo', () => {
    expect(avaliar(rpe(), escolha('a'))).toMatchObject({ correta: true, direcao: 'produzir' })
    expect(avaliar(rpe(ids('abce')), escolha('b'))).toMatchObject({ correta: false, confundidaCom: B })
  })

  it('em grupo-membros, acerta só com o conjunto exato do alvo e do parceiro, em qualquer ordem', () => {
    expect(avaliar(membros(), escolha('ba'))).toMatchObject({ correta: true, direcao: 'reconhecer' })
    expect(avaliar(membros(), escolha('a'))).toEqual({
      correta: false,
      qualidade: 'errada',
      direcao: 'reconhecer',
      deltaBruto: P.deltaBruto.errada,
    })
    expect(avaliar(membros(), escolha('abg'))).toMatchObject({ correta: false, confundidaCom: G })
  })

  it('erro abaixo de latenciaChuteMs é chute, com a opção escolhida como confundida; no limite já é errada', () => {
    // 900, e não os 600 do padrão: o limiar vem do parâmetro.
    const p = desembrulhar(resolverParametros({ latenciaChuteMs: 900 }))
    expect(avaliar(epr(), escolha('e', 899), NORMAS_DE_LATENCIA_VAZIAS, p)).toMatchObject({
      correta: false,
      qualidade: 'chute',
      confundidaCom: E,
    })
    expect(avaliar(epr(), escolha('e', 900), NORMAS_DE_LATENCIA_VAZIAS, p)).toMatchObject({ qualidade: 'errada' })
    expect(avaliar(epr(), escolha('e', 700))).toMatchObject({ qualidade: 'errada' })
  })
})

describe('avaliarResposta: qualidade do acerto', () => {
  const normas = normasCom('estimulo-para-rotulo', OITO)

  it('acerto até a mediana própria é perfeita, mais lento é boa sem limite e lenta com limite', () => {
    expect(avaliar(epr(), escolha('a', 1500), normas)).toMatchObject({ qualidade: 'perfeita' })
    expect(avaliar(epr(), escolha('a', 1501), normas)).toMatchObject({
      correta: true,
      qualidade: 'boa',
      deltaBruto: P.deltaBruto.boa,
    })
    expect(avaliar(epr(undefined, 5000), escolha('a', 1501), normas)).toMatchObject({
      correta: true,
      qualidade: 'lenta',
      deltaBruto: P.deltaBruto.lenta,
    })
  })

  it('sem amostras bastantes, todo acerto é perfeita', () => {
    expect(
      avaliar(epr(undefined, 5000), escolha('a', 4999), normasCom('estimulo-para-rotulo', OITO.slice(1))),
    ).toMatchObject({ qualidade: 'perfeita' })
    // As normas são por formato: as da escolha do rótulo não valem para o texto.
    expect(avaliar(digitado(), texto('Item A', 4999), normas)).toMatchObject({ qualidade: 'perfeita' })
  })

  it('acerto abaixo de latenciaChuteMs é perfeita mesmo acima de uma mediana mais rápida', () => {
    const rapidas = normasCom('estimulo-para-rotulo', [300, 320, 340, 360, 380, 400, 420, 440])
    expect(avaliar(epr(), escolha('a', 599), rapidas)).toMatchObject({ correta: true, qualidade: 'perfeita' })
    expect(avaliar(epr(), escolha('a', 600), rapidas)).toMatchObject({ correta: true, qualidade: 'boa' })
  })

  it('escolha ou texto acima do limite é tempo-esgotado, sem confundida, mesmo se certo', () => {
    for (const r of [
      avaliar(epr(undefined, 4000), escolha('a', 4001)),
      avaliar(digitado(4000), texto('Item C', 4001)),
    ]) {
      expect(r).toEqual({
        correta: false,
        qualidade: 'tempo-esgotado',
        direcao: r.direcao,
        deltaBruto: P.deltaBruto['tempo-esgotado'],
      })
    }
    expect(avaliar(epr(undefined, 4000), escolha('a', 4000))).toMatchObject({ correta: true })
  })
})

describe('avaliarResposta: texto', () => {
  it('aceita rótulo e aliases do alvo e do parceiro, com a normalização do catálogo', () => {
    for (const t of ['Item A', '  item a ', 'Apelido A 1', 'Item B', 'apelido b 2']) {
      expect(avaliar(digitado(), texto(t)), t).toMatchObject({ correta: true, direcao: 'recordar' })
    }
  })

  it('texto de outro item é errada com o item como confundida, e texto que não é rótulo é errada sem confundida', () => {
    expect(avaliar(digitado(), texto('Item C'))).toMatchObject({
      correta: false,
      qualidade: 'errada',
      confundidaCom: C,
    })
    expect(avaliar(digitado(), texto('Item'))).toEqual({
      correta: false,
      qualidade: 'errada',
      direcao: 'recordar',
      deltaBruto: P.deltaBruto.errada,
    })
  })

  it('texto vazio depois de aparado é chute, e texto errado rápido é errada, porque digitar é tentativa', () => {
    expect(avaliar(digitado(), texto('   ', 3000))).toEqual({
      correta: false,
      qualidade: 'chute',
      direcao: 'recordar',
      deltaBruto: P.deltaBruto.chute,
    })
    expect(avaliar(digitado(), texto(''))).toMatchObject({ qualidade: 'chute' })
    expect(avaliar(digitado(), texto('Item C', 100))).toMatchObject({ qualidade: 'errada' })
  })
})

describe('avaliarResposta: não sei, tempo esgotado e respostas incompatíveis', () => {
  it('não sei é erro sem confundida', () => {
    expect(avaliar(epr(), { tipo: 'nao-sei' })).toEqual({
      correta: false,
      qualidade: 'nao-sei',
      direcao: 'reconhecer',
      deltaBruto: P.deltaBruto['nao-sei'],
    })
  })

  it('tempo esgotado só existe em questão com limite', () => {
    expect(avaliar(digitado(4000), { tipo: 'tempo-esgotado' })).toMatchObject({ qualidade: 'tempo-esgotado' })
    expect(codigo(digitado(), { tipo: 'tempo-esgotado' })).toBe('RESPOSTA_INCOMPATIVEL')
  })

  it('recusa a resposta que não serve ao formato', () => {
    expect(codigo(digitado(), escolha('a'))).toBe('RESPOSTA_INCOMPATIVEL')
    expect(codigo(epr(), texto('Item A'))).toBe('RESPOSTA_INCOMPATIVEL')
    expect(codigo(membros(), texto('Item A'))).toBe('RESPOSTA_INCOMPATIVEL')
    expect(codigo(epr(), escolha('b'))).toBe('RESPOSTA_INCOMPATIVEL')
    expect(codigo(epr(), escolha(''))).toBe('RESPOSTA_INCOMPATIVEL')
    expect(codigo(epr(), escolha('ac'))).toBe('RESPOSTA_INCOMPATIVEL')
    expect(codigo(membros(), escolha('aa'))).toBe('RESPOSTA_INCOMPATIVEL')
    expect(codigo(epr(), { tipo: 'continuar' })).toBe('RESPOSTA_INCOMPATIVEL')
    for (const latencia of [-1, Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(codigo(epr(), escolha('a', latencia)), String(latencia)).toBe('RESPOSTA_INCOMPATIVEL')
      expect(codigo(digitado(), texto('Item A', latencia)), String(latencia)).toBe('RESPOSTA_INCOMPATIVEL')
    }
  })

  it('recusa a associação, que o diagnóstico avalia, e item fora do catálogo', () => {
    const associacao = criarQuestao(
      A,
      { tipo: 'associacao', linhas: [ids('ab'), ids('c')], rotulos: ids('abc') },
      ISOLADA,
    )
    expect(codigo(associacao, { tipo: 'nao-sei' })).toBe('FORMATO_NAO_SUPORTADO')
    expect(codigo(criarQuestao('zz' as IdItem, { tipo: 'rotulo-digitado' }, ISOLADA), texto('x'))).toBe(
      'ITEM_INEXISTENTE',
    )
  })

  it('recusa ligações de associação em questão de outro formato, e mantém a recusa do formato associação', () => {
    const ligacoes: Resposta = { tipo: 'associacao', ligacoes: [{ linha: 0, rotulo: A, latencia: ms(900) }] }
    for (const questao of [digitado(), epr(), rpe(), membros()]) {
      expect(codigo(questao, ligacoes), questao.formato.tipo).toBe('RESPOSTA_INCOMPATIVEL')
    }
    const associacao = criarQuestao(A, { tipo: 'associacao', linhas: [ids('ab')], rotulos: ids('ab') }, ISOLADA)
    expect(codigo(associacao, ligacoes)).toBe('FORMATO_NAO_SUPORTADO')
  })
})

describe('avaliarResposta: deltaBruto de cada qualidade', () => {
  it('lê o delta da qualidade que deu, com deltas ajustados distintos entre si', () => {
    // No padrão, perfeita e boa valem 1, e errada, chute e não sei, -1: com eles, ler o delta de uma qualidade no
    // lugar da outra passaria. Ajustados, cada qualidade tem o seu.
    const p: Parametros = desembrulhar(
      resolverParametros({
        'deltaBruto.boa': 0.8,
        'deltaBruto.lenta': 0.55,
        'deltaBruto.chute': -0.9,
        'deltaBruto.nao-sei': -0.7,
        'deltaBruto.tempo-esgotado': -0.4,
      }),
    )
    const normas = normasCom('estimulo-para-rotulo', OITO)
    const delta = (questao: Questao, resposta: Resposta): number => avaliar(questao, resposta, normas, p).deltaBruto
    const casos: [Avaliacao['qualidade'], number][] = [
      ['perfeita', delta(epr(), escolha('a', 1000))],
      ['boa', delta(epr(), escolha('a', 3000))],
      ['lenta', delta(epr(undefined, 5000), escolha('a', 3000))],
      ['errada', delta(epr(), escolha('c', 3000))],
      ['chute', delta(epr(), escolha('c', 100))],
      ['nao-sei', delta(epr(), { tipo: 'nao-sei' })],
      ['tempo-esgotado', delta(epr(undefined, 5000), { tipo: 'tempo-esgotado' })],
    ]
    expect(Object.fromEntries(casos)).toEqual({
      perfeita: 1,
      boa: 0.8,
      lenta: 0.55,
      errada: -1,
      chute: -0.9,
      'nao-sei': -0.7,
      'tempo-esgotado': -0.4,
    })
  })
})

describe('Avaliacao no tipo', () => {
  it('não admite erro com qualidade de acerto nem acerto com qualidade de erro', () => {
    // @ts-expect-error: erro não tem qualidade de acerto.
    const erroPerfeito: Avaliacao = {
      correta: false,
      qualidade: 'perfeita',
      direcao: 'reconhecer',
      deltaBruto: -1,
    }
    // @ts-expect-error: chute só qualifica erro.
    const acertoChutado: Avaliacao = {
      correta: true,
      qualidade: 'chute',
      direcao: 'reconhecer',
      deltaBruto: 1,
    }
    const acertoConfundido: Avaliacao = {
      correta: true,
      qualidade: 'boa',
      direcao: 'recordar',
      deltaBruto: 1,
      // @ts-expect-error: acerto não tem item confundido.
      confundidaCom: A,
    }
    expect([erroPerfeito, acertoChutado, acertoConfundido]).toHaveLength(3)
  })
})
