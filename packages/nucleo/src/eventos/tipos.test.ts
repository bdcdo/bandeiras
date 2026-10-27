import { describe, expect, it } from 'vitest'
import type { Milis } from '../base/tempo'
import type { IdItem } from '../catalogo/tipos'
import type { IdTopico } from '../grafo/topico'
import type { Avaliacao } from '../avaliacao'
import { criarQuestao } from '../questoes/questao'
import { TIPOS_DE_EVENTO, type CorpoDeEvento, type Evento, type TarefaRegistrada, type TipoDeEvento } from './tipos'
import { VERSAO_MODELO } from './versao'
import type { EnvelopeDeEvento } from './armazenamento'

// Um tipo por chave, escrito à mão: o registro exige toda a união, e a lista tem de ter as mesmas chaves.
const CADA_TIPO: Readonly<Record<TipoDeEvento, true>> = {
  'perfil-criado': true,
  'perfil-reiniciado': true,
  'sessao-iniciada': true,
  'sessao-encerrada': true,
  'diagnostico-iniciado': true,
  'diagnostico-pulado': true,
  'diagnostico-encerrado': true,
  'tarefa-iniciada': true,
  'apresentacao-vista': true,
  'resposta-registrada': true,
  'licao-adiada': true,
  'licao-concluida': true,
  'remediacao-concluida': true,
  'meta-diaria-alterada': true,
}

const G = 'g' as IdItem
const DIGITADO = criarQuestao(G, { tipo: 'rotulo-digitado' }, { tipo: 'isolada' })
const ASSOCIACAO = criarQuestao(G, { tipo: 'associacao', linhas: [[G]], rotulos: [G] }, { tipo: 'isolada' })
const ACERTO: Avaliacao = { correta: true, qualidade: 'perfeita', direcao: 'recordar', deltaBruto: 1 }
const RESPOSTA = {
  tipo: 'resposta-registrada',
  tarefaId: 't',
  passo: 0,
  uso: { tipo: 'revisao' },
  questao: DIGITADO,
} as const

describe('a união de eventos', () => {
  it('TIPOS_DE_EVENTO lista cada tipo da união, uma vez, e não tem parametros-alterados', () => {
    expect([...TIPOS_DE_EVENTO].sort()).toEqual(Object.keys(CADA_TIPO).sort())
    expect(new Set(TIPOS_DE_EVENTO).size).toBe(TIPOS_DE_EVENTO.length)
    expect(TIPOS_DE_EVENTO).toHaveLength(14)
    expect(TIPOS_DE_EVENTO as readonly string[]).not.toContain('parametros-alterados')
  })

  it('começa na versão 1 do modelo', () => {
    expect(VERSAO_MODELO).toBe(1)
  })

  it('amarra a resposta e a avaliação no tipo', () => {
    const comAvaliacao: CorpoDeEvento = {
      ...RESPOSTA,
      resposta: { tipo: 'texto', texto: 'Item G', latencia: 900 as Milis },
      avaliacao: ACERTO,
    }
    const associacao: CorpoDeEvento = {
      ...RESPOSTA,
      uso: { tipo: 'diagnostico' },
      questao: ASSOCIACAO,
      resposta: { tipo: 'associacao', ligacoes: [{ linha: 0, rotulo: null, latencia: 700 as Milis }] },
    }
    // @ts-expect-error: resposta de escolha sem avaliação
    const escolhaSemAvaliacao: CorpoDeEvento = {
      ...RESPOSTA,
      resposta: { tipo: 'escolha', escolhidas: [G], latencia: 1 as Milis },
    }
    // @ts-expect-error: continuar fecha apresentação e não é resposta registrada
    const continuar: CorpoDeEvento = { ...RESPOSTA, resposta: { tipo: 'continuar' }, avaliacao: ACERTO }
    const associacaoComAvaliacao: CorpoDeEvento = {
      ...RESPOSTA,
      questao: ASSOCIACAO,
      // @ts-expect-error: a associação não tem avaliação; com ela, o compilador exige uma resposta de outro tipo
      resposta: { tipo: 'associacao', ligacoes: [] },
      avaliacao: ACERTO,
    }
    const todos = [comAvaliacao, associacao, escolhaSemAvaliacao, continuar, associacaoComAvaliacao]
    expect(todos.map((c) => c.tipo)).toEqual(Array(5).fill('resposta-registrada'))
  })

  it('aceita só os knowledge points 1, 2 e 3', () => {
    const topico = 'item:g' as IdTopico
    const adiada: CorpoDeEvento = { tipo: 'licao-adiada', tarefaId: 't', topico, kp: 3 }
    // @ts-expect-error: kp é 1, 2 ou 3
    const kp4: CorpoDeEvento = { tipo: 'licao-adiada', tarefaId: 't', topico, kp: 4 }
    const usoKp4: CorpoDeEvento = {
      ...RESPOSTA,
      // @ts-expect-error: o uso de lição também
      uso: { tipo: 'licao', kp: 0 },
      resposta: { tipo: 'nao-sei' },
      avaliacao: { correta: false, qualidade: 'nao-sei', direcao: 'recordar', deltaBruto: -1 },
    }
    expect([adiada, kp4, usoKp4].map((c) => c.tipo)).toEqual(['licao-adiada', 'licao-adiada', 'resposta-registrada'])
  })

  it('aceita tarefa adaptativa de passos vazios, e não apresentação sem item', () => {
    const adaptativa: TarefaRegistrada = { id: 't', tipo: 'licao', alvos: ['item:g' as IdTopico], passos: [] }
    // @ts-expect-error: a apresentação mostra pelo menos um item
    const vazia: CorpoDeEvento = { tipo: 'apresentacao-vista', tarefaId: 't', itens: [] }
    expect([adaptativa.passos, vazia.tipo]).toEqual([[], 'apresentacao-vista'])
  })

  it('todo evento cabe no envelope do armazenamento', () => {
    const comoEnvelope = (e: Evento): EnvelopeDeEvento => e
    expect(comoEnvelope).toBeTypeOf('function')
  })
})
