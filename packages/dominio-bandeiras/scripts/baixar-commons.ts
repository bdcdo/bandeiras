/**
 * Baixa do Wikimedia Commons o SVG original de cada bandeira e fixa a revisão e a licença de cada arquivo.
 *
 * Quando rodar: à mão, como primeiro passo de `pnpm gerar:dados`, nunca no install nem no CI. Precisa de rede; antes,
 * conferir a rede ativa como manda a regra do projeto para coleta em fonte externa.
 *
 * Entrada: curadoria/commons.json (título do arquivo por código). Saída: .cache/commons/<codigo>.svg (fora do Git),
 * gerado/commons-revisoes.json ({ codigo, titulo, sha1, timestamp, url }) e gerado/licencas.json.
 *
 * Sem `--atualizar`, quem já está fixado em commons-revisoes.json com o mesmo título não é consultado na API: o script só
 * baixa o que falta no cache e confere o sha1 contra o fixado. Se o arquivo mudou no Commons, o sha1 não bate e o script
 * para pedindo `--atualizar`, que consulta tudo de novo e deixa no diff qual bandeira mudou. Assim nenhuma bandeira troca
 * em silêncio.
 *
 * Educação com a Wikimedia: User-Agent identificado, consultas em lotes de até 50 títulos (o teto da API para
 * usuário comum), downloads em série com pausa de 200 ms e nova tentativa espaçada em 429 e 5xx.
 */
import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import {
  CAMINHOS,
  falhar,
  gravarJson,
  lerCuradoria,
  lerJsonSeExistir,
  pausa,
  type EntradaCommons,
  type Licenca,
  type RevisaoCommons,
} from './comum.ts'
import { MEMBROS_EM_ORDEM } from './membros.ts'

const API = 'https://commons.wikimedia.org/w/api.php'
const USER_AGENT = 'bandeiras-app/0.1 (https://github.com/bdcdo/bandeiras)'
const TAMANHO_DO_LOTE = 50
const PAUSA_ENTRE_DOWNLOADS_MS = 200
const TENTATIVAS = 4

/**
 * Licenças aceitas, por LicenseShortName do Commons. Domínio público e CC0 não pedem nada; CC BY e CC BY-SA pedem
 * atribuição, que vai para LICENCAS-DE-DADOS.md a partir de licencas.json. Qualquer outra (inclusive licença de
 * governo com cláusula própria, como a OGL-om) reprova e pede outro título.
 */
const LICENCAS_EXATAS = new Set(['Public domain', 'CC0', 'CC BY 3.0', 'CC BY 4.0', 'CC BY-SA 3.0', 'CC BY-SA 4.0'])
function licencaAceita(licenca: string): boolean {
  return LICENCAS_EXATAS.has(licenca) || licenca.startsWith('PD-')
}

type PaginaDaApi = {
  title: string
  missing?: boolean
  invalid?: boolean
  imageinfo?: {
    url: string
    descriptionurl: string
    sha1: string
    timestamp: string
    extmetadata?: Record<string, { value?: string }>
  }[]
}
type RespostaDaApi = {
  error?: { info?: string }
  query?: { pages?: PaginaDaApi[]; normalized?: { from: string; to: string }[] }
}

async function buscar(url: string): Promise<Response> {
  for (let tentativa = 1; ; tentativa++) {
    let resposta: Response | undefined
    try {
      resposta = await fetch(url, { headers: { 'User-Agent': USER_AGENT } })
    } catch (erro) {
      if (tentativa >= TENTATIVAS) throw erro
    }
    if (resposta?.ok === true) return resposta
    const status = resposta?.status ?? 0
    // 429 e 5xx são passageiros; o resto (404, 403) não melhora com espera.
    const passageiro = status === 0 || status === 429 || status >= 500
    if (!passageiro || tentativa >= TENTATIVAS) falhar(`HTTP ${String(status)} em ${url}`)
    const retryAfter = Number(resposta?.headers.get('retry-after'))
    const esperaMs = Number.isFinite(retryAfter) && retryAfter > 0 ? retryAfter * 1000 : 2000 * 2 ** (tentativa - 1)
    console.warn(`aviso: HTTP ${String(status)}, nova tentativa em ${String(esperaMs)} ms`)
    await pausa(esperaMs)
  }
}

