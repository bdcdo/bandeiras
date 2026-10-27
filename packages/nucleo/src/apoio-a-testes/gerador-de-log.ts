import type { NaoVazio } from '../base/nao-vazio'
import { desembrulhar } from '../base/resultado'
import type { Instante, Milis, Minutos } from '../base/tempo'
import { TECNICAS_TODAS_LIGADAS } from '../catalogo/tecnicas'
import { DIRECOES, type Catalogo, type IdGrupo, type IdItem } from '../catalogo/tipos'
import { topicoDeGrupo, topicoDeItem, type IdTopico } from '../grafo'
import { PARAMETROS_PADRAO } from '../memoria'
import { criarQuestao, type FormatoDeQuestao } from '../questoes/questao'
import {
  gerarQuestao,
  gerarQuestoesDeGrupo,
  parceirosIndiscerniveis,
  TIPOS_DE_TAREFA,
  type PedidoDeQuestao,
  type Questao,
  type UsoDeQuestao,
} from '../questoes'
import {
  avaliarResposta,
  type Avaliacao,
  type QualidadeDeAcerto,
  type QualidadeDeErro,
  type Resposta,
} from '../avaliacao'
import {
  criarEvento,
  idDeTarefa,
  MOTIVOS_DE_FIM_DE_SESSAO,
  MOTIVOS_DE_FIM_DO_DIAGNOSTICO,
  MOTIVOS_DE_REMEDIACAO,
  VERSAO_MODELO,
  type CorpoDeEvento,
  type CorpoDeResposta,
  type CorpoDoTipo,
  type Evento,
  type PassoRegistrado,
  type TarefaRegistrada,
} from '../eventos'
import {
  chaveDePar,
  criarContextoDeReducao,
  emitir,
  iniciarPerfil,
  sorteioDoEstado,
  statusDaLicao,
  type ContextoDeReducao,
  type EstadoMotor,
  type Origem,
  type Transicao,
} from '../estado'

// Geradores de log para as propriedades da camada `estado`, sem fast-check: fora dos arquivos de teste, o núcleo só
// importa do núcleo. Cada gerador é função pura de uma lista de naturais, que o teste sorteia com `fc.array(fc.nat())`, e
// o fast-check encolhe a lista quando uma propriedade falha.
//
// São dois, porque um só não serve às duas classes de propriedade. O livre fabrica eventos válidos um a um, sem
// coerência, para a totalidade: nenhuma sequência que o leitor aceita faz o redutor falhar. O roteirizado conta uma
// história coerente, com lições inteiras, tarefas de grupo completas e interrompidas, remediação e reinício, que o livre
// quase nunca produziria, para as propriedades de equivalência exercitarem o que importa.

/** As escolhas, lidas em ordem. Esgotadas, `ate` devolve 0 e `chance` devolve falso. */
type Fonte = Readonly<{
  ate(n: number): number
  chance(porcento: number): boolean
  um<T>(xs: NaoVazio<T>): T
  acabou(): boolean
}>

function fonteDe(escolhas: readonly number[]): Fonte {
  let i = 0
  const proxima = (): number | undefined => {
    const valor = escolhas[i]
    i += 1
    return valor
  }
  return {
    ate: (n) => (proxima() ?? 0) % Math.max(1, n),
    chance: (porcento) => {
      const valor = proxima()
      return valor !== undefined && valor % 100 < porcento
    },
    um: (xs) => xs[(proxima() ?? 0) % xs.length] ?? xs[0],
    acabou: () => i >= escolhas.length,
  }
}

/** Um elemento sorteado da lista, ou `undefined` se ela é vazia. */
function algumDe<T>(f: Fonte, xs: readonly T[]): T | undefined {
  return xs.length === 0 ? undefined : xs[f.ate(xs.length)]
}

/** Os corpos de uma transição: os de antes, o corpo e os de depois, com o tipo que diz que a lista não é vazia. */
function juntos(
  antes: readonly CorpoDeEvento[],
  corpo: CorpoDeEvento,
  depois: readonly CorpoDeEvento[] = [],
): NaoVazio<CorpoDeEvento> {
  const [primeiro, ...resto] = antes
  return primeiro === undefined ? [corpo, ...depois] : [primeiro, ...resto, corpo, ...depois]
}

const T0 = 1_760_000_000_000
const MINUTO = 60_000
const HORA = 60 * MINUTO
const DIA = 24 * HORA
const ACERTOS: NaoVazio<QualidadeDeAcerto> = ['perfeita', 'boa', 'lenta']
const ERROS: NaoVazio<QualidadeDeErro> = ['errada', 'chute', 'nao-sei', 'tempo-esgotado']
const FUSOS: NaoVazio<number> = [180, -60, 0, -540, 330, 1440, -1440]
const FORA_DO_CATALOGO = 'fora-do-catalogo' as IdItem
const GRUPO_FORA = 'grupo-fora' as IdGrupo

function registrarTarefa(semId: Omit<TarefaRegistrada, 'id'>): TarefaRegistrada {
  return { id: idDeTarefa(semId), ...semId }
}

// ---------------------------------------------------------------------------------------------------------------------
// Gerador livre
// ---------------------------------------------------------------------------------------------------------------------

