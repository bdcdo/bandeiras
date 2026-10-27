import type { NaoVazio } from '../base/nao-vazio'
import { erro, ok, type Resultado } from '../base/resultado'
import type { Instante, Milis, Minutos } from '../base/tempo'
import { DIRECOES, type IdGrupo, type IdItem } from '../catalogo/tipos'
import { topicoDeGrupo, topicoDeItem, type IdTopico } from '../grafo/topico'
import { QUALIDADES_DE_RESPOSTA, type QualidadeDeResposta } from '../memoria'
import type {
  Avaliacao,
  LigacaoDeAssociacao,
  QualidadeDeAcerto,
  QualidadeDeErro,
  RespostaDeAssociacao,
} from '../avaliacao'
import {
  FORMATOS_DE_QUESTAO,
  TIPOS_DE_TAREFA,
  type ContextoDeQuestao,
  type FormatoDeQuestao,
  type Questao,
  type UsoDeQuestao,
} from '../questoes'
import { ehTextoSeguro } from './texto-seguro'
import {
  MOTIVOS_DE_FIM_DE_SESSAO,
  MOTIVOS_DE_FIM_DO_DIAGNOSTICO,
  MOTIVOS_DE_REMEDIACAO,
  TIPOS_DE_EVENTO,
  type CorpoDeResposta,
  type CorpoDoTipo,
  type Evento,
  type EventoSemId,
  type PassoRegistrado,
  type TarefaRegistrada,
  type TipoDeEvento,
} from './tipos'

// Leitor de eventos escrito à mão: o núcleo não tem dependências, e a casca valida só o envelope. O leitor é a linha
// entre o evento malformado, que a reconstrução recusa, e o válido que não combina com o estado, que o redutor absorve.
// Por isso ele barra tudo o que faria uma função das camadas de baixo lançar ou devolver NaN, e deixa passar o que só o
// estado sabe julgar: referência ao catálogo, escolhida fora das opções, avaliação que outra régua daria.
//
// A leitura devolve um objeto novo só com os campos conhecidos, e o id do evento é calculado sobre essa saída. Campo a
// mais, Map, NaN ou função nunca chegam ao hash, que assim cobre exatamente o conteúdo válido.
//
// Mecânica: cada leitor de campo recebe a `Leitura` em curso e devolve o valor lido. No primeiro problema, ele anota o
// caminho e o motivo e devolve um valor de enchimento, que nunca sai daqui, porque as funções exportadas conferem o
// problema antes de devolver. Assim a leitura de um evento válido não aloca um `Resultado` por campo, o que conta na
// reconstrução de um log de 100 mil eventos.

/** Onde a leitura parou: no envelope, num tipo que esta versão não conhece, ou no corpo de um tipo conhecido. */
export type ProblemaDeLeitura = Readonly<{ parte: 'envelope' | 'tipo-desconhecido' | 'corpo'; motivo: string }>

/** O envelope de um evento lido sem o corpo, para a reconstrução ordenar e achar a época antes de ler os corpos. */
export type EnvelopeLido = Readonly<{
  id: string
  tipo: string
  em: Instante
  dispositivo: string
  fusoMinutos: number
}>

type Leitura = { problema: string | undefined }
// As duas leem e escrevem `problema` por função, e não no lugar: o compilador estreitaria o campo pelo literal ou por
// uma conferência anterior e não veria que os leitores o mudam por referência, e daria por sempre falsa a conferência
// seguinte.
const novaLeitura = (): Leitura => ({ problema: undefined })
const problemaDe = (l: Leitura): string | undefined => l.problema
type Registro = Readonly<Record<string, unknown>>

const VAZIO: Registro = Object.freeze({})
// Fuso extremo da convenção de getTimezoneOffset: um dia inteiro para cada lado.
const FUSO_MAXIMO_MINUTOS = 1440
const ID_DE_EVENTO = /^[0-9a-f]{16}$/
const PREFIXOS_DE_TOPICO = [topicoDeItem('' as IdItem).id, topicoDeGrupo('' as IdGrupo).id] as const

// O lado de cada qualidade, conferido pelo compilador contra `QualidadeDeAcerto`: mover uma qualidade de lado em
// avaliacao/tipos.ts sem mexer aqui não compila.
const EH_ACERTO: { readonly [Q in QualidadeDeResposta]: Q extends QualidadeDeAcerto ? true : false } = {
  perfeita: true,
  boa: true,
  lenta: true,
  errada: false,
  chute: false,
  'nao-sei': false,
  'tempo-esgotado': false,
}

