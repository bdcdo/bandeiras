/**
 * Processa os originais do Commons e monta os dados commitados do domínio: imagens/, gerado/bandeiras.json,
 * gerado/hashes.json e LICENCAS-DE-DADOS.md na raiz do repositório.
 *
 * Quando rodar: em `pnpm gerar:dados`, depois de baixar-commons e similaridade. Roda à mão; o teste de dados valida o
 * que ele deixou commitado. Imagem que mudou exige conferência à mão e o hash novo no mesmo commit.
 *
 * Por bandeira: recusa SVG com <text> ou <image> (texto depende da fonte instalada para rasterizar igual em todo
 * lugar, e <image> embute bitmap que o svgo não otimiza); passa o svgo; rasteriza o original e o otimizado em dois
 * renderizadores e reprova se o svgo mudou a imagem em algum deles; grava o SVG otimizado ou, acima de 100 KB, um WebP
 * em duas larguras.
 */
import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, readdirSync, statSync, unlinkSync, writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { Resvg } from '@resvg/resvg-js'
import sharp from 'sharp'
import { optimize, VERSION as VERSAO_DO_SVGO, type CustomPlugin } from 'svgo'
import {
  CAMINHOS,
  falhar,
  gravarJson,
  lerCuradoria,
  lerJson,
  lerJsonSeExistir,
  type Licenca,
  type RegioesM49,
  type Vizinhos,
} from './comum.ts'
import { MEMBROS_EM_ORDEM } from './membros.ts'

/** Largura do gate de fidelidade: a largura da bandeira na tela do celular, com folga. */
const LARGURA_DO_GATE = 480
/** Diferença de canal, em níveis de 0 a 255, abaixo da qual dois pixels contam como iguais (antisserrilhado, arredondamento). */
const TOLERANCIA_DE_CANAL = 8
/** Fração máxima de pixels diferentes entre o original e o otimizado. */
const FRACAO_MAXIMA_DIFERENTE = 0.005
/** Acima disto, depois do svgo, o SVG vira WebP: brasões detalhados pesam centenas de KB em vetor e pouco em raster. */
const LIMITE_DO_SVG_BYTES = 100 * 1024
const LARGURAS_DO_WEBP = [480, 960] as const
/**
 * Qualidade do WebP com perda. As bandeiras são chapadas com bordas nítidas; smartSubsample evita que o vermelho e o
 * azul borrem nas bordas, o defeito mais visível do subamostramento de cor.
 */
const OPCOES_DO_WEBP = { quality: 88, effort: 6, smartSubsample: true } as const
/** Teto do conjunto de imagens: o pré-cache do service worker baixa tudo na primeira visita, inclusive no celular. */
const TETO_DAS_IMAGENS_BYTES = 6 * 1024 * 1024
/**
 * Códigos cujo original o resvg não desenha por inteiro. O gate deles compara só pelo librsvg: pelo resvg, ele poria um
 * original incompleto contra um otimizado completo e reprovaria a otimização certa.
 *
 * pk: a estrela é um polígono com coordenadas na casa das centenas de milhares sob scale(0.00001557408), e o resvg não a
 * desenha no original. O preset do svgo aplica a transformação às coordenadas, e aí o resvg passa a desenhá-la (0,82%
 * dos pixels a 480 px). No librsvg, original e otimizado têm a mesma estrela.
 */
const GATE_SO_PELO_LIBRSVG: ReadonlySet<string> = new Set(['pk'])

// O pacote não exporta o package.json; ele fica ao lado do ponto de entrada que o resolvedor devolve.
const VERSAO_DO_RESVG = (
  lerJson(fileURLToPath(new URL('package.json', import.meta.resolve('@resvg/resvg-js')))) as { version: string }
).version

