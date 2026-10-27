/**
 * O leitor de caminho do SVG (scripts/caminho-svg.ts) e a derivação que apaga a inscrição (scripts/inscricoes.ts), sobre
 * SVGs pequenos escritos à mão. As oito bandeiras reais passam pelo gate da remoção em gerar.ts; aqui ficam os casos que
 * dá para enunciar com poucos pontos: número colado, arco, posição da caneta, o subcaminho do meio que sai sem deslocar
 * o vizinho, e a operação que não acha o que declarou.
 */
import { Resvg } from '@resvg/resvg-js'
import { describe, expect, it } from 'vitest'
import { lerComandos, lerSubcaminhos, semSubcaminhos } from '../scripts/caminho-svg.ts'
import type { Inscricao, OperacaoDeInscricao } from '../scripts/comum.ts'
import { derivar, lerTransformacao } from '../scripts/inscricoes.ts'

function pixels(svg: string): Buffer {
  return new Resvg(svg, { fitTo: { mode: 'width', value: 200 }, font: { loadSystemFonts: false } }).render().asPng()
}

function inscricao(operacoes: OperacaoDeInscricao[]): Inscricao {
  return {
    codigo: 'xx',
    texto: 'TESTE',
    lugar: 'no teste',
    caixa: { x0: 0, y0: 0, x1: 1, y1: 1 },
    operacoes,
  }
}

describe('leitura do caminho', () => {
  it('separa números colados pelo sinal e pelo ponto, e lê expoente', () => {
    const [m, l] = lerComandos('M1-2.5.5.5L1e1-1E-1')
    expect(m?.numeros).toEqual([1, -2.5, 0.5, 0.5])
    expect(l?.numeros).toEqual([10, -0.1])
  })

  it('lê as bandeiras de arco de um dígito coladas no número seguinte', () => {
    const [, a] = lerComandos('M0 0a1 1 0 011 1')
    expect(a?.numeros).toEqual([1, 1, 0, 0, 1, 1, 1])
  })

  it('recusa caminho sem M no começo e comando com número faltando', () => {
    expect(() => lerSubcaminhos('L1 2')).toThrow('começa com "L"')
    expect(() => lerComandos('M1 2L3')).toThrow('"L" na posição 4 tem 1 números')
  })

  it('acompanha a caneta por todos os comandos, relativos e absolutos, até o subcaminho seguinte', () => {
    // A mesma sequência, uma vez em relativo e uma em absoluto: c, s, q, t, a, l, h, v e o m do segundo subcaminho, sem
    // z no meio e fora da origem. Assim a partida do segundo subcaminho é a soma de tudo o que veio antes, e um erro na
    // posição em que qualquer comando relativo deixa a caneta a desloca.
    const relativo = 'M5 5c1 1 2 1 3 0s2-1 3 0q1 1 2 0t2 0a2 2 0 0 1 4 0l1 1h1v1m1 1h1'
    const absoluto = 'M5 5C6 6 7 6 8 5S10 4 11 5Q12 6 13 5T15 5A2 2 0 0 1 19 5L20 6H21V7M22 8H23'
    const [doRelativo, doAbsoluto] = [lerSubcaminhos(relativo), lerSubcaminhos(absoluto)]
    for (const subcaminhos of [doRelativo, doAbsoluto]) {
      expect(subcaminhos.map((s) => s.partida)).toEqual([
        { x: 5, y: 5 },
        { x: 22, y: 8 },
      ])
    }
    expect(doRelativo.map((s) => s.caixa)).toEqual(doAbsoluto.map((s) => s.caixa))
    // Tirar o primeiro subcaminho reescreve o m1 1 como M absoluto na posição que a caneta acumulou.
    expect(lerSubcaminhos(semSubcaminhos(relativo, new Set([0])))[0]?.partida).toEqual({ x: 22, y: 8 })
  })

  it('depois do z, a caneta volta ao início do subcaminho', () => {
    // O m1 1 conta a partir de (5, 5), onde o subcaminho começou, e não de (8, 5), onde a curva terminou.
    const subcaminhos = lerSubcaminhos('M5 5c1 1 2 1 3 0z m1 1h1')
    expect(subcaminhos.map((s) => s.partida)).toEqual([
      { x: 5, y: 5 },
      { x: 6, y: 6 },
    ])
  })

  it('a caixa do subcaminho inclui o controle do q e o refletido do t', () => {
    // q0 10 10 0 sai de (5, 5) com o controle em (5, 15) e termina em (15, 5); o t reflete esse controle em torno de
    // (15, 5) para (25, -5) e termina em (25, 5).
    const [s] = lerSubcaminhos('M5 5q0 10 10 0t10 0')
    expect(s?.caixa).toEqual({ x0: 5, y0: -5, x1: 25, y1: 15 })
  })

  it('a caixa do subcaminho inclui o controle refletido do S, que não está escrito no texto', () => {
    // C termina em (10, 0) com o segundo controle em (10, -10); o S reflete esse controle para (10, 10).
    const [s] = lerSubcaminhos('M0 0C0 0 10-10 10 0S20 0 20 0')
    expect(s?.caixa).toEqual({ x0: 0, y0: -10, x1: 20, y1: 10 })
  })
})