function falhar(l: Leitura, onde: string, motivo: string): void {
  l.problema ??= `${onde}: ${motivo}`
}

function registro(l: Leitura, v: unknown, onde: string): Registro {
  if (typeof v === 'object' && v !== null && !Array.isArray(v)) return v as Registro
  falhar(l, onde, 'não é objeto')
  return VAZIO
}

function lista(l: Leitura, v: unknown, onde: string): readonly unknown[] {
  if (Array.isArray(v)) return v
  falhar(l, onde, 'não é lista')
  return []
}

function naoVazia<T>(l: Leitura, xs: readonly T[], onde: string): NaoVazio<T> {
  if (xs.length === 0) falhar(l, onde, 'lista vazia')
  return xs as NaoVazio<T>
}

function texto(l: Leitura, v: unknown, onde: string): string {
  if (typeof v === 'string') return v
  falhar(l, onde, 'não é texto')
  return ''
}

function textoNaoVazio(l: Leitura, v: unknown, onde: string): string {
  const t = texto(l, v, onde)
  if (t === '') falhar(l, onde, 'texto vazio')
  return t
}

/** Texto que vem de fora do núcleo e vai ao Postgres: ver `eventos/texto-seguro.ts`. */
function textoSeguro(l: Leitura, v: unknown, onde: string): string {
  const t = texto(l, v, onde)
  if (!ehTextoSeguro(t)) falhar(l, onde, 'texto com U+0000 ou metade solta de par substituto')
  return t
}

function numero(l: Leitura, v: unknown, onde: string): number {
  if (typeof v === 'number' && Number.isFinite(v)) return v
  falhar(l, onde, 'não é número finito')
  return 0
}

function inteiroNaoNegativo(l: Leitura, v: unknown, onde: string): number {
  if (typeof v === 'number' && Number.isSafeInteger(v) && v >= 0) return v
  falhar(l, onde, 'não é inteiro seguro não negativo')
  return 0
}

function milis(l: Leitura, v: unknown, onde: string): Milis {
  const n = numero(l, v, onde)
  if (n < 0) falhar(l, onde, 'duração negativa')
  return n as Milis
}

function booleano(l: Leitura, v: unknown, onde: string): boolean {
  if (typeof v === 'boolean') return v
  falhar(l, onde, 'não é booleano')
  return false
}

function umDe<T extends string | number>(l: Leitura, v: unknown, opcoes: readonly T[], onde: string): T {
  if ((opcoes as readonly unknown[]).includes(v)) return v as T
  falhar(l, onde, `fora de ${opcoes.join(', ')}`)
  return opcoes[0] as T
}

function idItem(l: Leitura, v: unknown, onde: string): IdItem {
  return textoNaoVazio(l, v, onde) as IdItem
}

function idsDeItem(l: Leitura, v: unknown, onde: string): IdItem[] {
  return lista(l, v, onde).map((x) => idItem(l, x, onde))
}

/** Id de tópico: um dos dois prefixos de grafo/topico.ts seguido de um id não vazio. */
function idTopico(l: Leitura, v: unknown, onde: string): IdTopico {
  const t = texto(l, v, onde)
  if (!PREFIXOS_DE_TOPICO.some((p) => t.startsWith(p) && t.length > p.length)) {
    falhar(l, onde, `não é id de tópico: '${t}'`)
  }
  return t as IdTopico
}

function formato(l: Leitura, v: unknown, onde: string): FormatoDeQuestao {
  const r = registro(l, v, onde)
  const tipo = umDe(l, r['tipo'], FORMATOS_DE_QUESTAO, `${onde}.tipo`)
  switch (tipo) {
    case 'estimulo-para-rotulo':
    case 'rotulo-para-estimulo':
    case 'grupo-membros':
      return { tipo, opcoes: idsDeItem(l, r['opcoes'], `${onde}.opcoes`) }
    case 'rotulo-digitado':
      return { tipo }
    case 'associacao':
      return {
        tipo,
        linhas: lista(l, r['linhas'], `${onde}.linhas`).map((x) => idsDeItem(l, x, `${onde}.linhas`)),
        rotulos: idsDeItem(l, r['rotulos'], `${onde}.rotulos`),
      }
  }
}

