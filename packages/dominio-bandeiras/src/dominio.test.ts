/**
 * O adaptador `Dominio` das bandeiras sobre o núcleo de verdade: os dados commitados passam pela validação de
 * `carregarCatalogo`, e o estímulo sai do `import.meta.glob`, que só existe sob o Vite (o Vitest roda sob ele).
 */
import {
  carregarCatalogo,
  conferirTecnicas,
  desembrulhar,
  indiceDeRotulos,
  resolverRotulo,
  type IdItem,
} from '@bandeiras/nucleo'
import { describe, expect, it } from 'vitest'
import gerado from '../gerado/bandeiras.json'
import { DADOS_DE_CATALOGO, dominio, VOCABULARIO } from './index'

const catalogo = () => desembrulhar(dominio.catalogo())
const id = (codigo: string) => codigo as IdItem
const proporcaoDe = new Map(gerado.bandeiras.map((b) => [b.codigo, b.proporcao]))

describe('catálogo', () => {
  it('carrega os dados commitados sem erro, com as contagens da curadoria', () => {
    const resultado = dominio.catalogo()
    expect(resultado.ok, resultado.ok ? '' : JSON.stringify(resultado.erro)).toBe(true)
    const { itens, grupos, vizinhancas, categorias, classes, hash } = catalogo()
    expect(itens.size).toBe(193)
    expect(grupos.size).toBe(38)
    expect(vizinhancas.size).toBe(8)
    expect(categorias.size).toBe(5)
    expect([...categorias.values()].reduce((soma, c) => soma + c.subcategorias.size, 0)).toBe(22)
    expect(classes.size).toBe(8)
    expect(hash).toMatch(/^[0-9a-f]{16}$/)
  })

  it('valida uma vez: a segunda chamada devolve o mesmo objeto', () => {
    expect(dominio.catalogo()).toBe(dominio.catalogo())
  })

  it('cada item é o registro de bandeiras.json no vocabulário do núcleo', () => {
    // A tradução de campo por campo, escrita à parte do mapeamento de dados.ts: um campo esquecido ou trocado lá reprova
    // aqui. O traço de vizinhança é opcional e só aparece no item quando o registro o traz.
    const { itens } = catalogo()
    for (const b of gerado.bandeiras) {
      expect(itens.get(id(b.codigo)), b.codigo).toStrictEqual({
        id: b.codigo,
        rotulo: b.nome,
        aliases: b.aliases,
        categoria: b.regiao,
        subcategoria: b.subRegiao,
        grupos: b.grupos,
        dificuldadeAPriori: b.dificuldadeAPriori,
        descricao: b.descricao,
        classe: b.classe,
        vizinhos: b.vizinhos,
        ...(b.tracoVizinhanca === undefined ? {} : { tracoVizinhanca: b.tracoVizinhanca }),
      })
    }
    expect([...itens.values()].filter((i) => i.tracoVizinhanca !== undefined).length).toBeGreaterThan(0)
  })

  it('as categorias são as regiões M49, com os nomes de bandeiras.json', () => {
    const { categorias } = catalogo()
    for (const r of gerado.regioes) {
      expect(categorias.get(r.codigo), r.codigo).toStrictEqual({
        nome: r.nome,
        subcategorias: new Map(r.subRegioes.map((s) => [s.codigo, s.nome])),
      })
    }
  })

  it('a validação do núcleo está no caminho: um alias igual ao rótulo de outro item é recusado', () => {
    const brasil = DADOS_DE_CATALOGO.itens.find((i) => i.id === 'br')
    expect(brasil?.rotulo).toBe('Brasil')
    const alterado = {
      ...DADOS_DE_CATALOGO,
      itens: DADOS_DE_CATALOGO.itens.map((i) => (i.id === 'pt' ? { ...i, aliases: [...i.aliases, 'Brasil'] } : i)),
    }
    const resultado = carregarCatalogo(alterado)
    expect(resultado.ok).toBe(false)
    if (!resultado.ok) {
      expect(resultado.erro.codigo).toBe('ROTULO_AMBIGUO')
      expect(resultado.erro.detalhe).toContain("'brasil' em 'br', 'pt'")
    }
    // A cópia não tocou nos dados do domínio.
    expect(carregarCatalogo(DADOS_DE_CATALOGO).ok).toBe(true)
  })
})

describe('rótulos', () => {
  const indice = () => indiceDeRotulos(catalogo().itens.values())

  it('a normalização do núcleo resolve grafias alternativas e aliases para o código certo', () => {
    expect(resolverRotulo(indice(), 'Guiné Bissau')).toBe('gw')
    expect(resolverRotulo(indice(), 'guine-bissau')).toBe('gw')
    expect(resolverRotulo(indice(), 'República Tcheca')).toBe('cz')
  })

  it('"Congo" solto não resolve nenhum item', () => {
    expect(resolverRotulo(indice(), 'Congo')).toBeUndefined()
  })
})

describe('estímulo', () => {
  /** Estímulo do código como imagem; reprova se vier texto. */
  function imagemDe(codigo: string): { url: string; proporcao: number } {
    const estimulo = dominio.estimulo(id(codigo))
    if (estimulo.tipo !== 'imagem') throw new Error(`o estímulo de '${codigo}' não é imagem`)
    return { url: estimulo.url, proporcao: estimulo.proporcao }
  }

  it('SVG sai do próprio arquivo, com a proporção do registro', () => {
    const br = imagemDe('br')
    expect(br.url).toMatch(/\/br\.svg$/)
    expect(br.proporcao).toBe(proporcaoDe.get('br'))
  })

  it('WebP sai na maior largura, 960 px, com a proporção do registro', () => {
    const mx = imagemDe('mx')
    expect(mx.url).toMatch(/\/mx-960\.webp$/)
    expect(mx.proporcao).toBe(proporcaoDe.get('mx'))
  })

  it('toda bandeira do catálogo tem estímulo', () => {
    for (const item of catalogo().itens.keys()) expect(dominio.estimulo(item).tipo, item).toBe('imagem')
  })

  it('código sem imagem lança, porque é defeito de build', () => {
    expect(() => dominio.estimulo(id('va'))).toThrow("A bandeira 'va' não tem registro em bandeiras.json.")
  })
})

describe('vocabulário e técnicas', () => {
  it('o domínio usa VOCABULARIO, e toda chave é não vazia', () => {
    expect(dominio.vocabulario).toBe(VOCABULARIO)
    const entradas = Object.entries(VOCABULARIO)
    expect(entradas).toHaveLength(11)
    for (const [chave, texto] of entradas) expect(texto.trim(), chave).not.toBe('')
  })

  it('as doze técnicas estão ligadas, numa combinação que o núcleo aceita', () => {
    const valores = Object.values(dominio.tecnicas)
    expect(valores).toHaveLength(12)
    expect(valores.every((ligada) => ligada)).toBe(true)
    expect(conferirTecnicas(dominio.tecnicas).ok).toBe(true)
  })
})