type Livre = Readonly<{
  f: Fonte
  itens: NaoVazio<IdItem>
  grupos: NaoVazio<IdGrupo>
  topicos: NaoVazio<IdTopico>
  tarefas: [string, ...string[]]
  ultima: { tarefa: TarefaRegistrada | undefined }
}>

function algunsItens(l: Livre): NaoVazio<IdItem> {
  return [l.f.um(l.itens), ...Array.from({ length: l.f.ate(3) }, () => l.f.um(l.itens))]
}

function usoLivre(f: Fonte): UsoDeQuestao {
  const usos: NaoVazio<UsoDeQuestao> = [
    { tipo: 'licao', kp: f.um([1, 2, 3] as const) },
    { tipo: 'sondagem', etapa: f.um(['recordar', 'confirmar'] as const) },
    { tipo: 'revisao' },
    { tipo: 'remediacao' },
    { tipo: 'quiz' },
    { tipo: 'discriminacao' },
    { tipo: 'grupo' },
    { tipo: 'diagnostico' },
  ]
  return f.um(usos)
}

function questaoLivre(l: Livre): Questao {
  const { f } = l
  const alvo = f.um(l.itens)
  const outro = f.um(l.itens)
  const formatos: NaoVazio<FormatoDeQuestao> = [
    { tipo: 'estimulo-para-rotulo', opcoes: [alvo, outro] },
    { tipo: 'rotulo-para-estimulo', opcoes: [outro, alvo] },
    { tipo: 'rotulo-digitado' },
    { tipo: 'grupo-membros', opcoes: [alvo, outro] },
    { tipo: 'associacao', linhas: [[alvo], [outro]], rotulos: [alvo, outro] },
  ]
  const contexto = f.chance(30)
    ? { tipo: 'grupo' as const, grupo: f.um(l.grupos), exibidos: [alvo, ...algunsItens(l)] }
    : { tipo: 'isolada' as const }
  return criarQuestao(alvo, f.um(formatos), contexto, f.chance(20) ? (f.ate(10_000) as Milis) : undefined)
}

function avaliacaoLivre(f: Fonte, itens: NaoVazio<IdItem>): Avaliacao {
  const direcao = f.um(DIRECOES)
  // O deltaBruto e a direção gravados são de auditoria: o redutor não os lê, e o gerador os sorteia para provar isso.
  const deltaBruto = f.ate(5) - 2
  if (f.chance(50)) return { correta: true, qualidade: f.um(ACERTOS), direcao, deltaBruto }
  const base = { correta: false as const, qualidade: f.um(ERROS), direcao, deltaBruto }
  return f.chance(50) ? { ...base, confundidaCom: f.um(itens) } : base
}

function respostaLivre(l: Livre): CorpoDeResposta {
  const { f } = l
  const passoDaUltima = l.ultima.tarefa?.passos.flatMap((p, k) => (p.tipo === 'questao' ? [{ ...p, k }] : [])) ?? []
  const daTarefa = passoDaUltima.length > 0 && f.chance(50) ? passoDaUltima[f.ate(passoDaUltima.length)] : undefined
  const questao = daTarefa?.questao ?? questaoLivre(l)
  const comum = {
    tipo: 'resposta-registrada' as const,
    tarefaId: f.um(l.tarefas),
    passo: daTarefa?.k ?? f.ate(4),
    uso: daTarefa?.uso ?? usoLivre(f),
    questao,
  }
  if (questao.formato.tipo === 'associacao') {
    const ligacoes = Array.from({ length: f.ate(3) }, () => ({
      linha: f.ate(2),
      rotulo: f.chance(30) ? null : f.um(l.itens),
      latencia: f.ate(5000) as Milis,
    }))
    return { ...comum, resposta: { tipo: 'associacao', ligacoes } }
  }
  const latencia = f.ate(8000) as Milis
  const respostas: NaoVazio<Exclude<CorpoDeResposta['resposta'], Readonly<{ tipo: 'associacao' }>>> = [
    { tipo: 'escolha', escolhidas: [f.um(l.itens)], latencia },
    { tipo: 'texto', texto: f.um(['Item A', '', 'qualquer coisa', '😀']), latencia },
    { tipo: 'nao-sei' },
    { tipo: 'tempo-esgotado' },
  ]
  return { ...comum, resposta: f.um(respostas), avaliacao: avaliacaoLivre(f, l.itens) }
}

function tarefaLivre(l: Livre): TarefaRegistrada {
  const { f } = l
  const passos: PassoRegistrado[] = Array.from({ length: f.ate(4) }, () =>
    f.chance(25)
      ? { tipo: 'apresentacao', itens: algunsItens(l) }
      : { tipo: 'questao', questao: questaoLivre(l), uso: usoLivre(f) },
  )
  const alvos = Array.from({ length: f.ate(3) }, () => f.um(l.topicos))
  const semId = { tipo: f.um(TIPOS_DE_TAREFA), alvos, passos }
  return registrarTarefa(f.chance(30) ? { ...semId, motivo: f.um(MOTIVOS_DE_REMEDIACAO) } : semId)
}

function perfilLivre(f: Fonte, catalogo: Catalogo, tipo: 'perfil-criado' | 'perfil-reiniciado'): CorpoDeEvento {
  return {
    tipo,
    semente: `semente-${String(f.ate(3))}`,
    catalogoHash: f.chance(80) ? catalogo.hash : 'catalogo-de-antes',
    versaoModelo: f.chance(80) ? VERSAO_MODELO : 0,
  }
}

