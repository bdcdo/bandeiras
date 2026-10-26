import { describe, expect, it } from 'vitest'
import { catalogoFixo } from '../apoio-a-testes/catalogo-de-teste'
import { desembrulhar } from '../base/resultado'
import { sorteioComSemente } from '../base/sorteio-com-semente'
import type { Milis } from '../base/tempo'
import type { IdItem } from '../catalogo/tipos'
import { topicoDeItem } from '../grafo/topico'
import { PARAMETROS_PADRAO as P, resolverParametros } from '../memoria/parametros'
import { contextoDeSessao } from './contexto-de-sessao'
import { gerarQuestao, type PedidoDeQuestao } from './gerar-questao'
import { opcoesDe, type Questao } from './questao'

const catalogo = catalogoFixo()
const ids = (texto: string): IdItem[] => texto.split('') as IdItem[]
const [A, B, C] = ids('abc') as [IdItem, IdItem, IdItem]
const VAZIO = contextoDeSessao({})
// Cinco opções, e não as quatro do padrão, para o tamanho da questão vir do parâmetro e não de um número escrito no código.
const CINCO = desembrulhar(resolverParametros({ opcoesMultiplaEscolha: 5 }))

const gerar = (pedido: PedidoDeQuestao, limiteMs?: number, parametros = CINCO, semente = 'questao'): Questao =>
  desembrulhar(
    gerarQuestao(pedido, catalogo, VAZIO, sorteioComSemente(semente), parametros, limiteMs as Milis | undefined),
  )

describe('gerarQuestao', () => {
  it('na lição, reconhece e produz entre dissimilares e depois recorda', () => {
    const kp1 = gerar({ tipo: 'licao', item: C, kp: 1 })
    expect(kp1.formato.tipo).toBe('estimulo-para-rotulo')
    // Com cinco opções, c recebe quatro dos sete dissimilares: e, i e k da outra categoria e um de f, h, j e l.
    expect(opcoesDe(kp1.formato)).toHaveLength(5)
    expect(opcoesDe(kp1.formato)).toEqual(expect.arrayContaining(ids('ceik')))
    expect(gerar({ tipo: 'licao', item: C, kp: 2 }).formato.tipo).toBe('rotulo-para-estimulo')
    expect(gerar({ tipo: 'licao', item: C, kp: 3 }).formato).toEqual({ tipo: 'rotulo-digitado' })
  })

  it('na sondagem, recorda e confirma produzindo entre parecidos', () => {
    expect(gerar({ tipo: 'sondagem', item: A, etapa: 'recordar' }).formato).toEqual({ tipo: 'rotulo-digitado' })
    const confirmacao = gerar({ tipo: 'sondagem', item: A, etapa: 'confirmar' })
    expect(confirmacao.formato.tipo).toBe('rotulo-para-estimulo')
    // Parecidos de a, sem o parceiro b: c, d, e e g.
    expect(new Set(opcoesDe(confirmacao.formato))).toEqual(new Set(ids('acdeg')))
  })

  it('na discriminação, reconhece entre parecidos', () => {
    const q = gerar({ tipo: 'discriminacao', item: A })
    expect(q.formato.tipo).toBe('estimulo-para-rotulo')
    expect(new Set(opcoesDe(q.formato))).toEqual(new Set(ids('acdeg')))
  })

  it('na revisão, na remediação e no quiz, recorda, com o limite que vier de quem chama', () => {
    for (const tipo of ['revisao', 'remediacao', 'quiz'] as const) {
      expect(gerar({ tipo, item: A })).toMatchObject({ formato: { tipo: 'rotulo-digitado' } })
      expect(gerar({ tipo, item: A }).limiteMs).toBeUndefined()
      expect(gerar({ tipo, item: A }, 4500).limiteMs).toBe(4500)
    }
  })

  it('preenche o alvo, o item e o contexto isolado', () => {
    const q = gerar({ tipo: 'licao', item: A, kp: 1 })
    expect(q.alvo).toBe(topicoDeItem(A).id)
    expect(q.itemAlvo).toBe(A)
    expect(q.contexto).toEqual({ tipo: 'isolada' })
    expect(opcoesDe(q.formato).filter((o) => o === A)).toHaveLength(1)
  })

  it('recusa limite em pedido que não é cronometrado, e limite que não é positivo', () => {
    const recusa = (pedido: PedidoDeQuestao, limiteMs: number) =>
      gerarQuestao(pedido, catalogo, VAZIO, sorteioComSemente('x'), P, limiteMs as Milis)
    expect(recusa({ tipo: 'licao', item: A, kp: 3 }, 3000)).toEqual({
      ok: false,
      erro: { codigo: 'LIMITE_INVALIDO', detalhe: 'questão de licao não é cronometrada' },
    })
    for (const tipo of ['sondagem', 'discriminacao'] as const) {
      const pedido: PedidoDeQuestao = tipo === 'sondagem' ? { tipo, item: A, etapa: 'recordar' } : { tipo, item: A }
      expect(recusa(pedido, 3000)).toMatchObject({ ok: false, erro: { codigo: 'LIMITE_INVALIDO' } })
    }
    for (const limite of [0, -1, Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(recusa({ tipo: 'revisao', item: A }, limite), String(limite)).toMatchObject({
        ok: false,
        erro: { codigo: 'LIMITE_INVALIDO' },
      })
    }
  })

  it('devolve erro para item que não existe e passa adiante o erro dos distratores', () => {
    expect(gerarQuestao({ tipo: 'revisao', item: 'zz' as IdItem }, catalogo, VAZIO, sorteioComSemente('x'), P)).toEqual(
      {
        ok: false,
        erro: { codigo: 'ITEM_INEXISTENTE', detalhe: "item que não existe: 'zz'" },
      },
    )
    // Doze opções pedem onze distratores, e a só tem dez parecidos sem o parceiro.
    const doze = desembrulhar(resolverParametros({ opcoesMultiplaEscolha: 12 }))
    expect(
      gerarQuestao({ tipo: 'discriminacao', item: A }, catalogo, VAZIO, sorteioComSemente('x'), doze),
    ).toMatchObject({ ok: false, erro: { codigo: 'DISTRATORES_INSUFICIENTES' } })
  })

  it('dá o mesmo id ao mesmo conteúdo e ids diferentes a conteúdos diferentes', () => {
    const q1 = gerar({ tipo: 'licao', item: A, kp: 1 }, undefined, CINCO, 'semente-1')
    const q2 = gerar({ tipo: 'licao', item: A, kp: 1 }, undefined, CINCO, 'semente-1')
    expect(q2).toEqual(q1)
    const ids = new Set(
      [
        q1,
        gerar({ tipo: 'licao', item: A, kp: 1 }, undefined, CINCO, 'semente-2'),
        gerar({ tipo: 'licao', item: A, kp: 2 }, undefined, CINCO, 'semente-1'),
        gerar({ tipo: 'revisao', item: A }),
        gerar({ tipo: 'revisao', item: A }, 3000),
        gerar({ tipo: 'revisao', item: B }),
      ].map((q) => q.id),
    )
    expect(ids.size).toBe(6)
    expect(q1.id).toMatch(/^[0-9a-f]{16}$/)
  })
})