describe('remoção de subcaminhos', () => {
  // Três quadrados de 10 lado a lado, cada um começando com m relativo ao início do anterior (o z volta a caneta para
  // lá): (0, 0), (20, 0) e (40, 0).
  const TRES = 'M0 0h10v10h-10z m20 0h10v10h-10z m20 0h10v10h-10z'

  it('tira o subcaminho do meio e o vizinho seguinte fica onde estava', () => {
    const sem = semSubcaminhos(TRES, new Set([1]))
    const [primeiro, terceiro] = lerSubcaminhos(sem)
    const original = lerSubcaminhos(TRES)
    expect(primeiro?.partida).toEqual(original[0]?.partida)
    expect(terceiro?.partida).toEqual({ x: 40, y: 0 })
    expect(terceiro?.caixa).toEqual(original[2]?.caixa)
    // Cortar só o texto deixaria "m20 0" contando a partir de (0, 0), e o terceiro quadrado iria para (20, 0).
    expect(lerSubcaminhos(TRES.replace(' m20 0h10v10h-10z', ''))[1]?.partida).toEqual({ x: 20, y: 0 })
  })

  it('o desenho derivado é, pixel a pixel, o dos dois quadrados que ficam escritos em absoluto', () => {
    const svg = (d: string): string =>
      `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 50 10"><path d="${d}"/></svg>`
    const esperado = pixels(svg('M0 0H10V10H0Z M40 0H50V10H40Z'))
    expect(pixels(svg(semSubcaminhos(TRES, new Set([1]))))).toEqual(esperado)
  })

  it('os pares extras do movimento reescrito continuam retas relativas', () => {
    // O segundo subcaminho é um triângulo escrito só com o m e pares implícitos: m2 0 1 0 0 1 é mover a (2, 0) e
    // traçar retas relativas. Depois do M absoluto, os pares têm de sair como l, ou virariam retas absolutas.
    const d = 'M0 0h1v1z m2 0 1 0 0 1z'
    const sem = semSubcaminhos(d, new Set([0]))
    expect(sem).toBe('M2 0l1 0 0 1z')
    expect(lerSubcaminhos(sem)[0]?.caixa).toEqual(lerSubcaminhos(d)[1]?.caixa)
  })

  it('a posição reescrita sai na precisão do texto, sem resíduo de ponto flutuante', () => {
    const sem = semSubcaminhos('M0.1 0.2h1z m0.2 0.1h1z m0.1 0.2h1z', new Set([1]))
    // O texto do primeiro subcaminho vai como está, com o espaço que o separava do seguinte.
    expect(sem).toBe('M0.1 0.2h1z M0.4 0.5h1z')
  })

  it('recusa tirar todos os subcaminhos', () => {
    expect(() => semSubcaminhos(TRES, new Set([0, 1, 2]))).toThrow('remova o elemento inteiro')
  })
})

describe('transformação', () => {
  it('compõe a lista da direita para a esquerda, como o SVG', () => {
    // translate(10) scale(2): o ponto (1, 1) vai a (2, 2) e depois a (12, 2).
    const [a, b, c, d, e, f] = lerTransformacao('translate(10) scale(2)')
    expect([a * 1 + c * 1 + e, b * 1 + d * 1 + f]).toEqual([12, 2])
    expect(() => lerTransformacao('perspective(3)')).toThrow('não sei ler')
  })
})

