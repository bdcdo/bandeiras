import { erro, ok, type Resultado } from '../base/resultado'
import { serializarCanonico } from '../base/serializacao'
import { compararEventos, VERSAO_MODELO, type Evento, type EventoDoTipo } from '../eventos'
import { ehTipoDeEvento, lerEnvelope, lerEventoSemId, type EnvelopeLido } from '../eventos/ler-evento'
import { aplicarNoRascunho } from './aplicar'
import type { ContextoDeReducao } from './contexto'
import { estadoDe, rascunhoDoPerfil } from './rascunho'
import type { ErroDeReconstrucao, MotivoDeAbsorcao, Reconstrucao } from './tipos'

type Entrada = Readonly<{ indice: number; envelope: EnvelopeLido; valor: unknown }>
type Ocorrencia = ErroDeReconstrucao['ocorrencias'][number]

/** O id do valor, quando ele é um objeto com `id` de texto, para a ocorrência apontar o evento mesmo malformado. */
function idLegivel(valor: unknown): Readonly<{ id?: string }> {
  if (typeof valor !== 'object' || valor === null) return {}
  const id = (valor as Readonly<Record<string, unknown>>)['id']
  return typeof id === 'string' ? { id } : {}
}

function falha(
  codigo: ErroDeReconstrucao['codigo'],
  ocorrencias: readonly Ocorrencia[],
): { ok: false; erro: ErroDeReconstrucao } {
  const detalhe = `${String(ocorrencias.length)} evento(s): ${ocorrencias.map((o) => `[${String(o.indice)}] ${o.motivo}`).join('; ')}`
  return erro({ codigo, detalhe, ocorrencias })
}

/**
 * Uma entrada por id. Cópias do mesmo conteúdo canônico contam como duplicadas; um id com mais de um conteúdo conta uma
 * vez em `divergentes` e fica com o de menor serialização canônica, para o resultado não depender da ordem de entrada
 * nem no caso corrompido. As duas contagens saem do conjunto de conteúdos de cada id, e por isso também não dependem da
 * ordem. Só os ids repetidos são serializados.
 */
function deduplicar(
  entradas: readonly Entrada[],
): Readonly<{ unicas: Entrada[]; duplicados: number; divergentes: number }> {
  const porId = new Map<string, Entrada>()
  const repetidos = new Map<string, Map<string, Entrada>>()
  for (const entrada of entradas) {
    const { id } = entrada.envelope
    const primeira = porId.get(id)
    if (primeira === undefined) {
      porId.set(id, entrada)
      continue
    }
    let conteudos = repetidos.get(id)
    if (conteudos === undefined) {
      conteudos = new Map([[serializarCanonico(primeira.valor), primeira]])
      repetidos.set(id, conteudos)
    }
    const texto = serializarCanonico(entrada.valor)
    if (!conteudos.has(texto)) conteudos.set(texto, entrada)
  }
  let duplicados = entradas.length - porId.size
  let divergentes = 0
  for (const [id, conteudos] of repetidos) {
    duplicados -= conteudos.size - 1
    if (conteudos.size === 1) continue
    divergentes += 1
    const menor = [...conteudos.keys()].sort()[0]
    const escolhida = menor === undefined ? undefined : conteudos.get(menor)
    if (escolhida !== undefined) porId.set(id, escolhida)
  }
  return { unicas: [...porId.values()], duplicados, divergentes }
}

