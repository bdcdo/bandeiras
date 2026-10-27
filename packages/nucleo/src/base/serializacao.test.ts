import { describe, expect, it } from 'vitest'
import { catalogoFixo } from '../apoio-a-testes/catalogo-de-teste'
import { serializarCanonico } from './serializacao'

describe('serializarCanonico', () => {
  it('ordena as chaves de todo nível e mantém a ordem das listas', () => {
    expect(serializarCanonico({ b: 1, a: [{ d: 'x', c: null }, 2] })).toBe('{"a":[{"c":null,"d":"x"},2],"b":1}')
    expect(serializarCanonico([3, 1, 2])).toBe('[3,1,2]')
  })

  it('ordena por unidade de código, e não pelo idioma', () => {
    // 'B' (U+0042) vem antes de 'a' (U+0061) por unidade de código; localeCompare poria 'a' primeiro.
    expect(serializarCanonico({ a: 1, B: 2, ã: 3 })).toBe('{"B":2,"a":1,"ã":3}')
  })

  it('deixa de fora a chave com undefined, como o JSON', () => {
    expect(serializarCanonico({ a: 1, b: undefined })).toBe(serializarCanonico({ a: 1 }))
  })

  it('escapa o texto como o JSON', () => {
    expect(serializarCanonico({ 'a"b': 'c\nd' })).toBe('{"a\\"b":"c\\nd"}')
  })

  // O hash do catálogo, o id de todo evento e o de toda tarefa registrada saem desta serialização. Um log gravado com uma
  // saída e lido com outra deixaria de se reconhecer, então a saída para o catálogo de teste fica fixada aqui.
  it('dá ao catálogo de teste o hash fixado', () => {
    expect(catalogoFixo().hash).toBe('a30bba52f155f53d')
  })
})
