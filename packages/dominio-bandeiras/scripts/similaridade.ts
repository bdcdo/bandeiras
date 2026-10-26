/**
 * Mede a semelhança visual entre as bandeiras e grava os 6 vizinhos de cada uma em gerado/vizinhos.json.
 *
 * Quando rodar: em `pnpm gerar:dados`, depois de baixar-commons e antes de gerar, que lê o vizinhos.json. Também pode
 * rodar sozinho depois de mexer em curadoria/vizinhancas.json ou curadoria/familias.json.
 *
 * Entrada: os originais em .cache/commons/ (baixar-commons os deixa lá) e a curadoria. A entrada é o original, e não
 * imagens/, porque este passo roda antes de gerar.ts produzir imagens/; o gate de fidelidade de gerar.ts garante que o
 * processado e o original rasterizam igual (até 0,5% dos pixels), então a medida vale para os dois. A exceção são os
 * códigos de GATE_SO_PELO_LIBRSVG, cujo original o resvg não desenha por inteiro (no Paquistão, a estrela): para eles a
 * medida rasteriza o otimizado, montado em memória com a mesma função de gerar.ts, que o resvg desenha completo e que o
 * gate pelo librsvg confere contra o original.
 *
 * A medida tem duas partes. A grade 3x3 de cor média em Lab pega onde está cada cor (vermelho em cima, faixa azul no
 * meio), com distância perceptual: no Lab, uma diferença de 10 entre dois vermelhos parece tão grande quanto entre dois
 * azuis, o que não vale no RGB. A orientação das faixas separa o que a grade confunde: um tricolor vertical e um
 * horizontal das mesmas cores podem ter médias parecidas em várias células. Para formas geométricas chapadas isso
 * funciona melhor que um hash perceptual, que responde a textura e borda.
 *
 * Os vizinhos de cada bandeira são, primeiro, os co-membros das vizinhanças dela, ordenados pela distância; o ranking
 * geral completa até 6. A curadoria manda e a medida só ordena e completa. O script também imprime os pares mais
 * próximos que não dividem família, candidatos que a revisão da curadoria mostra ao Bruno.
 */
import { readFileSync } from 'node:fs'
import { Resvg } from '@resvg/resvg-js'
import { CAMINHOS, falhar, gravarJson, lerCuradoria, type Familia, type Vizinhanca, type Vizinhos } from './comum.ts'
import { GATE_SO_PELO_LIBRSVG, otimizar } from './gerar.ts'
import { MEMBROS_EM_ORDEM } from './membros.ts'

/** Largura da rasterização de análise. A grade 3x3 e a orientação não precisam de detalhe; 120 px basta e é rápido. */
const LARGURA_DE_ANALISE = 120
const VIZINHOS_POR_BANDEIRA = 6
/**
 * Razão entre a variação ao longo das linhas e ao longo das colunas abaixo da qual as faixas contam como horizontais
 * (a cor quase não muda andando na linha); o inverso dela marca as verticais. Entre as duas, ou com a imagem quase lisa,
 * a orientação é "outra".
 */
const RAZAO_DE_ORIENTACAO = 0.4
/** Variância total mínima (em unidades de Lab ao quadrado) para a orientação significar algo. */
const VARIANCIA_MINIMA = 25
/** Peso, em unidades de ΔE, de orientações diferentes; da ordem da distância entre dois tons de uma mesma cor. */
const PENALIDADE_DE_ORIENTACAO = 15

type Lab = [number, number, number]
export type Orientacao = 'horizontal' | 'vertical' | 'outra'
export type Assinatura = { codigo: string; grade: Lab[]; orientacao: Orientacao }

/** sRGB de 8 bits para Lab (D65), pelas fórmulas da CIE: linearizar, passar a XYZ, normalizar pelo branco, comprimir. */
function rgbParaLab(r: number, g: number, b: number): Lab {
  const linear = (c: number): number => {
    const v = c / 255
    return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4
  }
  const [rl, gl, bl] = [linear(r), linear(g), linear(b)]
  const x = (0.4124 * rl + 0.3576 * gl + 0.1805 * bl) / 0.95047
  const y = 0.2126 * rl + 0.7152 * gl + 0.0722 * bl
  const z = (0.0193 * rl + 0.1192 * gl + 0.9505 * bl) / 1.08883
  // Raiz cúbica acima de ε = 216/24389; abaixo, o trecho linear (κt + 16)/116 com κ = 24389/27, que evita a derivada
  // infinita da raiz perto do preto.
  const f = (t: number): number => (t > 216 / 24389 ? Math.cbrt(t) : ((24389 / 27) * t + 16) / 116)
  const [fx, fy, fz] = [f(x), f(y), f(z)]
  return [116 * fy - 16, 500 * (fx - fy), 200 * (fy - fz)]
}