function corpoLivre(l: Livre, catalogo: Catalogo): CorpoDeEvento {
  const { f } = l
  const tarefaId = f.um(l.tarefas)
  // A resposta vem com peso maior, porque é o evento com mais caminhos no redutor.
  switch (f.ate(18)) {
    case 0:
      return perfilLivre(f, catalogo, 'perfil-criado')
    case 1:
      return perfilLivre(f, catalogo, 'perfil-reiniciado')
    case 2:
      return { tipo: 'sessao-iniciada', orcamentoMin: f.um([5, 15, 30]) as Minutos, novasPrevistas: algunsItens(l) }
    case 3:
      return { tipo: 'sessao-encerrada', motivo: f.um(MOTIVOS_DE_FIM_DE_SESSAO) }
    case 4:
      return f.um<CorpoDeEvento>([
        { tipo: 'diagnostico-iniciado' },
        { tipo: 'diagnostico-pulado' },
        { tipo: 'diagnostico-encerrado', motivo: f.um(MOTIVOS_DE_FIM_DO_DIAGNOSTICO) },
      ])
    case 5:
    case 6: {
      const tarefa = tarefaLivre(l)
      l.tarefas.push(tarefa.id)
      l.ultima.tarefa = tarefa
      return { tipo: 'tarefa-iniciada', tarefa }
    }
    case 7:
      return { tipo: 'apresentacao-vista', tarefaId, itens: algunsItens(l) }
    case 8:
      return { tipo: 'licao-adiada', tarefaId, topico: f.um(l.topicos), kp: f.um([1, 2, 3] as const) }
    case 9:
    case 10:
      return { tipo: 'licao-concluida', tarefaId, topico: f.um(l.topicos), acelerada: f.chance(30) }
    case 11:
      return {
        tipo: 'remediacao-concluida',
        tarefaId,
        motivo: f.um(MOTIVOS_DE_REMEDIACAO),
        alvos: [f.um(l.topicos), ...Array.from({ length: f.ate(3) }, () => f.um(l.topicos))],
      }
    case 12:
      return { tipo: 'meta-diaria-alterada', xp: f.um([0.5, 5, 10, 30, 180]) }
    default:
      return respostaLivre(l)
  }
}

/**
 * Log de eventos válidos e incoerentes, para a totalidade do redutor. Começa por um `perfil-criado`, para a reconstrução
 * sempre ter perfil, e segue até as escolhas acabarem, um evento por vez, de qualquer tipo e em qualquer ordem: instantes
 * arbitrários, iguais entre os dois aparelhos e fora de ordem, fusos dos dois extremos, itens, grupos e tópicos fora do
 * catálogo, perfis criados e reiniciados no meio, respostas a tarefas que não existem ou a passos já respondidos, e
 * avaliações com rawDelta e direção sorteados. Não gera tipo desconhecido nem versão futura, que a reconstrução recusa
 * de propósito.
 */
export function gerarLogLivre(catalogo: Catalogo, escolhas: readonly number[]): readonly Evento[] {
  const f = fonteDe(escolhas)
  const itens: NaoVazio<IdItem> = [FORA_DO_CATALOGO, ...catalogo.itens.keys()]
  const grupos: NaoVazio<IdGrupo> = [GRUPO_FORA, ...catalogo.grupos.keys()]
  const l: Livre = {
    f,
    itens,
    grupos,
    topicos: [
      topicoDeItem(FORA_DO_CATALOGO).id,
      ...[...catalogo.itens.keys()].map((i) => topicoDeItem(i).id),
      ...grupos.map((g) => topicoDeGrupo(g).id),
    ],
    tarefas: ['tarefa-que-nao-existe'],
    ultima: { tarefa: undefined },
  }
  const eventos: Evento[] = []
  const criar = (corpo: CorpoDeEvento): void => {
    const cabecalho = {
      em: (T0 + f.ate(40) * HORA + f.ate(3)) as Instante,
      dispositivo: f.um(['aparelho-a', 'aparelho-b']),
      fusoMinutos: f.um(FUSOS),
    }
    const criado = criarEvento(cabecalho, corpo)
    if (!criado.ok) throw new Error(`o gerador livre fez um corpo que o leitor recusa: ${criado.erro.detalhe}`)
    eventos.push(criado.valor)
  }
  criar(perfilLivre(f, catalogo, 'perfil-criado'))
  while (!f.acabou()) criar(corpoLivre(l, catalogo))
  return eventos
}

// ---------------------------------------------------------------------------------------------------------------------
// Gerador roteirizado
// ---------------------------------------------------------------------------------------------------------------------

/** Um passo do roteiro: os corpos de uma ação do motor, emitidos juntos, e de onde eles vêm. */
export type PassoDoRoteiro = Readonly<{ corpos: NaoVazio<CorpoDeEvento>; origem: Origem }>

/**
 * Um roteiro: o perfil e os passos. O estado vivo é `iniciarPerfil` com o início, seguido de `emitir` de cada passo; o
 * log é a concatenação dos eventos de cada transição. `inicioDaParteLivre` é o índice do primeiro passo da parte
 * livre, igual ao número de passos quando as escolhas acabaram antes dela: é por ele que a propriedade confere que
 * chegou ao chute, ao "não sei" e às avaliações trocadas, que só a parte livre emite.
 */