/**
 * Garante viewBox no <svg> raiz, derivado de width e height quando o original não tem. Sem viewBox, o SVG não escala
 * no <img> da casca e a proporção não tem de onde sair. O svgo 4 já não remove viewBox no preset-default (o plugin
 * removeViewBox saiu do preset), então não há override a desligar; este plugin cobre o caso inverso, o viewBox ausente.
 */
const garantirViewBox: CustomPlugin = {
  name: 'garantirViewBox',
  fn: () => ({
    element: {
      enter: (no, pai) => {
        if (no.name !== 'svg' || pai.type !== 'root' || no.attributes['viewBox'] !== undefined) return
        const largura = parseFloat(no.attributes['width'] ?? '')
        const altura = parseFloat(no.attributes['height'] ?? '')
        // Número simples ou em notação científica ("1e3" aparece no Commons), com px opcional; percentual não serve.
        const emPixels = (v: string | undefined): boolean =>
          v !== undefined && /^(\d+\.?\d*|\.\d+)(e[+-]?\d+)?(px)?$/i.test(v)
        if (!emPixels(no.attributes['width']) || !emPixels(no.attributes['height']) || !(largura > 0 && altura > 0)) {
          throw new Error('SVG sem viewBox e sem width e height em pixels')
        }
        no.attributes['viewBox'] = `0 0 ${String(largura)} ${String(altura)}`
      },
    },
  }),
}

function otimizar(codigo: string, original: string): string {
  try {
    return optimize(original, { floatPrecision: 3, plugins: [garantirViewBox, 'preset-default'] }).data
  } catch (erro) {
    falhar(`${codigo}: svgo falhou (${erro instanceof Error ? erro.message : String(erro)})`)
  }
}

function rasterizar(svg: string, largura: number): { largura: number; altura: number; pixels: Buffer } {
  const imagem = new Resvg(svg, { fitTo: { mode: 'width', value: largura }, font: { loadSystemFonts: false } }).render()
  return { largura: imagem.width, altura: imagem.height, pixels: imagem.pixels }
}

/**
 * Rasteriza pelo librsvg, embutido no sharp, no tamanho que o resvg deu. O librsvg desenha no tamanho intrínseco vezes
 * density/72; a densidade leva o desenho ao dobro da largura pedida e o resize reduz, para o antisserrilhado sair igual
 * nos dois lados da comparação.
 */
async function rasterizarPeloLibrsvg(svg: string, largura: number, altura: number): Promise<Buffer> {
  const entrada = Buffer.from(svg)
  const { width: intrinseca } = await sharp(entrada, { limitInputPixels: false }).metadata()
  return sharp(entrada, { density: (72 * 2 * largura) / intrinseca, limitInputPixels: false })
    .resize(largura, altura, { fit: 'fill' })
    .ensureAlpha()
    .raw()
    .toBuffer()
}

/** Fração dos pixels em que algum canal (RGBA) difere mais que a tolerância. */
function fracaoDiferente(a: Buffer, b: Buffer): number {
  let diferentes = 0
  for (let i = 0; i < a.length; i += 4) {
    for (let canal = 0; canal < 4; canal++) {
      if (Math.abs((a[i + canal] ?? 0) - (b[i + canal] ?? 0)) > TOLERANCIA_DE_CANAL) {
        diferentes++
        break
      }
    }
  }
  return diferentes / (a.length / 4)
}

/**
 * Largura sobre altura da bandeira desenhada, em 3 casas. Vem do viewBox, que é a forma do desenho: com o
 * preserveAspectRatio padrão, um width e height de outra proporção só acrescentam margem transparente. A exceção é
 * preserveAspectRatio="none", que estica o viewBox até width e height (o Catar do Commons desenha num viewBox 75x18 e
 * pede 1400x550); aí a forma exibida é a de width e height.
 */
