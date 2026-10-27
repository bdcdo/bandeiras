import { describe, expect, it } from 'vitest'
import {
  abrirSessaoNaCena,
  contextoDosCasos,
  DIA,
  emitirUm,
  INICIO_DA_CENA,
  licaoDeItem,
  novaCena,
  passoDe,
  questaoDeEscolha,
  questaoDigitada,
  respostaCerta,
  respostaErrada,
  tarefaRegistrada,
  type Cena,
} from '../apoio-a-testes/cena-do-estado'
import { instantaneoDoEstado } from '../apoio-a-testes/instantaneo-do-estado'
import { desembrulhar } from '../base/resultado'
import type { Instante, Minutos } from '../base/tempo'
import { TECNICAS_TODAS_DESLIGADAS } from '../catalogo/tecnicas'
import type { IdGrupo, IdItem } from '../catalogo/tipos'
import { criarEvento, type CorpoDeEvento, type Evento, type EventoDoTipo } from '../eventos'
import { aplicarRespostaIsolada } from '../fire'
import { diaLocal } from '../gamificacao'
import { topicoDeItem, type IdTopico } from '../grafo'
import { acuraciaInicial, aplicarRepeticao, atualizarAcuracia, estadoMemoriaInicial, velocidade } from '../memoria'
import {
  contextoDeSessao,
  direcaoDoFormato,
  registrarApresentacao,
  registrarLicaoConcluida,
  registrarQuestao,
} from '../questoes'
import { registrarLatencia } from '../avaliacao'
import type { ContextoDeReducao } from './contexto'
import { reconstruir } from './reconstruir'
import { reduzir } from './reduzir'
import { MOTIVOS_DE_ABSORCAO, type EstadoMotor, type MotivoDeAbsorcao } from './tipos'

// A tabela de totalidade: cada linha é um evento válido que não combina com o estado, com o estado esperado depois dele
// e o motivo que a reconstrução conta. O estado esperado parte do de antes e aplica só o efeito que a linha diz; sem
// efeito, o evento só conta, e só mudam nEventos, ultimoEventoId e ultimoEm. A preparação de cada linha é coerente e não
// absorve nada, e por isso os motivos do relato são os da linha.

const ctx = contextoDosCasos()
const { catalogo, parametros: P } = ctx
const I = (id: string): IdItem => id as IdItem
const T = (id: string): IdTopico => topicoDeItem(I(id)).id
const GRUPO_1 = 'grupo-1' as IdGrupo
const NO_GRUPO_1 = { tipo: 'grupo', grupo: GRUPO_1, exibidos: [I('c'), I('d'), I('a'), I('g')] } as const

/** O estado depois do evento, com o efeito dado e a contagem que todo evento faz. */
function contado(efeito: EstadoMotor, antes: EstadoMotor, e: Evento): EstadoMotor {
  return {
    ...efeito,
    nEventos: antes.nEventos + 1,
    ultimoEventoId: e.id,
    ultimoEm: Math.max(antes.ultimoEm, e.em) as Instante,
  }
}

/** O estado sem a sessão ou sem a tarefa: o redutor tira a chave, e não a deixa indefinida. */
function sem(e: EstadoMotor, chave: 'sessao' | 'tarefa'): EstadoMotor {
  return Object.fromEntries(Object.entries(e).filter(([k]) => k !== chave)) as EstadoMotor
}

function comoResposta(e: Evento): EventoDoTipo<'resposta-registrada'> & Readonly<{ avaliacao: object }> {
  if (e.tipo !== 'resposta-registrada' || e.avaliacao === undefined) throw new Error('o caso espera resposta avaliada')
  return e
}

