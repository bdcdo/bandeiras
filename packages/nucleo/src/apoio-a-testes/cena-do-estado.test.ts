import { describe, expect, it } from 'vitest'
import { PARAMETROS_PADRAO, type Parametros } from '../memoria'
import { AJUSTES_DOS_CASOS, PARAMETROS_DOS_CASOS } from './cena-do-estado'

/** Cada número dos parâmetros pelo caminho dele, com ponto nos aninhados, como em `AjustesDeParametros`. */
function folhas(p: Parametros): Map<string, number> {
  const saida = new Map<string, number>()
  for (const [chave, valor] of Object.entries(p)) {
    if (typeof valor === 'number') saida.set(chave, valor)
    else for (const [sub, v] of Object.entries(valor as Readonly<Record<string, number>>)) saida.set(`${chave}.${sub}`, v)
  }
  return saida
}

describe('AJUSTES_DOS_CASOS', () => {
  it('cada ajuste difere do padrão dele e de todo outro número dos parâmetros dos casos', () => {
    const dosCasos = folhas(PARAMETROS_DOS_CASOS)
    const padrao = folhas(PARAMETROS_PADRAO)
    const coincidencias = Object.entries(AJUSTES_DOS_CASOS).flatMap(([caminho, valor]) => [
      ...(padrao.get(caminho) === valor ? [`${caminho}: igual ao padrão`] : []),
      ...[...dosCasos]
        .filter(([outro, v]) => outro !== caminho && v === valor)
        .map(([outro]) => `${caminho} = ${outro} = ${String(valor)}`),
    ])
    expect(coincidencias).toStrictEqual([])
    expect([...dosCasos.keys()].sort()).toStrictEqual([...padrao.keys()].sort())
  })
})
