/**
 * Apaga das bandeiras a inscrição que escreve o nome do país. Não roda sozinho: gerar.ts e similaridade.ts chamam
 * `derivar` logo depois de ler o original do cache, e o resto do processamento (svgo, gates, WebP, assinatura de
 * similaridade) opera sobre o derivado, que é o que o aluno vê.
 *
 * Por que existe: numa pergunta que mostra a bandeira e pede o nome, a inscrição entrega a resposta, e o acerto deixa de
 * provar recordação. A curadoria (curadoria/inscricoes.json) diz, por bandeira, o que está escrito, onde, e as operações
 * que identificam no original fixado o que sai. O desenho que fica é o do arquivo do Commons, sem a inscrição.
 *
 * Como a identificação funciona. Cada operação nomeia um traço do próprio SVG e diz quanto espera achar:
 *
 * - `atributos`: valor de atributo como o elemento o herda, o dele ou, se ele não tiver, o do ancestral mais próximo que
 *   tiver, até o <svg> raiz; `null` quer dizer ausente no elemento e em todos os ancestrais. É o que o SVG faz com
 *   `fill`: um path sem `fill` dentro de `<g fill="#fffffd">` é pintado de #fffffd, e um path sem `fill` em lugar
 *   nenhum é preto. A busca lê o atributo escrito, e não a cor calculada: um `fill` que venha de CSS (folha <style> ou
 *   atributo style=) não aparece em atributo nenhum, e um path pintado assim pareceria sem cor. Por isso uma operação
 *   que identifica por `fill` lança quando o original pinta fill por CSS; nesse original, identifique por class ou id.
 * - `subcaminhos`: quantos subcaminhos o path tem no total, o que separa dois paths da mesma cor.
 * - `dentroDe`: uma lista de retângulos em frações da imagem (0 a 1, a partir do canto de cima à esquerda do viewBox),
 *   já com as transformações do elemento e dos ancestrais aplicadas. A forma tem de caber inteira num deles. Mais de um
 *   retângulo serve à inscrição curva: as letras de BOLIVIA seguem a borda do oval, e um retângulo só que cobrisse o
 *   arco pegaria também o miolo do brasão; três (lado esquerdo, topo, lado direito) seguem a borda.
 *
 * A caixa de cada forma é a dos pontos e controles do caminho, que pode ser maior que o desenho e nunca menor; "cabe no
 * retângulo" garante que o desenho cabe, e uma forma que só encosta na borda fica de fora, o que a contagem acusa.
 *
 * Esses traços valem mais que um índice ("o 699º filho do 3º grupo"): quem revisa lê "os paths dourados que cabem na
 * borda do oval" e confere na imagem, e uma revisão nova do arquivo que embaralhe a ordem dos elementos não muda o que
 * é escolhido. Se o arquivo mudar de um jeito que o traço já não ache o que a curadoria declarou, a contagem não bate e
 * a derivação lança, nomeando o código e a operação. O campo `descricao` de cada operação diz em palavras o que ela
 * acha, para a revisão comparar com a imagem, sem repetir as contagens de `esperados` e `subcaminhos`.
 *
 * Os dois tipos de operação:
 *
 * - `elementos`: remove todo path que tem os traços; `esperados` é quantos paths.
 * - `subcaminhos`: nos paths que têm os traços, remove os subcaminhos que cabem em `dentroDe`, para quando a inscrição
 *   está no mesmo path composto que outras formas; `esperados` é quantos subcaminhos. caminho-svg.ts reescreve o
 *   subcaminho seguinte a um trecho removido, para um `m` relativo não deslocar o resto do desenho.
 *
 * Só entram na busca os elementos desenhados: o conteúdo dos elementos de NAO_DESENHADOS é molde, recorte, preenchimento
 * ou filtro usado por referência, e tirar um deles mudaria outra parte da imagem.
 *
 * A remoção passa pelo svgo só para ler e reescrever a árvore (nenhum plugin de otimização roda aqui); os elementos que
 * ficam saem com os mesmos atributos. Mesmo original, mesmos bytes. O gate da remoção, em gerar.ts, rasteriza original e
 * derivado e confere que a mudança cabe na caixa da curadoria e chega perto de todas as bordas dela.
 */