/** O que toda resposta avaliada fora do diagnóstico faz: normas, janela de qualidades e, com sessão, o contexto. */
function comumDaResposta(antes: EstadoMotor, evento: Evento): EstadoMotor {
  const e = comoResposta(evento)
  const avaliacao = e.avaliacao as NonNullable<EventoDoTipo<'resposta-registrada'>['avaliacao']>
  const normas = registrarLatencia(antes.normas, e.questao, e.resposta, avaliacao, P)
  const ultimasQualidades = [...antes.ultimasQualidades, avaliacao.qualidade].slice(-P.janelaChuteSistematico)
  const depois = { ...antes, normas, ultimasQualidades }
  return antes.sessao === undefined
    ? depois
    : { ...depois, sessao: { ...antes.sessao, contexto: registrarQuestao(antes.sessao.contexto, e.questao) } }
}

const inicial = (antes: EstadoMotor, t: IdTopico) =>
  antes.memorias.get(t) ?? estadoMemoriaInicial(acuraciaInicial(t, catalogo, antes.memorias, P))

/** As memórias depois da resposta isolada sobre tópico de lição concluída, pela função da camada fire. */
function isolada(antes: EstadoMotor, evento: Evento): EstadoMotor['memorias'] {
  const e = comoResposta(evento)
  const avaliacao = e.avaliacao as NonNullable<EventoDoTipo<'resposta-registrada'>['avaliacao']>
  const elegiveis = new Set([...antes.licoes].filter(([, s]) => s.status === 'concluida').map(([t]) => t))
  const propagacao = {
    grafo: ctx.grafo,
    parametros: P,
    tecnicas: ctx.tecnicas,
    agora: e.em,
    dificuldade: ctx.dificuldade,
  }
  return aplicarRespostaIsolada(propagacao, antes.memorias, {
    alvo: e.questao.alvo,
    direcao: direcaoDoFormato(e.questao.formato.tipo),
    deltaBruto: P.deltaBruto[avaliacao.qualidade],
    elegiveis,
  }).memorias
}

const revisaoDe = (...itens: readonly string[]) =>
  tarefaRegistrada(
    'revisao',
    itens.map(T),
    itens.map((i) => passoDe(questaoDigitada(I(i)), { tipo: 'revisao' })),
  )
const REVISAO_K = revisaoDe('k')
const REVISAO_L = revisaoDe('l')
const REVISAO_K_L = revisaoDe('k', 'l')
const REVISAO = { tipo: 'revisao' } as const
const DE_GRUPO = { tipo: 'grupo' } as const
const GRUPO_RECUSADO = tarefaRegistrada(
  'revisao-grupo',
  [],
  [
    passoDe(questaoDigitada(I('c'), NO_GRUPO_1), DE_GRUPO),
    passoDe(questaoDeEscolha(I('c'), [I('d'), I('a'), I('g')], NO_GRUPO_1), DE_GRUPO),
  ],
)
const GRUPO_SEM_ALVO = tarefaRegistrada('revisao-grupo', [], [passoDe(questaoDigitada(I('d'), NO_GRUPO_1), DE_GRUPO)])
const passoDoGrupo = (tarefa: typeof GRUPO_RECUSADO, passo: number) => {
  const p = tarefa.passos[passo]
  if (p?.tipo !== 'questao') throw new Error('passo de questão esperado')
  return { tarefaId: tarefa.id, passo, uso: DE_GRUPO, questao: p.questao }
}

type Linha = Readonly<{
  linha: string
  contexto?: ContextoDeReducao
  /** Monta a cena até o evento da linha; a preparação não absorve nada. */
  preparar?: (c: Cena) => void
  corpo: CorpoDeEvento
  /** O efeito esperado sobre o estado de antes, sem a contagem; sem ele, o evento só conta. */
  efeito?: (antes: EstadoMotor, e: Evento) => EstadoMotor
  motivos: Partial<Record<MotivoDeAbsorcao, number>>
}>

