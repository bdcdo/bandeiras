import { describe, expect, it } from 'vitest'
import { catalogoDe, type EspecificacaoDeCatalogo } from '../apoio-a-testes/catalogo-de-teste'
import {
  abrirSessaoNaCena,
  contextoDosCasos,
  DIA,
  emitirNaCena,
  emitirUm,
  HORA,
  licaoDeItem,
  MINUTO,
  novaCena,
  parametrosDosCasos,
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
import type { Instante } from '../base/tempo'
import { TECNICAS_TODAS_LIGADAS } from '../catalogo/tecnicas'
import type { Direcao, IdGrupo, IdItem } from '../catalogo/tipos'
import type { Evento, EventoDoTipo, TipoDeEvento } from '../eventos'
import { aplicarRespostaIsolada, aplicarTarefaDeGrupo, type Memorias } from '../fire'
import { diaLocal } from '../gamificacao'
import { topicoDeGrupo, topicoDeItem, type IdTopico } from '../grafo'
import {
  acuraciaInicial,
  aplicarRepeticao,
  atualizarAcuracia,
  devidoEm,
  estadoMemoriaInicial,
  fase,
  velocidade,
  type EstadoMemoria,
} from '../memoria'
import { contextoDeSessao, registrarQuestao } from '../questoes'
import { criarQuestao } from '../questoes/questao'
import { registrarLatencia } from '../avaliacao'
import { chaveDePar } from './confusoes'
import { metaDoDia, statusDaLicao } from './consultas'
import type { ContextoDeReducao } from './contexto'
import { reconstruir } from './reconstruir'
import type { EstadoMotor } from './tipos'

// Os casos fixos dos efeitos da redução, com os parâmetros de `AJUSTES_DOS_CASOS`: cada caso compara o estado com o que
// as funções de memoria/, fire/ e gamificacao/ dão para a mesma história, e assim prende a composição (o que se aplica,
// em que ordem, com que instante e com que parâmetro), e não as fórmulas, que têm teste próprio.

const ctx = contextoDosCasos()
const P = ctx.parametros
const I = (id: string): IdItem => id as IdItem
const T = (id: string): IdTopico => topicoDeItem(I(id)).id
const REVISAO = { tipo: 'revisao' } as const

function memoria(c: Cena, t: IdTopico): EstadoMemoria {
  const m = c.estado.memorias.get(t)
  if (m === undefined) throw new Error(`sem memória de ${t}`)
  return m
}

function ultimo<K extends TipoDeEvento>(c: Cena, tipo: K): EventoDoTipo<K> {
  const e = c.eventos.findLast((x) => x.tipo === tipo)
  if (e === undefined) throw new Error(`sem evento ${tipo}`)
  return e as EventoDoTipo<K>
}

const propagacao = (contexto: ContextoDeReducao, agora: Instante) => ({
  grafo: contexto.grafo,
  parametros: contexto.parametros,
  tecnicas: contexto.tecnicas,
  agora,
  dificuldade: contexto.dificuldade,
})

/** A memória de `t` depois de medir cada acerto e de uma repetição perfeita em `em`, como a lição deixa. */
function memoriaDaLicao(
  t: IdTopico,
  acertos: readonly boolean[],
  em: Instante,
  contexto: ContextoDeReducao = ctx,
  direcao: Direcao = 'recordar',
): EstadoMemoria {
  const p = contexto.parametros
  let e = estadoMemoriaInicial(acuraciaInicial(t, contexto.catalogo, new Map(), p))
  for (const acerto of acertos) e = atualizarAcuracia(e, acerto, 1, p, direcao)
  const v = velocidade(e, contexto.dificuldade(t), p, contexto.tecnicas)
  return aplicarRepeticao(e, { deltaBruto: p.deltaBruto.perfeita, agora: em, velocidade: v, origem: 'explicita' }, p)
}

const somenteXp = (estado: EstadoMotor): [string, number][] => [...estado.xpPorDia]

describe('lição', () => {
  it('licao-concluida dá uma repetição explícita perfeita no instante dela, e só ela', () => {
    const c = novaCena(ctx)
    abrirSessaoNaCena(c, [I('k')])
    licaoDeItem(c, I('k'))
    const fim = ultimo(c, 'licao-concluida')
    const m = memoria(c, T('k'))
    expect(m).toStrictEqual(memoriaDaLicao(T('k'), [true, true, true], fim.em))
    expect(fase(m, P)).toBe('aprendendo')
    // O vencimento da lição, preso em número: um intervalo ideal de `intervaloBaseDias` 1,3 crescido pela velocidade do
    // tópico, acima de 1 depois de três acertos. Sem a repetição, o tópico não teria vencimento.
    expect(((devidoEm(m, P) ?? 0) - fim.em) / DIA).toBeCloseTo(1.5787, 4)
    expect(statusDaLicao(c.estado, T('k'))).toStrictEqual({
      status: 'concluida',
      em: fim.em,
      acelerada: false,
      viaDiagnostico: false,
    })
  })

  it('com o KP1 errado e refeito, as respostas da lição só medem, sem repetição', () => {
    const c = novaCena(ctx)
    abrirSessaoNaCena(c, [I('k')])
    licaoDeItem(c, I('k'), { acertos: [false, true, true, true] })
    expect(memoria(c, T('k'))).toStrictEqual(
      memoriaDaLicao(T('k'), [false, true, true, true], ultimo(c, 'licao-concluida').em),
    )
  })

  it('licao-adiada libera a lição 24 horas depois e conta os adiamentos, com o KP da falha', () => {
    const c = novaCena(ctx)
    abrirSessaoNaCena(c, [I('k')])
    for (const kp of [1, 3] as const) {
      const tarefaId = licaoDeItem(c, I('k'), { acertos: [false, false], concluir: false })
      emitirUm(c, { tipo: 'licao-adiada', tarefaId, topico: T('k'), kp })
    }
    const adiada = ultimo(c, 'licao-adiada')
    expect(statusDaLicao(c.estado, T('k'))).toStrictEqual({
      status: 'adiada',
      liberadoEm: adiada.em + DIA,
      tentativas: 2,
      kpDaFalha: 3,
    })
    expect(c.estado.tarefa).toBeUndefined()
  })

  it('a remediação de lição antes da lição concluída só mede, e a repetição vem com a lição', () => {
    const c = novaCena(ctx)
    abrirSessaoNaCena(c, [I('k')])
    const licao = tarefaRegistrada('licao', [T('k')])
    emitirNaCena(
      c,
      { tipo: 'tarefa-iniciada', tarefa: licao },
      { tipo: 'apresentacao-vista', tarefaId: licao.id, itens: [I('k')] },
    )
    const questao = questaoDigitada(I('k'))
    const remediacao = tarefaRegistrada('remediacao', [T('k')], [passoDe(questao, { tipo: 'remediacao' })])
    emitirUm(c, { tipo: 'tarefa-iniciada', tarefa: remediacao })
    emitirUm(c, respostaCerta({ tarefaId: remediacao.id, passo: 0, uso: { tipo: 'remediacao' }, questao }))
    c.agora += 10 * MINUTO
    emitirUm(c, { tipo: 'licao-concluida', tarefaId: licao.id, topico: T('k'), acelerada: false })
    expect(memoria(c, T('k'))).toStrictEqual(memoriaDaLicao(T('k'), [true], ultimo(c, 'licao-concluida').em))
  })
})

describe('resposta isolada', () => {
  /** Uma cena com a lição de k concluída e o relógio dois dias à frente. */
  function comK(contexto: ContextoDeReducao = ctx): Cena {
    const c = novaCena(contexto)
    abrirSessaoNaCena(c, [I('k')])
    licaoDeItem(c, I('k'))
    c.agora += 2 * DIA
    return c
  }

  function isoladaEsperada(contexto: ContextoDeReducao, antes: Memorias, e: Evento, direcao: Direcao, delta: number) {
    return aplicarRespostaIsolada(propagacao(contexto, e.em), antes, {
      alvo: T('k'),
      direcao,
      deltaBruto: delta,
      elegiveis: new Set([T('k')]),
    }).memorias
  }

  it('a discriminação certa de múltipla escolha entra com fatorMultiplaEscolha 0,4', () => {
    const corpo = respostaCerta({
      tarefaId: 'avulsa',
      passo: 0,
      uso: { tipo: 'discriminacao' },
      questao: questaoDeEscolha(I('k'), [I('l'), I('g'), I('h')]),
    })
    const c = comK()
    const antes = c.estado.memorias
    const e = emitirUm(c, corpo)
    expect([...c.estado.memorias]).toStrictEqual([
      ...isoladaEsperada(ctx, antes, e, 'reconhecer', P.deltaBruto.perfeita),
    ])
    const comMeio = contextoDosCasos({ parametros: parametrosDosCasos({ fatorMultiplaEscolha: 0.5 }) })
    const outra = comK(comMeio)
    emitirUm(outra, corpo)
    expect(devidoEm(memoria(outra, T('k')), P)).not.toBe(devidoEm(memoria(c, T('k')), P))
  })

  it('o deltaBruto sai dos parâmetros vigentes, e não do gravado na avaliação', () => {
    const c = comK()
    const antes = c.estado.memorias
    const e = emitirUm(
      c,
      respostaCerta({ tarefaId: 'avulsa', passo: 0, uso: REVISAO, questao: questaoDigitada(I('k')) }, 'boa'),
    )
    const comBoa = contextoDosCasos({ parametros: parametrosDosCasos({ 'deltaBruto.boa': 0.7 }) })
    const ajustado = desembrulhar(reconstruir(comBoa, c.eventos)).estado
    expect([...ajustado.memorias]).toStrictEqual([...isoladaEsperada(comBoa, antes, e, 'recordar', 0.7)])
    expect(devidoEm(memoria(c, T('k')), P)).not.toBe(devidoEm(ajustado.memorias.get(T('k')) ?? memoria(c, T('k')), P))
  })

  it.each([
    ['ligada', TECNICAS_TODAS_LIGADAS],
    ['desligada', { ...TECNICAS_TODAS_LIGADAS, remediacao: false }],
  ])('o erro de quiz reagenda o tópico para um dia depois, com a remediação %s', (_, tecnicas) => {
    const c = comK(contextoDosCasos({ tecnicas }))
    const questao = questaoDigitada(I('k'))
    const quiz = tarefaRegistrada('quiz', [T('k')], [passoDe(questao, { tipo: 'quiz' })])
    emitirUm(c, { tipo: 'tarefa-iniciada', tarefa: quiz })
    const e = emitirUm(c, respostaErrada({ tarefaId: quiz.id, passo: 0, uso: { tipo: 'quiz' }, questao }))
    expect(Math.abs((devidoEm(memoria(c, T('k')), P) ?? 0) - (e.em + DIA))).toBeLessThan(1)
  })

  it('a resposta sobre tópico sem lição concluída só mede', () => {
    const c = novaCena(ctx)
    abrirSessaoNaCena(c, [I('k')])
    emitirUm(c, { tipo: 'apresentacao-vista', tarefaId: 'tarefa', itens: [I('k')] })
    const antes = memoria(c, T('k'))
    emitirUm(c, respostaErrada({ tarefaId: 'avulsa', passo: 0, uso: REVISAO, questao: questaoDigitada(I('k')) }))
    expect(memoria(c, T('k'))).toStrictEqual(atualizarAcuracia(antes, false, 1, P, 'recordar'))
  })
})

describe('XP', () => {
  const XP_DA_LICAO = P.minutosLicao * P.multiplicadorXpPerfeita

  it('entra no dia local do evento que conclui, no fuso dele: a virada das 4h com fusos 180 e -180', () => {
    // 04:10 UTC é 01:10 em UTC-3 (fuso 180), ainda o dia anterior pela virada das 4h, e 07:10 em UTC+3 (fuso -180).
    // A tarefa começa quatro horas antes, no dia anterior nos dois fusos.
    const conclusao = Date.UTC(2025, 9, 10, 4, 10)
    const c = novaCena(ctx, { agora: conclusao - 4 * HORA, fusoMinutos: 180 })
    abrirSessaoNaCena(c, [I('k')])
    const tarefaId = licaoDeItem(c, I('k'), { concluir: false })
    c.agora = conclusao
    c.fusoMinutos = -180
    emitirUm(c, { tipo: 'licao-concluida', tarefaId, topico: T('k'), acelerada: false })
    expect(diaLocal(ultimo(c, 'tarefa-iniciada').em, 180, P)).toBe('2025-10-09')
    expect(diaLocal(ultimo(c, 'licao-concluida').em, 180, P)).toBe('2025-10-09')
    const [[dia, xp] = ['', 0], ...outros] = somenteXp(c.estado)
    expect([dia, outros]).toStrictEqual(['2025-10-10', []])
    expect(xp).toBeCloseTo(XP_DA_LICAO, 9)
  })

  it('o fuso do dia é o gravado no evento, e não um fixo: 01:10 UTC em UTC+3 já passou da virada do dia 10', () => {
    // Em UTC+3 (fuso -180), 01:10 UTC é 04:10, depois da virada das 4h; em UTC (fuso 0) e em UTC-3 (fuso 180), ainda é o
    // dia 9. No caso de cima o fuso 0 e o -180 caem no mesmo dia, e um fuso fixo passaria por ele.
    const c = novaCena(ctx, { agora: Date.UTC(2025, 9, 10, 1, 10), fusoMinutos: -180 })
    abrirSessaoNaCena(c, [I('k')])
    licaoDeItem(c, I('k'))
    const { em } = ultimo(c, 'licao-concluida')
    expect([diaLocal(em, 0, P), diaLocal(em, 180, P)]).toStrictEqual(['2025-10-09', '2025-10-09'])
    const [[dia, xp] = ['', 0], ...outros] = somenteXp(c.estado)
    expect([dia, outros]).toStrictEqual(['2025-10-10', []])
    expect(xp).toBeCloseTo(XP_DA_LICAO, 9)
  })

  it('o chute sistemático lê as qualidades de antes da tarefa, e não a janela do fechamento', () => {
    // Com janela 3: [perfeita x3] da lição, dois chutes avulsos, a tarefa abre com [perfeita, chute, chute], uma
    // resposta avulsa perfeita entra no meio, e a tarefa fecha com um chute. Antes da tarefa mais ela dá três chutes na
    // janela; a janela do fechamento, [chute, perfeita, chute] mais o chute, daria dois.
    const c = novaCena(ctx)
    abrirSessaoNaCena(c, [I('k')])
    licaoDeItem(c, I('k'))
    const avulsa = { tarefaId: 'avulsa', passo: 0, uso: REVISAO, questao: questaoDigitada(I('l')) }
    emitirUm(c, respostaErrada(avulsa, 'chute'))
    emitirUm(c, respostaErrada(avulsa, 'chute'))
    const questao = questaoDigitada(I('k'))
    const revisao = tarefaRegistrada('revisao', [T('k')], [passoDe(questao, REVISAO)])
    emitirUm(c, { tipo: 'tarefa-iniciada', tarefa: revisao })
    emitirUm(c, respostaCerta(avulsa))
    emitirUm(c, respostaErrada({ tarefaId: revisao.id, passo: 0, uso: REVISAO, questao }, 'chute'))
    const [[, xp] = ['', 0]] = somenteXp(c.estado)
    expect(xp).toBeCloseTo(XP_DA_LICAO + P.minutosPorQuestao * P.multiplicadorXpChute, 9)
  })

  // Escolha do mantenedor: a tarefa que não se conclui soma min(0, xp). A alternativa descartada, somar 0, deixaria quem
  // chuta e abandona a tarefa antes do fim escapar da penalidade (The Math Academy Way, p. 312-313).
  describe('a tarefa interrompida soma só a penalidade', () => {
    function quizInterrompido(responder: (j: Parameters<typeof respostaCerta>[0]) => ReturnType<typeof respostaCerta>) {
      const c = novaCena(ctx)
      abrirSessaoNaCena(c, [I('k')])
      licaoDeItem(c, I('k'))
      const questoes = [
        questaoDigitada(I('k')),
        questaoDeEscolha(I('k'), [I('l'), I('g'), I('h')]),
        questaoDigitada(I('l')),
      ]
      const quiz = tarefaRegistrada(
        'quiz',
        [T('k'), T('l')],
        questoes.map((q) => passoDe(q, { tipo: 'quiz' })),
      )
      emitirUm(c, { tipo: 'tarefa-iniciada', tarefa: quiz })
      questoes.slice(0, 2).forEach((questao, passo) => {
        emitirUm(c, responder({ tarefaId: quiz.id, passo, uso: { tipo: 'quiz' }, questao }))
      })
      emitirUm(c, { tipo: 'sessao-encerrada', motivo: 'usuario' })
      expect(c.estado.tarefa).toBeUndefined()
      const [[, xp] = ['', 0]] = somenteXp(c.estado)
      return xp
    }

    it('com chute sistemático, tira XP do dia', () => {
      const xp = quizInterrompido((j) => respostaErrada(j, 'chute'))
      expect(xp).toBeCloseTo(XP_DA_LICAO + 2 * P.minutosPorQuestao * P.multiplicadorXpChute, 9)
    })

    it('com acertos, não ganha nada', () => {
      expect(quizInterrompido((j) => respostaCerta(j))).toBeCloseTo(XP_DA_LICAO, 9)
    })
  })
})

describe('confusões e remediação', () => {
  const confundir = (c: Cena, alvo: string, com: string, uso: Parameters<typeof respostaErrada>[0]['uso'] = REVISAO) =>
    emitirUm(
      c,
      respostaErrada({ tarefaId: 'avulsa', passo: 0, uso, questao: questaoDigitada(I(alvo)) }, 'errada', I(com)),
    )

  it('a com b e b com a caem na mesma chave', () => {
    const c = novaCena(ctx)
    abrirSessaoNaCena(c)
    confundir(c, 'a', 'b')
    confundir(c, 'b', 'a')
    expect(chaveDePar(I('a'), I('b'))).toBe(chaveDePar(I('b'), I('a')))
    expect([...c.estado.confusoes]).toStrictEqual([[chaveDePar(I('a'), I('b')), 2]])
  })

  // Escolha do mantenedor: conta o erro com confundidaCom fora da lição, da sondagem e do diagnóstico, e sem chute. A
  // alternativa descartada, contar todo erro com confundidaCom, punha na conta os KPs da lição, que erram entre
  // distratores logo depois da primeira exposição, e o chute, que não diz qual item a pessoa confunde.
  it('conta o erro de revisão, quiz, remediação, discriminação e grupo, e não o da lição, o da sondagem nem o chute', () => {
    const c = novaCena(ctx)
    abrirSessaoNaCena(c)
    for (const uso of [
      REVISAO,
      { tipo: 'quiz' },
      { tipo: 'remediacao' },
      { tipo: 'discriminacao' },
      { tipo: 'licao', kp: 1 },
      { tipo: 'sondagem', etapa: 'recordar' },
    ] as const) {
      confundir(c, 'a', 'b', uso)
    }
    const noGrupo = { tipo: 'grupo', grupo: 'grupo-1' as IdGrupo, exibidos: [I('a'), I('c'), I('d'), I('g')] } as const
    emitirUm(
      c,
      respostaErrada(
        { tarefaId: 'avulsa', passo: 0, uso: { tipo: 'grupo' }, questao: questaoDigitada(I('a'), noGrupo) },
        'errada',
        I('b'),
      ),
    )
    emitirUm(
      c,
      respostaErrada({ tarefaId: 'avulsa', passo: 0, uso: REVISAO, questao: questaoDigitada(I('a')) }, 'chute', I('b')),
    )
    expect([...c.estado.confusoes]).toStrictEqual([[chaveDePar(I('a'), I('b')), 5]])
  })

  it('remediacao-concluida marca o par com a contagem de agora, e a confusão seguinte volta a contar', () => {
    const c = novaCena(ctx)
    abrirSessaoNaCena(c)
    confundir(c, 'a', 'b')
    confundir(c, 'b', 'a')
    emitirUm(c, {
      tipo: 'remediacao-concluida',
      tarefaId: 'remediacao',
      motivo: 'licao',
      alvos: [T('a'), T('b'), T('k')],
    })
    confundir(c, 'a', 'b')
    const par = chaveDePar(I('a'), I('b'))
    expect([...c.estado.confusoesRemediadas]).toStrictEqual([[par, 2]])
    expect([...c.estado.confusoes]).toStrictEqual([[par, 3]])
  })
})

describe('metas por dia', () => {
  it('cada dia lê a meta vigente nele, na sequência de cinco dias com troca de meta', () => {
    const c = novaCena(ctx)
    const dia = (): string => diaLocal(c.agora as Instante, c.fusoMinutos, P)
    const dias: string[] = [dia()]
    c.agora += DIA
    dias.push(dia())
    emitirUm(c, { tipo: 'meta-diaria-alterada', xp: 30 })
    c.agora += DIA
    dias.push(dia())
    c.agora += DIA
    dias.push(dia())
    emitirUm(c, { tipo: 'meta-diaria-alterada', xp: 10 })
    emitirUm(c, { tipo: 'meta-diaria-alterada', xp: 12 })
    c.agora += DIA
    dias.push(dia())
    const metas = dias.map((d) => metaDoDia(c.estado, d as never, P))
    expect(metas).toStrictEqual([P.orcamentoPadraoMin, 30, 30, 12, 12])
    expect(c.estado.metaDiariaXp).toBe(12)
  })
})

describe('contexto da sessão', () => {
  it('a tarefa iniciada sem resposta não muda o contexto; a resposta registra a questão', () => {
    const c = novaCena(ctx)
    abrirSessaoNaCena(c, [I('k')])
    const questoes = [questaoDigitada(I('k')), questaoDeEscolha(I('l'), [I('k'), I('g'), I('h')])]
    const quiz = tarefaRegistrada(
      'quiz',
      [T('k'), T('l')],
      questoes.map((q) => passoDe(q, { tipo: 'quiz' })),
    )
    const antes = c.estado.sessao?.contexto
    emitirUm(c, { tipo: 'tarefa-iniciada', tarefa: quiz })
    const [primeira] = questoes
    if (antes === undefined || primeira === undefined) throw new Error('sessão e questão esperadas')
    expect(c.estado.sessao?.contexto).toStrictEqual(antes)
    emitirUm(c, respostaCerta({ tarefaId: quiz.id, passo: 0, uso: { tipo: 'quiz' }, questao: primeira }))
    expect(c.estado.sessao?.contexto).toStrictEqual(registrarQuestao(antes, primeira))
  })

  it('a sessão nasce com as novas previstas sem lição concluída e os itens aprendidos, na ordem das lições', () => {
    const c = novaCena(ctx)
    abrirSessaoNaCena(c, [I('l'), I('k')])
    licaoDeItem(c, I('l'))
    licaoDeItem(c, I('k'))
    abrirSessaoNaCena(c, [I('k'), I('h')])
    expect(c.estado.sessao?.contexto).toStrictEqual(
      contextoDeSessao({ pendentesNovas: [I('h')], aprendidos: [I('l'), I('k')] }),
    )
    expect(c.estado.sessoesIniciadas).toBe(2)
  })
})

describe('tarefa de grupo', () => {
  // Um grupo de seis membros sem par indiscernível, para três alvos caberem com os outros exibidos. O grupo-2, de b e g,
  // tem lição concluída: o erro de b na tarefa do grupo-1 sobe até ele, que fica fora do grupo e dos alvos da tarefa e
  // por isso prova que a redução passa a fire/ também os ascendentes de cada alvo.
  const ESPEC: EspecificacaoDeCatalogo = {
    classes: [1, 1, 1, 1, 1, 1, 2, 2],
    categorias: [1, 1, 2, 2, 1, 2, 1, 2],
    aliases: [],
    vizinhos: [],
    grupos: [
      { membros: [0, 1, 2, 3, 4, 5], par: false },
      { membros: [1, 6], par: false },
    ],
    vizinhancas: [],
  }
  const ctxG = contextoDosCasos({ catalogo: catalogoDe(ESPEC) })
  const GRUPO = 'grupo-1' as IdGrupo
  const F = topicoDeGrupo(GRUPO).id
  const F2 = topicoDeGrupo('grupo-2' as IdGrupo).id
  const CONCLUIDOS = [...['a', 'b', 'c', 'g'].map(T), F2]
  const EXIBIDOS = ['a', 'b', 'c', 'd', 'e', 'f'].map(I)
  const noGrupo = { tipo: 'grupo', grupo: GRUPO, exibidos: EXIBIDOS } as const
  const ACERTOS: Readonly<Record<string, boolean>> = { a: true, b: false, c: true }

  /** A cena com as lições de a, b, c, g e do grupo-2 e a tarefa de grupo aberta, com os alvos na ordem dada. */
  function comTarefa(ordem: readonly string[]) {
    const c = novaCena(ctxG)
    abrirSessaoNaCena(c, [I('a'), I('b'), I('c'), I('g')])
    for (const item of ['a', 'b', 'c', 'g']) licaoDeItem(c, I(item))
    emitirUm(c, { tipo: 'licao-concluida', tarefaId: 'licao-do-grupo-2', topico: F2, acelerada: false })
    c.agora += DIA
    abrirSessaoNaCena(c)
    const questoes = ordem.map((i) => questaoDigitada(I(i), noGrupo))
    const tarefa = tarefaRegistrada(
      'revisao-grupo',
      [F],
      questoes.map((q) => passoDe(q, { tipo: 'grupo' })),
    )
    emitirUm(c, { tipo: 'tarefa-iniciada', tarefa })
    const responder = (passo: number): Evento => {
      const questao = questoes[passo]
      if (questao === undefined) throw new Error('passo inexistente')
      const j = { tarefaId: tarefa.id, passo, uso: { tipo: 'grupo' }, questao } as const
      return emitirUm(c, ACERTOS[questao.itemAlvo] === true ? respostaCerta(j) : respostaErrada(j))
    }
    return { c, antes: c.estado.memorias, responder }
  }

  function esperado(antes: Memorias, alvos: readonly string[], agora: Instante): Memorias {
    const comF = new Map(antes).set(F, estadoMemoriaInicial(acuraciaInicial(F, ctxG.catalogo, antes, ctxG.parametros)))
    const feita = aplicarTarefaDeGrupo(propagacao(ctxG, agora), comF, {
      grupo: F,
      respostas: alvos.map((i) => ({
        alvo: T(i),
        direcao: 'recordar',
        deltaBruto: ctxG.parametros.deltaBruto[ACERTOS[i] === true ? 'perfeita' : 'errada'],
      })),
      exibidos: new Set(EXIBIDOS.map((i) => topicoDeItem(i).id)),
      elegiveis: new Set(CONCLUIDOS),
    })
    return desembrulhar(feita).memorias
  }

  it('o grupo recebe uma atualização por tarefa, no fechamento, com as respostas todas', () => {
    const { c, antes, responder } = comTarefa(['a', 'b', 'c'])
    responder(0)
    responder(1)
    expect(c.estado.memorias).toBe(antes)
    const fim = responder(2)
    expect([...c.estado.memorias]).toStrictEqual([...esperado(antes, ['a', 'b', 'c'], fim.em)])
    expect(c.estado.memorias.get(F2)).not.toBe(antes.get(F2))
    expect(c.estado.tarefa).toBeUndefined()
  })

  it('permutar as respostas não muda as memórias', () => {
    const direta = comTarefa(['a', 'b', 'c'])
    const permutada = comTarefa(['c', 'a', 'b'])
    for (const t of [direta, permutada]) [0, 1, 2].forEach((p) => t.responder(p))
    expect([...permutada.c.estado.memorias]).toStrictEqual([...direta.c.estado.memorias])
  })

  it('interrompida, aplica as respostas ligadas com o instante da última', () => {
    const { c, antes, responder } = comTarefa(['a', 'b', 'c'])
    responder(0)
    const segunda = responder(1)
    c.agora += HORA
    emitirUm(c, { tipo: 'sessao-encerrada', motivo: 'usuario' })
    expect([...c.estado.memorias]).toStrictEqual([...esperado(antes, ['a', 'b'], segunda.em)])
  })
})

describe('diagnóstico', () => {
  // Provisório até a finalização do diagnóstico: a resposta dele só passa pelas normas de latência, e o resto do estado
  // fica como estava, sem memória, acurácia, lição, janela de qualidades, confusão nem XP.
  it('a resposta do diagnóstico só mexe nas normas, e os eventos dele só no status', () => {
    const c = novaCena(ctx)
    const inicio = emitirUm(c, { tipo: 'diagnostico-iniciado' })
    const antes = c.estado
    const uso = { tipo: 'diagnostico' } as const
    const digitada = questaoDigitada(I('k'))
    const certa = respostaCerta({ tarefaId: inicio.id, passo: 0, uso, questao: digitada })
    const associacao = criarQuestao(
      I('k'),
      { tipo: 'associacao', linhas: [[I('k')], [I('l')]], rotulos: [I('k'), I('l')] },
      { tipo: 'isolada' },
    )
    emitirUm(c, certa)
    emitirUm(
      c,
      respostaErrada(
        { tarefaId: inicio.id, passo: 1, uso, questao: questaoDeEscolha(I('l'), [I('k'), I('g'), I('h')]) },
        'errada',
        I('k'),
      ),
    )
    emitirUm(c, {
      tipo: 'resposta-registrada',
      tarefaId: inicio.id,
      passo: 2,
      uso,
      questao: associacao,
      resposta: {
        tipo: 'associacao',
        ligacoes: [
          { linha: 0, rotulo: I('k'), latencia: 900 as never },
          { linha: 1, rotulo: null, latencia: 1200 as never },
        ],
      },
    })
    const fim = emitirUm(c, { tipo: 'diagnostico-encerrado', motivo: 'concluido' })
    if (certa.avaliacao === undefined) throw new Error('avaliação esperada')
    const esperadoDepois: EstadoMotor = {
      ...antes,
      diagnostico: 'encerrado',
      normas: registrarLatencia(antes.normas, digitada, certa.resposta, certa.avaliacao, P),
      nEventos: antes.nEventos + 4,
      ultimoEventoId: fim.id,
      ultimoEm: fim.em,
    }
    expect(instantaneoDoEstado(c.estado)).toStrictEqual(instantaneoDoEstado(esperadoDepois))
  })
})
