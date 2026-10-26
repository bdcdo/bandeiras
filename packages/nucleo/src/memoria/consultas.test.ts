import { describe, expect, it } from 'vitest'
import { desembrulhar } from '../base/resultado'
import { acuraciaNaDirecao, prontoParaCronometrar } from './consultas'
import { estadoMemoriaInicial, type EstadoMemoria } from './estado-memoria'
import { PARAMETROS_PADRAO as P, resolverParametros } from './parametros'

const estado = (numRepeticoes: number, acuracia: number): EstadoMemoria => ({
  ...estadoMemoriaInicial(acuracia),
  numRepeticoes,
})

describe('acuraciaNaDirecao', () => {
  it('lê a acurácia da direção pedida, e não a geral', () => {
    const e: EstadoMemoria = {
      ...estado(2, 0.5),
      acuraciaPorDirecao: { reconhecer: 0.9, produzir: 0.7, recordar: 0.3 },
    }
    expect(acuraciaNaDirecao(e, 'reconhecer')).toBe(0.9)
    expect(acuraciaNaDirecao(e, 'produzir')).toBe(0.7)
    expect(acuraciaNaDirecao(e, 'recordar')).toBe(0.3)
  })
})

describe('prontoParaCronometrar', () => {
  it('exige as repetições e a acurácia mínimas, inclusive na borda', () => {
    expect(prontoParaCronometrar(estado(3, 0.9), P)).toBe(true)
    expect(prontoParaCronometrar(estado(2.99, 0.95), P)).toBe(false)
    expect(prontoParaCronometrar(estado(5, 0.89), P)).toBe(false)
  })

  it('lê cada mínimo no lugar dele, com os dois ajustados a valores que não coincidem', () => {
    // Repetições mínimas 4 e acurácia mínima 0,7. O primeiro estado tem repetições abaixo do mínimo delas e acima do
    // mínimo da acurácia; trocar os dois parâmetros de lugar compararia a acurácia com 4 e recusaria o segundo estado.
    const p = desembrulhar(resolverParametros({ numRepeticoesMinimaCronometrada: 4, acuraciaMinimaCronometrada: 0.7 }))
    expect(prontoParaCronometrar(estado(3.5, 0.95), p)).toBe(false)
    expect(prontoParaCronometrar(estado(4, 0.75), p)).toBe(true)
  })
})
