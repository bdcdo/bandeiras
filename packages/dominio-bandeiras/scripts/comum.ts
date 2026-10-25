/**
 * Caminhos, formatos de arquivo e leitura de JSON compartilhados pelos scripts do gerador. Não roda sozinho.
 *
 * Os tipos abaixo descrevem os arquivos de curadoria/ e gerado/ como os scripts os leem e gravam. O teste de dados
 * valida o conteúdo; aqui a leitura só afirma o formato, porque quem escreve curadoria/ é gente e quem escreve gerado/
 * são estes mesmos scripts.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const PACOTE = new URL('../', import.meta.url)

export const CAMINHOS = {
  curadoria: fileURLToPath(new URL('curadoria/', PACOTE)),
  gerado: fileURLToPath(new URL('gerado/', PACOTE)),
  imagens: fileURLToPath(new URL('imagens/', PACOTE)),
  // Originais baixados do Commons. Fora do Git (.gitignore da raiz): o repositório guarda só a cópia processada, e a
  // revisão de cada original fica fixada por sha1 em gerado/commons-revisoes.json.
  cache: fileURLToPath(new URL('.cache/commons/', PACOTE)),
  raizDoRepositorio: fileURLToPath(new URL('../../', PACOTE)),
  textosDeLicenca: fileURLToPath(new URL('scripts/licencas/', PACOTE)),
} as const

export type EntradaCommons = { codigo: string; titulo: string; motivo?: string }

export type Nomes = {
  overrides: Record<string, { nome: string; motivo: string }>
  aliases: Record<string, string[]>
}

export type RegioesM49 = {
  fonte: { url: string; consultadoEm: string; nota: string }
  /** Override de nome de região ou sub-região, por código numérico, para quando o ICU não tiver nome. */
  nomesDeRegiao?: Record<string, { nome: string; motivo: string }>
  paises: Record<string, { regiao: string; subRegiao: string }>
}

export type Familia = {
  id: string
  nome: string
  membros: string[]
  tracoDistintivo: Record<string, string>
  paresIndiscerniveis?: [string, string][]
}

export type Vizinhanca = { id: string; nome: string; membros: string[]; tracoDistintivo: Record<string, string> }

export type Fora = { motivo: string; codigos: string[] }

export type Descricao = { codigo: string; classe: string; descricao: string }

export type OverridesDeDificuldade = Record<string, { dificuldade: 1 | 2 | 3; motivo: string }>

export type RevisaoCommons = { codigo: string; titulo: string; sha1: string; timestamp: string; url: string }

export type Licenca = {
  codigo: string
  titulo: string
  autor: string
  licenca: string
  /** null quando o Commons não dá URL de licença, o caso do domínio público. */
  urlLicenca: string | null
  urlPagina: string
}

/** Vizinhos de cada bandeira, na ordem em que a casca e o núcleo devem consultá-los. */
export type Vizinhos = Record<string, string[]>

/** Devolve unknown: quem chama afirma o formato com `as`, porque o arquivo é deste pacote (ver o cabeçalho). */
export function lerJson(caminho: string): unknown {
  return JSON.parse(readFileSync(caminho, 'utf8'))
}

/** Lê se existir; ausência é estado normal (primeira execução), não erro. */
export function lerJsonSeExistir(caminho: string): unknown {
  return existsSync(caminho) ? lerJson(caminho) : undefined
}

/** Grava com indentação de 2 e quebra de linha final, o formato que o diff de regeneração lê. */
export function gravarJson(caminho: string, dado: unknown): void {
  mkdirSync(dirname(caminho), { recursive: true })
  writeFileSync(caminho, JSON.stringify(dado, null, 2) + '\n')
}

export function lerCuradoria() {
  const c = CAMINHOS.curadoria
  return {
    commons: lerJson(c + 'commons.json') as EntradaCommons[],
    nomes: lerJson(c + 'nomes.json') as Nomes,
    regioes: lerJson(c + 'regioes-m49.json') as RegioesM49,
    familias: lerJson(c + 'familias.json') as Familia[],
    vizinhancas: lerJson(c + 'vizinhancas.json') as Vizinhanca[],
    fora: lerJson(c + 'fora.json') as Fora,
    descricoes: lerJson(c + 'descricoes.json') as Descricao[],
    dificuldade: lerJson(c + 'dificuldade.json') as OverridesDeDificuldade,
  }
}

/** Falha com mensagem; os scripts param no primeiro problema em vez de gravar um conjunto parcial. */
export function falhar(mensagem: string): never {
  console.error(`erro: ${mensagem}`)
  process.exit(1)
}

export function pausa(ms: number): Promise<void> {
  return new Promise((resolver) => setTimeout(resolver, ms))
}
