import { describe, expect, it } from 'vitest'
import { catalogoFixo } from '../apoio-a-testes/catalogo-de-teste'
import { desembrulhar } from '../base/resultado'
import type { Milis } from '../base/tempo'
import type { IdGrupo, IdItem } from '../catalogo/tipos'
import { PARAMETROS_PADRAO as P } from '../memoria/parametros'
import { criarQuestao, type ContextoDeQuestao, type Questao } from '../questoes/questao'
import { avaliarResposta } from './avaliar-resposta'
import { feedbackDe } from './feedback'
import { NORMAS_DE_LATENCIA_VAZIAS } from './normas-de-latencia'
import type { Avaliacao } from './tipos'

const catalogo = catalogoFixo()
const ids = (texto: string): IdItem[] => texto.split('') as IdItem[]
const ISOLADA: ContextoDeQuestao = { tipo: 'isolada' }
const questao = (alvo: string, contexto: ContextoDeQuestao = ISOLADA, opcoes = 'acgi'): Questao =>
  criarQuestao(alvo as IdItem, { tipo: 'estimulo-para-rotulo', opcoes: ids(opcoes) }, contexto)
const certa: Avaliacao = { correta: true, qualidade: 'perfeita', direcao: 'reconhecer', deltaBruto: 1 }
const confundida = (id: string): Avaliacao => ({
  correta: false,
  qualidade: 'errada',
  direcao: 'reconhecer',
  deltaBruto: -1,
  confundidaCom: id as IdItem,
})

describe('feedbackDe', () => {
  it('no acerto isolado, mostra só a resposta certa, com o rótulo oficial, os aliases e a descrição', () => {
    expect(desembrulhar(feedbackDe(questao('a'), certa, catalogo))).toEqual({
      correta: true,
      respostaCerta: { item: 'a', rotulo: 'Item A', aliases: ['Apelido A 1'], descricao: 'Descrição de a' },
    })
  })

  it('no erro, junta o item confundido e o traço do grupo que os dois dividem', () => {
    expect(desembrulhar(feedbackDe(questao('a'), confundida('c'), catalogo))).toEqual({
      correta: false,
      respostaCerta: { item: 'a', rotulo: 'Item A', aliases: ['Apelido A 1'], descricao: 'Descrição de a' },
      tracoDistintivo: 'traço de a no grupo-1',
      confundidaCom: { item: 'c', rotulo: 'Item C', descricao: 'Descrição de c' },
    })
  })

  it('sem grupo em comum, usa o traço da vizinhança dos dois; sem nenhum, fica sem traço', () => {
    expect(desembrulhar(feedbackDe(questao('i', ISOLADA, 'ijkl'), confundida('j'), catalogo))).toMatchObject({
      tracoDistintivo: 'traço de i na vizinhanca-1',
      confundidaCom: { item: 'j' },
    })
    expect(desembrulhar(feedbackDe(questao('a'), confundida('g'), catalogo))).not.toHaveProperty('tracoDistintivo')
  })

  it('na tarefa de grupo, traz o traço do alvo no grupo mesmo no acerto', () => {
    const grupo: ContextoDeQuestao = { tipo: 'grupo', grupo: 'grupo-1' as IdGrupo, exibidos: ids('acdg') }
    expect(desembrulhar(feedbackDe(questao('c', grupo, 'acdg'), certa, catalogo))).toMatchObject({
      correta: true,
      tracoDistintivo: 'traço de c no grupo-1',
    })
  })

  it('não revela nenhuma outra opção nem o parceiro indiscernível', () => {
    const texto = JSON.stringify(desembrulhar(feedbackDe(questao('a', ISOLADA, 'abci'), confundida('c'), catalogo)))
    for (const outro of ['Item B', 'Item I', 'Apelido B']) expect(texto).not.toContain(outro)
  })

  describe('em grupo-membros, a resposta certa é o alvo com o parceiro', () => {
    // a e b são o par do grupo-1: a destacado na fileira, b entre os rótulos. A avaliação é a de avaliarResposta.
    const grupo: ContextoDeQuestao = { tipo: 'grupo', grupo: 'grupo-1' as IdGrupo, exibidos: ids('acdg') }
    const membros = criarQuestao('a' as IdItem, { tipo: 'grupo-membros', opcoes: ids('abcdg') }, grupo)
    const feedbackDaEscolha = (marcadas: string) => {
      const resposta = { tipo: 'escolha', escolhidas: ids(marcadas), latencia: 2000 as Milis } as const
      const avaliacao = desembrulhar(avaliarResposta(membros, resposta, catalogo, NORMAS_DE_LATENCIA_VAZIAS, P))
      return desembrulhar(feedbackDe(membros, avaliacao, catalogo))
    }
    const parceiro = [{ item: 'b', rotulo: 'Item B', descricao: 'Descrição de b' }]

    it('marcando só o parceiro, o feedback diz que ele também é certo', () => {
      expect(feedbackDaEscolha('b')).toMatchObject({
        correta: false,
        respostaCerta: { item: 'a' },
        tambemCertas: parceiro,
      })
    })

    it('marcando só o alvo, o feedback diz o que faltou', () => {
      expect(feedbackDaEscolha('a')).toMatchObject({
        correta: false,
        respostaCerta: { item: 'a' },
        tambemCertas: parceiro,
      })
    })

    it('marcando o par, o feedback confirma os dois', () => {
      expect(feedbackDaEscolha('ab')).toMatchObject({
        correta: true,
        respostaCerta: { item: 'a' },
        tambemCertas: parceiro,
      })
    })
  })

  it('devolve erro para item fora do catálogo', () => {
    expect(feedbackDe(questao('zz'), certa, catalogo)).toMatchObject({
      ok: false,
      erro: { codigo: 'ITEM_INEXISTENTE' },
    })
    expect(feedbackDe(questao('a'), confundida('zz'), catalogo)).toMatchObject({
      ok: false,
      erro: { codigo: 'ITEM_INEXISTENTE' },
    })
  })
})