export type Roteiro = Readonly<{
  inicio: Readonly<{ corpo: CorpoDoTipo<'perfil-criado'>; origem: Origem }>
  passos: readonly PassoDoRoteiro[]
  inicioDaParteLivre: number
}>

type Roteirista = {
  readonly ctx: ContextoDeReducao
  readonly catalogo: Catalogo
  readonly f: Fonte
  /** Fora da parte obrigatória, as respostas erram ao acaso e uma fração das avaliações é trocada. */
  livre: boolean
  estado: EstadoMotor
  agora: number
  dispositivo: string
  fuso: number
  readonly passos: PassoDoRoteiro[]
}

const parametros = PARAMETROS_PADRAO

function origemDe(r: Roteirista): Origem {
  return { dispositivo: r.dispositivo, agora: r.agora as Instante, fusoMinutos: r.fuso }
}

/**
 * O relógio entre um passo e o seguinte: de um a quarenta segundos e, de vez em quando, parado, com fração de
 * milissegundo ou dois minutos para trás, como um relógio de aparelho corrigido pela rede.
 */
function avancar(r: Roteirista): void {
  const sorte = r.f.ate(100)
  if (sorte === 1) r.agora -= 2 * MINUTO
  else if (sorte === 2) r.agora += 0.5
  else if (sorte !== 3) r.agora += 1000 + r.f.ate(39_000)
}

function emitirPasso(r: Roteirista, corpos: NaoVazio<CorpoDeEvento>): readonly Evento[] {
  const origem = origemDe(r)
  r.passos.push({ corpos, origem })
  const transicao = emitir(r.ctx, r.estado, corpos, origem)
  if (!transicao.ok) throw new Error(`o roteiro fez um corpo que o leitor recusa: ${transicao.erro.detalhe}`)
  r.estado = transicao.valor.estado
  avancar(r)
  return transicao.valor.eventos
}

const concluido = (r: Roteirista, item: IdItem): boolean =>
  statusDaLicao(r.estado, topicoDeItem(item).id).status === 'concluida'
const aprendidos = (r: Roteirista): IdItem[] => [...r.catalogo.itens.keys()].filter((i) => concluido(r, i))
const rotulo = (r: Roteirista, item: IdItem): string => r.catalogo.itens.get(item)?.rotulo ?? item

/**
 * A questão isolada do pedido, gerada pela camada `questoes` sobre o contexto da sessão. Quando o pool de distratores
 * da sessão não rende a múltipla escolha, ela vira texto digitado, que não precisa de distrator: num catálogo pequeno,
 * uma sessão longa esgota os usos de cada distrator.
 */
function questaoDe(r: Roteirista, pedido: PedidoDeQuestao, limiteMs?: Milis): Questao {
  const contexto = r.estado.sessao?.contexto
  if (contexto !== undefined) {
    const gerada = gerarQuestao(
      pedido,
      r.catalogo,
      contexto,
      sorteioDoEstado(r.estado, 'roteiro'),
      parametros,
      limiteMs,
    )
    if (gerada.ok) return gerada.valor
  }
  return criarQuestao(pedido.item, { tipo: 'rotulo-digitado' }, { tipo: 'isolada' }, limiteMs)
}

/** Um item aprendido que não é o alvo nem o parceiro dele, para o texto errado ser a confusão com um item conhecido. */
function outroAprendido(r: Roteirista, alvo: IdItem): IdItem | undefined {
  const parceiros = parceirosIndiscerniveis(alvo, r.catalogo)
  return aprendidos(r).find((i) => i !== alvo && !parceiros.has(i))
}

/** O que responde a uma questão: toda resposta menos `continuar`, que fecha apresentação. */
type RespostaDeQuestao = Exclude<Resposta, Readonly<{ tipo: 'continuar' }>>

/** A resposta que acerta, ou que erra, a questão; o chute e o "não sei" só saem na parte livre. */
function respostaPara(r: Roteirista, questao: Questao, certa: boolean): RespostaDeQuestao {
  const { f } = r
  const { formato, itemAlvo } = questao
  const latencia = (2000 + f.ate(4000)) as Milis
  if (!certa && r.livre && f.chance(15)) return { tipo: 'nao-sei' }
  if (!certa && r.livre && questao.limiteMs !== undefined && f.chance(30)) return { tipo: 'tempo-esgotado' }
  switch (formato.tipo) {
    case 'rotulo-digitado': {
      if (certa) return { tipo: 'texto', texto: rotulo(r, itemAlvo), latencia }
      if (r.livre && f.chance(20)) return { tipo: 'texto', texto: '', latencia }
      const outro = outroAprendido(r, itemAlvo)
      return { tipo: 'texto', texto: outro === undefined ? 'nenhum item' : rotulo(r, outro), latencia }
    }
    case 'grupo-membros': {
      const parceiros = parceirosIndiscerniveis(itemAlvo, r.catalogo)
      const conjunto = formato.opcoes.filter((o) => o === itemAlvo || parceiros.has(o))
      return { tipo: 'escolha', escolhidas: certa ? conjunto : [itemAlvo], latencia }
    }
    case 'estimulo-para-rotulo':
    case 'rotulo-para-estimulo': {
      const errada = formato.opcoes.find((o) => o !== itemAlvo && !parceirosIndiscerniveis(itemAlvo, r.catalogo).has(o))
      const chute = r.livre && f.chance(30)
      return certa || errada === undefined
        ? { tipo: 'escolha', escolhidas: [itemAlvo], latencia }
        : { tipo: 'escolha', escolhidas: [errada], latencia: (chute ? 200 : latencia) as Milis }
    }
    case 'associacao':
      return { tipo: 'associacao', ligacoes: [{ linha: 0, rotulo: certa ? itemAlvo : null, latencia }] }
  }
}

