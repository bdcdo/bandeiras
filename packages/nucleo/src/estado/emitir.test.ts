import { describe, expect, it } from 'vitest'
import {
  abrirSessaoNaCena,
  contextoDosCasos,
  INICIO_DA_CENA,
  licaoDeItem,
  novaCena,
} from '../apoio-a-testes/cena-do-estado'
import { instantaneoDoEstado } from '../apoio-a-testes/instantaneo-do-estado'
import { desembrulhar } from '../base/resultado'
import type { Instante } from '../base/tempo'
import type { IdItem } from '../catalogo/tipos'
import { VERSAO_MODELO, type CorpoDeEvento, type EventoDoTipo } from '../eventos'
import { topicoDeItem } from '../grafo'
import { metaDoDia, statusDaLicao } from './consultas'
import { emitir, iniciarPerfil } from './emitir'
import { reconstruir } from './reconstruir'
import { estadoDoPerfil } from './reduzir'
import { sorteioDoEstado } from './sorteio'

const ctx = contextoDosCasos()
const I = (id: string): IdItem => id as IdItem
const PERFIL = {
  tipo: 'perfil-criado',
  semente: 's',
  catalogoHash: ctx.catalogo.hash,
  versaoModelo: VERSAO_MODELO,
} as const
const META = (xp: number) => ({ tipo: 'meta-diaria-alterada', xp }) as const
const origem = (agora: number) => ({ dispositivo: 'aparelho-a', agora: agora as Instante, fusoMinutos: 180 })

describe('iniciarPerfil', () => {
  it('cria o perfil no agora arredondado para baixo, e o estado é o da época que ele abre', () => {
    const t = desembrulhar(iniciarPerfil(ctx, PERFIL, { dispositivo: 'a', agora: 1000.9 as Instante, fusoMinutos: 0 }))
    const [perfil] = t.eventos
    expect(t.eventos).toHaveLength(1)
    expect(perfil?.em).toBe(1000)
    expect(instantaneoDoEstado(t.estado)).toStrictEqual(
      instantaneoDoEstado(estadoDoPerfil(ctx, perfil as EventoDoTipo<'perfil-criado'>)),
    )
    expect(t.estado.nEventos).toBe(1)
    expect(t.estado.ultimoEventoId).toBe(perfil?.id)
  })

  it('devolve o erro do leitor para o perfil que ele recusa', () => {
    const r = iniciarPerfil(
      ctx,
      { ...PERFIL, semente: '' },
      { dispositivo: 'a', agora: 1000 as Instante, fusoMinutos: 0 },
    )
    expect(r.ok).toBe(false)
  })
})

