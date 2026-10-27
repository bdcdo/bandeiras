import { hashFnv1a } from '../base/hash'
import { erro, ok, type Resultado } from '../base/resultado'
import { serializarCanonico } from '../base/serializacao'
import { lerEventoSemId } from './ler-evento'
import type { CabecalhoDeEvento, CorpoDeEvento, Evento, EventoSemId, TarefaRegistrada } from './tipos'

/** O que `criarEvento` devolve quando o corpo, ou o cabeçalho, não passa no leitor. */
export type ErroDeLeitura = Readonly<{ codigo: 'EVENTO_MALFORMADO'; detalhe: string }>

/**
 * Id do evento: o FNV-1a de 64 bits da serialização canônica de todo o conteúdo, o cabeçalho inclusive. Com só os campos
 * identificadores, duas respostas diferentes dadas em duas abas do mesmo navegador no mesmo milissegundo teriam o mesmo
 * id, e a união por id descartaria uma em silêncio; com o conteúdo inteiro, o id repetido é o mesmo evento.
 *
 * A serialização ordena as chaves, então o id não depende da ordem em que elas foram escritas, nem da que o jsonb do
 * servidor devolve. `criarEvento` é quem o calcula; a reconstrução não o recalcula, só confere o formato.
 */
export function idDeEvento(semId: EventoSemId): string {
  return hashFnv1a(serializarCanonico(semId))
}

/**
 * Fabrica o evento: lê o cabeçalho e o corpo pelo mesmo leitor do log, e calcula o id sobre a saída dele, que só tem os
 * campos conhecidos. Assim o id cobre exatamente o conteúdo que a leitura devolve, e o evento que sai daqui passa no
 * leitor. Devolve `EVENTO_MALFORMADO` com o motivo para o que o leitor recusa, como um instante fracionário ou um texto
 * com U+0000.
 */
export function criarEvento(cabecalho: CabecalhoDeEvento, corpo: CorpoDeEvento): Resultado<Evento, ErroDeLeitura> {
  const lido = lerEventoSemId({ ...cabecalho, ...corpo })
  if (!lido.ok) return erro({ codigo: 'EVENTO_MALFORMADO', detalhe: `${lido.erro.parte}: ${lido.erro.motivo}` })
  return ok({ id: idDeEvento(lido.valor), ...lido.valor })
}

/**
 * Id da tarefa registrada, pela mesma regra do evento: o FNV-1a da serialização canônica da tarefa sem o id. A mesma
 * tarefa montada de novo, na reconstrução ou em outro aparelho, tem o mesmo id.
 */
export function idDeTarefa(semId: Omit<TarefaRegistrada, 'id'>): string {
  return hashFnv1a(serializarCanonico(semId))
}