const LINHAS: readonly Linha[] = [
  {
    linha: 'perfil-criado dentro da época só conta',
    corpo: { tipo: 'perfil-criado', semente: 'outra', catalogoHash: catalogo.hash, versaoModelo: 1 },
    motivos: { 'perfil-criado-na-epoca': 1 },
  },
  {
    linha: 'sessao-iniciada com sessão aberta troca a sessão e interrompe a tarefa aberta, sem fabricar evento',
    preparar: (c) => {
      abrirSessaoNaCena(c, [I('h')])
      emitirUm(c, { tipo: 'tarefa-iniciada', tarefa: REVISAO_K })
    },
    corpo: { tipo: 'sessao-iniciada', orcamentoMin: 20 as Minutos, novasPrevistas: [I('i')] },
    efeito: (antes, e) => ({
      ...sem(antes, 'tarefa'),
      sessao: {
        iniciadaEm: e.em,
        orcamentoMin: 20 as Minutos,
        contexto: contextoDeSessao({ pendentesNovas: [I('i')], aprendidos: [] }),
      },
      sessoesIniciadas: antes.sessoesIniciadas + 1,
    }),
    motivos: { 'sessao-sobre-sessao-aberta': 1 },
  },
  {
    linha: 'sessao-encerrada sem sessão só conta',
    corpo: { tipo: 'sessao-encerrada', motivo: 'usuario' },
    motivos: { 'sessao-encerrada-sem-sessao': 1 },
  },
  {
    linha: 'sessao-encerrada sem sessão interrompe a tarefa aberta',
    preparar: (c) => emitirUm(c, { tipo: 'tarefa-iniciada', tarefa: REVISAO_K }),
    corpo: { tipo: 'sessao-encerrada', motivo: 'usuario' },
    efeito: (antes) => sem(antes, 'tarefa'),
    motivos: { 'sessao-encerrada-sem-sessao': 1 },
  },
  {
    linha: 'diagnostico-encerrado sem diagnóstico em curso só conta',
    corpo: { tipo: 'diagnostico-encerrado', motivo: 'concluido' },
    motivos: { 'diagnostico-fora-de-ordem': 1 },
  },
  {
    linha: 'diagnostico-iniciado depois do pulado só conta',
    preparar: (c) => emitirUm(c, { tipo: 'diagnostico-pulado' }),
    corpo: { tipo: 'diagnostico-iniciado' },
    motivos: { 'diagnostico-fora-de-ordem': 1 },
  },
  {
    linha: 'diagnostico-pulado com o diagnóstico em curso só conta',
    preparar: (c) => emitirUm(c, { tipo: 'diagnostico-iniciado' }),
    corpo: { tipo: 'diagnostico-pulado' },
    motivos: { 'diagnostico-fora-de-ordem': 1 },
  },
  {
    linha: 'tarefa-iniciada com tarefa aberta interrompe a anterior e abre a nova',
    preparar: (c) => {
      abrirSessaoNaCena(c)
      emitirUm(c, { tipo: 'tarefa-iniciada', tarefa: REVISAO_K })
    },
    corpo: { tipo: 'tarefa-iniciada', tarefa: REVISAO_L },
    efeito: (antes, e) => ({
      ...antes,
      tarefa: {
        tarefa: REVISAO_L,
        iniciadaEm: e.em,
        respostas: new Map(),
        normasAntes: antes.normas,
        qualidadesAntes: antes.ultimasQualidades,
      },
    }),
    motivos: { 'tarefa-sobre-tarefa-aberta': 1 },
  },
  {
    linha: 'apresentacao-vista de item fora do catálogo só conta para ele',
    preparar: (c) => abrirSessaoNaCena(c, [I('k')]),
    corpo: { tipo: 'apresentacao-vista', tarefaId: 'tarefa', itens: [I('k'), I('fora')] },
    efeito: (antes) => ({
      ...antes,
      memorias: new Map(antes.memorias).set(T('k'), inicial(antes, T('k'))),
      ...(antes.sessao && {
        sessao: { ...antes.sessao, contexto: registrarApresentacao(antes.sessao.contexto, I('k')) },
      }),
    }),
    motivos: { 'item-fora-do-catalogo': 1 },
  },
  {
    linha: 'apresentacao-vista sem sessão cria a memória e não toca contexto',
    corpo: { tipo: 'apresentacao-vista', tarefaId: 'tarefa', itens: [I('k')] },
    efeito: (antes) => ({ ...antes, memorias: new Map(antes.memorias).set(T('k'), inicial(antes, T('k'))) }),
    motivos: { 'fora-da-sessao': 1 },
  },
  {
    linha: 'resposta sem sessão tem efeito normal e não toca contexto',
    corpo: respostaCerta({ tarefaId: 'avulsa', passo: 0, uso: REVISAO, questao: questaoDigitada(I('k')) }),
    efeito: (antes, e) => ({
      ...comumDaResposta(antes, e),
      memorias: new Map(antes.memorias).set(T('k'), atualizarAcuracia(inicial(antes, T('k')), true, 1, P, 'recordar')),
    }),
    motivos: { 'fora-da-sessao': 1, 'resposta-avulsa': 1 },
  },
  {
    linha: 'resposta sobre tópico fora do grafo só conta',
    preparar: (c) => abrirSessaoNaCena(c),
    corpo: respostaCerta({ tarefaId: 'avulsa', passo: 0, uso: REVISAO, questao: questaoDigitada(I('fora')) }),
    motivos: { 'topico-fora-do-grafo': 1 },
  },
  {
    linha: 'resposta errada confundida com item fora do catálogo tem efeito normal e não conta confusão',
    preparar: (c) => abrirSessaoNaCena(c),
    corpo: respostaErrada(
      { tarefaId: 'avulsa', passo: 0, uso: REVISAO, questao: questaoDigitada(I('k')) },
      'errada',
      I('zz'),
    ),
    efeito: (antes, e) => ({
      ...comumDaResposta(antes, e),
      memorias: new Map(antes.memorias).set(T('k'), atualizarAcuracia(inicial(antes, T('k')), false, 1, P, 'recordar')),
    }),
    motivos: { 'item-fora-do-catalogo': 1, 'resposta-avulsa': 1 },
  },
  ...(
    [
      ['com tarefaId diferente da aberta', 'outra', 0, questaoDigitada(I('k'))],
      ['com passo inexistente', REVISAO_K_L.id, 5, questaoDigitada(I('k'))],
      ['com questao.id diferente da do passo', REVISAO_K_L.id, 0, questaoDeEscolha(I('k'), [I('l'), I('g'), I('h')])],
    ] as const
  ).map(([como, tarefaId, passo, questao]): Linha => ({
    linha: `resposta ${como} é avulsa: efeito isolado, sem XP e sem fechar a aberta`,
    preparar: (c) => {
      abrirSessaoNaCena(c, [I('k')])
      licaoDeItem(c, I('k'))
      emitirUm(c, { tipo: 'tarefa-iniciada', tarefa: REVISAO_K_L })
    },
    corpo: respostaCerta({ tarefaId, passo, uso: REVISAO, questao }),
    efeito: (antes, e) => ({ ...comumDaResposta(antes, e), memorias: isolada(antes, e) }),
    motivos: { 'resposta-avulsa': 1 },
  })),
  {
    linha: 'resposta a passo já respondido é avulsa: efeito isolado, sem XP e sem fechar a aberta',
    preparar: (c) => {
      abrirSessaoNaCena(c, [I('k')])
      licaoDeItem(c, I('k'))
      emitirUm(c, { tipo: 'tarefa-iniciada', tarefa: REVISAO_K_L })
      emitirUm(c, respostaCerta({ tarefaId: REVISAO_K_L.id, passo: 0, uso: REVISAO, questao: questaoDigitada(I('k')) }))
    },
    corpo: respostaErrada({ tarefaId: REVISAO_K_L.id, passo: 0, uso: REVISAO, questao: questaoDigitada(I('k')) }),
    efeito: (antes, e) => ({ ...comumDaResposta(antes, e), memorias: isolada(antes, e) }),
    motivos: { 'resposta-avulsa': 1 },
  },
  {
    linha: 'resposta avulsa de uso grupo não muda a memória',
    preparar: (c) => {
      abrirSessaoNaCena(c, [I('c')])
      licaoDeItem(c, I('c'))
    },
    corpo: respostaCerta({ tarefaId: 'outra', passo: 0, uso: DE_GRUPO, questao: questaoDigitada(I('c'), NO_GRUPO_1) }),
    efeito: comumDaResposta,
    motivos: { 'resposta-avulsa': 1 },
  },
  {
    linha: 'tarefa de grupo que aplicarTarefaDeGrupo recusa absorve a memória da tarefa',
    preparar: (c) => {
      abrirSessaoNaCena(c, [I('c')])
      licaoDeItem(c, I('c'))
      emitirUm(c, { tipo: 'tarefa-iniciada', tarefa: GRUPO_RECUSADO })
      emitirUm(c, respostaErrada(passoDoGrupo(GRUPO_RECUSADO, 0)))
    },
    // Dois passos sobre o mesmo alvo: a função recusa alvo repetido. Os erros tiram o XP da tarefa, que fica em zero.
    corpo: respostaErrada(passoDoGrupo(GRUPO_RECUSADO, 1)),
    efeito: (antes, e) => sem(comumDaResposta(antes, e), 'tarefa'),
    motivos: { 'tarefa-de-grupo-recusada': 1 },
  },
  {
    linha: 'tarefa de grupo sem alvo de lição concluída absorve a memória da tarefa',
    preparar: (c) => {
      abrirSessaoNaCena(c)
      emitirUm(c, { tipo: 'tarefa-iniciada', tarefa: GRUPO_SEM_ALVO })
    },
    corpo: respostaErrada(passoDoGrupo(GRUPO_SEM_ALVO, 0)),
    efeito: (antes, e) => sem(comumDaResposta(antes, e), 'tarefa'),
    motivos: { 'tarefa-de-grupo-sem-alvo-valido': 1 },
  },
  {
    linha: 'licao-concluida de tópico já concluído só conta, sem segunda repetição',
    preparar: (c) => {
      abrirSessaoNaCena(c, [I('k')])
      licaoDeItem(c, I('k'))
    },
    corpo: { tipo: 'licao-concluida', tarefaId: 'outra', topico: T('k'), acelerada: false },
    motivos: { 'licao-ja-concluida': 1 },
  },
  {
    linha: 'licao-concluida de tópico fora do grafo só conta',
    preparar: (c) => abrirSessaoNaCena(c),
    corpo: { tipo: 'licao-concluida', tarefaId: 'outra', topico: 'grupo:fora' as IdTopico, acelerada: false },
    motivos: { 'topico-fora-do-grafo': 1 },
  },
  {
    linha: 'licao-concluida com tarefaId que não é a aberta aplica status e repetição e não fecha a aberta',
    preparar: (c) => {
      abrirSessaoNaCena(c, [I('l')])
      emitirUm(c, { tipo: 'tarefa-iniciada', tarefa: REVISAO_K })
    },
    corpo: { tipo: 'licao-concluida', tarefaId: 'outra', topico: T('l'), acelerada: false },
    efeito: (antes, e) => {
      const antesDaLicao = inicial(antes, T('l'))
      const repetida = aplicarRepeticao(
        antesDaLicao,
        {
          deltaBruto: P.deltaBruto.perfeita,
          agora: e.em,
          velocidade: velocidade(antesDaLicao, ctx.dificuldade(T('l')), P, ctx.tecnicas),
          origem: 'explicita',
        },
        P,
      )
      return {
        ...antes,
        memorias: new Map(antes.memorias).set(T('l'), repetida),
        licoes: new Map(antes.licoes).set(T('l'), {
          status: 'concluida',
          em: e.em,
          acelerada: false,
          viaDiagnostico: false,
        }),
        ...(antes.sessao && {
          sessao: { ...antes.sessao, contexto: registrarLicaoConcluida(antes.sessao.contexto, I('l')) },
        }),
      }
    },
    motivos: { 'licao-de-outra-tarefa': 1 },
  },
  {
    linha: 'licao-adiada de tópico concluído só conta',
    preparar: (c) => {
      abrirSessaoNaCena(c, [I('k')])
      licaoDeItem(c, I('k'))
    },
    corpo: { tipo: 'licao-adiada', tarefaId: 'outra', topico: T('k'), kp: 2 },
    motivos: { 'licao-ja-concluida': 1 },
  },
  {
    linha: 'remediacao-concluida sem par confundido só conta',
    corpo: { tipo: 'remediacao-concluida', tarefaId: 'outra', motivo: 'confusao', alvos: [T('k'), T('l')] },
    motivos: { 'remediacao-sem-par-confundido': 1 },
  },
  {
    linha: 'meta-diaria-alterada sempre grava, com qualquer interruptor',
    contexto: contextoDosCasos({ tecnicas: TECNICAS_TODAS_DESLIGADAS }),
    corpo: { tipo: 'meta-diaria-alterada', xp: 25 },
    efeito: (antes, e) => ({
      ...antes,
      metaPorDia: new Map(antes.metaPorDia).set(diaLocal(e.em, e.fusoMinutos, P), 25),
      metaDiariaXp: 25,
    }),
    motivos: {},
  },
]