/**
 * O corpo da resposta a uma questão, com a avaliação de `avaliarResposta` sobre as normas do estado. Na parte livre, uma
 * fração das avaliações é trocada por outra válida, a de outra resposta à mesma questão, e uma fração tem o rawDelta
 * gravado adulterado: o redutor lê o julgamento gravado e o número vigente, e nunca reavalia.
 */
function responder(
  r: Roteirista,
  tarefaId: string,
  passo: number,
  uso: UsoDeQuestao,
  questao: Questao,
  certa: boolean,
): Readonly<{ corpo: CorpoDeResposta; correta: boolean }> {
  const resposta = respostaPara(r, questao, certa)
  if (resposta.tipo === 'associacao') {
    return { corpo: { tipo: 'resposta-registrada', tarefaId, passo, uso, questao, resposta }, correta: certa }
  }
  const avaliar = (rr: Resposta): Avaliacao =>
    desembrulhar(avaliarResposta(questao, rr, r.catalogo, r.estado.normas, parametros))
  let avaliacao = avaliar(resposta)
  if (r.livre && r.f.chance(8)) avaliacao = avaliar(respostaPara(r, questao, !avaliacao.correta))
  if (r.livre && r.f.chance(5)) avaliacao = { ...avaliacao, deltaBruto: avaliacao.deltaBruto * 3 }
  return {
    corpo: { tipo: 'resposta-registrada', tarefaId, passo, uso, questao, resposta, avaliacao },
    correta: avaliacao.correta,
  }
}

/**
 * Abre uma sessão com as novas previstas: até `quantas` itens ainda sem lição concluída, `primeiras` antes e os outros
 * na ordem do catálogo. Nova prevista e ainda não apresentada nunca é exibida, e por isso a sessão da tarefa de grupo
 * abre sem nenhuma: com o vizinho de um membro entre as previstas, o grupo pequeno não chega às opções mínimas.
 */
function abrirSessao(r: Roteirista, primeiras: readonly IdItem[] = [], quantas = 3): void {
  const novas = [...primeiras, ...r.catalogo.itens.keys()].filter((i) => !concluido(r, i))
  emitirPasso(r, [
    { tipo: 'sessao-iniciada', orcamentoMin: 15 as Minutos, novasPrevistas: [...new Set(novas)].slice(0, quantas) },
  ])
}

/** Fecha a sessão e passa para o dia seguinte, às vezes noutro aparelho e noutro fuso. */
function proximoDia(r: Roteirista, trocar: boolean): void {
  emitirPasso(r, [{ tipo: 'sessao-encerrada', motivo: 'usuario' }])
  r.agora += DIA + r.f.ate(6) * HORA
  if (trocar) {
    r.dispositivo = r.dispositivo === 'aparelho-a' ? 'aparelho-b' : 'aparelho-a'
    r.fuso = r.fuso === 180 ? -60 : 180
  }
}

type VarianteDeLicao = 'normal' | 'sondagem-errada' | 'kp1-refeito' | 'acelerada' | 'adiada'

/**
 * A lição de um item, numa tarefa adaptativa. A sondagem, quando há, vem primeiro: certa nas duas etapas, a lição
 * conclui acelerada, sem apresentação; senão vêm a apresentação e os três KPs, cada um repetido depois de um erro e
 * adiado depois do segundo. A última resposta e o evento da lição saem na mesma transição, como o motor os emite.
 */
function licao(r: Roteirista, item: IdItem, variante: VarianteDeLicao): void {
  const topico = topicoDeItem(item).id
  const tarefa = registrarTarefa({ tipo: 'licao', alvos: [topico], passos: [] })
  let passo = 0
  let abertura: CorpoDeEvento[] = [{ tipo: 'tarefa-iniciada', tarefa }]
  const emitirComAbertura = (corpo: CorpoDeEvento, depois: readonly CorpoDeEvento[] = []): void => {
    emitirPasso(r, juntos(abertura, corpo, depois))
    abertura = []
  }
  const decidir = (planejada: boolean): boolean => (r.livre ? r.f.ate(100) < 85 : planejada)

  if (variante === 'acelerada' || variante === 'sondagem-errada') {
    const recordar = questaoDe(r, { tipo: 'sondagem', etapa: 'recordar', item })
    const uso = { tipo: 'sondagem', etapa: 'recordar' } as const
    const primeira = responder(r, tarefa.id, passo++, uso, recordar, decidir(variante === 'acelerada'))
    emitirComAbertura(primeira.corpo)
    if (primeira.correta) {
      const confirmar = questaoDe(r, { tipo: 'sondagem', etapa: 'confirmar', item })
      const usoC = { tipo: 'sondagem', etapa: 'confirmar' } as const
      const segunda = responder(r, tarefa.id, passo++, usoC, confirmar, decidir(true))
      if (segunda.correta) {
        emitirComAbertura(segunda.corpo, [{ tipo: 'licao-concluida', tarefaId: tarefa.id, topico, acelerada: true }])
        return
      }
      emitirComAbertura(segunda.corpo)
    }
  }
  emitirComAbertura({ tipo: 'apresentacao-vista', tarefaId: tarefa.id, itens: [item] })
  for (const kp of [1, 2, 3] as const) {
    for (let falhas = 0; ;) {
      const planejada =
        !(variante === 'kp1-refeito' && kp === 1 && falhas === 0) && !(variante === 'adiada' && kp === 2)
      const uso = { tipo: 'licao', kp } as const
      const { corpo, correta } = responder(
        r,
        tarefa.id,
        passo++,
        uso,
        questaoDe(r, { tipo: 'licao', kp, item }),
        decidir(planejada),
      )
      if (correta && kp === 3) {
        emitirComAbertura(corpo, [{ tipo: 'licao-concluida', tarefaId: tarefa.id, topico, acelerada: false }])
        return
      }
      if (correta) {
        emitirComAbertura(corpo)
        break
      }
      falhas += 1
      if (falhas >= 2) {
        emitirComAbertura(corpo, [{ tipo: 'licao-adiada', tarefaId: tarefa.id, topico, kp }])
        return
      }
      emitirComAbertura(corpo)
    }
  }
}

