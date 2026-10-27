import { describe, expect, it } from 'vitest'
import type { IdGrupo, IdItem } from '../catalogo/tipos'
import {
  chaveDeOpcoes,
  contextoDeSessao,
  registrarApresentacao,
  registrarLicaoConcluida,
  registrarQuestao,
} from './contexto-de-sessao'
import { criarQuestao } from './questao'

const ids = (texto: string): IdItem[] => texto.split('') as IdItem[]
const [A, B, C, D] = ids('abcd') as [IdItem, IdItem, IdItem, IdItem]

describe('contextoDeSessao', () => {
  it('começa sem distrator usado nem conjunto mostrado', () => {
    const ctx = contextoDeSessao({ pendentesNovas: [A], aprendidos: [B, C] })
    expect(ctx.pendentesNovas).toEqual(new Set([A]))
    expect(ctx.aprendidos).toEqual(new Set([B, C]))
    expect(ctx.usosComoDistrator.size).toBe(0)
    expect(ctx.conjuntosUsados.size).toBe(0)
  })
})

describe('chaveDeOpcoes', () => {
  it('não depende da ordem e não emenda um id no outro', () => {
    expect(chaveDeOpcoes([A, B, C])).toBe(chaveDeOpcoes([C, A, B]))
    expect(chaveDeOpcoes(['ab', 'c'] as IdItem[])).not.toBe(chaveDeOpcoes(['a', 'bc'] as IdItem[]))
    expect(chaveDeOpcoes(['a|b', 'c'] as IdItem[])).not.toBe(chaveDeOpcoes(['a', 'b|c'] as IdItem[]))
  })
})

describe('registrarQuestao', () => {
  it('conta cada opção que não é o alvo como um uso de distrator e guarda o conjunto', () => {
    const q1 = criarQuestao(A, { tipo: 'estimulo-para-rotulo', opcoes: [B, A, C] }, { tipo: 'isolada' })
    const q2 = criarQuestao(D, { tipo: 'rotulo-para-estimulo', opcoes: [D, B] }, { tipo: 'isolada' })
    const ctx = registrarQuestao(registrarQuestao(contextoDeSessao({}), q1), q2)
    expect(ctx.usosComoDistrator).toEqual(
      new Map([
        [B, 2],
        [C, 1],
      ]),
    )
    expect(ctx.conjuntosUsados).toEqual(new Set([chaveDeOpcoes([A, B, C]), chaveDeOpcoes([B, D])]))
  })

  it('não muda o contexto com texto digitado nem com questão de grupo', () => {
    const ctx = contextoDeSessao({})
    expect(registrarQuestao(ctx, criarQuestao(A, { tipo: 'rotulo-digitado' }, { tipo: 'isolada' }))).toBe(ctx)
    const grupo = { tipo: 'grupo', grupo: 'grupo-1' as IdGrupo, exibidos: [A, B, C, D] } as const
    expect(registrarQuestao(ctx, criarQuestao(A, { tipo: 'estimulo-para-rotulo', opcoes: [A, B, C, D] }, grupo))).toBe(
      ctx,
    )
  })

  it('não mexe no contexto recebido', () => {
    const ctx = contextoDeSessao({})
    registrarQuestao(ctx, criarQuestao(A, { tipo: 'estimulo-para-rotulo', opcoes: [A, B] }, { tipo: 'isolada' }))
    expect(ctx.usosComoDistrator.size).toBe(0)
    expect(ctx.conjuntosUsados.size).toBe(0)
  })
})

describe('registrarApresentacao e registrarLicaoConcluida', () => {
  it('a apresentação tira o item dos pendentes, e a lição concluída também o põe nos aprendidos', () => {
    const ctx = contextoDeSessao({ pendentesNovas: [A, B] })
    expect(registrarApresentacao(ctx, A).pendentesNovas).toEqual(new Set([B]))
    expect(registrarApresentacao(ctx, A).aprendidos.size).toBe(0)
    // A lição acelerada conclui sem apresentação: o item sai dos pendentes do mesmo jeito.
    const concluida = registrarLicaoConcluida(ctx, B)
    expect(concluida.pendentesNovas).toEqual(new Set([A]))
    expect(concluida.aprendidos).toEqual(new Set([B]))
    expect(ctx.pendentesNovas).toEqual(new Set([A, B]))
  })
})