function contexto(l: Leitura, v: unknown, onde: string): ContextoDeQuestao {
  const r = registro(l, v, onde)
  const tipo = umDe(l, r['tipo'], ['isolada', 'grupo'] as const, `${onde}.tipo`)
  if (tipo === 'isolada') return { tipo }
  return {
    tipo,
    grupo: textoNaoVazio(l, r['grupo'], `${onde}.grupo`) as IdGrupo,
    exibidos: idsDeItem(l, r['exibidos'], `${onde}.exibidos`),
  }
}

/** A questão, com a coerência entre `alvo` e `itemAlvo`: o redutor lê o alvo, e os dois não podem discordar. */
function questao(l: Leitura, v: unknown, onde: string): Questao {
  const r = registro(l, v, onde)
  const itemAlvo = idItem(l, r['itemAlvo'], `${onde}.itemAlvo`)
  const alvo = idTopico(l, r['alvo'], `${onde}.alvo`)
  if (alvo !== topicoDeItem(itemAlvo).id) falhar(l, `${onde}.alvo`, `não é o tópico de '${itemAlvo}'`)
  const lida = {
    id: textoNaoVazio(l, r['id'], `${onde}.id`),
    alvo,
    itemAlvo,
    formato: formato(l, r['formato'], `${onde}.formato`),
    contexto: contexto(l, r['contexto'], `${onde}.contexto`),
  }
  return r['limiteMs'] === undefined ? lida : { ...lida, limiteMs: milis(l, r['limiteMs'], `${onde}.limiteMs`) }
}

// Um leitor por tipo de uso: o registro exige uma entrada para cada um, e um uso novo em questoes/ sem leitor aqui não
// compila.
const LEITORES_DE_USO: { readonly [T in UsoDeQuestao['tipo']]: (l: Leitura, r: Registro) => UsoDeQuestao } = {
  licao: (l, r) => ({ tipo: 'licao', kp: umDe(l, r['kp'], [1, 2, 3] as const, 'uso.kp') }),
  sondagem: (l, r) => ({
    tipo: 'sondagem',
    etapa: umDe(l, r['etapa'], ['recordar', 'confirmar'] as const, 'uso.etapa'),
  }),
  revisao: () => ({ tipo: 'revisao' }),
  remediacao: () => ({ tipo: 'remediacao' }),
  quiz: () => ({ tipo: 'quiz' }),
  discriminacao: () => ({ tipo: 'discriminacao' }),
  grupo: () => ({ tipo: 'grupo' }),
  diagnostico: () => ({ tipo: 'diagnostico' }),
}
const TIPOS_DE_USO = Object.keys(LEITORES_DE_USO) as readonly UsoDeQuestao['tipo'][]

function uso(l: Leitura, v: unknown, onde: string): UsoDeQuestao {
  const r = registro(l, v, onde)
  return LEITORES_DE_USO[umDe(l, r['tipo'], TIPOS_DE_USO, `${onde}.tipo`)](l, r)
}

function avaliacao(l: Leitura, v: unknown, onde: string): Avaliacao {
  const r = registro(l, v, onde)
  const correta = booleano(l, r['correta'], `${onde}.correta`)
  const qualidade = umDe(l, r['qualidade'], QUALIDADES_DE_RESPOSTA, `${onde}.qualidade`)
  if (EH_ACERTO[qualidade] !== correta) {
    falhar(l, `${onde}.qualidade`, `'${qualidade}' do lado errado de correta ${String(correta)}`)
  }
  const direcao = umDe(l, r['direcao'], DIRECOES, `${onde}.direcao`)
  const deltaBruto = numero(l, r['deltaBruto'], `${onde}.deltaBruto`)
  if (correta) {
    if (r['confundidaCom'] !== undefined) falhar(l, `${onde}.confundidaCom`, 'confusão num acerto')
    return { correta, qualidade: qualidade as QualidadeDeAcerto, direcao, deltaBruto }
  }
  const base = { correta, qualidade: qualidade as QualidadeDeErro, direcao, deltaBruto }
  return r['confundidaCom'] === undefined
    ? base
    : { ...base, confundidaCom: idItem(l, r['confundidaCom'], `${onde}.confundidaCom`) }
}