/**
 * Uma tarefa de passos fixos de questões isoladas: revisão, quiz ou remediação. A tarefa-iniciada vai na transição da
 * primeira resposta, ou da apresentação, quando a remediação começa pelos itens lado a lado. `erradas` diz que passos a
 * parte obrigatória erra; na livre, cada resposta acerta com 80% de chance.
 */
function tarefaFixa(
  r: Roteirista,
  semId: Omit<TarefaRegistrada, 'id'>,
  erradas: ReadonlySet<number> = new Set(),
  depois: (tarefaId: string) => readonly CorpoDeEvento[] = () => [],
): void {
  const tarefa = registrarTarefa(semId)
  let abertura: CorpoDeEvento[] = [{ tipo: 'tarefa-iniciada', tarefa }]
  const ultimo = tarefa.passos.length - 1
  tarefa.passos.forEach((p, k) => {
    const final = k === ultimo ? depois(tarefa.id) : []
    if (p.tipo === 'apresentacao') {
      emitirPasso(r, juntos(abertura, { tipo: 'apresentacao-vista', tarefaId: tarefa.id, itens: p.itens }, final))
    } else {
      const certa = r.livre ? r.f.ate(100) < 80 : !erradas.has(k)
      emitirPasso(r, juntos(abertura, responder(r, tarefa.id, k, p.uso, p.questao, certa).corpo, final))
    }
    abertura = []
  })
}

type PedidoDeTarefaFixa = Extract<
  PedidoDeQuestao,
  Readonly<{ tipo: 'revisao' | 'quiz' | 'remediacao' | 'discriminacao' }>
>

const questaoIsolada = (r: Roteirista, pedido: PedidoDeTarefaFixa, limiteMs?: Milis): PassoRegistrado => ({
  tipo: 'questao',
  questao: questaoDe(r, pedido, limiteMs),
  uso: { tipo: pedido.tipo },
})

function revisao(r: Roteirista, item: IdItem, limiteMs?: Milis): void {
  tarefaFixa(r, {
    tipo: 'revisao',
    alvos: [topicoDeItem(item).id],
    passos: [questaoIsolada(r, { tipo: 'revisao', item }, limiteMs)],
  })
}

function quiz(r: Roteirista, itens: readonly IdItem[], erradas: ReadonlySet<number>): void {
  tarefaFixa(
    r,
    {
      tipo: 'quiz',
      alvos: itens.map((i) => topicoDeItem(i).id),
      passos: itens.map((item) => questaoIsolada(r, { tipo: 'quiz', item })),
    },
    erradas,
  )
}

/** A remediação de um par confundido: os dois lado a lado, uma questão de remediação e uma de discriminação. */
function remediacao(r: Roteirista, x: IdItem, y: IdItem): void {
  const alvos: NaoVazio<IdTopico> = [topicoDeItem(x).id, topicoDeItem(y).id]
  tarefaFixa(
    r,
    {
      tipo: 'remediacao',
      alvos,
      motivo: 'confusao',
      passos: [
        { tipo: 'apresentacao', itens: [x, y] },
        questaoIsolada(r, { tipo: 'remediacao', item: x }),
        questaoIsolada(r, { tipo: 'discriminacao', item: y }),
      ],
    },
    new Set(),
    (tarefaId) => [{ tipo: 'remediacao-concluida', tarefaId, motivo: 'confusao', alvos }],
  )
}

/**
 * Uma tarefa de grupo sobre os membros aprendidos de `grupo`, com as questões de `gerarQuestoesDeGrupo`: até dois alvos,
 * sem os dois de um par. `tipo` é `licao` na lição de família, seguida da lição concluída do grupo. Interrompida, a
 * tarefa para depois da primeira resposta e a sessão se encerra. A tarefa não sai quando o grupo não rende exibidos ou
 * alvos.
 */