import { optimize, type XastChild, type XastElement, type XastParent } from 'svgo'
import { cabeEm, caixaDe, lerSubcaminhos, semSubcaminhos, type Retangulo } from './caminho-svg.ts'
import type { Inscricao, OperacaoDeInscricao } from './comum.ts'

/** Elementos cujo conteúdo não é desenhado onde está, mas usado por referência (molde, recorte, preenchimento, filtro). */
const NAO_DESENHADOS = new Set([
  'defs',
  'clipPath',
  'mask',
  'symbol',
  'pattern',
  'marker',
  'linearGradient',
  'radialGradient',
  'filter',
])

/** Matriz afim [a, b, c, d, e, f] do SVG: x' = a·x + c·y + e e y' = b·x + d·y + f. */
type Matriz = readonly [number, number, number, number, number, number]
const IDENTIDADE: Matriz = [1, 0, 0, 1, 0, 0]

function compor(m: Matriz, n: Matriz): Matriz {
  const [a, b, c, d, e, f] = m
  const [a2, b2, c2, d2, e2, f2] = n
  return [a * a2 + c * b2, b * a2 + d * b2, a * c2 + c * d2, b * c2 + d * d2, a * e2 + c * f2 + e, b * e2 + d * f2 + f]
}

/** Lê o atributo transform: lista de matrix, translate, scale, rotate, skewX e skewY, aplicadas da direita para a esquerda. */
export function lerTransformacao(texto: string): Matriz {
  let total = IDENTIDADE
  const restante = texto.replace(
    /(matrix|translate|scale|rotate|skewX|skewY)\s*\(([^)]*)\)/g,
    (_, nome: string, args: string) => {
      const n = args
        .split(/[\s,]+/)
        .filter((v) => v !== '')
        .map(Number)
      if (n.some((v) => !Number.isFinite(v))) throw new Error(`transformação com número inválido: "${texto}"`)
      const [p0 = 0, p1, p2, p3 = 0, p4 = 0, p5 = 0] = n
      const rad = (graus: number): number => (graus * Math.PI) / 180
      let m: Matriz
      if (nome === 'matrix') {
        if (n.length !== 6) throw new Error(`matrix com ${String(n.length)} números: "${texto}"`)
        m = [p0, p1 ?? 0, p2 ?? 0, p3, p4, p5]
      } else if (nome === 'translate') m = [1, 0, 0, 1, p0, p1 ?? 0]
      else if (nome === 'scale') m = [p0, 0, 0, p1 ?? p0, 0, 0]
      else if (nome === 'rotate') {
        const [cos, sen] = [Math.cos(rad(p0)), Math.sin(rad(p0))]
        const [cx, cy] = [p1 ?? 0, p2 ?? 0]
        // rotate(a, cx, cy) é translate(cx, cy) rotate(a) translate(-cx, -cy).
        m = compor(compor([1, 0, 0, 1, cx, cy], [cos, sen, -sen, cos, 0, 0]), [1, 0, 0, 1, -cx, -cy])
      } else if (nome === 'skewX') m = [1, 0, Math.tan(rad(p0)), 1, 0, 0]
      else m = [1, Math.tan(rad(p0)), 0, 1, 0, 0]
      total = compor(total, m)
      return ''
    },
  )
  if (restante.replace(/[\s,]/g, '') !== '') throw new Error(`transformação que não sei ler: "${texto}"`)
  return total
}

/** Caixa de um retângulo depois da transformação: a dos quatro cantos transformados, que contém a forma transformada. */
function transformar(m: Matriz, r: Retangulo): Retangulo {
  const [a, b, c, d, e, f] = m
  const cantos = [
    [r.x0, r.y0],
    [r.x1, r.y0],
    [r.x0, r.y1],
    [r.x1, r.y1],
  ].map(([x = 0, y = 0]) => ({ x: a * x + c * y + e, y: b * x + d * y + f }))
  return caixaDe(cantos)
}

