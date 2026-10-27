/**
 * Leitura do atributo `d` de um <path> do SVG e remoção de subcaminhos dele. Não roda sozinho: é usado por
 * inscricoes.ts, que apaga das bandeiras a inscrição com o nome do país.
 *
 * Um path composto desenha várias formas num atributo só. Cada forma é um subcaminho, que começa num comando de
 * movimento (M ou m) e vai até o próximo. Tirar um subcaminho do meio não é só cortar o texto dele: um comando em
 * minúscula é relativo ao ponto onde a caneta estava, e o `m` do subcaminho seguinte passaria a contar a partir de outro
 * lugar, deslocando a forma inteira. Por isso a leitura acompanha a posição da caneta ao longo de todo o caminho
 * original, e o primeiro subcaminho que sobra depois de um trecho removido ganha um M absoluto com a posição que ele
 * tinha antes.
 *
 * O texto dos subcaminhos que ficam é copiado como está, byte a byte. Reescrever o caminho inteiro em coordenadas
 * absolutas também funcionaria, mas cada soma em ponto flutuante pode deslocar um ponto numa casa decimal distante, e o
 * gate da remoção (gerar.ts) exige que nenhum pixel fora da inscrição mude.
 */

/** Quantos números cada comando consome por repetição. Z não leva número. */
const ARIDADE: Readonly<Record<string, number>> = { M: 2, L: 2, T: 2, H: 1, V: 1, C: 6, S: 4, Q: 4, A: 7, Z: 0 }

export type Comando = {
  /** A letra como está no texto: maiúscula é absoluta, minúscula é relativa. */
  letra: string
  numeros: number[]
  /** Posição da letra no texto do `d`. */
  inicio: number
  /** Posição logo depois do último caractere do comando, antes da letra seguinte (inclui o espaço que sobra). */
  fim: number
}

type Ponto = { x: number; y: number }

/** Retângulo em coordenadas do próprio caminho, com x0 <= x1 e y0 <= y1. */
export type Retangulo = { x0: number; y0: number; x1: number; y1: number }

export type Subcaminho = {
  /** Comandos do subcaminho, do movimento que o abre até antes do próximo movimento. */
  comandos: Comando[]
  inicio: number
  fim: number
  /** Onde a caneta fica depois do movimento inicial, em coordenadas absolutas do caminho original. */
  partida: Ponto
  /**
   * Caixa que contém o subcaminho: pontos finais, pontos de controle das curvas e, nos arcos, a elipse inteira. Pode
   * ser maior que o desenho (a curva fica dentro do polígono dos pontos de controle), nunca menor; por isso "a caixa
   * cabe no retângulo" garante que o desenho cabe.
   */
  caixa: Retangulo
}

/**
 * Número do SVG: sinal opcional, dígitos com ponto opcional, expoente opcional. A gramática permite colar números
 * quando o segundo começa com sinal ou ponto: `1-2.5.5` são três números, 1, -2.5 e 0.5.
 */
