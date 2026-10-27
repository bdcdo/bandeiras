import { erro, ok, type Resultado } from '../base/resultado'
import type { SorteioComSemente } from '../base/sorteio-com-semente'
import type { Milis } from '../base/tempo'
import type { Catalogo, IdItem } from '../catalogo/tipos'
import type { Parametros } from '../memoria/parametros'
import type { ContextoDeSessao } from './contexto-de-sessao'
import { escolherDistratores, type ModoDeDistratores } from './distratores'
import { criarQuestao, type ErroDeQuestao, type Questao } from './questao'

/**
 * Para que a questão serve, e é a fonte única desta lista. Na lição, `kp` é o knowledge point: 1 reconhece, 2 produz e 3
 * recorda. A sondagem da lição acelerada recorda primeiro e, se acertar, confirma produzindo entre parecidos. `grupo` é a
 * questão da tarefa de grupo e `diagnostico` a do diagnóstico; as duas têm geradores próprios.
 *
 * O uso vai gravado com a resposta, porque questões iguais servem a usos diferentes: a de recordar da sondagem é idêntica
 * à do KP3, até no id, e só o uso diz se a resposta mexe na memória.
 */
export type UsoDeQuestao = Readonly<
  | { tipo: 'licao'; kp: 1 | 2 | 3 }
  | { tipo: 'sondagem'; etapa: 'recordar' | 'confirmar' }
  | { tipo: 'revisao' }
  | { tipo: 'remediacao' }
  | { tipo: 'quiz' }
  | { tipo: 'discriminacao' }
  | { tipo: 'grupo' }
  | { tipo: 'diagnostico' }
>

/** O pedido a `gerarQuestao`: um uso de questão isolada, que decide o formato e os distratores, e o item perguntado. */
export type PedidoDeQuestao = Exclude<UsoDeQuestao, Readonly<{ tipo: 'grupo' | 'diagnostico' }>> &
  Readonly<{ item: IdItem }>

type Molde =
  { tipo: 'rotulo-digitado' } | { tipo: 'estimulo-para-rotulo' | 'rotulo-para-estimulo'; modo: ModoDeDistratores }

/**
 * Formato de cada uso. Lição é andaime: múltipla escolha entre dissimilares logo depois da apresentação. Revisão,
 * remediação e quiz usam texto digitado, que não se acerta ao acaso. Múltipla escolha entre parecidos fica para a
 * confirmação da sondagem e para a discriminação, em que distinguir o alvo dos parecidos é o que se testa.
 */
function moldeDe(pedido: PedidoDeQuestao): Molde {
  switch (pedido.tipo) {
    case 'licao':
      if (pedido.kp === 1) return { tipo: 'estimulo-para-rotulo', modo: 'dissimilares' }
      if (pedido.kp === 2) return { tipo: 'rotulo-para-estimulo', modo: 'dissimilares' }
      return { tipo: 'rotulo-digitado' }
    case 'sondagem':
      return pedido.etapa === 'recordar'
        ? { tipo: 'rotulo-digitado' }
        : { tipo: 'rotulo-para-estimulo', modo: 'parecidos' }
    case 'revisao':
    case 'remediacao':
    case 'quiz':
      return { tipo: 'rotulo-digitado' }
    case 'discriminacao':
      return { tipo: 'estimulo-para-rotulo', modo: 'parecidos' }
  }
}

// Só a recuperação de algo já aprendido é cronometrada (The Math Academy Way, p. 289): a lição é andaime, a sondagem mede
// se a pessoa já sabe sem pressa, e a discriminação ainda treina a distinção.
const ACEITAM_LIMITE: ReadonlySet<PedidoDeQuestao['tipo']> = new Set(['revisao', 'remediacao', 'quiz'])

/**
 * Gera a questão de um pedido. A múltipla escolha tem `opcoesMultiplaEscolha` opções, o alvo e os distratores de
 * `escolherDistratores`, em ordem sorteada; o texto digitado não tem opções.
 *
 * `limiteMs` vem pronto de quem chama, que o tira de `limiteCronometrado` na camada de avaliação, acima desta. Ele só cabe
 * em revisão, remediação e quiz, e precisa ser positivo; fora disso a geração devolve `LIMITE_INVALIDO`.
 *
 * O mesmo pedido, com o mesmo contexto e um sorteio no mesmo estado, gera a mesma questão, com o mesmo id.
 */
export function gerarQuestao(
  pedido: PedidoDeQuestao,
  catalogo: Catalogo,
  ctx: ContextoDeSessao,
  sorteio: SorteioComSemente,
  parametros: Parametros,
  limiteMs?: Milis,
): Resultado<Questao, ErroDeQuestao> {
  const { item } = pedido
  if (!catalogo.itens.has(item)) return erro({ codigo: 'ITEM_INEXISTENTE', detalhe: `item que não existe: '${item}'` })
  if (limiteMs !== undefined && !ACEITAM_LIMITE.has(pedido.tipo)) {
    return erro({ codigo: 'LIMITE_INVALIDO', detalhe: `questão de ${pedido.tipo} não é cronometrada` })
  }
  if (limiteMs !== undefined && !(Number.isFinite(limiteMs) && limiteMs > 0)) {
    return erro({ codigo: 'LIMITE_INVALIDO', detalhe: `limite que não é positivo: ${String(limiteMs)}` })
  }
  const molde = moldeDe(pedido)
  if (molde.tipo === 'rotulo-digitado') return ok(criarQuestao(item, molde, { tipo: 'isolada' }, limiteMs))
  const distratores = escolherDistratores(
    item,
    molde.modo,
    parametros.opcoesMultiplaEscolha - 1,
    catalogo,
    ctx,
    sorteio,
    parametros,
  )
  if (!distratores.ok) return distratores
  const opcoes = sorteio.embaralhar([item, ...distratores.valor])
  return ok(criarQuestao(item, { tipo: molde.tipo, opcoes }, { tipo: 'isolada' }, limiteMs))
}