describe('emitir', () => {
  it('com o relógio parado, cada evento fica um milissegundo depois do anterior', () => {
    const c = novaCena(ctx)
    const t = desembrulhar(emitir(ctx, c.estado, [META(20), META(30), META(40)], origem(INICIO_DA_CENA)))
    expect(t.eventos.map((e) => e.em - INICIO_DA_CENA)).toStrictEqual([1, 2, 3])
    expect(t.estado.ultimoEm).toBe(INICIO_DA_CENA + 3)
    expect(t.estado.metaDiariaXp).toBe(40)
  })

  it('com o relógio atrás do último evento, o em segue o último mais um; adiante, o agora arredondado', () => {
    const c = novaCena(ctx)
    const atras = desembrulhar(emitir(ctx, c.estado, [META(20)], origem(INICIO_DA_CENA - 60_000)))
    expect(atras.eventos[0]?.em).toBe(INICIO_DA_CENA + 1)
    const adiante = desembrulhar(emitir(ctx, atras.estado, [META(30)], origem(INICIO_DA_CENA + 5000.7)))
    expect(adiante.eventos[0]?.em).toBe(INICIO_DA_CENA + 5000)
  })

  it('a lição emitida com o relógio parado reconstrói na ordem em que foi emitida', () => {
    // A última resposta e a lição concluída saem na mesma transição; com o mesmo em, a ordem do log seria a dos ids, e a
    // lição poderia fechar antes da resposta, que viraria avulsa.
    const c = novaCena(ctx)
    abrirSessaoNaCena(c, [I('k')])
    c.passoDoRelogio = 0
    licaoDeItem(c, I('k'))
    const ems = c.eventos.map((e) => e.em)
    expect(new Set(ems).size).toBe(ems.length)
    const { estado, relato } = desembrulhar(reconstruir(ctx, [...c.eventos].reverse()))
    expect(relato.absorvidos).toStrictEqual({})
    expect(instantaneoDoEstado(estado)).toStrictEqual(instantaneoDoEstado(c.estado))
    expect(statusDaLicao(estado, topicoDeItem(I('k')).id).status).toBe('concluida')
  })

  it('o corpo com chaves do envelope não troca o cabeçalho: o evento antigo reaproveitado vira um evento novo', () => {
    // O corpo vem de variável, como o de um evento já gravado; o tipo de CorpoDeEvento não barra as chaves a mais.
    const c = novaCena(ctx)
    const antes = desembrulhar(
      emitir(ctx, c.estado, [META(25), { tipo: 'meta-diaria-alterada', xp: 40 }], origem(INICIO_DA_CENA + 86_400_000)),
    )
    const [antigo] = antes.eventos
    if (antigo === undefined) throw new Error('evento esperado')
    const reaproveitado = { ...antigo, xp: 30, dispositivo: 'intruso', fusoMinutos: -600 }
    const corpo: CorpoDeEvento = reaproveitado
    const t = desembrulhar(emitir(ctx, antes.estado, [corpo], origem(INICIO_DA_CENA)))
    const [novo] = t.eventos
    expect([novo?.em, novo?.dispositivo, novo?.fusoMinutos]).toStrictEqual([
      antes.estado.ultimoEm + 1,
      'aparelho-a',
      180,
    ])
    const { estado } = desembrulhar(reconstruir(ctx, [...c.eventos, ...antes.eventos, ...t.eventos]))
    expect(instantaneoDoEstado(estado)).toStrictEqual(instantaneoDoEstado(t.estado))
    expect(t.estado.metaDiariaXp).toBe(30)
  })

  it('um corpo recusado devolve o erro, e nenhum evento da ação vale', () => {
    const c = novaCena(ctx)
    const r = emitir(ctx, c.estado, [META(20), META(-1)], origem(INICIO_DA_CENA))
    expect(r.ok).toBe(false)
    expect(c.estado.metaDiariaXp).toBe(ctx.parametros.orcamentoPadraoMin)
  })
})

describe('consultas', () => {
  it('statusDaLicao lê a ausência como pendente', () => {
    expect(statusDaLicao(novaCena(ctx).estado, topicoDeItem(I('k')).id)).toStrictEqual({ status: 'pendente' })
  })

  it('metaDoDia antes da primeira troca é o orçamento padrão', () => {
    expect(metaDoDia(novaCena(ctx).estado, '2000-01-01' as never, ctx.parametros)).toBe(
      ctx.parametros.orcamentoPadraoMin,
    )
  })

  it('sorteioDoEstado se repete no mesmo estado e muda com a finalidade e com cada evento', () => {
    const c = novaCena(ctx)
    const valor = (estado: typeof c.estado, finalidade: string) => sorteioDoEstado(estado, finalidade).inteiro(0, 1e9)
    expect(valor(c.estado, 'a')).toBe(valor(c.estado, 'a'))
    expect(valor(c.estado, 'a')).not.toBe(valor(c.estado, 'b'))
    const depois = desembrulhar(emitir(ctx, c.estado, [META(20)], origem(INICIO_DA_CENA))).estado
    expect(valor(depois, 'a')).not.toBe(valor(c.estado, 'a'))
  })
})
