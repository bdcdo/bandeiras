import { describe, expect, it } from 'vitest'
import { desembrulhar } from '../base/resultado'
import { carregarCatalogo } from './carregar-catalogo'
import { DIRECOES, type Catalogo, type IdGrupo, type IdItem } from './tipos'

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

describe('Catalogo', () => {
  const vazio = { itens: [], grupos: [], vizinhancas: [], classes: [], categorias: [] }

  it('não aceita literal com os campos do catálogo', () => {
    // @ts-expect-error: só carregarCatalogo constrói um Catalogo
    const literal: Catalogo = {
      itens: new Map(),
      grupos: new Map(),
      vizinhancas: new Map(),
      classes: new Set(),
      categorias: new Map(),
      hash: 'qualquer',
    }
    expect(literal.hash).toBe('qualquer')
  })

  it('não aceita cópia por spread de um catálogo carregado com um campo trocado', () => {
    const carregado = desembrulhar(carregarCatalogo(vazio))
    const outro = desembrulhar(carregarCatalogo({ ...vazio, classes: ['classe-1'] }))
    // @ts-expect-error: as classes de um catálogo com o hash do outro
    // eslint-disable-next-line @typescript-eslint/no-misused-spread -- o spread de catálogo é o caso que o teste recusa
    const misturado: Catalogo = { ...carregado, classes: outro.classes }
    expect(misturado.hash).toBe(carregado.hash)
  })

  it('aceita o catálogo que carregarCatalogo devolve', () => {
    const catalogo: Catalogo = desembrulhar(carregarCatalogo(vazio))
    expect(catalogo.itens.size).toBe(0)
  })
})