describe('derivação', () => {
  const FUNDO = '<path fill="#00f" d="M0 0h100v50H0z"/>'

  it('remove o elemento inteiro com o traço herdado e deixa o resto', () => {
    const original =
      `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 50">${FUNDO}` +
      '<g fill="#fc0"><path d="M40 20h20v10H40z"/></g><path fill="#fc0" d="M0 0h5v5H0z"/></svg>'
    const { svg, remocoes } = derivar(
      inscricao([
        {
          descricao: 'o retângulo amarelo do centro',
          remover: 'elementos',
          atributos: { fill: '#fc0' },
          dentroDe: [{ x0: 0.3, y0: 0.3, x1: 0.7, y1: 0.7 }],
          esperados: 1,
        },
      ]),
      original,
    )
    expect(remocoes).toEqual([{ operacao: 1, elementos: 1, subcaminhos: 0 }])
    const esperado =
      `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 50">${FUNDO}` +
      '<path fill="#fc0" d="M0 0h5v5H0z"/></svg>'
    expect(pixels(svg)).toEqual(pixels(esperado))
  })

  it('atributo null casa só com o elemento que não o tem nem herda', () => {
    const original =
      `<svg xmlns="http://www.w3.org/2000/svg" width="100" height="50">${FUNDO}` +
      '<g fill="#fff"><path d="M0 0h5v5H0z"/></g><path d="M40 20h20v10H40z"/></svg>'
    const { svg } = derivar(
      inscricao([{ descricao: 'o preto', remover: 'elementos', atributos: { fill: null }, esperados: 1 }]),
      original,
    )
    expect(svg).not.toContain('M40 20')
    expect(svg).toContain('M0 0h5v5H0z')
  })

  it('o fill do <svg> raiz conta como o de um ancestral', () => {
    // O path sem fill dentro de <svg fill="#fc0"> é amarelo: casa com '#fc0' e não com null.
    const original =
      `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 50" fill="#fc0">${FUNDO}` +
      '<path d="M40 20h20v10H40z"/></svg>'
    const amarelo: OperacaoDeInscricao = {
      descricao: 'o amarelo',
      remover: 'elementos',
      atributos: { fill: '#fc0' },
      esperados: 1,
    }
    expect(derivar(inscricao([amarelo]), original).svg).not.toContain('M40 20')
    expect(() => derivar(inscricao([{ ...amarelo, atributos: { fill: null } }]), original)).toThrow(
      'achou 0 elementos',
    )
  })

  it('a operação por fill recusa o original que pinta fill por CSS, e a por class segue valendo', () => {
    // O path amarelo por CSS não tem atributo fill e passaria por preto.
    const cabeca = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 50">'
    const porFolha = `${cabeca}<style><![CDATA[.a{fill:#fc0}]]></style>${FUNDO}<path class="a" d="M40 20h20v10H40z"/></svg>`
    const porStyle = `${cabeca}${FUNDO}<path style="fill:#fc0" d="M40 20h20v10H40z"/></svg>`
    const preto: OperacaoDeInscricao = { descricao: 'o preto', remover: 'elementos', atributos: { fill: null }, esperados: 1 }
    for (const original of [porFolha, porStyle]) {
      expect(() => derivar(inscricao([preto]), original)).toThrow(
        'xx: operação 1 (elementos): a operação identifica por fill, e o original pinta fill por CSS',
      )
    }
    const porClasse = { ...preto, atributos: { class: 'a' } }
    expect(derivar(inscricao([porClasse]), porFolha).svg).not.toContain('M40 20')
    // fill-rule não é fill: o style= abaixo não pinta, e a busca por fill segue valendo.
    const comRegra = `${cabeca}${FUNDO}<path style="fill-rule:evenodd" d="M40 20h20v10H40z"/></svg>`
    expect(derivar(inscricao([preto]), comRegra).svg).not.toContain('M40 20')
  })

  it('remove só os subcaminhos dentro da região, com a transformação do grupo aplicada', () => {
    // O grupo desloca tudo 10 para a direita: os quadrados ficam em x 10, 30 e 50 de uma imagem de 100.
    const corpo = (d: string): string =>
      `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 50">${FUNDO}` +
      `<g fill="#fff" transform="translate(10)"><path d="${d}"/></g></svg>`
    const { svg, remocoes } = derivar(
      inscricao([
        {
          descricao: 'o quadrado do meio',
          remover: 'subcaminhos',
          atributos: { fill: '#fff' },
          subcaminhos: 3,
          dentroDe: [{ x0: 0.25, y0: 0, x1: 0.45, y1: 0.5 }],
          esperados: 1,
        },
      ]),
      corpo('M0 0h10v10h-10z m20 0h10v10h-10z m20 0h10v10h-10z'),
    )
    expect(remocoes).toEqual([{ operacao: 1, elementos: 0, subcaminhos: 1 }])
    expect(pixels(svg)).toEqual(pixels(corpo('M0 0H10V10H0Z M40 0H50V10H40Z')))
  })

  it('a operação que não acha o que declarou falha com o código e a operação na mensagem', () => {
    const original = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 50">${FUNDO}</svg>`
    const operacao: OperacaoDeInscricao = {
      descricao: 'um path amarelo que não existe',
      remover: 'elementos',
      atributos: { fill: '#fc0' },
      esperados: 1,
    }
    expect(() => derivar(inscricao([operacao]), original)).toThrow(
      'xx: operação 1 (elementos) achou 0 elementos, e a curadoria declara 1',
    )
  })

  it('mesmo original, mesmos bytes', () => {
    const original =
      `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 50">${FUNDO}` +
      '<path fill="#fc0" d="M1 1h2v2H1z"/></svg>'
    const entrada = inscricao([
      { descricao: 'o amarelo', remover: 'elementos', atributos: { fill: '#fc0' }, esperados: 1 },
    ])
    expect(derivar(entrada, original).svg).toBe(derivar(entrada, original).svg)
  })
})
