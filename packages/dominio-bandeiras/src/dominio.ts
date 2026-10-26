import {
  carregarCatalogo,
  TECNICAS_TODAS_LIGADAS,
  type Catalogo,
  type Dominio,
  type ErroDeCatalogo,
  type Resultado,
} from '@bandeiras/nucleo'
import { DADOS_DE_CATALOGO } from './dados'
import { estimulo } from './estimulo'
import { VOCABULARIO } from './vocabulario'

// Os dados são fixos no build, então a validação roda uma vez e o resultado, sucesso ou erro, vale para todas as
// chamadas. Guardar o objeto também dá à casca sempre o mesmo catálogo, e comparar por referência basta para ela.
let carregado: Resultado<Catalogo, ErroDeCatalogo> | undefined

/**
 * As 193 bandeiras da ONU como aplicação do núcleo. `catalogo()` é o único caminho que chama `carregarCatalogo` para
 * este domínio.
 *
 * Sem `parametros`: valem os padrões do modelo de memória. Um ajuste por domínio entra aqui quando houver medida que o
 * justifique.
 */
export const dominio: Dominio = {
  id: 'bandeiras-onu',
  catalogo() {
    carregado ??= carregarCatalogo(DADOS_DE_CATALOGO)
    return carregado
  },
  tecnicas: TECNICAS_TODAS_LIGADAS,
  vocabulario: VOCABULARIO,
  estimulo,
}