function tarefaDeGrupo(r: Roteirista, grupo: IdGrupo, tipo: 'licao' | 'revisao-grupo', interromper: boolean): void {
  const membros = r.catalogo.grupos.get(grupo)?.membros ?? []
  const alvos: IdItem[] = []
  for (const m of membros) {
    if (alvos.length < (interromper ? 2 : 1 + r.f.ate(2)) && concluido(r, m)) {
      if (!alvos.some((a) => parceirosIndiscerniveis(a, r.catalogo).has(m))) alvos.push(m)
    }
  }
  const contexto = r.estado.sessao?.contexto
  if (contexto === undefined || alvos.length === 0 || (interromper && alvos.length < 2)) return
  const questoes = gerarQuestoesDeGrupo(
    grupo,
    alvos,
    r.estado.memorias,
    r.catalogo,
    contexto,
    sorteioDoEstado(r.estado, 'roteiro'),
    parametros,
  )
  if (!questoes.ok) return
  const uso = { tipo: 'grupo' } as const
  const topico = topicoDeGrupo(grupo).id
  const tarefa = registrarTarefa({
    tipo,
    alvos: [topico],
    passos: questoes.valor.map((questao) => ({ tipo: 'questao', questao, uso })),
  })
  let abertura: CorpoDeEvento[] = [{ tipo: 'tarefa-iniciada', tarefa }]
  for (const [k, questao] of questoes.valor.entries()) {
    const { corpo } = responder(r, tarefa.id, k, uso, questao, r.livre ? r.f.ate(100) < 80 : k !== 1)
    const fim: CorpoDeEvento[] =
      tipo === 'licao' && k === questoes.valor.length - 1
        ? [{ tipo: 'licao-concluida', tarefaId: tarefa.id, topico, acelerada: false }]
        : []
    emitirPasso(r, juntos(abertura, corpo, fim))
    abertura = []
    if (interromper) {
      proximoDia(r, false)
      abrirSessao(r)
      return
    }
  }
}

/**
 * A parte obrigatória, que todo roteiro tem, para as propriedades exercitarem cada caminho sempre, e não só quando o
 * sorteio ajuda: o diagnóstico, encerrado ou pulado; a lição com a sondagem errada, com o KP1 refeito, acelerada e
 * adiada e refeita; a meta trocada em dois dias; o quiz com um erro que confunde dois itens aprendidos e a remediação
 * do par; a revisão com e sem limite; a lição de família, a tarefa de grupo completa e a interrompida; e a troca de
 * aparelho e de fuso. O grupo é o primeiro com quatro membros ou mais, ou o primeiro, e os membros dele são as primeiras
 * lições.
 */
function parteObrigatoria(r: Roteirista): void {
  const grupos = [...r.catalogo.grupos.values()]
  const grupo = grupos.find((g) => g.membros.length >= 4) ?? grupos[0]
  const itens = [...r.catalogo.itens.keys()]
  const ordem = [...new Set([...(grupo?.membros ?? []), ...itens])]
  const [a, b, c, d, e] = ordem

  if (r.f.chance(30)) emitirPasso(r, [{ tipo: 'diagnostico-pulado' }])
  else {
    const [inicio] = emitirPasso(r, [{ tipo: 'diagnostico-iniciado' }])
    const tarefaId = inicio?.id ?? 'diagnostico'
    const uso = { tipo: 'diagnostico' } as const
    if (a !== undefined && b !== undefined) {
      const associacao = criarQuestao(
        a,
        { tipo: 'associacao', linhas: [[a], [b]], rotulos: [a, b] },
        { tipo: 'isolada' },
      )
      emitirPasso(r, [responder(r, tarefaId, 0, uso, associacao, true).corpo])
      const digitada = criarQuestao(b, { tipo: 'rotulo-digitado' }, { tipo: 'isolada' })
      emitirPasso(r, [responder(r, tarefaId, 1, uso, digitada, true).corpo])
    }
    emitirPasso(r, [{ tipo: 'diagnostico-encerrado', motivo: 'concluido' }])
  }

  abrirSessao(
    r,
    [a, b].filter((x) => x !== undefined),
  )
  if (a !== undefined) licao(r, a, 'sondagem-errada')
  if (b !== undefined) licao(r, b, 'kp1-refeito')
  emitirPasso(r, [{ tipo: 'meta-diaria-alterada', xp: 30 }])
  proximoDia(r, true)

  abrirSessao(
    r,
    [c, d].filter((x) => x !== undefined),
  )
  if (c !== undefined) licao(r, c, 'acelerada')
  if (d !== undefined) licao(r, d, 'adiada')
  proximoDia(r, true)

  abrirSessao(
    r,
    [d, e].filter((x) => x !== undefined),
  )
  emitirPasso(r, [{ tipo: 'meta-diaria-alterada', xp: 10 }])
  if (d !== undefined) licao(r, d, 'normal')
  if (e !== undefined) licao(r, e, 'normal')
  if (c !== undefined && d !== undefined && e !== undefined) {
    // O erro no primeiro passo digita o rótulo de outro aprendido: a confusão do par que a remediação trata.
    quiz(r, [c, d, e], new Set([0]))
    const confundido = outroAprendido(r, c)
    if (confundido !== undefined) remediacao(r, c, confundido)
    revisao(r, c, 8000 as Milis)
    revisao(r, d)
  }
  proximoDia(r, false)

  abrirSessao(r, [], 0)
  if (grupo !== undefined) {
    tarefaDeGrupo(r, grupo.id, 'licao', false)
    tarefaDeGrupo(r, grupo.id, 'revisao-grupo', false)
    tarefaDeGrupo(r, grupo.id, 'revisao-grupo', true)
  }
  proximoDia(r, false)
  abrirSessao(r)
}