/**
 * Refaz o estado a partir do log, em qualquer ordem e com cópias, e devolve o estado com o relato. As regras vão em
 * ordem, e a primeira violada devolve o erro com todas as ocorrências dela:
 *
 * 1. Todo envelope se lê (`EVENTO_MALFORMADO`).
 * 2. Há um perfil (`SEM_PERFIL`). A época começa no último `perfil-reiniciado` na ordem do log ou, sem nenhum, no
 *    primeiro `perfil-criado`: dois aparelhos usados sem conta e depois unidos têm dois perfis criados, e a época do mais
 *    antigo guarda o estudo dos dois. O que vem antes da época é ignorado e só conta no relato.
 * 3. Nada na época é de versão futura (`VERSAO_DE_MODELO_FUTURA`): o perfil com versão acima de `VERSAO_MODELO`, ou um
 *    tipo que esta versão não conhece. Pela regra aditiva da união, tipo desconhecido só nasce de app mais novo noutro
 *    aparelho, e chamá-lo de malformado levaria a pessoa a zerar o progresso por ter o app desatualizado.
 * 4. Todo corpo da época se lê (`EVENTO_MALFORMADO`).
 *
 * Depois disso a reconstrução não falha: o catálogo do contexto vale, mesmo que não seja o do perfil, e a referência a
 * item ou tópico que ele não tem é absorvida, com o motivo no relato. O id gravado não é recalculado: o leitor confere o
 * formato, e a deduplicação confia nele.
 */
export function reconstruir(
  ctx: ContextoDeReducao,
  eventos: readonly unknown[],
): Resultado<Reconstrucao, ErroDeReconstrucao> {
  const entradas: Entrada[] = []
  const malformados: Ocorrencia[] = []
  eventos.forEach((valor, indice) => {
    const lido = lerEnvelope(valor)
    if (lido.ok) entradas.push({ indice, envelope: lido.valor, valor })
    else malformados.push({ indice, ...idLegivel(valor), motivo: lido.erro.motivo })
  })
  if (malformados.length > 0) return falha('EVENTO_MALFORMADO', malformados)

  const { unicas, duplicados, divergentes } = deduplicar(entradas)
  unicas.sort((a, b) => compararEventos(a.envelope, b.envelope))
  const reinicio = unicas.findLastIndex((e) => e.envelope.tipo === 'perfil-reiniciado')
  const inicio = reinicio >= 0 ? reinicio : unicas.findIndex((e) => e.envelope.tipo === 'perfil-criado')
  if (inicio < 0) {
    return erro({ codigo: 'SEM_PERFIL', detalhe: 'o log não tem perfil-criado nem perfil-reiniciado', ocorrencias: [] })
  }
  const epoca = unicas.slice(inicio)

  const futuras = epoca.flatMap(({ indice, envelope, valor }): Ocorrencia[] => {
    const { id, tipo } = envelope
    if (!ehTipoDeEvento(tipo)) return [{ indice, id, motivo: `tipo que esta versão não conhece: '${tipo}'` }]
    if (tipo !== 'perfil-criado' && tipo !== 'perfil-reiniciado') return []
    const versao = (valor as Readonly<Record<string, unknown>>)['versaoModelo']
    return typeof versao === 'number' && versao > VERSAO_MODELO
      ? [{ indice, id, motivo: `perfil de versão ${String(versao)}, acima da ${String(VERSAO_MODELO)} desta` }]
      : []
  })
  if (futuras.length > 0) return falha('VERSAO_DE_MODELO_FUTURA', futuras)

  const lidos: Evento[] = []
  const corrompidos: Ocorrencia[] = []
  for (const { indice, envelope, valor } of epoca) {
    const lido = lerEventoSemId(valor)
    if (lido.ok) lidos.push({ id: envelope.id, ...lido.valor })
    else corrompidos.push({ indice, id: envelope.id, motivo: lido.erro.motivo })
  }
  if (corrompidos.length > 0) return falha('EVENTO_MALFORMADO', corrompidos)

  const [perfil, ...resto] = lidos as [EventoDoTipo<'perfil-criado' | 'perfil-reiniciado'>, ...Evento[]]
  const absorvidos: Partial<Record<MotivoDeAbsorcao, number>> = {}
  const absorver = (motivo: MotivoDeAbsorcao): void => {
    absorvidos[motivo] = (absorvidos[motivo] ?? 0) + 1
  }
  const r = rascunhoDoPerfil(ctx, perfil)
  for (const evento of resto) aplicarNoRascunho(ctx, r, evento, absorver)
  return ok({
    estado: estadoDe(r),
    relato: {
      duplicados,
      divergentes,
      anterioresAEpoca: inicio,
      catalogoTrocado: perfil.catalogoHash !== ctx.catalogo.hash,
      absorvidos,
    },
  })
}
