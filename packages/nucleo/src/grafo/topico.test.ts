import fc from 'fast-check'
import { describe, expect, it } from 'vitest'
import type { IdGrupo, IdItem } from '../catalogo/tipos'
import { lerTopico, topicoDeGrupo, topicoDeItem, type IdTopico } from './topico'

describe('topicoDeItem e topicoDeGrupo', () => {
  it('prefixam o id de origem pelo tipo do tópico', () => {
    expect(topicoDeItem('a' as IdItem)).toEqual({ tipo: 'item', id: 'item:a', item: 'a' })
    expect(topicoDeGrupo('grupo-1' as IdGrupo)).toEqual({ tipo: 'grupo', id: 'grupo:grupo-1', grupo: 'grupo-1' })
  })

  it('separam um item e um grupo de mesmo id', () => {
    expect(topicoDeItem('x' as IdItem).id).not.toBe(topicoDeGrupo('x' as IdGrupo).id)
  })

  it('não aceitam string crua como IdTopico', () => {
    // @ts-expect-error: o id de tópico nasce dos construtores, não de uma string qualquer
    const id: IdTopico = 'item:a'
    expect(id).toBe('item:a')
  })
})

describe('lerTopico', () => {
  it('devolve o tópico que o construtor montou, para qualquer id de origem', () => {
    fc.assert(
      fc.property(fc.string(), (origem) => {
        const item = topicoDeItem(origem as IdItem)
        const grupo = topicoDeGrupo(origem as IdGrupo)
        expect(lerTopico(item.id)).toEqual(item)
        expect(lerTopico(grupo.id)).toEqual(grupo)
      }),
    )
  })

  it('devolve inteiro o id de origem que tem dois-pontos', () => {
    expect(lerTopico(topicoDeItem('grupo:a' as IdItem).id)).toEqual({
      tipo: 'item',
      id: 'item:grupo:a',
      item: 'grupo:a',
    })
  })
})