/** Texto puro de um campo do extmetadata, que vem em HTML (links, spans, entidades). */
function limparHtml(html: string): string {
  const entidades: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' }
  return html
    .replace(/<[^>]*>/g, ' ')
    .replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (inteira, nome: string) => {
      if (nome.startsWith('#x') || nome.startsWith('#X')) return String.fromCodePoint(parseInt(nome.slice(2), 16))
      if (nome.startsWith('#')) return String.fromCodePoint(parseInt(nome.slice(1), 10))
      return entidades[nome.toLowerCase()] ?? inteira
    })
    .replace(/\s+/g, ' ')
    .trim()
}

function sha1(conteudo: Buffer): string {
  return createHash('sha1').update(conteudo).digest('hex')
}

/** URL do original sem os parâmetros de rastreio que a API acrescenta; o arquivo servido é o mesmo. */
function semConsulta(url: string): string {
  const u = new URL(url)
  u.search = ''
  return u.toString()
}

/** Nome do arquivo para onde a página de descrição aponta; difere do título pedido quando o título é redirecionamento. */
function tituloDaPaginaDeDescricao(descriptionurl: string): string {
  const nome = decodeURIComponent(new URL(descriptionurl).pathname.replace(/^\/wiki\//, ''))
  return nome.replace(/_/g, ' ').replace(/^File:/, '')
}

async function consultar(
  entradas: EntradaCommons[],
): Promise<Map<string, { revisao: RevisaoCommons; licenca: Licenca }>> {
  const resultado = new Map<string, { revisao: RevisaoCommons; licenca: Licenca }>()
  for (let inicio = 0; inicio < entradas.length; inicio += TAMANHO_DO_LOTE) {
    const lote = entradas.slice(inicio, inicio + TAMANHO_DO_LOTE)
    const parametros = new URLSearchParams({
      action: 'query',
      prop: 'imageinfo',
      iiprop: 'url|sha1|timestamp|extmetadata',
      iiextmetadatafilter: 'LicenseShortName|LicenseUrl|Artist|Credit',
      format: 'json',
      formatversion: '2',
      titles: lote.map((e) => `File:${e.titulo}`).join('|'),
    })
    const resposta = (await (await buscar(`${API}?${parametros.toString()}`)).json()) as RespostaDaApi
    if (resposta.error !== undefined) falhar(`API do Commons: ${resposta.error.info ?? 'erro sem descrição'}`)
    // A API normaliza o título (primeira letra, sublinhado); o mapa leva de volta ao título pedido.
    const pedidoPorNormalizado = new Map((resposta.query?.normalized ?? []).map((n) => [n.to, n.from]))
    const paginas = new Map(
      (resposta.query?.pages ?? []).map((p) => [pedidoPorNormalizado.get(p.title) ?? p.title, p] as const),
    )
    for (const entrada of lote) {
      const pagina = paginas.get(`File:${entrada.titulo}`)
      if (pagina === undefined) falhar(`${entrada.codigo}: a API não devolveu "${entrada.titulo}"`)
      if (pagina.missing === true || pagina.invalid === true) {
        falhar(
          `${entrada.codigo}: "${entrada.titulo}" não existe no Commons; corrija o título em curadoria/commons.json`,
        )
      }
      const info = pagina.imageinfo?.[0]
      if (info === undefined) falhar(`${entrada.codigo}: "${entrada.titulo}" sem imageinfo`)
      const destino = tituloDaPaginaDeDescricao(info.descriptionurl)
      if (destino !== entrada.titulo) {
        falhar(`${entrada.codigo}: "${entrada.titulo}" redireciona para "${destino}"; use o título de destino`)
      }
      const meta = info.extmetadata ?? {}
      const licenca = limparHtml(meta['LicenseShortName']?.value ?? '')
      if (!licencaAceita(licenca)) {
        falhar(
          `${entrada.codigo}: "${entrada.titulo}" tem licença "${licenca}", fora das aceitas (domínio público, ` +
            `PD-*, CC0, CC BY e CC BY-SA 3.0 e 4.0); escolha outro título em curadoria/commons.json`,
        )
      }
      const autor = limparHtml(meta['Artist']?.value ?? '') || limparHtml(meta['Credit']?.value ?? '')
      const urlLicenca = limparHtml(meta['LicenseUrl']?.value ?? '')
      resultado.set(entrada.codigo, {
        revisao: {
          codigo: entrada.codigo,
          titulo: entrada.titulo,
          sha1: info.sha1,
          timestamp: info.timestamp,
          url: semConsulta(info.url),
        },
        licenca: {
          codigo: entrada.codigo,
          titulo: entrada.titulo,
          autor,
          licenca,
          urlLicenca: urlLicenca === '' ? null : urlLicenca,
          urlPagina: info.descriptionurl,
        },
      })
    }
  }
  return resultado
}

function caminhoNoCache(codigo: string): string {
  return `${CAMINHOS.cache}${codigo}.svg`
}

function cacheConfere(revisao: RevisaoCommons): boolean {
  const caminho = caminhoNoCache(revisao.codigo)
  return existsSync(caminho) && sha1(readFileSync(caminho)) === revisao.sha1
}

async function principal(): Promise<void> {
  const atualizar = process.argv.includes('--atualizar')
  const { commons } = lerCuradoria()
  const codigos = commons.map((e) => e.codigo).sort()
  if (codigos.join() !== MEMBROS_EM_ORDEM.join()) {
    falhar('curadoria/commons.json não cobre exatamente os 193 membros (ou repete código)')
  }

  const revisoesFixadas = new Map(
    ((lerJsonSeExistir(`${CAMINHOS.gerado}commons-revisoes.json`) as RevisaoCommons[] | undefined) ?? []).map((r) => [
      r.codigo,
      r,
    ]),
  )
  const licencasFixadas = new Map(
    ((lerJsonSeExistir(`${CAMINHOS.gerado}licencas.json`) as Licenca[] | undefined) ?? []).map((l) => [l.codigo, l]),
  )

  // Fixado = mesma entrada de título nas duas fontes. Título trocado em commons.json conta como novo e é consultado.
  const fixado = (e: EntradaCommons): boolean =>
    !atualizar &&
    revisoesFixadas.get(e.codigo)?.titulo === e.titulo &&
    licencasFixadas.get(e.codigo)?.titulo === e.titulo
  const aConsultar = commons.filter((e) => !fixado(e))
  console.log(
    `${String(commons.length - aConsultar.length)} fixados sem consulta, ${String(aConsultar.length)} a consultar` +
      (atualizar ? ' (--atualizar)' : ''),
  )
  const consultados = await consultar(aConsultar)

  const revisoes: RevisaoCommons[] = []
  const licencas: Licenca[] = []
  for (const codigo of MEMBROS_EM_ORDEM) {
    const novo = consultados.get(codigo)
    const revisao = novo?.revisao ?? revisoesFixadas.get(codigo)
    const licenca = novo?.licenca ?? licencasFixadas.get(codigo)
    if (revisao === undefined || licenca === undefined) falhar(`${codigo}: sem revisão nem licença`)
    const anterior = revisoesFixadas.get(codigo)
    if (novo !== undefined && anterior !== undefined && anterior.sha1 !== revisao.sha1) {
      console.log(
        `${codigo}: o arquivo mudou no Commons (${anterior.sha1} -> ${revisao.sha1}); confira a bandeira à mão`,
      )
    }
    revisoes.push(revisao)
    licencas.push(licenca)
  }

  mkdirSync(CAMINHOS.cache, { recursive: true })
  let baixados = 0
  for (const revisao of revisoes) {
    if (cacheConfere(revisao)) continue
    const conteudo = Buffer.from(await (await buscar(revisao.url)).arrayBuffer())
    const obtido = sha1(conteudo)
    if (obtido !== revisao.sha1) {
      falhar(
        `${revisao.codigo}: o sha1 baixado (${obtido}) não é o fixado (${revisao.sha1}); o arquivo mudou no ` +
          'Commons. Rode com --atualizar e confira a bandeira nova à mão antes de commitar.',
      )
    }
    writeFileSync(caminhoNoCache(revisao.codigo), conteudo)
    baixados++
    await pausa(PAUSA_ENTRE_DOWNLOADS_MS)
  }

  gravarJson(`${CAMINHOS.gerado}commons-revisoes.json`, revisoes)
  gravarJson(`${CAMINHOS.gerado}licencas.json`, licencas)
  const porLicenca = new Map<string, number>()
  for (const l of licencas) porLicenca.set(l.licenca, (porLicenca.get(l.licenca) ?? 0) + 1)
  console.log(`${String(baixados)} baixados, ${String(revisoes.length - baixados)} já no cache com sha1 conferido`)
  console.log(`licenças: ${[...porLicenca].map(([l, n]) => `${l} ${String(n)}`).join(', ')}`)
}

if (import.meta.main) await principal()
