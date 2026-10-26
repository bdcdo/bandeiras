/**
 * Como a imagem de cada bandeira foi gravada em imagens/, lido de bandeiras.json.
 *
 * Mora fora de dados.ts de propósito. O mapa nasce na carga do módulo e lança diante de um formato desconhecido; em
 * dados.ts, esse lançamento derrubaria a carga do teste de dados, que importa `DADOS_DE_CATALOGO`, e nenhum
 * invariante dele chegaria a rodar, nem o que acusa o formato. Aqui, o defeito reprova só quem usa as imagens.
 */
import gerado from '../gerado/bandeiras.json'

export type FormatoDeImagem = 'svg' | 'webp'

/** Como a imagem de uma bandeira foi gravada em imagens/, e a proporção (largura sobre altura) da bandeira. */
export type Imagem = { formato: FormatoDeImagem; larguras?: readonly number[]; proporcao: number }

// O JSON importado tipa `formato` como string qualquer. O teste de dados garante que todo registro commitado é svg ou
// webp; este estreitamento só converte o tipo, e lançar aqui é defeito de geração que chegou ao build.
function formatoDe(codigo: string, formato: string): FormatoDeImagem {
  if (formato === 'svg' || formato === 'webp') return formato
  throw new Error(`A bandeira '${codigo}' declara o formato de imagem '${formato}', que não é svg nem webp.`)
}

/**
 * Imagem de cada bandeira, por código. O estímulo do núcleo leva uma URL só; `larguras` fica aqui para a casca montar um
 * `srcset` se o tipo do estímulo crescer.
 */
export const IMAGENS: ReadonlyMap<string, Imagem> = new Map(
  gerado.bandeiras.map((b) => [
    b.codigo,
    {
      formato: formatoDe(b.codigo, b.imagem.formato),
      // Spread condicional pelo mesmo motivo do `tracoVizinhanca` em dados.ts: exactOptionalPropertyTypes.
      ...(b.imagem.larguras === undefined ? {} : { larguras: b.imagem.larguras }),
      proporcao: b.proporcao,
    },
  ]),
)