function proporcaoDaBandeira(codigo: string, svg: string): number {
  const raiz = /<svg\b[^>]*>/.exec(svg)?.[0] ?? ''
  const atributo = (nome: string): string | undefined => new RegExp(`\\s${nome}="([^"]*)"`).exec(raiz)?.[1]
  let [largura, altura] = (
    atributo('viewBox')
      ?.trim()
      .split(/[\s,]+/)
      .map(Number) ?? []
  ).slice(2)
  if (atributo('preserveAspectRatio')?.trim() === 'none') {
    largura = parseFloat(atributo('width') ?? '')
    altura = parseFloat(atributo('height') ?? '')
  }
  if (largura === undefined || altura === undefined || !(largura > 0 && altura > 0)) {
    falhar(`${codigo}: viewBox (ou width e height) ausente ou inválido no SVG otimizado`)
  }
  return Math.round((largura / altura) * 1000) / 1000
}

function sha256(conteudo: Buffer): string {
  return createHash('sha256').update(conteudo).digest('hex')
}

type Imagem = { formato: 'svg' } | { formato: 'webp'; larguras: number[] }
/** Fração de pixels diferentes entre original e otimizado em cada renderizador; resvg ausente nos códigos isentos. */
type Gate = { resvg?: number; librsvg: number }
type Processada = { codigo: string; proporcao: number; imagem: Imagem; arquivos: Map<string, Buffer>; gate: Gate }

async function processar(codigo: string): Promise<Processada> {
  const caminho = `${CAMINHOS.cache}${codigo}.svg`
  if (!existsSync(caminho)) falhar(`${codigo}: original ausente em .cache/commons/; rode baixar-commons.ts antes`)
  const original = readFileSync(caminho, 'utf8')
  const proibido = /<(?:[\w-]+:)?(text|image)[\s/>]/.exec(original)?.[1]
  if (proibido !== undefined) {
    falhar(`${codigo}: o SVG tem <${proibido}>; escolha outro título em curadoria/commons.json`)
  }

  const otimizado = otimizar(codigo, original)
  const antes = rasterizar(original, LARGURA_DO_GATE)
  const depois = rasterizar(otimizado, LARGURA_DO_GATE)
  if (antes.largura !== depois.largura || antes.altura !== depois.altura) {
    falhar(
      `${codigo}: o svgo mudou o tamanho rasterizado (${String(antes.altura)} -> ${String(depois.altura)} px de altura)`,
    )
  }
  // Dois renderizadores porque cada um ignora coisas que o outro desenha: o que o svgo estragar num elemento que só um
  // deles desenha passaria por um gate de renderizador único.
  const gate: Gate = {
    librsvg: fracaoDiferente(
      await rasterizarPeloLibrsvg(original, antes.largura, antes.altura),
      await rasterizarPeloLibrsvg(otimizado, antes.largura, antes.altura),
    ),
    ...(GATE_SO_PELO_LIBRSVG.has(codigo) ? {} : { resvg: fracaoDiferente(antes.pixels, depois.pixels) }),
  }
  for (const [renderizador, fracao] of Object.entries(gate)) {
    if (fracao > FRACAO_MAXIMA_DIFERENTE) {
      falhar(
        `${codigo}: o svgo mudou ${(fracao * 100).toFixed(2)}% dos pixels no ${renderizador} (máximo ${String(FRACAO_MAXIMA_DIFERENTE * 100)}%)`,
      )
    }
  }

  const proporcao = proporcaoDaBandeira(codigo, otimizado)
  const bytes = Buffer.from(otimizado)
  if (bytes.length <= LIMITE_DO_SVG_BYTES) {
    return { codigo, proporcao, imagem: { formato: 'svg' }, arquivos: new Map([[`${codigo}.svg`, bytes]]), gate }
  }
  // O raster sai do resvg e o sharp só codifica: o WebP mostra o que o gate do resvg conferiu. Um código isento desse
  // gate não pode virar WebP, porque o resvg não desenha o original dele por inteiro.
  if (GATE_SO_PELO_LIBRSVG.has(codigo)) {
    falhar(`${codigo}: passou de 100 KB e viraria WebP pelo resvg, que não desenha este original por inteiro`)
  }
  const arquivos = new Map<string, Buffer>()
  for (const largura of LARGURAS_DO_WEBP) {
    const png = new Resvg(otimizado, { fitTo: { mode: 'width', value: largura }, font: { loadSystemFonts: false } })
      .render()
      .asPng()
    arquivos.set(`${codigo}-${String(largura)}.webp`, await sharp(png).webp(OPCOES_DO_WEBP).toBuffer())
  }
  return { codigo, proporcao, imagem: { formato: 'webp', larguras: [...LARGURAS_DO_WEBP] }, arquivos, gate }
}

