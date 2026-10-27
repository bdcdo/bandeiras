import { describe, expect, it } from 'vitest'
import {
  abrirSessaoNaCena,
  contextoDosCasos,
  emitirUm,
  licaoDeItem,
  novaCena,
  passoDe,
  questaoDigitada,
  respostaCerta,
  respostaErrada,
  tarefaRegistrada,
} from '../apoio-a-testes/cena-do-estado'
import type { Instante, Milis } from '../base/tempo'
import type { IdItem } from '../catalogo/tipos'
import { topicoDeItem, type IdTopico } from '../grafo'
import { estadoMemoriaInicial } from '../memoria'
import { chaveDePar } from './confusoes'
import { conferirInvariantes } from './invariantes'
import type { EstadoMotor, TarefaAberta } from './tipos'

// Cada invariante, violada sozinha sobre um estado coerente, aparece na lista com a mensagem dela; o estado coerente dá
// lista vazia. O redutor nunca produz estes estados: eles são montados à mão, para provar que a conferência os pega.

const ctx = contextoDosCasos()
const P = ctx.parametros
const I = (id: string): IdItem => id as IdItem
const T = (id: string): IdTopico => topicoDeItem(I(id)).id
const PAR = chaveDePar(I('a'), I('b'))

/** Sessão aberta, a lição de k, uma confusão remediada, a meta trocada e uma revisão de três passos com um respondido. */
function coerente(): EstadoMotor {
  const c = novaCena(ctx)
  abrirSessaoNaCena(c, [I('k')])
  licaoDeItem(c, I('k'))
  emitirUm(
    c,
    respostaErrada(
      { tarefaId: 'avulsa', passo: 0, uso: { tipo: 'revisao' }, questao: questaoDigitada(I('a')) },
      'errada',
      I('b'),
    ),
  )
  emitirUm(c, { tipo: 'remediacao-concluida', tarefaId: 'r', motivo: 'confusao', alvos: [T('a'), T('b')] })
  emitirUm(c, { tipo: 'meta-diaria-alterada', xp: 30 })
  const questoes = [questaoDigitada(I('k')), questaoDigitada(I('l')), questaoDigitada(I('g'))]
  const revisao = tarefaRegistrada(
    'revisao',
    [T('k'), T('l'), T('g')],
    questoes.map((q) => passoDe(q, { tipo: 'revisao' })),
  )
  emitirUm(c, { tipo: 'tarefa-iniciada', tarefa: revisao })
  emitirUm(
    c,
    respostaCerta({
      tarefaId: revisao.id,
      passo: 0,
      uso: { tipo: 'revisao' },
      questao: questoes[0] ?? questaoDigitada(I('k')),
    }),
  )
  return c.estado
}

const base = coerente()
const tarefa = base.tarefa as TarefaAberta
const [resposta] = tarefa.respostas.values()
const dia = [...base.metaPorDia.keys()][0] ?? ('2025-10-09' as never)

const VIOLACOES: readonly (readonly [string, Partial<EstadoMotor>, string | readonly string[]])[] = [
  [
    'memória de tópico fora do grafo',
    { memorias: new Map(base.memorias).set('item:fora' as IdTopico, estadoMemoriaInicial(0.85)) },
    "tópico fora do grafo no estado: 'item:fora'",
  ],
  [
    'lição de tópico fora do grafo',
    { licoes: new Map(base.licoes).set('grupo:fora' as IdTopico, { status: 'pendente' } as never) },
    "tópico fora do grafo no estado: 'grupo:fora'",
  ],
  [
    'lição concluída sem memória',
    {
      licoes: new Map(base.licoes).set(T('l'), {
        status: 'concluida',
        em: base.ultimoEm,
        acelerada: false,
        viaDiagnostico: false,
      }),
    },
    "lição concluída sem memória: 'item:l'",
  ],
  [
    'lição de item concluída sem repetição',
    {
      memorias: new Map(base.memorias).set(T('l'), estadoMemoriaInicial(0.85)),
      licoes: new Map(base.licoes).set(T('l'), {
        status: 'concluida',
        em: base.ultimoEm,
        acelerada: false,
        viaDiagnostico: false,
      }),
    },
    "lição de item concluída sem repetição: 'item:l'",
  ],
  [
    'par remediado além das confusões',
    { confusoesRemediadas: new Map([[PAR, 2]]) },
    `par remediado além das confusões: '${PAR}'`,
  ],
  [
    'par remediado sem confusão',
    { confusoesRemediadas: new Map([[chaveDePar(I('x'), I('y')), 1]]) },
    `par remediado além das confusões: '${chaveDePar(I('x'), I('y'))}'`,
  ],
  ['XP negativo', { xpPorDia: new Map([[dia, -1]]) }, `XP inválido no dia ${dia}: -1`],
  ['XP não finito', { xpPorDia: new Map([[dia, Number.NaN]]) }, `XP inválido no dia ${dia}: NaN`],
  ['meta de um dia não positiva', { metaPorDia: new Map([[dia, 0]]) }, `meta inválida no dia ${dia}: 0`],
  ['meta vigente não finita', { metaDiariaXp: Number.POSITIVE_INFINITY }, 'meta vigente inválida: Infinity'],
  ['nenhum evento', { nEventos: 0 }, 'nEventos abaixo de 1: 0'],
  // Com o último instante antes da época, nenhuma sessão cabe entre os dois, e a aberta também aparece.
  [
    'último instante antes da época',
    { ultimoEm: (base.inicioDaEpoca - 1) as Instante },
    ['último instante antes do início da época', 'sessão iniciada fora da época'],
  ],
  [
    'sessão iniciada depois do último instante',
    { sessao: { ...(base.sessao as NonNullable<EstadoMotor['sessao']>), iniciadaEm: (base.ultimoEm + 1) as Instante } },
    'sessão iniciada fora da época',
  ],
  [
    'resposta num passo que não existe',
    { tarefa: { ...tarefa, respostas: new Map(tarefa.respostas).set(7, resposta as never) } },
    `tarefa '${tarefa.tarefa.id}' com resposta no passo 7, que não é passo de questão`,
  ],
  [
    'tarefa de passos fixos aberta com tudo respondido',
    { tarefa: { ...tarefa, respostas: new Map(tarefa.respostas).set(1, resposta as never).set(2, resposta as never) } },
    `tarefa '${tarefa.tarefa.id}' de passos fixos aberta com todos os passos de questão respondidos`,
  ],
  [
    'janela de qualidades maior que a janela',
    { ultimasQualidades: Array.from({ length: P.janelaChuteSistematico + 1 }, () => 'perfeita' as const) },
    `janela de qualidades com ${String(P.janelaChuteSistematico + 1)} respostas`,
  ],
  [
    'normas de um formato maiores que a janela delas',
    {
      normas: {
        ...base.normas,
        'rotulo-digitado': Array.from({ length: P.janelaNormasDeLatencia + 1 }, () => 1000 as Milis),
      },
    },
    `normas de 'rotulo-digitado' com ${String(P.janelaNormasDeLatencia + 1)} amostras`,
  ],
]

describe('conferirInvariantes', () => {
  it('não acha nada no estado coerente', () => {
    expect(base.tarefa?.respostas.size).toBe(1)
    expect(base.confusoesRemediadas.get(PAR)).toBe(1)
    expect(conferirInvariantes(ctx, base)).toStrictEqual([])
  })

  it.each(VIOLACOES)('acha %s', (_, mudanca, mensagem) => {
    expect(conferirInvariantes(ctx, { ...base, ...mudanca })).toStrictEqual(
      typeof mensagem === 'string' ? [mensagem] : mensagem,
    )
  })
})
