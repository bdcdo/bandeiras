import type { Resultado } from '../base/resultado'
import type { ErroDeCatalogo } from './carregar-catalogo'
import type { Tecnicas } from './tecnicas'
import type { Catalogo, IdItem } from './tipos'

/** O que a casca mostra para um item. O núcleo nunca o lê: só o domínio o produz e só a casca o renderiza. */
export type Estimulo = { tipo: 'imagem'; url: string; proporcao: number } | { tipo: 'texto'; texto: string }

/** Palavras com que a casca nomeia o conteúdo, para nenhuma string de domínio morar fora do domínio. */
export type Vocabulario = Readonly<
  Record<
    | 'item'
    | 'itens'
    | 'rotulo'
    | 'rotulos'
    | 'grupo'
    | 'grupos'
    | 'categoria'
    | 'perguntaReconhecer'
    | 'perguntaProduzir'
    | 'perguntaRecordar'
    | 'tituloCatalogo',
    string
  >
>

/**
 * Ajustes do domínio aos parâmetros do modelo de memória, como pares nome-valor planos. O tipo não restringe as chaves
 * porque os parâmetros moram na camada `memoria`, acima desta; é ela que valida cada chave contra os parâmetros do
 * modelo e recusa a que não existir.
 */
export type AjustesDeParametros = Readonly<Record<string, number>>

/** A aplicação do núcleo a um conteúdo: o catálogo, as técnicas ligadas, o vocabulário e como mostrar cada item. */
export interface Dominio {
  id: string
  catalogo(): Resultado<Catalogo, ErroDeCatalogo>
  tecnicas: Tecnicas
  parametros?: AjustesDeParametros
  vocabulario: Vocabulario
  estimulo(id: IdItem): Estimulo
}