/**
 * Matriz que leva as coordenadas da raiz a frações da imagem. Vale o viewBox; sem ele, width e height, que é como o SVG
 * define o sistema de coordenadas nesse caso.
 */
function matrizDaRaiz(raiz: XastElement): Matriz {
  const viewBox = raiz.attributes['viewBox']
    ?.trim()
    .split(/[\s,]+/)
    .map(Number)
  const [x, y, largura, altura] =
    viewBox?.length === 4
      ? viewBox
      : [0, 0, parseFloat(raiz.attributes['width'] ?? ''), parseFloat(raiz.attributes['height'] ?? '')]
  if (
    x === undefined ||
    y === undefined ||
    largura === undefined ||
    altura === undefined ||
    !(largura > 0 && altura > 0)
  ) {
    throw new Error('o SVG não tem viewBox nem width e height em número')
  }
  return [1 / largura, 0, 0, 1 / altura, -x / largura, -y / altura]
}

type Desenhado = {
  elemento: XastElement
  pai: XastParent
  /** Das coordenadas do `d` deste elemento para frações da imagem. */
  matriz: Matriz
  /** Atributos como o elemento os herda: os dele por cima dos dos ancestrais. */
  herdados: Record<string, string>
}

/** Paths desenhados, na ordem do documento, com a matriz e os atributos herdados de cada um. */
function pathsDesenhados(raiz: XastElement): Desenhado[] {
  const encontrados: Desenhado[] = []
  const andar = (pai: XastElement, matriz: Matriz, herdados: Record<string, string>): void => {
    for (const filho of pai.children) {
      if (filho.type !== 'element' || NAO_DESENHADOS.has(filho.name)) continue
      const propria = filho.attributes['transform']
      const sua = propria === undefined ? matriz : compor(matriz, lerTransformacao(propria))
      const seus = { ...herdados, ...filho.attributes }
      if (filho.name === 'path') encontrados.push({ elemento: filho, pai, matriz: sua, herdados: seus })
      andar(filho, sua, seus)
    }
  }
  // A herança começa nos atributos do próprio <svg>, que é ancestral de todo elemento: um fill escrito nele pinta os
  // paths que não têm fill.
  andar(raiz, matrizDaRaiz(raiz), { ...raiz.attributes })
  return encontrados
}

