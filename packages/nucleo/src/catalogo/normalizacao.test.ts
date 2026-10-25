import fc from 'fast-check'
import { describe, expect, it } from 'vitest'
import { casaComRotulo, formasNormalizadas, indiceDeRotulos, normalizarRotulo, resolverRotulo } from './normalizacao'
import type { IdItem, Item } from './tipos'

// Texto com tudo o que a normalização trata (acentos compostos e decompostos, maiúsculas, hífen, traços, apóstrofos,
// pontuação, espaços de vários tipos, artigos), misturado a texto qualquer de toda a faixa Unicode.
const PECAS = [
  'a',
  'o',
  'as',
  'os',
  'the',
  'A',
  'O',
  'The',
  'é',
  'e\u0301',
  'Ç',
  'İ',
  'ß',
  'x',
  'Y',
  ' ',
  '  ',
  '\u00a0',
  '\t',
  '-',
  '\u2013',
  '\u2014',
  "'",
  '\u2019',
  '.',
  ',',
  '!',
  '(',
  ')',
  '\u034f',
  '\u0483',
  '\u05b0',
]
const textoInteressante = fc.oneof(
  fc.string({ unit: fc.constantFrom(...PECAS), maxLength: 12 }),
  fc.string({ unit: 'binary' }),
  fc.string({ unit: 'grapheme' }),
)

describe('normalizarRotulo', () => {
  it('trata hífen como espaço', () => {
    expect(normalizarRotulo('Guiné Bissau')).toBe(normalizarRotulo('Guiné-Bissau'))
    expect(normalizarRotulo('Guiné-Bissau')).toBe('guine bissau')
  })

  it('tira o artigo inicial', () => {
    expect(normalizarRotulo('O Brasil')).toBe(normalizarRotulo('Brasil'))
    expect(normalizarRotulo('The Item')).toBe('item')
    expect(normalizarRotulo('os as Item')).toBe('item')
  })

  it('mantém o artigo quando ele é a única palavra', () => {
    expect(normalizarRotulo('O')).toBe('o')
    expect(normalizarRotulo('  a  ')).toBe('a')
  })

  it('não tira artigo do meio', () => {
    expect(normalizarRotulo('Item de a')).toBe('item de a')
  })

  it('tira acentos e cedilha e passa a minúsculas', () => {
    expect(normalizarRotulo('ÁÉÍÓÚ ÂÊÔ ÃÕ Ç À Ü')).toBe('aeiou aeo ao c a u')
  })

  it('trata traços e apóstrofos reto e curvo como espaço', () => {
    expect(normalizarRotulo("d'Item")).toBe('d item')
    expect(normalizarRotulo('d\u2019Item')).toBe('d item')
    expect(normalizarRotulo('Item\u2013Outro\u2014Mais\u2010Fim')).toBe('item outro mais fim')
  })

  it('apaga a pontuação restante sem deixar espaço', () => {
    expect(normalizarRotulo('I.T.E.M.')).toBe('item')
    expect(normalizarRotulo('Item (B), C!')).toBe('item b c')
  })

  it('colapsa espaços de todo tipo e apara as pontas', () => {
    expect(normalizarRotulo('  Item \t\n  B\u00a0 ')).toBe('item b')
  })

  it('devolve vazio para texto só de pontuação e espaço', () => {
    expect(normalizarRotulo(' - . ! ')).toBe('')
  })

  it('reordena os sinais combinantes que uma remoção juntou', () => {
    // U+034F fica dentro do bloco removido e separava dois sinais de fora do bloco com classes combinantes diferentes;
    // o ponto final, como pontuação, faz o mesmo. Sem o NFD final, a segunda passada mudaria o resultado.
    for (const texto of ['a\u0483\u034f\u05b0', 'a\u0483.\u05b0']) {
      const uma = normalizarRotulo(texto)
      expect(normalizarRotulo(uma)).toBe(uma)
      expect(uma).toBe('a\u05b0\u0483')
    }
  })

  it('é idempotente', () => {
    fc.assert(
      fc.property(textoInteressante, (texto) => {
        const uma = normalizarRotulo(texto)
        expect(normalizarRotulo(uma)).toBe(uma)
      }),
      { numRuns: 1000 },
    )
  })

  it('nunca devolve diacrítico, maiúscula, espaço duplo nem espaço nas pontas', () => {
    fc.assert(
      fc.property(textoInteressante, (texto) => {
        const r = normalizarRotulo(texto)
        expect(r).not.toMatch(/[\u0300-\u036f]/)
        // Maiúscula aqui é o que muda ao passar para minúsculas: há letras de categoria maiúscula sem forma minúscula
        // (como U+2102), que nenhuma normalização tem como trocar.
        expect(r.toLowerCase()).toBe(r)
        expect(r).not.toMatch(/\s\s/)
        expect(r).toBe(r.trim())
      }),
      { numRuns: 1000 },
    )
  })
})