describe('tabela de totalidade', () => {
  it.each(LINHAS)('$linha', (linha) => {
    const c = novaCena(linha.contexto ?? ctx)
    linha.preparar?.(c)
    expect(desembrulhar(reconstruir(c.ctx, c.eventos)).relato.absorvidos).toStrictEqual({})
    const antes = c.estado
    const quantos = c.eventos.length
    const e = emitirUm(c, linha.corpo)

    const esperado = contado(linha.efeito?.(antes, e) ?? antes, antes, e)
    expect(instantaneoDoEstado(c.estado)).toStrictEqual(instantaneoDoEstado(esperado))
    expect(c.eventos).toHaveLength(quantos + 1)
    const { estado, relato } = desembrulhar(reconstruir(c.ctx, c.eventos))
    expect(instantaneoDoEstado(estado)).toStrictEqual(instantaneoDoEstado(c.estado))
    expect(relato.absorvidos).toStrictEqual(linha.motivos)
  })

  it('cobre todo motivo de absorção', () => {
    const cobertos = new Set(LINHAS.flatMap((l) => Object.keys(l.motivos)))
    expect(cobertos).toEqual(new Set(MOTIVOS_DE_ABSORCAO))
  })

  it('reduzir com em anterior a ultimoEm reduz com o próprio em, e ultimoEm fica o maior', () => {
    const c = novaCena(ctx)
    c.agora += 3 * DIA
    abrirSessaoNaCena(c)
    const antes = c.estado
    const e = desembrulhar(
      criarEvento(
        { em: (INICIO_DA_CENA + DIA) as Instante, dispositivo: 'aparelho-b', fusoMinutos: 180 },
        { tipo: 'meta-diaria-alterada', xp: 40 },
      ),
    )
    const depois = reduzir(ctx, antes, e)
    const esperado = contado(
      { ...antes, metaPorDia: new Map(antes.metaPorDia).set(diaLocal(e.em, 180, P), 40), metaDiariaXp: 40 },
      antes,
      e,
    )
    expect(depois.ultimoEm).toBe(antes.ultimoEm)
    expect(instantaneoDoEstado(depois)).toStrictEqual(instantaneoDoEstado(esperado))
  })
})