/** Declaração da propriedade fill numa folha CSS ou num style=; `fill-rule` e `fill-opacity` não contam. */
const FILL_EM_CSS = /(?:^|[{;\s])fill\s*:/

/** Se o elemento ou algum descendente pinta fill por CSS: atributo style= com fill, ou folha <style> com fill. */
function pintaFillPorCss(elemento: XastElement): boolean {
  if (FILL_EM_CSS.test(elemento.attributes['style'] ?? '')) return true
  return elemento.children.some(
    (filho) =>
      filho.type === 'element' &&
      ((filho.name === 'style' &&
        filho.children.some((t) => (t.type === 'text' || t.type === 'cdata') && FILL_EM_CSS.test(t.value))) ||
        pintaFillPorCss(filho)),
  )
}

function temOsAtributos(desenhado: Desenhado, atributos: Record<string, string | null>): boolean {
  return Object.entries(atributos).every(([nome, valor]) =>
    valor === null ? desenhado.herdados[nome] === undefined : desenhado.herdados[nome] === valor,
  )
}

/** O que cada operação achou e tirou; os testes conferem a contagem por aqui. */
export type Remocao = { operacao: number; elementos: number; subcaminhos: number }

function aplicar(raiz: XastElement, operacao: OperacaoDeInscricao): Omit<Remocao, 'operacao'> {
  const { dentroDe } = operacao
  if ('fill' in operacao.atributos && pintaFillPorCss(raiz)) {
    throw new Error(
      'a operação identifica por fill, e o original pinta fill por CSS (<style> ou style=), que o atributo não ' +
        'mostra; identifique por class ou id',
    )
  }
  // A forma cabe na região quando cabe inteira em algum dos retângulos.
  const cabe = (matriz: Matriz, caixa: Retangulo): boolean =>
    dentroDe !== undefined && dentroDe.some((r) => cabeEm(transformar(matriz, caixa), r))
  const candidatos = pathsDesenhados(raiz).filter((p) => {
    if (!temOsAtributos(p, operacao.atributos)) return false
    const subcaminhos = lerSubcaminhos(p.elemento.attributes['d'] ?? '')
    if (operacao.subcaminhos !== undefined && subcaminhos.length !== operacao.subcaminhos) return false
    if (operacao.remover === 'subcaminhos' || dentroDe === undefined) return true
    return subcaminhos.length > 0 && subcaminhos.every((s) => cabe(p.matriz, s.caixa))
  })

  if (operacao.remover === 'elementos') {
    for (const { elemento, pai } of candidatos) pai.children = pai.children.filter((c: XastChild) => c !== elemento)
    return { elementos: candidatos.length, subcaminhos: 0 }
  }

  if (dentroDe === undefined) throw new Error('remover subcaminhos pede dentroDe')
  let removidos = 0
  for (const { elemento, matriz } of candidatos) {
    const d = elemento.attributes['d'] ?? ''
    const indices = new Set(lerSubcaminhos(d).flatMap((s, i) => (cabe(matriz, s.caixa) ? [i] : [])))
    if (indices.size === 0) continue
    elemento.attributes['d'] = semSubcaminhos(d, indices)
    removidos += indices.size
  }
  return { elementos: 0, subcaminhos: removidos }
}

/**
 * O SVG sem a inscrição. Lança, com o código e o número da operação na mensagem, quando uma operação não acha o que
 * declarou ou não acha nada.
 */
export function derivar(inscricao: Inscricao, original: string): { svg: string; remocoes: Remocao[] } {
  const remocoes: Remocao[] = []
  const svg = optimize(original, {
    plugins: [
      {
        name: 'apagarInscricao',
        fn: (raizDoDocumento) => {
          const raiz = raizDoDocumento.children.find((c): c is XastElement => c.type === 'element' && c.name === 'svg')
          if (raiz === undefined) throw new Error(`${inscricao.codigo}: o arquivo não tem <svg> na raiz`)
          for (const [i, operacao] of inscricao.operacoes.entries()) {
            const rotulo = `${inscricao.codigo}: operação ${String(i + 1)} (${operacao.remover})`
            let feito: Omit<Remocao, 'operacao'>
            try {
              feito = aplicar(raiz, operacao)
            } catch (erro) {
              throw new Error(`${rotulo}: ${erro instanceof Error ? erro.message : String(erro)}`, { cause: erro })
            }
            const achados = operacao.remover === 'elementos' ? feito.elementos : feito.subcaminhos
            if (achados !== operacao.esperados) {
              throw new Error(
                `${rotulo} achou ${String(achados)} ${operacao.remover}, e a curadoria declara ` +
                  `${String(operacao.esperados)}; confira o original fixado contra curadoria/inscricoes.json`,
              )
            }
            remocoes.push({ operacao: i + 1, ...feito })
          }
          return null
        },
      },
    ],
  }).data
  return { svg, remocoes }
}

/**
 * A frase que gerado/licencas.json e LICENCAS-DE-DADOS.md registram para a bandeira modificada. Sai daqui, da curadoria,
 * para os dois arquivos dizerem a mesma coisa.
 */
export function fraseDaModificacao(inscricao: Inscricao): string {
  const texto =
    inscricao.traducao === undefined ? `"${inscricao.texto}"` : `"${inscricao.texto}" (${inscricao.traducao})`
  return `O projeto apagou do desenho a inscrição com o nome do país, ${texto}, ${inscricao.lugar}; o resto é o do arquivo original.`
}