function rasterizar(svg: Buffer | string): { largura: number; altura: number; lab: Lab[] } {
  // Fundo branco: a parte transparente (o recorte do Nepal) conta como o branco da página.
  const imagem = new Resvg(svg, {
    fitTo: { mode: 'width', value: LARGURA_DE_ANALISE },
    background: '#ffffff',
    font: { loadSystemFonts: false },
  }).render()
  const pixels = imagem.pixels
  const lab: Lab[] = []
  for (let i = 0; i < pixels.length; i += 4) {
    lab.push(rgbParaLab(pixels[i] ?? 0, pixels[i + 1] ?? 0, pixels[i + 2] ?? 0))
  }
  return { largura: imagem.width, altura: imagem.height, lab }
}

function somaDeVariancias(cores: Lab[]): number {
  if (cores.length === 0) return 0
  let total = 0
  for (let canal = 0; canal < 3; canal++) {
    const media = cores.reduce((s, c) => s + c[canal as 0 | 1 | 2], 0) / cores.length
    total += cores.reduce((s, c) => s + (c[canal as 0 | 1 | 2] - media) ** 2, 0) / cores.length
  }
  return total
}

/** Assinatura do original do Commons; nos códigos de GATE_SO_PELO_LIBRSVG, do otimizado (ver o cabeçalho). */
export function assinar(codigo: string, original: Buffer): Assinatura {
  const svg = GATE_SO_PELO_LIBRSVG.has(codigo) ? otimizar(codigo, original.toString('utf8')) : original
  const { largura, altura, lab } = rasterizar(svg)
  const pixel = (x: number, y: number): Lab => lab[y * largura + x] ?? [0, 0, 0]

  const grade: Lab[] = []
  for (let gy = 0; gy < 3; gy++) {
    for (let gx = 0; gx < 3; gx++) {
      const soma: Lab = [0, 0, 0]
      let n = 0
      for (let y = Math.floor((gy * altura) / 3); y < Math.floor(((gy + 1) * altura) / 3); y++) {
        for (let x = Math.floor((gx * largura) / 3); x < Math.floor(((gx + 1) * largura) / 3); x++) {
          const c = pixel(x, y)
          soma[0] += c[0]
          soma[1] += c[1]
          soma[2] += c[2]
          n++
        }
      }
      grade.push([soma[0] / n, soma[1] / n, soma[2] / n])
    }
  }

  // Variação andando ao longo de cada linha (média entre as linhas) contra a variação ao longo de cada coluna.
  const linhas = Array.from({ length: altura }, (_, y) => Array.from({ length: largura }, (_, x) => pixel(x, y)))
  const colunas = Array.from({ length: largura }, (_, x) => Array.from({ length: altura }, (_, y) => pixel(x, y)))
  const naLinha = linhas.reduce((s, l) => s + somaDeVariancias(l), 0) / altura
  const naColuna = colunas.reduce((s, c) => s + somaDeVariancias(c), 0) / largura
  let orientacao: Orientacao = 'outra'
  if (somaDeVariancias(lab) >= VARIANCIA_MINIMA) {
    if (naLinha < RAZAO_DE_ORIENTACAO * naColuna) orientacao = 'horizontal'
    else if (naColuna < RAZAO_DE_ORIENTACAO * naLinha) orientacao = 'vertical'
  }
  return { codigo, grade, orientacao }
}

/** Média do ΔE76 entre as nove células, mais a penalidade de orientação. */
function distancia(a: Assinatura, b: Assinatura): number {
  let soma = 0
  for (let i = 0; i < 9; i++) {
    const ca = a.grade[i] ?? [0, 0, 0]
    const cb = b.grade[i] ?? [0, 0, 0]
    soma += Math.hypot(ca[0] - cb[0], ca[1] - cb[1], ca[2] - cb[2])
  }
  return soma / 9 + (a.orientacao === b.orientacao ? 0 : PENALIDADE_DE_ORIENTACAO)
}

export function assinarTodas(): Map<string, Assinatura> {
  const assinaturas = new Map<string, Assinatura>()
  for (const codigo of MEMBROS_EM_ORDEM) {
    let svg: Buffer
    try {
      svg = readFileSync(`${CAMINHOS.cache}${codigo}.svg`)
    } catch {
      falhar(`${codigo}: original ausente em .cache/commons/; rode baixar-commons.ts antes`)
    }
    assinaturas.set(codigo, assinar(codigo, svg))
  }
  return assinaturas
}