function ligacao(l: Leitura, v: unknown, linhas: number, onde: string): LigacaoDeAssociacao {
  const r = registro(l, v, onde)
  const linha = inteiroNaoNegativo(l, r['linha'], `${onde}.linha`)
  if (linha >= linhas) falhar(l, `${onde}.linha`, `linha ${String(linha)} fora das ${String(linhas)} do formato`)
  return {
    linha,
    rotulo: r['rotulo'] === null ? null : idItem(l, r['rotulo'], `${onde}.rotulo`),
    latencia: milis(l, r['latencia'], `${onde}.latencia`),
  }
}

/**
 * A resposta e a avaliação, que dependem do formato: a resposta de associação vem se e só se o formato é associação, e
 * sem avaliação; as outras vêm com avaliação. `continuar` fecha apresentação e nunca é resposta registrada.
 */
function respostaEAvaliacao(l: Leitura, r: Registro, q: Questao): Pick<CorpoDeResposta, 'resposta' | 'avaliacao'> {
  const rr = registro(l, r['resposta'], 'resposta')
  const tipo = umDe(
    l,
    rr['tipo'],
    ['escolha', 'texto', 'nao-sei', 'tempo-esgotado', 'associacao'] as const,
    'resposta.tipo',
  )
  const ehAssociacao = q.formato.tipo === 'associacao'
  if ((tipo === 'associacao') !== ehAssociacao) {
    falhar(l, 'resposta.tipo', `resposta '${tipo}' em questão de ${q.formato.tipo}`)
  }
  if (tipo === 'associacao') {
    if (r['avaliacao'] !== undefined) falhar(l, 'avaliacao', 'associação não tem avaliação')
    const linhas = q.formato.tipo === 'associacao' ? q.formato.linhas.length : 0
    const resposta: RespostaDeAssociacao = {
      tipo,
      ligacoes: lista(l, rr['ligacoes'], 'resposta.ligacoes').map((x) => ligacao(l, x, linhas, 'resposta.ligacoes')),
    }
    return { resposta }
  }
  const av = avaliacao(l, r['avaliacao'], 'avaliacao')
  switch (tipo) {
    case 'escolha':
      return {
        resposta: {
          tipo,
          escolhidas: idsDeItem(l, rr['escolhidas'], 'resposta.escolhidas'),
          latencia: milis(l, rr['latencia'], 'resposta.latencia'),
        },
        avaliacao: av,
      }
    case 'texto':
      return {
        resposta: {
          tipo,
          texto: textoSeguro(l, rr['texto'], 'resposta.texto'),
          latencia: milis(l, rr['latencia'], 'resposta.latencia'),
        },
        avaliacao: av,
      }
    case 'nao-sei':
    case 'tempo-esgotado':
      return { resposta: { tipo }, avaliacao: av }
  }
}

function passo(l: Leitura, v: unknown, onde: string): PassoRegistrado {
  const r = registro(l, v, onde)
  const tipo = umDe(l, r['tipo'], ['apresentacao', 'questao'] as const, `${onde}.tipo`)
  if (tipo === 'apresentacao') {
    return { tipo, itens: naoVazia(l, idsDeItem(l, r['itens'], `${onde}.itens`), `${onde}.itens`) }
  }
  return { tipo, questao: questao(l, r['questao'], `${onde}.questao`), uso: uso(l, r['uso'], `${onde}.uso`) }
}

function tarefa(l: Leitura, v: unknown, onde: string): TarefaRegistrada {
  const r = registro(l, v, onde)
  const lida = {
    id: textoNaoVazio(l, r['id'], `${onde}.id`),
    tipo: umDe(l, r['tipo'], TIPOS_DE_TAREFA, `${onde}.tipo`),
    alvos: lista(l, r['alvos'], `${onde}.alvos`).map((x) => idTopico(l, x, `${onde}.alvos`)),
    passos: lista(l, r['passos'], `${onde}.passos`).map((x) => passo(l, x, `${onde}.passos`)),
  }
  return r['motivo'] === undefined
    ? lida
    : { ...lida, motivo: umDe(l, r['motivo'], MOTIVOS_DE_REMEDIACAO, `${onde}.motivo`) }
}

function dadosDoPerfil(
  l: Leitura,
  r: Registro,
): Readonly<{ semente: string; catalogoHash: string; versaoModelo: number }> {
  return {
    semente: textoNaoVazio(l, textoSeguro(l, r['semente'], 'semente'), 'semente'),
    catalogoHash: textoNaoVazio(l, r['catalogoHash'], 'catalogoHash'),
    versaoModelo: inteiroNaoNegativo(l, r['versaoModelo'], 'versaoModelo'),
  }
}

