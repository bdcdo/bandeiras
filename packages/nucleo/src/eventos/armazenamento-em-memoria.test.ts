import { describe, expect, it } from 'vitest'
import { CASOS_DO_CONTRATO_DE_ARMAZENAMENTO } from '../apoio-a-testes'
import type { ArmazenamentoDeEventos, EnvelopeDeEvento } from './armazenamento'
import { armazenamentoEmMemoria } from './armazenamento-em-memoria'
import { compararEventos } from './ordem'

describe('armazenamentoEmMemoria cumpre o contrato', () => {
  for (const caso of CASOS_DO_CONTRATO_DE_ARMAZENAMENTO) {
    it(caso.nome, () => caso.executar(() => Promise.resolve(armazenamentoEmMemoria())))
  }
})

// Fakes estragadas de propósito, uma por defeito, para provar que o contrato pega cada um: um caso que passa com a fake
// errada não protege a implementação do IndexedDB do mesmo erro.
type Defeito = Readonly<{
  ordem?: 'insercao' | 'idioma'
  repetido?: 'duplica' | 'ultimo'
  desdeInclusivo?: true
  semCopia?: true
}>

function fakeComDefeito(defeito: Defeito): ArmazenamentoDeEventos {
  const gravados: EnvelopeDeEvento[] = []
  const copia = (e: EnvelopeDeEvento): EnvelopeDeEvento =>
    defeito.semCopia === true ? e : (JSON.parse(JSON.stringify(e)) as EnvelopeDeEvento)
  const ordenar = (lista: EnvelopeDeEvento[]): EnvelopeDeEvento[] => {
    if (defeito.ordem === 'insercao') return lista
    if (defeito.ordem === 'idioma') return lista.sort((a, b) => a.em - b.em || a.id.localeCompare(b.id))
    return lista.sort(compararEventos)
  }
  return {
    anexar(eventos) {
      for (const e of eventos) {
        const ja = gravados.findIndex((g) => g.id === e.id)
        if (ja === -1 || defeito.repetido === 'duplica') gravados.push(copia(e))
        else if (defeito.repetido === 'ultimo') gravados[ja] = copia(e)
      }
      return Promise.resolve()
    },
    ler(desde) {
      const ordenados = ordenar([...gravados])
      const passa = (e: EnvelopeDeEvento): boolean =>
        desde === undefined || compararEventos(e, desde) > (defeito.desdeInclusivo === true ? -1 : 0)
      return Promise.resolve(ordenados.filter(passa).map(copia))
    },
    contar() {
      return Promise.resolve(gravados.length)
    },
  }
}

const caso = (nome: string) => {
  const achado = CASOS_DO_CONTRATO_DE_ARMAZENAMENTO.find((c) => c.nome.startsWith(nome))
  if (achado === undefined) throw new Error(`o contrato não tem o caso '${nome}'`)
  return achado
}

describe('o contrato reprova a fake com defeito', () => {
  it.each<[string, Defeito, string]>([
    ['ler sem ordenar', { ordem: 'insercao' }, 'anexado fora de ordem'],
    ['empate pela ordem do idioma', { ordem: 'idioma' }, 'no empate de instante'],
    ['anexar que duplica', { repetido: 'duplica' }, 'id repetido'],
    ['repetido mantendo o último', { repetido: 'ultimo' }, 'id repetido'],
    ['desde inclusivo', { desdeInclusivo: true }, 'desde é exclusivo'],
    ['desde inclusivo, depois do último', { desdeInclusivo: true }, 'desde depois do último'],
    ['sem cópia nas pontas', { semCopia: true }, 'mudar o objeto'],
  ])('%s', async (_, defeito, nome) => {
    await expect(caso(nome).executar(() => Promise.resolve(fakeComDefeito(defeito)))).rejects.toThrow(Error)
  })

  it('e a fake sem defeito passa em todos os casos', async () => {
    for (const c of CASOS_DO_CONTRATO_DE_ARMAZENAMENTO) {
      await expect(c.executar(() => Promise.resolve(fakeComDefeito({})))).resolves.toBeUndefined()
    }
  })
})