/** Distâncias de um código a todos os outros, da menor para a maior; empate desfeito pelo código. */
function ranking(codigo: string, assinaturas: Map<string, Assinatura>): { codigo: string; distancia: number }[] {
  const propria = assinaturas.get(codigo)
  if (propria === undefined) return []
  return [...assinaturas.values()]
    .filter((a) => a.codigo !== codigo)
    .map((a) => ({ codigo: a.codigo, distancia: distancia(propria, a) }))
    .sort((x, y) => x.distancia - y.distancia || x.codigo.localeCompare(y.codigo))
}

function calcularVizinhos(assinaturas: Map<string, Assinatura>, vizinhancas: Vizinhanca[]): Vizinhos {
  const vizinhos: Vizinhos = {}
  for (const codigo of MEMBROS_EM_ORDEM) {
    const minhas = vizinhancas.filter((v) => v.membros.includes(codigo))
    const ordem = ranking(codigo, assinaturas).map((r) => r.codigo)
    const comembros = new Set(minhas.flatMap((v) => v.membros).filter((c) => c !== codigo))
    // O co-membro mais próximo de cada vizinhança entra garantido. Sem isso, quem está em duas vizinhanças pode ter os
    // seis lugares tomados pela mais parecida (o Quirguistão, todo vermelho, perderia o sol para os vermelhos lisos).
    const garantidos = new Set(minhas.map((v) => ordem.find((c) => v.membros.includes(c))))
    const escolhidos = ordem.filter((c) => garantidos.has(c))
    for (const c of ordem) {
      if (escolhidos.length >= VIZINHOS_POR_BANDEIRA) break
      if (comembros.has(c) && !escolhidos.includes(c)) escolhidos.push(c)
    }
    for (const c of ordem) {
      if (escolhidos.length >= VIZINHOS_POR_BANDEIRA) break
      if (!escolhidos.includes(c)) escolhidos.push(c)
    }
    // Co-membros primeiro, cada bloco pela distância; o ranking geral só completa.
    const posicao = (c: string): number => ordem.indexOf(c) + (comembros.has(c) ? 0 : ordem.length)
    vizinhos[codigo] = escolhidos.sort((a, b) => posicao(a) - posicao(b))
  }
  return vizinhos
}

export type Candidato = { a: string; b: string; distancia: number; mesmaVizinhanca: boolean }

/** Os pares mais próximos que não dividem família: onde a curadoria pode ter deixado uma família de fora. */
export function candidatosAFamilia(
  assinaturas: Map<string, Assinatura>,
  familias: Familia[],
  vizinhancas: Vizinhanca[],
): Candidato[] {
  const dividem = (grupos: { membros: string[] }[], a: string, b: string): boolean =>
    grupos.some((g) => g.membros.includes(a) && g.membros.includes(b))
  const pares: Candidato[] = []
  const lista = [...assinaturas.values()]
  for (let i = 0; i < lista.length; i++) {
    for (let j = i + 1; j < lista.length; j++) {
      const [x, y] = [lista[i], lista[j]]
      if (x === undefined || y === undefined || dividem(familias, x.codigo, y.codigo)) continue
      pares.push({
        a: x.codigo,
        b: y.codigo,
        distancia: distancia(x, y),
        mesmaVizinhanca: dividem(vizinhancas, x.codigo, y.codigo),
      })
    }
  }
  return pares.sort((p, q) => p.distancia - q.distancia || (p.a + p.b).localeCompare(q.a + q.b)).slice(0, 30)
}

function principal(): void {
  const { familias, vizinhancas } = lerCuradoria()
  const assinaturas = assinarTodas()
  gravarJson(`${CAMINHOS.gerado}vizinhos.json`, calcularVizinhos(assinaturas, vizinhancas))

  const porOrientacao = new Map<Orientacao, string[]>()
  for (const a of assinaturas.values())
    porOrientacao.set(a.orientacao, [...(porOrientacao.get(a.orientacao) ?? []), a.codigo])
  for (const [orientacao, codigos] of porOrientacao) {
    console.log(`orientação ${orientacao}: ${String(codigos.length)} (${codigos.join(' ')})`)
  }
  console.log('candidatos a família (pares próximos que não dividem família):')
  for (const c of candidatosAFamilia(assinaturas, familias, vizinhancas)) {
    console.log(`  ${c.a}-${c.b} ${c.distancia.toFixed(1)}${c.mesmaVizinhanca ? ' (mesma vizinhança)' : ''}`)
  }
  console.log(`vizinhos gravados para ${String(assinaturas.size)} bandeiras`)
}

if (import.meta.main) principal()
