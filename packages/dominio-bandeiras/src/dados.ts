/**
 * Os dados commitados do domínio na forma de entrada do núcleo: `DADOS_DE_CATALOGO` é o que `carregarCatalogo` recebe.
 *
 * O mapeamento mora aqui, e não no gerador. bandeiras.json é dado neutro sobre as bandeiras (código, nome, região e
 * sub-região M49), e chamar a região de categoria e a sub-região de subcategoria é decisão desta aplicação do núcleo, não
 * fato sobre as bandeiras. Se o vocabulário do núcleo mudar, muda este arquivo, e os dados gerados e o gerador ficam como
 * estão.
 */
import type { DadosDeCatalogo, ItemBruto } from '@bandeiras/nucleo'
import familias from '../curadoria/familias.json'
import vizinhancas from '../curadoria/vizinhancas.json'
import gerado from '../gerado/bandeiras.json'
import { PADROES_VISUAIS } from './classes'

/** Momento da geração de bandeiras.json; muda a cada regeneração e identifica a versão dos dados embutidos. */
export const VERSAO_DADOS: string = gerado.geradoEm

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
      // Os spreads condicionais aqui e em `itens` existem por causa de exactOptionalPropertyTypes: campo opcional aceita
      // ausência, nunca `undefined` explícito. Registro sem o campo no JSON vira objeto sem o campo.
      ...(b.imagem.larguras === undefined ? {} : { larguras: b.imagem.larguras }),
      proporcao: b.proporcao,
    },
  ]),
)

export const DADOS_DE_CATALOGO = {
  itens: gerado.bandeiras.map((b): ItemBruto => ({
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
  })),
  // Famílias e vizinhanças da curadoria já têm a forma do núcleo, campo a campo: uma família é um grupo.
  grupos: familias,
  vizinhancas,
  classes: PADROES_VISUAIS,
  categorias: gerado.regioes.map((r) => ({
    id: r.codigo,
    nome: r.nome,
    subcategorias: r.subRegioes.map((s) => ({ id: s.codigo, nome: s.nome })),
  })),
} satisfies DadosDeCatalogo