const NUMERO = /[+-]?(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?/y
const SEPARADOR = /[\s,]*/y

/** Lê um `d` em comandos. Lança com a posição quando o texto foge da gramática do SVG. */
export function lerComandos(d: string): Comando[] {
  const comandos: Comando[] = []
  let atual: Comando | undefined
  let i = 0
  const pular = (): void => {
    SEPARADOR.lastIndex = i
    SEPARADOR.exec(d)
    i = SEPARADOR.lastIndex
  }
  pular()
  while (i < d.length) {
    const c = d.charAt(i)
    if (/[a-zA-Z]/.test(c)) {
      if (ARIDADE[c.toUpperCase()] === undefined) throw new Error(`comando desconhecido "${c}" na posição ${String(i)}`)
      if (atual !== undefined) atual.fim = i
      atual = { letra: c, numeros: [], inicio: i, fim: d.length }
      comandos.push(atual)
      i++
    } else {
      if (atual === undefined) throw new Error(`o caminho começa com número, sem comando, na posição ${String(i)}`)
      // Nos arcos, o 4º e o 5º parâmetros de cada grupo de 7 são bandeiras de um dígito só, que o SVG permite colar no
      // número seguinte: em `a1 1 0 011 1` as bandeiras são 0 e 1, e o x final é 1.
      const posicaoNoGrupo = atual.numeros.length % 7
      if (atual.letra.toUpperCase() === 'A' && (posicaoNoGrupo === 3 || posicaoNoGrupo === 4)) {
        if (c !== '0' && c !== '1') throw new Error(`bandeira de arco "${c}" na posição ${String(i)}; esperava 0 ou 1`)
        atual.numeros.push(Number(c))
        i++
      } else {
        NUMERO.lastIndex = i
        const casado = NUMERO.exec(d)
        if (casado === null) throw new Error(`caractere inesperado "${c}" na posição ${String(i)}`)
        atual.numeros.push(Number(casado[0]))
        i = NUMERO.lastIndex
      }
    }
    pular()
  }
  for (const comando of comandos) {
    const aridade = ARIDADE[comando.letra.toUpperCase()] ?? 0
    const n = comando.numeros.length
    const certo = aridade === 0 ? n === 0 : n > 0 && n % aridade === 0
    if (!certo) {
      throw new Error(
        `o comando "${comando.letra}" na posição ${String(comando.inicio)} tem ${String(n)} números; ` +
          (aridade === 0 ? 'não leva nenhum' : `leva múltiplos de ${String(aridade)}`),
      )
    }
  }
  return comandos
}

/** Pontos que delimitam um arco elíptico: a elipse inteira, depois da correção de raio que o SVG manda fazer. */
function limitesDoArco(de: Ponto, rx: number, ry: number, rotacaoGraus: number, ate: Ponto): Ponto[] {
  rx = Math.abs(rx)
  ry = Math.abs(ry)
  // Raio zero vira segmento de reta (SVG 1.1, F.6.2).
  if (rx === 0 || ry === 0) return [ate]
  // Pela especificação (F.6.6), raios pequenos demais para ligar os dois pontos crescem na proporção de sqrt(lambda).
  const fi = (rotacaoGraus * Math.PI) / 180
  const [cos, sen] = [Math.cos(fi), Math.sin(fi)]
  const dx = (de.x - ate.x) / 2
  const dy = (de.y - ate.y) / 2
  const x1 = cos * dx + sen * dy
  const y1 = -sen * dx + cos * dy
  const lambda = (x1 * x1) / (rx * rx) + (y1 * y1) / (ry * ry)
  if (lambda > 1) {
    rx *= Math.sqrt(lambda)
    ry *= Math.sqrt(lambda)
  }
  // Toda a elipse fica a menos de um diâmetro de qualquer ponto dela; a caixa do ponto final mais o maior diâmetro
  // contém o arco sem precisar achar o centro, ao custo de ser larga.
  const r = 2 * Math.max(rx, ry)
  return [
    { x: ate.x - r, y: ate.y - r },
    { x: ate.x + r, y: ate.y + r },
  ]
}

/**
 * Separa o caminho em subcaminhos e acompanha a caneta ao longo dele.
 *
 * A posição da caneta segue as regras do SVG: comando relativo soma à posição atual; Z volta ao início do subcaminho; os
 * pares que sobram depois de um M ou m são retas (L ou l), e o primeiro m do caminho conta como absoluto, porque não há
 * posição anterior (a caneta começa em 0,0, e somar a 0,0 dá o mesmo).
 */
export function lerSubcaminhos(d: string): Subcaminho[] {
  const comandos = lerComandos(d)
  const primeiro = comandos[0]
  if (primeiro === undefined) return []
  if (primeiro.letra.toUpperCase() !== 'M') throw new Error(`o caminho começa com "${primeiro.letra}", e não com M`)

  const subcaminhos: Subcaminho[] = []
  let caneta: Ponto = { x: 0, y: 0 }
  let inicioDoSubcaminho: Ponto = { x: 0, y: 0 }
  let pontos: Ponto[] = []
  let atual: Subcaminho | undefined
  // Último controle de curva cúbica (C, S) e quadrática (Q, T), para o reflexo de S e T; undefined depois de outro
  // comando.
  let controleCubico: Ponto | undefined
  let controleQuadratico: Ponto | undefined

  for (const comando of comandos) {
    const maiuscula = comando.letra.toUpperCase()
    const relativo = comando.letra !== maiuscula
    const n = comando.numeros
    const num = (k: number): number => n[k] ?? 0
    const absoluto = (x: number, y: number): Ponto => (relativo ? { x: caneta.x + x, y: caneta.y + y } : { x, y })

    if (maiuscula === 'M') {
      if (atual !== undefined) atual.caixa = caixaDe(pontos)
      caneta = absoluto(num(0), num(1))
      inicioDoSubcaminho = caneta
      pontos = [caneta]
      atual = { comandos: [], inicio: comando.inicio, fim: comando.fim, partida: caneta, caixa: caixaDe(pontos) }
      subcaminhos.push(atual)
      // Os pares seguintes ao primeiro são retas, relativas ou absolutas como o próprio movimento.
      for (let k = 2; k < n.length; k += 2) {
        caneta = absoluto(num(k), num(k + 1))
        pontos.push(caneta)
      }
      controleCubico = undefined
      controleQuadratico = undefined
    } else if (maiuscula === 'Z') {
      caneta = inicioDoSubcaminho
      controleCubico = undefined
      controleQuadratico = undefined
    } else {
      const aridade = ARIDADE[maiuscula] ?? 1
      for (let k = 0; k < n.length; k += aridade) {
        const p = (j: number): Ponto => absoluto(num(k + j), num(k + j + 1))
        // S e T não escrevem o primeiro controle: ele é o reflexo, em torno da caneta, do último controle da curva
        // anterior do mesmo tipo, ou a própria caneta quando a anterior não era desse tipo. O reflexo pode cair fora
        // de todos os pontos escritos, e por isso entra na caixa.
        const refletido = (controle: Ponto | undefined): Ponto =>
          controle === undefined ? caneta : { x: 2 * caneta.x - controle.x, y: 2 * caneta.y - controle.y }
        let fim: Ponto
        let cubico: Ponto | undefined
        let quadratico: Ponto | undefined
        if (maiuscula === 'H') fim = { x: relativo ? caneta.x + num(k) : num(k), y: caneta.y }
        else if (maiuscula === 'V') fim = { x: caneta.x, y: relativo ? caneta.y + num(k) : num(k) }
        else if (maiuscula === 'L') fim = p(0)
        else if (maiuscula === 'C') {
          cubico = p(2)
          pontos.push(p(0), cubico)
          fim = p(4)
        } else if (maiuscula === 'S') {
          cubico = p(0)
          pontos.push(refletido(controleCubico), cubico)
          fim = p(2)
        } else if (maiuscula === 'Q') {
          quadratico = p(0)
          pontos.push(quadratico)
          fim = p(2)
        } else if (maiuscula === 'T') {
          quadratico = refletido(controleQuadratico)
          pontos.push(quadratico)
          fim = p(0)
        } else {
          fim = p(5)
          pontos.push(...limitesDoArco(caneta, num(k), num(k + 1), num(k + 2), fim))
        }
        controleCubico = cubico
        controleQuadratico = quadratico
        caneta = fim
        pontos.push(fim)
      }
    }
    if (atual !== undefined) {
      atual.comandos.push(comando)
      atual.fim = comando.fim
    }
  }
  if (atual !== undefined) atual.caixa = caixaDe(pontos)
  return subcaminhos
}

function caixaDe(pontos: Ponto[]): Retangulo {
  const xs = pontos.map((p) => p.x)
  const ys = pontos.map((p) => p.y)
  return { x0: Math.min(...xs), y0: Math.min(...ys), x1: Math.max(...xs), y1: Math.max(...ys) }
}

export function cabeEm(caixa: Retangulo, retangulo: Retangulo): boolean {
  return caixa.x0 >= retangulo.x0 && caixa.y0 >= retangulo.y0 && caixa.x1 <= retangulo.x1 && caixa.y1 <= retangulo.y1
}

/**
 * Casas decimais do número mais preciso do texto. A posição absoluta de um subcaminho é a soma de números com no máximo
 * essa quantidade de casas, então ela é exata nessa precisão; arredondar a soma em ponto flutuante a essas casas devolve
 * o valor exato, sem o resíduo de ponto flutuante (388.12300000000005).
 */
function casasDecimais(d: string): number {
  let maximo = 0
  for (const casado of d.matchAll(/(?:\d+\.?(\d*)|\.(\d+))(?:[eE]([+-]?\d+))?/g)) {
    const decimais = casado[1] ?? casado[2] ?? ''
    maximo = Math.max(maximo, decimais.length - Number(casado[3] ?? '0'))
  }
  return Math.min(maximo, 15)
}

function escrever(valor: number, casas: number): string {
  // Number() tira os zeros à direita que toFixed deixa; o resultado é a menor grafia exata do valor.
  return String(Number(valor.toFixed(casas)))
}

/**
 * Remove do `d` os subcaminhos dos índices dados e devolve o texto novo. O primeiro subcaminho que fica depois de um
 * trecho removido tem o movimento reescrito como M absoluto na posição original; os pares extras desse movimento, que
 * eram retas relativas, saem como `l` explícito, porque depois de um M eles virariam retas absolutas. Os demais
 * subcaminhos ficam com o texto original.
 */
export function semSubcaminhos(d: string, remover: ReadonlySet<number>): string {
  const subcaminhos = lerSubcaminhos(d)
  if (subcaminhos.every((_, indice) => remover.has(indice))) {
    throw new Error('a remoção tiraria todos os subcaminhos; remova o elemento inteiro')
  }
  const casas = casasDecimais(d)
  const partes: string[] = []
  let anteriorRemovido = false
  for (const [indice, sub] of subcaminhos.entries()) {
    if (remover.has(indice)) {
      anteriorRemovido = true
      continue
    }
    const movimento = sub.comandos[0]
    if (anteriorRemovido && movimento !== undefined && movimento.letra === 'm') {
      const extras = movimento.numeros.slice(2)
      partes.push(
        `M${escrever(sub.partida.x, casas)} ${escrever(sub.partida.y, casas)}` +
          (extras.length > 0 ? `l${extras.map(String).join(' ')}` : '') +
          d.slice(movimento.fim, sub.fim),
      )
    } else {
      partes.push(d.slice(sub.inicio, sub.fim))
    }
    anteriorRemovido = false
  }
  return partes.join('')
}