// Um leitor por tipo de evento; o registro exige uma entrada para cada tipo da união.
const LEITORES: { readonly [T in TipoDeEvento]: (l: Leitura, r: Registro) => CorpoDoTipo<T> } = {
  'perfil-criado': (l, r) => ({ tipo: 'perfil-criado', ...dadosDoPerfil(l, r) }),
  'perfil-reiniciado': (l, r) => ({ tipo: 'perfil-reiniciado', ...dadosDoPerfil(l, r) }),
  'sessao-iniciada': (l, r) => ({
    tipo: 'sessao-iniciada',
    orcamentoMin: numero(l, r['orcamentoMin'], 'orcamentoMin') as Minutos,
    novasPrevistas: idsDeItem(l, r['novasPrevistas'], 'novasPrevistas'),
  }),
  'sessao-encerrada': (l, r) => ({
    tipo: 'sessao-encerrada',
    motivo: umDe(l, r['motivo'], MOTIVOS_DE_FIM_DE_SESSAO, 'motivo'),
  }),
  'diagnostico-iniciado': () => ({ tipo: 'diagnostico-iniciado' }),
  'diagnostico-pulado': () => ({ tipo: 'diagnostico-pulado' }),
  'diagnostico-encerrado': (l, r) => ({
    tipo: 'diagnostico-encerrado',
    motivo: umDe(l, r['motivo'], MOTIVOS_DE_FIM_DO_DIAGNOSTICO, 'motivo'),
  }),
  'tarefa-iniciada': (l, r) => ({ tipo: 'tarefa-iniciada', tarefa: tarefa(l, r['tarefa'], 'tarefa') }),
  'apresentacao-vista': (l, r) => ({
    tipo: 'apresentacao-vista',
    tarefaId: textoNaoVazio(l, r['tarefaId'], 'tarefaId'),
    itens: naoVazia(l, idsDeItem(l, r['itens'], 'itens'), 'itens'),
  }),
  'resposta-registrada': (l, r) => {
    const q = questao(l, r['questao'], 'questao')
    return {
      tipo: 'resposta-registrada',
      tarefaId: textoNaoVazio(l, r['tarefaId'], 'tarefaId'),
      passo: inteiroNaoNegativo(l, r['passo'], 'passo'),
      uso: uso(l, r['uso'], 'uso'),
      questao: q,
      ...respostaEAvaliacao(l, r, q),
    } as CorpoDeResposta
  },
  'licao-adiada': (l, r) => ({
    tipo: 'licao-adiada',
    tarefaId: textoNaoVazio(l, r['tarefaId'], 'tarefaId'),
    topico: idTopico(l, r['topico'], 'topico'),
    kp: umDe(l, r['kp'], [1, 2, 3] as const, 'kp'),
  }),
  'licao-concluida': (l, r) => ({
    tipo: 'licao-concluida',
    tarefaId: textoNaoVazio(l, r['tarefaId'], 'tarefaId'),
    topico: idTopico(l, r['topico'], 'topico'),
    acelerada: booleano(l, r['acelerada'], 'acelerada'),
  }),
  'remediacao-concluida': (l, r) => ({
    tipo: 'remediacao-concluida',
    tarefaId: textoNaoVazio(l, r['tarefaId'], 'tarefaId'),
    motivo: umDe(l, r['motivo'], MOTIVOS_DE_REMEDIACAO, 'motivo'),
    alvos: naoVazia(
      l,
      lista(l, r['alvos'], 'alvos').map((x) => idTopico(l, x, 'alvos')),
      'alvos',
    ),
  }),
  'meta-diaria-alterada': (l, r) => {
    const xp = numero(l, r['xp'], 'xp')
    if (xp <= 0) falhar(l, 'xp', 'meta que não é positiva')
    return { tipo: 'meta-diaria-alterada', xp }
  },
}

export function ehTipoDeEvento(tipo: string): tipo is TipoDeEvento {
  return (TIPOS_DE_EVENTO as readonly string[]).includes(tipo)
}

