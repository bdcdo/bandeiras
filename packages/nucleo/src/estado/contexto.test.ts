import { describe, expect, it } from 'vitest'
import { dadosDe, ESPECIFICACAO_FIXA } from '../apoio-a-testes/catalogo-de-teste'
import {
  abrirSessaoNaCena,
  contextoDosCasos,
  DIA,
  emitirUm,
  licaoDeItem,
  novaCena,
  parametrosDosCasos,
  passoDe,
  questaoDigitada,
  respostaCerta,
  respostaErrada,
  tarefaRegistrada,
} from '../apoio-a-testes/cena-do-estado'
import { instantaneoDoEstado } from '../apoio-a-testes/instantaneo-do-estado'
import { desembrulhar } from '../base/resultado'
import { carregarCatalogo } from '../catalogo/carregar-catalogo'
import type { AjustesDeParametros } from '../catalogo/dominio'
import { TECNICAS_TODAS_DESLIGADAS } from '../catalogo/tecnicas'
import type { IdGrupo, IdItem } from '../catalogo/tipos'
import type { Evento } from '../eventos'
import { topicoDeGrupo, topicoDeItem } from '../grafo'
import { devidoEm } from '../memoria'
import type { ContextoDeReducao } from './contexto'
import { reconstruir } from './reconstruir'

const I = (id: string): IdItem => id as IdItem
const T = (id: string) => topicoDeItem(I(id)).id
const GRUPO = 'grupo-1' as IdGrupo
const F = topicoDeGrupo(GRUPO).id
const MEMBROS = ['a', 'b', 'c', 'd'].map(I)

/** Lições de a, b, c, d e do grupo-1, um dia depois uma revisão do grupo que acerta c, e por fim o evento dado. */
function logDoGrupo(ctx: ContextoDeReducao, ultimo?: (c: ReturnType<typeof novaCena>) => Evento): readonly Evento[] {
  const c = novaCena(ctx)
  abrirSessaoNaCena(c, MEMBROS)
  for (const item of MEMBROS) licaoDeItem(c, item)
  emitirUm(c, { tipo: 'licao-concluida', tarefaId: 'licao-do-grupo', topico: F, acelerada: false })
  c.agora += DIA
  abrirSessaoNaCena(c)
  const questao = questaoDigitada(I('c'), { tipo: 'grupo', grupo: GRUPO, exibidos: MEMBROS })
  const revisao = tarefaRegistrada('revisao-grupo', [F], [passoDe(questao, { tipo: 'grupo' })])
  emitirUm(c, { tipo: 'tarefa-iniciada', tarefa: revisao })
  emitirUm(c, respostaCerta({ tarefaId: revisao.id, passo: 0, uso: { tipo: 'grupo' }, questao }))
  if (ultimo !== undefined) ultimo(c)
  return c.eventos
}

describe('criarContextoDeReducao', () => {
  // Decisão do mantenedor: discriminar os membros de um grupo é tão difícil quanto o mais difícil deles.
  describe('a dificuldade do grupo é a do membro mais difícil', () => {
    const dados = dadosDe(ESPECIFICACAO_FIXA)
    const dificuldades: Readonly<Record<string, 1 | 3>> = { a: 1, b: 3 }
    const catalogo = desembrulhar(
      carregarCatalogo({
        ...dados,
        itens: dados.itens.map((i) => ({ ...i, dificuldadeAPriori: dificuldades[i.id] ?? i.dificuldadeAPriori })),
      }),
    )
    const comAjuste = (ajustes: AjustesDeParametros) =>
      contextoDosCasos({ catalogo, parametros: parametrosDosCasos(ajustes) })

    it('com membros de dificuldade 1, 3, 2 e 2, o grupo tem 3', () => {
      const ctx = comAjuste({})
      expect([ctx.dificuldade(T('a')), ctx.dificuldade(T('b')), ctx.dificuldade(T('c'))]).toStrictEqual([1, 3, 2])
      expect(ctx.dificuldade(F)).toBe(3)
    })

    it('o vencimento do grupo segue a desaceleração da dificuldade 3, e não a da 1', () => {
      const base = comAjuste({})
      const log = logDoGrupo(base)
      const vencimento = (ctx: ContextoDeReducao): number | undefined => {
        const m = desembrulhar(reconstruir(ctx, log)).estado.memorias.get(F)
        return m === undefined ? undefined : devidoEm(m, ctx.parametros)
      }
      const doGrupo = vencimento(base)
      expect(doGrupo).toBeDefined()
      expect(vencimento(comAjuste({ 'desaceleracaoPorDificuldade.3': 2 }))).not.toBe(doGrupo)
      expect(vencimento(comAjuste({ 'desaceleracaoPorDificuldade.1': 0.6 }))).toBe(doGrupo)
    })
  })

  it('o contexto não carrega o alcance: o montado à mão com outro grafo propaga pelo grafo que tem', () => {
    // A penalidade do erro em a sobe ao grupo-1, que tem lição concluída. Sem grupos no grafo, o alcance de a é só a; o
    // contexto montado por spread troca o grafo, e a propagação precisa seguir o grafo novo.
    const comGrupos = contextoDosCasos()
    const semGrupos = contextoDosCasos({ tecnicas: TECNICAS_TODAS_DESLIGADAS })
    expect(Object.keys(comGrupos).sort()).toStrictEqual(['catalogo', 'dificuldade', 'grafo', 'parametros', 'tecnicas'])
    const montado: ContextoDeReducao = { ...semGrupos, grafo: comGrupos.grafo, tecnicas: comGrupos.tecnicas }
    const semErro = logDoGrupo(comGrupos)
    const comErro = logDoGrupo(comGrupos, (c) =>
      emitirUm(
        c,
        respostaErrada({ tarefaId: 'avulsa', passo: 0, uso: { tipo: 'revisao' }, questao: questaoDigitada(I('a')) }),
      ),
    )
    const certo = desembrulhar(reconstruir(comGrupos, comErro)).estado
    expect(certo.memorias.get(F)).not.toStrictEqual(desembrulhar(reconstruir(comGrupos, semErro)).estado.memorias.get(F))
    expect(instantaneoDoEstado(desembrulhar(reconstruir(montado, comErro)).estado)).toStrictEqual(
      instantaneoDoEstado(certo),
    )
  })
})
