import type { Instante } from '../base/tempo'
import type { IdTopico } from '../grafo/topico'
import type { EstadoMemoria, QualidadeDeResposta } from '../memoria'
import { NORMAS_DE_LATENCIA_VAZIAS, type NormasDeLatencia } from '../avaliacao'
import type { DiaLocal } from '../gamificacao'
import type { EventoDoTipo } from '../eventos'
import type { ContextoDeReducao } from './contexto'
import type {
  EstadoDoDiagnostico,
  EstadoMotor,
  MotivoDeAbsorcao,
  SessaoAberta,
  StatusLicao,
  TarefaAberta,
} from './tipos'

// O rascunho é o estado com os contêineres abertos à escrita. `reduzir` monta um a partir do estado, aplica um evento e
// devolve o estado novo; `reconstruir` monta um no perfil e aplica a época inteira nele. Os dois passam pela mesma
// `aplicarNoRascunho`, e por isso o estado vivo e o reconstruído são iguais por construção.
//
// Cada mapa é copiado do estado só na primeira escrita: o estado recebido por `reduzir` fica intacto, e um evento que
// só conta não copia nada. Na reconstrução, os mapas nascem do rascunho e são escritos no lugar a época inteira. Os
// valores dentro dos mapas, como `EstadoMemoria`, `TarefaAberta` e o contexto de sessão, são imutáveis e trocados
// inteiros; só os mapas do rascunho mudam no lugar.

/**
 * Quem a redução avisa ao absorver um evento, inteiro ou em parte. `reconstruir` conta os motivos no relato; `reduzir`
 * não tem relato e passa uma função que não faz nada.
 */
export type Absorver = (motivo: MotivoDeAbsorcao) => void

/** Um mapa do rascunho: o atual e, depois da primeira escrita, a cópia própria, que passa a ser o atual. */
export type Copiavel<K, V> = { atual: ReadonlyMap<K, V>; proprio: Map<K, V> | undefined }

const doEstado = <K, V>(m: ReadonlyMap<K, V>): Copiavel<K, V> => ({ atual: m, proprio: undefined })

function vazio<K, V>(): Copiavel<K, V> {
  const m = new Map<K, V>()
  return { atual: m, proprio: m }
}

/** O mapa para escrita, copiado do atual na primeira vez. */
export function escrever<K, V>(c: Copiavel<K, V>): Map<K, V> {
  if (c.proprio === undefined) {
    c.proprio = new Map(c.atual)
    c.atual = c.proprio
  }
  return c.proprio
}

export type Rascunho = {
  versaoModelo: number
  catalogoHash: string
  semente: string
  inicioDaEpoca: Instante
  ultimoEm: Instante
  nEventos: number
  ultimoEventoId: string
  diagnostico: EstadoDoDiagnostico
  memorias: Copiavel<IdTopico, EstadoMemoria>
  licoes: Copiavel<IdTopico, StatusLicao>
  /**
   * Tópicos de lição concluída, derivado de `licoes` na primeira consulta (`concluidos`). Só se usa para saber se um
   * tópico está nele, nunca para percorrer: a ordem dele depende de quando foi derivado, e a do estado não pode depender.
   */
  concluidos: Set<IdTopico> | undefined
  sessao: SessaoAberta | undefined
  sessoesIniciadas: number
  tarefa: TarefaAberta | undefined
  normas: NormasDeLatencia
  ultimasQualidades: readonly QualidadeDeResposta[]
  confusoes: Copiavel<string, number>
  confusoesRemediadas: Copiavel<string, number>
  xpPorDia: Copiavel<DiaLocal, number>
  metaPorDia: Copiavel<DiaLocal, number>
  metaDiariaXp: number
}

/**
 * O rascunho do perfil que abre uma época: tudo zerado, com a semente, o catálogo e a versão do evento, o instante dele
 * como início e último, um evento contado e a meta padrão. Nada atravessa a fronteira de um reinício, nem a meta: quem
 * quiser mantê-la emite a alteração de novo depois do reinício.
 */
export function rascunhoDoPerfil(
  ctx: ContextoDeReducao,
  e: EventoDoTipo<'perfil-criado' | 'perfil-reiniciado'>,
): Rascunho {
  return {
    versaoModelo: e.versaoModelo,
    catalogoHash: e.catalogoHash,
    semente: e.semente,
    inicioDaEpoca: e.em,
    ultimoEm: e.em,
    nEventos: 1,
    ultimoEventoId: e.id,
    diagnostico: 'nao-iniciado',
    memorias: vazio(),
    licoes: vazio(),
    concluidos: new Set(),
    sessao: undefined,
    sessoesIniciadas: 0,
    tarefa: undefined,
    normas: NORMAS_DE_LATENCIA_VAZIAS,
    ultimasQualidades: [],
    confusoes: vazio(),
    confusoesRemediadas: vazio(),
    xpPorDia: vazio(),
    metaPorDia: vazio(),
    metaDiariaXp: ctx.parametros.orcamentoPadraoMin,
  }
}

/** O rascunho de um estado, sem copiar nada: cada mapa só se copia quando for escrito. */
export function rascunhoDe(estado: EstadoMotor): Rascunho {
  return {
    ...estado,
    memorias: doEstado(estado.memorias),
    licoes: doEstado(estado.licoes),
    concluidos: undefined,
    sessao: estado.sessao,
    tarefa: estado.tarefa,
    confusoes: doEstado(estado.confusoes),
    confusoesRemediadas: doEstado(estado.confusoesRemediadas),
    xpPorDia: doEstado(estado.xpPorDia),
    metaPorDia: doEstado(estado.metaPorDia),
  }
}

/** Os tópicos de lição concluída do rascunho. */
export function concluidos(r: Rascunho): Set<IdTopico> {
  r.concluidos ??= new Set([...r.licoes.atual].flatMap(([t, s]) => (s.status === 'concluida' ? [t] : [])))
  return r.concluidos
}

/** O estado que o rascunho descreve. A sessão e a tarefa só aparecem quando abertas. */
export function estadoDe(r: Rascunho): EstadoMotor {
  const { sessao, tarefa } = r
  return {
    versaoModelo: r.versaoModelo,
    catalogoHash: r.catalogoHash,
    semente: r.semente,
    inicioDaEpoca: r.inicioDaEpoca,
    ultimoEm: r.ultimoEm,
    nEventos: r.nEventos,
    ultimoEventoId: r.ultimoEventoId,
    diagnostico: r.diagnostico,
    memorias: r.memorias.atual,
    licoes: r.licoes.atual,
    ...(sessao === undefined ? {} : { sessao }),
    sessoesIniciadas: r.sessoesIniciadas,
    ...(tarefa === undefined ? {} : { tarefa }),
    normas: r.normas,
    ultimasQualidades: r.ultimasQualidades,
    confusoes: r.confusoes.atual,
    confusoesRemediadas: r.confusoesRemediadas.atual,
    xpPorDia: r.xpPorDia.atual,
    metaPorDia: r.metaPorDia.atual,
    metaDiariaXp: r.metaDiariaXp,
  }
}