/**
 * As 5 regiões e as 22 sub-regiões com nome em pt-BR, em listas ordenadas por código. Lista e não objeto: o JavaScript
 * ordena chaves que parecem inteiros ("142") antes das demais ("002"), e a ordem do arquivo deixaria de ser a do código.
 */
function nomesDasRegioes(regioes: RegioesM49, nomeIcu: (codigo: string) => string) {
  const nome = (codigo: string): string => regioes.nomesDeRegiao?.[codigo]?.nome ?? nomeIcu(codigo)
  const subRegioesPorRegiao = new Map<string, Set<string>>()
  for (const { regiao, subRegiao } of Object.values(regioes.paises)) {
    subRegioesPorRegiao.set(regiao, (subRegioesPorRegiao.get(regiao) ?? new Set()).add(subRegiao))
  }
  return [...subRegioesPorRegiao]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([codigo, subRegioes]) => ({
      codigo,
      nome: nome(codigo),
      subRegioes: [...subRegioes].sort().map((sub) => ({ codigo: sub, nome: nome(sub) })),
    }))
}

/** Barra vertical e quebra de linha quebram a tabela do Markdown; o resto do texto do Commons passa como está. */
function celula(texto: string): string {
  return texto.replace(/\|/g, '\\|').replace(/\s+/g, ' ').trim()
}

function licencasDeDados(licencas: Licenca[], regioes: RegioesM49, versoes: Record<string, string>): string {
  const unicode = readFileSync(`${CAMINHOS.textosDeLicenca}unicode-3.0.txt`, 'utf8').trim()
  const ofl = readFileSync(`${CAMINHOS.textosDeLicenca}ofl-1.1-atkinson-hyperlegible.txt`, 'utf8').trim()
  const linhas = licencas.map((l) => {
    const licenca = l.urlLicenca === null ? celula(l.licenca) : `[${celula(l.licenca)}](${l.urlLicenca})`
    return `| ${l.codigo} | [${celula(l.titulo)}](${l.urlPagina}) | ${celula(l.autor) || 'não informado'} | ${licenca} |`
  })
  return [
    '# Licenças dos dados',
    '',
    'Arquivo gerado por `packages/dominio-bandeiras/scripts/gerar.ts`; não editar à mão. O código do repositório está sob a licença MIT (`LICENSE`); os dados abaixo têm origem e licença próprias.',
    '',
    '## Imagens das bandeiras',
    '',
    'Cada bandeira vem de um arquivo do Wikimedia Commons, processado pelo projeto (otimização com svgo e, para os arquivos grandes, conversão para WebP). Título, autor e licença de cada arquivo estão abaixo; a revisão usada fica fixada por sha1 em `packages/dominio-bandeiras/gerado/commons-revisoes.json`.',
    '',
    '| Código | Arquivo no Commons | Autor | Licença |',
    '| --- | --- | --- | --- |',
    ...linhas,
    '',
    '## Nomes dos países e das regiões',
    '',
    `Os nomes em português vêm do CLDR por meio do ICU embutido no Node.js (Node ${versoes['node'] ?? ''}, ICU ${versoes['icu'] ?? ''}, CLDR ${versoes['cldr'] ?? ''}), com ajustes e grafias alternativas do projeto em \`packages/dominio-bandeiras/curadoria/nomes.json\`. Os dados do CLDR e do ICU são distribuídos sob a Unicode License v3 (SPDX \`Unicode-3.0\`):`,
    '',
    '```text',
    unicode,
    '```',
    '',
    '## Lista de membros e regiões',
    '',
    'A lista dos 193 Estados-membros foi digitada pelo projeto a partir da lista oficial da ONU (https://www.un.org/en/about-us/member-states, consultada em 2026-10-25).',
    '',
    `A região e a sub-região de cada membro foram atribuídas pelo projeto a partir da classificação M49 da Divisão de Estatística da ONU (${regioes.fonte.url}, consultada em ${regioes.fonte.consultadoEm}).`,
    '',
    'As duas são atribuições factuais (quais países são membros, a que região cada um pertence), registradas pelo projeto; nenhum arquivo da ONU é copiado ou redistribuído.',
    '',
    '## Fonte Atkinson Hyperlegible',
    '',
    'A interface usa a fonte Atkinson Hyperlegible, do Braille Institute of America, sob a SIL Open Font License 1.1:',
    '',
    '```text',
    ofl,
    '```',
    '',
  ].join('\n')
}