/** Uma ação da parte livre, sorteada; cada uma consome escolhas, e o laço termina quando elas acabam. */
function acaoLivre(r: Roteirista): void {
  const { f } = r
  const sabidos = aprendidos(r)
  const novo = [...r.catalogo.itens.keys()].find((i) => !concluido(r, i))
  const algum = algumDe(f, sabidos)
  switch (f.ate(10)) {
    case 0:
    case 1:
    case 2:
      if (novo !== undefined) {
        licao(r, novo, f.um(['normal', 'normal', 'sondagem-errada', 'kp1-refeito', 'acelerada', 'adiada'] as const))
        return
      }
      if (algum !== undefined) revisao(r, algum)
      return
    case 3:
    case 4:
      if (algum !== undefined) revisao(r, algum, f.chance(40) ? (8000 as Milis) : undefined)
      return
    case 5:
      if (sabidos.length > 0) quiz(r, f.chance(50) ? sabidos.slice(0, 3) : sabidos.slice(-3), new Set())
      return
    case 6: {
      const grupo = algumDe(f, [...r.catalogo.grupos.keys()])
      if (grupo !== undefined) tarefaDeGrupo(r, grupo, 'revisao-grupo', f.chance(30))
      return
    }
    case 7: {
      // O primeiro par de itens aprendidos com confusão ainda não remediada; a chave do par se consulta, não se desmonta.
      const pendente = (x: IdItem, y: IdItem): boolean => {
        const chave = chaveDePar(x, y)
        return (r.estado.confusoes.get(chave) ?? 0) > (r.estado.confusoesRemediadas.get(chave) ?? 0)
      }
      const par = sabidos.flatMap((x, k) => sabidos.slice(k + 1).map((y) => [x, y] as const)).find(([x, y]) => pendente(x, y))
      if (par !== undefined) remediacao(r, par[0], par[1])
      return
    }
    case 8:
      emitirPasso(r, [{ tipo: 'meta-diaria-alterada', xp: f.um([5, 10, 15, 30, 60]) }])
      return
    default:
      proximoDia(r, f.chance(20))
      abrirSessao(r, [], f.ate(4))
  }
}

/**
 * Roteiro coerente, como o motor emitiria: a parte obrigatória (ver `parteObrigatoria`), às vezes seguida de um
 * reinício do perfil e de outra parte obrigatória, e depois ações sorteadas até as escolhas acabarem. As questões saem de
 * `gerarQuestao` e `gerarQuestoesDeGrupo` sobre o contexto da sessão, e as avaliações de `avaliarResposta`; para isso o
 * gerador reduz o próprio roteiro enquanto o escreve, sob os parâmetros padrão e todas as técnicas. Os passos não
 * dependem desses parâmetros, e o teste pode reduzi-los sob outros.
 *
 * O fluxo normal não absorve nada: a reconstrução do log de um roteiro só tem relato vazio.
 */
export function gerarRoteiro(catalogo: Catalogo, escolhas: readonly number[]): Roteiro {
  const f = fonteDe(escolhas)
  const ctx = desembrulhar(criarContextoDeReducao({ catalogo, tecnicas: TECNICAS_TODAS_LIGADAS, parametros }))
  const inicio = {
    corpo: {
      tipo: 'perfil-criado' as const,
      semente: String(f.ate(1000)),
      catalogoHash: catalogo.hash,
      versaoModelo: VERSAO_MODELO,
    },
    origem: { dispositivo: 'aparelho-a', agora: (T0 + 0.25) as Instante, fusoMinutos: 180 },
  }
  const r: Roteirista = {
    ctx,
    catalogo,
    f,
    livre: false,
    estado: desembrulhar(iniciarPerfil(ctx, inicio.corpo, inicio.origem)).estado,
    agora: T0 + MINUTO,
    dispositivo: 'aparelho-a',
    fuso: 180,
    passos: [],
  }
  if (f.chance(50)) {
    parteObrigatoria(r)
    emitirPasso(r, [
      {
        tipo: 'perfil-reiniciado',
        semente: `${inicio.corpo.semente}-de-novo`,
        catalogoHash: catalogo.hash,
        versaoModelo: VERSAO_MODELO,
      },
    ])
  }
  parteObrigatoria(r)
  r.livre = true
  const inicioDaParteLivre = r.passos.length
  while (!f.acabou()) acaoLivre(r)
  return { inicio, passos: r.passos, inicioDaParteLivre }
}

/**
 * O estado vivo do roteiro sob o contexto dado, e o log que ele grava: `iniciarPerfil` com o início e `emitir` de cada
 * passo, com os eventos de cada transição em ordem. É o caminho do motor, que só muda o estado por essas duas funções.
 */
export function reduzirRoteiro(ctx: ContextoDeReducao, roteiro: Roteiro): Transicao {
  let { estado, eventos } = desembrulhar(iniciarPerfil(ctx, roteiro.inicio.corpo, roteiro.inicio.origem))
  const log = [...eventos]
  for (const passo of roteiro.passos) {
    ;({ estado, eventos } = desembrulhar(emitir(ctx, estado, passo.corpos, passo.origem)))
    log.push(...eventos)
  }
  return { estado, eventos: log }
}
