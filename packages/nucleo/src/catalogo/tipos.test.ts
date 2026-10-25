import { describe, expect, it } from 'vitest'
import { DIRECOES, type IdGrupo, type IdItem } from './tipos'

describe('DIRECOES', () => {
  it('lista as três direções de exercício', () => {
    expect(DIRECOES).toEqual(['reconhecer', 'produzir', 'recordar'])
  })
})

describe('ids marcados', () => {
  it('IdItem não aceita string', () => {
    const texto = 'a'
    // @ts-expect-error: string sem marca não passa por IdItem
    const id: IdItem = texto
    expect(id).toBe('a')
  })

  it('IdGrupo não passa por IdItem', () => {
    const grupo = 'grupo-1' as IdGrupo
    // @ts-expect-error: marcas diferentes não se misturam
    const id: IdItem = grupo
    expect(id).toBe('grupo-1')
  })

  it('IdItem continua sendo string onde se pede string', () => {
    const id = 'a' as IdItem
    const texto: string = id
    expect(texto).toBe('a')
  })
})