async function principal(): Promise<void> {
  const curadoria = lerCuradoria()
  const { nomes, regioes, familias, vizinhancas, descricoes, dificuldade } = curadoria
  const vizinhos = lerJsonSeExistir(`${CAMINHOS.gerado}vizinhos.json`) as Vizinhos | undefined
  if (vizinhos === undefined) falhar('gerado/vizinhos.json ausente; rode similaridade.ts antes')
  const licencas = lerJsonSeExistir(`${CAMINHOS.gerado}licencas.json`) as Licenca[] | undefined
  if (licencas === undefined) falhar('gerado/licencas.json ausente; rode baixar-commons.ts antes')
  const descricaoPorCodigo = new Map(descricoes.map((d) => [d.codigo, d]))

  const icu = new Intl.DisplayNames(['pt-BR'], { type: 'region' })
  // Sem nome no ICU, o DisplayNames devolve o próprio código; isso é falta de dado, não nome.
  const nomeIcu = (codigo: string): string => {
    const nome = icu.of(codigo.toUpperCase())
    if (nome === undefined || nome.toUpperCase() === codigo.toUpperCase()) {
      falhar(`${codigo}: o ICU não tem nome em pt-BR; acrescente um override na curadoria`)
    }
    return nome
  }

  const processadas: Processada[] = []
  for (const codigo of MEMBROS_EM_ORDEM) processadas.push(await processar(codigo))

  // Escreve o conjunto novo e apaga de imagens/ o que não faz mais parte dele (uma bandeira que passou de SVG a WebP,
  // por exemplo). O que sai continua no histórico do Git.
  mkdirSync(CAMINHOS.imagens, { recursive: true })
  const novos = new Map(processadas.flatMap((p) => [...p.arquivos]))
  for (const nome of readdirSync(CAMINHOS.imagens)) {
    if (!novos.has(nome)) {
      unlinkSync(`${CAMINHOS.imagens}${nome}`)
      console.log(`imagens/${nome} removido (fora do conjunto novo)`)
    }
  }
  for (const [nome, conteudo] of novos) writeFileSync(`${CAMINHOS.imagens}${nome}`, conteudo)
  const nomesDosArquivos = [...novos.keys()].sort()
  const total = nomesDosArquivos.reduce((s, nome) => s + statSync(`${CAMINHOS.imagens}${nome}`).size, 0)
  if (total > TETO_DAS_IMAGENS_BYTES) {
    falhar(`imagens/ soma ${(total / 1024 / 1024).toFixed(2)} MB, acima do teto de 6 MB`)
  }
  gravarJson(
    `${CAMINHOS.gerado}hashes.json`,
    Object.fromEntries(nomesDosArquivos.map((nome) => [nome, sha256(readFileSync(`${CAMINHOS.imagens}${nome}`))])),
  )

  const bandeiras = processadas.map(({ codigo, proporcao, imagem }) => {
    const grupos = familias.filter((f) => f.membros.includes(codigo)).map((f) => f.id)
    const daVizinhanca = vizinhancas.filter((v) => v.membros.includes(codigo))
    // Regra única da dificuldade a priori: 1 fora de grupo e de vizinhança; 2 em um grupo ou só em vizinhança; 3 em
    // dois ou mais grupos. curadoria/dificuldade.json sobrepõe, com motivo, os pares quase idênticos e as conhecidas.
    const pelaRegra = grupos.length >= 2 ? 3 : grupos.length === 1 || daVizinhanca.length > 0 ? 2 : 1
    const descricao = descricaoPorCodigo.get(codigo)
    const regiao = regioes.paises[codigo]
    const proprios = vizinhos[codigo]
    if (descricao === undefined) falhar(`${codigo}: sem descrição em curadoria/descricoes.json`)
    if (regiao === undefined) falhar(`${codigo}: sem região em curadoria/regioes-m49.json`)
    if (proprios === undefined) falhar(`${codigo}: sem vizinhos em gerado/vizinhos.json; rode similaridade.ts`)
    // Membro de mais de uma vizinhança junta os traços, na ordem do arquivo de vizinhanças.
    const tracos = daVizinhanca.map((v) => v.tracoDistintivo[codigo]).filter((t) => t !== undefined)
    return {
      codigo,
      nome: nomes.overrides[codigo]?.nome ?? nomeIcu(codigo),
      aliases: nomes.aliases[codigo] ?? [],
      regiao: regiao.regiao,
      subRegiao: regiao.subRegiao,
      grupos,
      dificuldadeAPriori: dificuldade[codigo]?.dificuldade ?? pelaRegra,
      descricao: descricao.descricao,
      classe: descricao.classe,
      vizinhos: proprios,
      ...(tracos.length > 0 ? { tracoVizinhanca: tracos.join('; ') } : {}),
      proporcao,
      imagem,
    }
  })

  const versoes = {
    node: process.versions.node,
    icu: process.versions['icu'] ?? '',
    cldr: process.versions['cldr'] ?? '',
    svgo: VERSAO_DO_SVGO,
    sharp: sharp.versions.sharp,
    resvg: VERSAO_DO_RESVG,
  }
  gravarJson(`${CAMINHOS.gerado}bandeiras.json`, {
    geradoEm: new Date().toISOString(),
    versoes,
    regioes: nomesDasRegioes(regioes, nomeIcu),
    bandeiras,
  })
  writeFileSync(`${CAMINHOS.raizDoRepositorio}LICENCAS-DE-DADOS.md`, licencasDeDados(licencas, regioes, versoes))

  const webp = processadas.filter((p) => p.imagem.formato === 'webp').map((p) => p.codigo)
  console.log(`${String(processadas.length)} bandeiras; ${String(nomesDosArquivos.length)} arquivos em imagens/`)
  console.log(`WebP (${String(webp.length)}): ${webp.join(' ')}`)
  console.log(`total de imagens/: ${String(total)} bytes (${(total / 1024 / 1024).toFixed(2)} MB)`)
  for (const renderizador of ['resvg', 'librsvg'] as const) {
    const [pior] = processadas
      .flatMap(({ codigo, gate }) => (gate[renderizador] === undefined ? [] : [{ codigo, fracao: gate[renderizador] }]))
      .sort((a, b) => b.fracao - a.fracao)
    if (pior !== undefined) {
      console.log(`gate ${renderizador}: maior diferença ${(pior.fracao * 100).toFixed(3)}% (${pior.codigo})`)
    }
  }
  console.log(`gate só pelo librsvg: ${[...GATE_SO_PELO_LIBRSVG].join(' ')}`)
}

if (import.meta.main) await principal()