/** Cabeçalho do envelope, sem o id: o instante, o aparelho e o fuso, com a regra de cada um. */
function cabecalho(
  l: Leitura,
  r: Registro,
): Readonly<{ tipo: string; em: Instante; dispositivo: string; fusoMinutos: number }> {
  const tipo = texto(l, r['tipo'], 'tipo')
  const em = inteiroNaoNegativo(l, r['em'], 'em') as Instante
  const dispositivo = textoNaoVazio(l, textoSeguro(l, r['dispositivo'], 'dispositivo'), 'dispositivo')
  const fusoMinutos = numero(l, r['fusoMinutos'], 'fusoMinutos')
  if (Math.abs(fusoMinutos) > FUSO_MAXIMO_MINUTOS) falhar(l, 'fusoMinutos', `fora de ±${String(FUSO_MAXIMO_MINUTOS)}`)
  return { tipo, em, dispositivo, fusoMinutos }
}

function id(l: Leitura, r: Registro): string {
  const lido = texto(l, r['id'], 'id')
  if (!ID_DE_EVENTO.test(lido)) falhar(l, 'id', 'não tem 16 dígitos hexadecimais minúsculos')
  return lido
}

const problema = (parte: ProblemaDeLeitura['parte'], motivo: string): Resultado<never, ProblemaDeLeitura> =>
  erro({ parte, motivo })

/**
 * Só o envelope: o id, o tipo como texto, o instante, o aparelho e o fuso. A reconstrução lê o envelope de todo evento
 * para ordenar o log e achar a época, e o corpo só dos eventos da época; o tipo desconhecido passa aqui.
 */
export function lerEnvelope(valor: unknown): Resultado<EnvelopeLido, ProblemaDeLeitura> {
  const l = novaLeitura()
  const r = registro(l, valor, 'evento')
  const lido = { id: id(l, r), ...cabecalho(l, r) }
  const achado = problemaDe(l)
  return achado === undefined ? ok(lido) : problema('envelope', achado)
}

/** O evento inteiro menos o id. É a leitura sobre cuja saída `criarEvento` calcula o id. */
export function lerEventoSemId(valor: unknown): Resultado<EventoSemId, ProblemaDeLeitura> {
  const l = novaLeitura()
  const r = registro(l, valor, 'evento')
  const { tipo, em, dispositivo, fusoMinutos } = cabecalho(l, r)
  const noEnvelope = problemaDe(l)
  if (noEnvelope !== undefined) return problema('envelope', noEnvelope)
  if (!ehTipoDeEvento(tipo)) return problema('tipo-desconhecido', `tipo que esta versão não conhece: '${tipo}'`)
  const corpo = LEITORES[tipo](l, r)
  const noCorpo = problemaDe(l)
  if (noCorpo !== undefined) return problema('corpo', noCorpo)
  return ok({ em, dispositivo, fusoMinutos, ...corpo })
}

/**
 * Lê um valor de fora, como um item do armazenamento ou do servidor, e devolve um evento novo só com os campos
 * conhecidos. Recusa, com a parte e o motivo do primeiro problema:
 *
 * - no envelope: o que não é objeto; id fora de 16 dígitos hexadecimais minúsculos; tipo que não é texto; instante que
 *   não é inteiro seguro não negativo; aparelho vazio ou com texto proibido; fuso não finito ou além de um dia;
 * - no tipo: o que esta versão não conhece, que é de um app mais novo e não de um log corrompido;
 * - no corpo: campo ausente ou de tipo errado, união interna com etiqueta desconhecida, número não finito, duração
 *   negativa, id de item vazio, id de tópico sem prefixo, alvo da questão que não é o tópico do item, qualidade do lado
 *   errado de `correta`, confusão num acerto, associação incoerente com o formato, meta que não é positiva, semente
 *   vazia, e U+0000 ou metade solta de par substituto no texto digitado, no aparelho e na semente.
 *
 * Não confere referência ao catálogo, escolhida dentro das opções, nem `avaliacao.direcao` e `avaliacao.deltaBruto`
 * contra a questão e os parâmetros, que o redutor não lê.
 */
export function lerEvento(valor: unknown): Resultado<Evento, ProblemaDeLeitura> {
  const l = novaLeitura()
  const idLido = id(l, registro(l, valor, 'evento'))
  const noId = problemaDe(l)
  if (noId !== undefined) return problema('envelope', noId)
  const resto = lerEventoSemId(valor)
  return resto.ok ? ok({ id: idLido, ...resto.valor }) : resto
}
