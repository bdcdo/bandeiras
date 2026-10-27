import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { hashFnv1a } from '../base/hash'
import { desembrulhar } from '../base/resultado'
import { serializarCanonico } from '../base/serializacao'
import type { Resposta } from '../avaliacao'
import { FORMATOS_DE_QUESTAO, TIPOS_DE_TAREFA, type UsoDeQuestao } from '../questoes'
import { idDeEvento, idDeTarefa } from './id'
import { lerEvento, lerEventoSemId } from './ler-evento'
import { compararEventos } from './ordem'
import { TIPOS_DE_EVENTO, type Evento } from './tipos'

// O log de referência trava o formato persistido. Cada evento saiu de criarEvento sobre o catálogo fixo dos testes, e o
// arquivo não se edita: um tipo novo, ou um campo opcional novo que precise de exemplo, entra num segundo log de
// referência, com teste próprio. Se este teste reprovar, a mudança no código deixou de ler, ou passou a dar outro id a,
// um evento que um aparelho já pode ter gravado.
const BRUTO = JSON.parse(
  readFileSync(new URL('./log-de-referencia.json', import.meta.url), 'utf8'),
) as readonly unknown[]
const LOG: readonly Evento[] = BRUTO.map((e) => desembrulhar(lerEvento(e)))

/**
 * A chave de cada variante de uso: o tipo, mais o knowledge point na lição e a etapa na sondagem. O tipo é derivado da
 * união, e por isso `CADA_USO` não compila se a união ganhar uma variante que ele não liste.
 */
type ChaveDeUso<U> =
  U extends Readonly<{ tipo: 'licao'; kp: infer K extends number }>
    ? `licao:${K}`
    : U extends Readonly<{ tipo: 'sondagem'; etapa: infer E extends string }>
      ? `sondagem:${E}`
      : U extends Readonly<{ tipo: infer T extends string }>
        ? T
        : never

const CADA_USO: Readonly<Record<ChaveDeUso<UsoDeQuestao>, true>> = {
  'licao:1': true,
  'licao:2': true,
  'licao:3': true,
  'sondagem:recordar': true,
  'sondagem:confirmar': true,
  revisao: true,
  remediacao: true,
  quiz: true,
  discriminacao: true,
  grupo: true,
  diagnostico: true,
}

/** As respostas que se registram: toda a união, menos `continuar`, que só fecha uma apresentação. */
const CADA_RESPOSTA: Readonly<Record<Exclude<Resposta['tipo'], 'continuar'>, true>> = {
  escolha: true,
  texto: true,
  'nao-sei': true,
  'tempo-esgotado': true,
  associacao: true,
}

function chaveDeUso(uso: UsoDeQuestao): string {
  switch (uso.tipo) {
    case 'licao':
      return `licao:${String(uso.kp)}`
    case 'sondagem':
      return `sondagem:${uso.etapa}`
    default:
      return uso.tipo
  }
}

const respostas = LOG.flatMap((e) => (e.tipo === 'resposta-registrada' ? [e] : []))
const distintos = (valores: readonly string[]): readonly string[] => [...new Set(valores)].sort()

describe('o log de referência', () => {
  it('lê cada evento sem perda, e o id de cada um é o hash dele sem o id', () => {
    expect(LOG).toHaveLength(BRUTO.length)
    for (const [indice, e] of LOG.entries()) {
      expect(e, `evento ${String(indice)}`).toStrictEqual(BRUTO[indice])
      expect(idDeEvento(desembrulhar(lerEventoSemId(e))), `evento ${String(indice)}`).toBe(e.id)
    }
  })

  it('não tem id repetido, e já está na ordem de compararEventos', () => {
    expect(new Set(LOG.map((e) => e.id)).size).toBe(LOG.length)
    expect([...LOG].sort(compararEventos)).toStrictEqual(LOG)
  })

  it('cobre cada tipo de evento, cada variante de uso, cada resposta registrável e cada formato', () => {
    expect(distintos(LOG.map((e) => e.tipo))).toStrictEqual(distintos(TIPOS_DE_EVENTO))
    expect(distintos(respostas.map((e) => chaveDeUso(e.uso)))).toStrictEqual(distintos(Object.keys(CADA_USO)))
    expect(distintos(respostas.map((e) => e.resposta.tipo))).toStrictEqual(distintos(Object.keys(CADA_RESPOSTA)))
    expect(distintos(respostas.map((e) => e.questao.formato.tipo))).toStrictEqual(distintos(FORMATOS_DE_QUESTAO))
    expect(distintos(respostas.map((e) => e.questao.contexto.tipo))).toStrictEqual(['grupo', 'isolada'])
    // O diagnóstico abre por diagnostico-iniciado, e não por tarefa registrada.
    const tarefas = LOG.flatMap((e) => (e.tipo === 'tarefa-iniciada' ? [e.tarefa] : []))
    expect(distintos(tarefas.map((t) => t.tipo))).toStrictEqual(
      distintos(TIPOS_DE_TAREFA.filter((t) => t !== 'diagnostico')),
    )
  })

  it('o id de cada tarefa registrada sai do conteúdo dela, e os eventos da tarefa o citam', () => {
    const tarefas = LOG.flatMap((e) => (e.tipo === 'tarefa-iniciada' ? [e.tarefa] : []))
    for (const { id, ...semId } of tarefas) expect(idDeTarefa(semId)).toBe(id)
    const ids = new Set([
      ...tarefas.map((t) => t.id),
      ...LOG.filter((e) => e.tipo === 'diagnostico-iniciado').map((e) => e.id),
    ])
    for (const e of LOG) if ('tarefaId' in e) expect(ids, `${e.tipo} ${e.id}`).toContain(e.tarefaId)
  })

  it('está congelado: o tamanho e o hash do conteúdo não mudam', () => {
    // Hash da serialização canônica, e não dos bytes do arquivo: reformatar o JSON não muda o conteúdo.
    expect(BRUTO).toHaveLength(33)
    expect(hashFnv1a(serializarCanonico(BRUTO))).toBe('9aaff91d019acb1a')
  })
})
