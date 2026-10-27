import { describe, expect, it } from 'vitest'
import { desembrulhar } from '../base/resultado'
import type { Instante, Milis } from '../base/tempo'
import type { IdItem } from '../catalogo/tipos'
import { topicoDeItem } from '../grafo/topico'
import { criarQuestao } from '../questoes/questao'
import { criarEvento, idDeEvento, idDeTarefa } from './id'
import { lerEvento, lerEventoSemId } from './ler-evento'
import type { CabecalhoDeEvento, CorpoDeEvento, Evento } from './tipos'

const CABECALHO: CabecalhoDeEvento = { em: 1_760_000_000_000 as Instante, dispositivo: 'aparelho-a', fusoMinutos: 180 }
const G = 'g' as IdItem
const QUESTAO = criarQuestao(
  G,
  { tipo: 'estimulo-para-rotulo', opcoes: ['e', 'g', 'k', 'i'] as IdItem[] },
  { tipo: 'isolada' },
)
const RESPOSTA: CorpoDeEvento = {
  tipo: 'resposta-registrada',
  tarefaId: 'tarefa-1',
  passo: 0,
  uso: { tipo: 'licao', kp: 1 },
  questao: QUESTAO,
  resposta: { tipo: 'escolha', escolhidas: ['e' as IdItem], latencia: 420 as Milis },
  avaliacao: {
    correta: false,
    qualidade: 'chute',
    direcao: 'reconhecer',
    deltaBruto: -1,
    confundidaCom: 'e' as IdItem,
  },
}
const criar = (corpo: CorpoDeEvento = RESPOSTA, cabecalho: CabecalhoDeEvento = CABECALHO): Evento =>
  desembrulhar(criarEvento(cabecalho, corpo))

/** O mesmo valor com as chaves de todo objeto, em todo nível, na ordem inversa. */
function invertido(valor: unknown): unknown {
  if (Array.isArray(valor)) return valor.map(invertido)
  if (typeof valor !== 'object' || valor === null) return valor
  return Object.fromEntries(
    Object.entries(valor)
      .reverse()
      .map(([k, v]) => [k, invertido(v)]),
  )
}

/** Os caminhos das folhas primitivas do valor. */
function folhas(valor: unknown, prefixo: readonly (string | number)[] = []): (readonly (string | number)[])[] {
  if (Array.isArray(valor)) return valor.flatMap((x: unknown, k) => folhas(x, [...prefixo, k]))
  if (typeof valor === 'object' && valor !== null) {
    return Object.entries(valor).flatMap(([k, v]) => folhas(v, [...prefixo, k]))
  }
  return [prefixo]
}

function trocar(valor: unknown, caminho: readonly (string | number)[], novo: (atual: unknown) => unknown): unknown {
  const [passo, ...resto] = caminho
  if (passo === undefined) return novo(valor)
  if (Array.isArray(valor)) return valor.map((x: unknown, k) => (k === passo ? trocar(x, resto, novo) : x))
  const registro = valor as Record<string, unknown>
  return { ...registro, [passo]: trocar(registro[passo], resto, novo) }
}

describe('criarEvento e idDeEvento', () => {
  it('o id é o hash do evento lido sem o id, e o evento criado passa no leitor', () => {
    const e = criar()
    expect(e.id).toMatch(/^[0-9a-f]{16}$/)
    expect(e.id).toBe(idDeEvento(desembrulhar(lerEventoSemId(e))))
    expect(lerEvento(e)).toStrictEqual({ ok: true, valor: e })
    expect(lerEvento(JSON.parse(JSON.stringify(e)))).toStrictEqual({ ok: true, valor: e })
  })

  it('dá o mesmo id com as chaves embaralhadas em todo nível', () => {
    const e = criar()
    expect(criar(invertido(RESPOSTA) as CorpoDeEvento, invertido(CABECALHO) as CabecalhoDeEvento).id).toBe(e.id)
    expect(lerEvento(invertido(e))).toStrictEqual({ ok: true, valor: e })
  })

  it('muda o id com o fuso, o aparelho, o instante e qualquer folha do corpo que o leitor aceite', () => {
    const e = criar()
    expect(criar(RESPOSTA, { ...CABECALHO, fusoMinutos: -180 }).id).not.toBe(e.id)
    expect(criar(RESPOSTA, { ...CABECALHO, dispositivo: 'aparelho-b' }).id).not.toBe(e.id)
    expect(criar(RESPOSTA, { ...CABECALHO, em: (CABECALHO.em + 1) as Instante }).id).not.toBe(e.id)
    // Cada folha trocada por outro valor do mesmo tipo; a troca que o leitor recusa, como um alvo que deixa de ser o
    // tópico do item, não é evento, e fica de fora da conta.
    const outro = (v: unknown): unknown =>
      typeof v === 'string' ? `${v}x` : typeof v === 'number' ? v + 1 : typeof v === 'boolean' ? !v : 'x'
    let mudaram = 0
    for (const caminho of folhas(RESPOSTA)) {
      const lido = criarEvento(CABECALHO, trocar(RESPOSTA, caminho, outro) as CorpoDeEvento)
      if (!lido.ok) continue
      mudaram++
      expect(lido.valor.id, caminho.join('.')).not.toBe(e.id)
    }
    expect(mudaram).toBeGreaterThan(10)
  })

  it('ignora campo a mais, que não chega ao id', () => {
    const comExtra = { ...RESPOSTA, extra: 1, questao: { ...QUESTAO, outro: 'x' } } as CorpoDeEvento
    expect(criar(comExtra)).toStrictEqual(criar())
  })

  it('recusa o que o leitor recusa, com o motivo', () => {
    const comNulo: CorpoDeEvento = {
      ...RESPOSTA,
      resposta: { tipo: 'texto', texto: 'Item\u0000G', latencia: 9 as Milis },
    }
    const digitado = { ...comNulo, questao: criarQuestao(G, { tipo: 'rotulo-digitado' }, { tipo: 'isolada' }) }
    expect(criarEvento(CABECALHO, digitado as CorpoDeEvento)).toStrictEqual({
      ok: false,
      erro: {
        codigo: 'EVENTO_MALFORMADO',
        detalhe: 'corpo: resposta.texto: texto com U+0000 ou metade solta de par substituto',
      },
    })
    expect(criarEvento({ ...CABECALHO, em: 1.5 as Instante }, RESPOSTA)).toMatchObject({
      ok: false,
      erro: { codigo: 'EVENTO_MALFORMADO', detalhe: 'envelope: em: não é inteiro seguro não negativo' },
    })
  })
})

describe('idDeTarefa', () => {
  const semId = {
    tipo: 'revisao',
    alvos: [topicoDeItem(G).id],
    passos: [{ tipo: 'questao', questao: QUESTAO, uso: { tipo: 'revisao' } }],
  } as const

  it('sai do conteúdo da tarefa, sem depender da ordem das chaves', () => {
    expect(idDeTarefa(semId)).toMatch(/^[0-9a-f]{16}$/)
    expect(idDeTarefa(invertido(semId) as typeof semId)).toBe(idDeTarefa(semId))
    expect(idDeTarefa({ ...semId, tipo: 'quiz' })).not.toBe(idDeTarefa(semId))
  })
})
