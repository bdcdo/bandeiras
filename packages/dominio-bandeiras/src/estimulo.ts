import type { Estimulo, IdItem } from '@bandeiras/nucleo'
import { IMAGENS, type Imagem } from './dados'

const PASTA = '../imagens/'

// O Vite resolve o glob no build: cada arquivo de imagens/ vira um asset com hash no nome, e o valor é a URL final dele.
// Com `eager`, o mapa existe já na carga do módulo, sem import dinâmico; com `?url`, nenhuma imagem entra no bundle de
// JavaScript. As chaves vêm como '../imagens/br.svg' e ficam só com o nome do arquivo.
const URL_POR_ARQUIVO: ReadonlyMap<string, string> = new Map(
  Object.entries(import.meta.glob('../imagens/*', { eager: true, query: '?url', import: 'default' })).map(
    ([caminho, url]) => [caminho.slice(PASTA.length), url],
  ),
)

// O estímulo do núcleo tem uma URL só, e por isso a WebP sai na maior largura gravada: a imagem aparece grande na
// pergunta e em tela de alta densidade, e a menor serve só a um `srcset` futuro.
function arquivoDe(id: IdItem, imagem: Imagem): string {
  if (imagem.formato === 'svg') return `${id}.svg`
  return `${id}-${String(Math.max(...(imagem.larguras ?? [])))}.webp`
}

/**
 * A bandeira como imagem, com a proporção do registro para a casca reservar o espaço antes de a imagem carregar.
 *
 * Código sem imagem lança em vez de devolver estado: o teste de dados garante uma imagem por bandeira, e chegar aqui sem
 * ela é defeito de build, que nenhuma tela tem como contornar.
 */
export function estimulo(id: IdItem): Estimulo {
  const imagem = IMAGENS.get(id)
  if (imagem === undefined) throw new Error(`A bandeira '${id}' não tem registro em bandeiras.json.`)
  const arquivo = arquivoDe(id, imagem)
  const url = URL_POR_ARQUIVO.get(arquivo)
  if (url === undefined) throw new Error(`A bandeira '${id}' não tem o arquivo imagens/${arquivo}.`)
  return { tipo: 'imagem', url, proporcao: imagem.proporcao }
}