function item(id: string, rotulo: string, aliases: readonly string[] = []): Item {
  return {
    id: id as IdItem,
    rotulo,
    aliases,
    categoria: 'categoria-1',
    subcategoria: 'subcategoria-1',
    grupos: [],
    dificuldadeAPriori: 1,
    descricao: `Descrição de ${id}`,
    classe: 'classe-1',
    vizinhos: [],
  }
}

describe('formasNormalizadas', () => {
  it('devolve rótulo e aliases normalizados, nessa ordem', () => {
    expect(formasNormalizadas(item('a', 'Item A', ['Apelido-A', 'O Outro']))).toEqual(['item a', 'apelido a', 'outro'])
  })
})

describe('casaComRotulo', () => {
  it('aceita o rótulo e os aliases escritos de outro jeito', () => {
    const a = item('a', 'Item Á', ['Apelido A'])
    expect(casaComRotulo('  item-a ', a)).toBe(true)
    expect(casaComRotulo('APELIDO A', a)).toBe(true)
    expect(casaComRotulo('o apelido a', a)).toBe(true)
  })

  it('não aceita pedaço nem extensão do rótulo', () => {
    const a = item('a', 'Item Longo')
    expect(casaComRotulo('Longo', a)).toBe(false)
    expect(casaComRotulo('Item', a)).toBe(false)
    expect(casaComRotulo('Item Longo Demais', a)).toBe(false)
    expect(casaComRotulo('Item Lomgo', a)).toBe(false)
  })

  it('aceita todo rótulo e todo alias do item', () => {
    fc.assert(
      fc.property(textoInteressante, fc.array(textoInteressante, { maxLength: 4 }), (rotulo, aliases) => {
        const a = item('a', rotulo, aliases)
        for (const forma of [rotulo, ...aliases]) expect(casaComRotulo(forma, a)).toBe(true)
      }),
    )
  })

  it('recusa texto que não é rótulo nem alias depois de normalizado', () => {
    fc.assert(
      fc.property(
        textoInteressante,
        fc.array(textoInteressante, { maxLength: 4 }),
        textoInteressante,
        (rotulo, aliases, texto) => {
          const a = item('a', rotulo, aliases)
          fc.pre(!formasNormalizadas(a).includes(normalizarRotulo(texto)))
          expect(casaComRotulo(texto, a)).toBe(false)
        },
      ),
    )
  })
})

describe('indiceDeRotulos', () => {
  it('liga cada forma normalizada ao id do item', () => {
    const indice = indiceDeRotulos([item('a', 'Item A', ['Apelido A']), item('b', 'Item B')])
    expect([...indice]).toEqual([
      ['item a', 'a'],
      ['apelido a', 'a'],
      ['item b', 'b'],
    ])
  })

  it('com forma ambígua, fica com o primeiro item que a declara', () => {
    const indice = indiceDeRotulos([item('a', 'Item A'), item('b', 'Item B', ['item-a'])])
    expect(indice.get('item a')).toBe('a')
  })
})

describe('resolverRotulo', () => {
  const indice = indiceDeRotulos([item('a', 'Item A', ['Apelido A']), item('b', 'Item B')])

  it('resolve o texto digitado pelo rótulo ou pelo alias', () => {
    expect(resolverRotulo(indice, 'item á')).toBe('a')
    expect(resolverRotulo(indice, 'O Apelido-A')).toBe('a')
    expect(resolverRotulo(indice, 'ITEM B')).toBe('b')
  })

  it('devolve undefined para texto que não é rótulo nem alias', () => {
    expect(resolverRotulo(indice, 'Item C')).toBeUndefined()
    expect(resolverRotulo(indice, '')).toBeUndefined()
  })
})
