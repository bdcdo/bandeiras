import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { lerEnvelope, lerEvento, type ProblemaDeLeitura } from './ler-evento'

// Os modelos dos casos são os eventos do log de referência: um de cada tipo e de cada variante de uso e de resposta,
// todos fabricados por criarEvento. Cada caso estraga uma folha de um modelo e confere que a leitura para ali, na parte
// e pelo motivo esperados, e não por acidente noutro campo.
const LOG = JSON.parse(readFileSync(new URL('./log-de-referencia.json', import.meta.url), 'utf8')) as readonly unknown[]

type Bruto = Record<string, unknown>
const brutos = LOG as readonly Bruto[]
function modelo(predicado: (e: Bruto) => boolean): Bruto {
  const achado = brutos.find(predicado)
  if (achado === undefined) throw new Error('o log de referência não tem o modelo pedido')
  return achado
}
const doTipo = (tipo: string) => modelo((e) => e['tipo'] === tipo)
const resposta = (usoTipo: string, respostaTipo: string) =>
  modelo(
    (e) =>
      e['tipo'] === 'resposta-registrada' &&
      (e['uso'] as Bruto)['tipo'] === usoTipo &&
      (e['resposta'] as Bruto)['tipo'] === respostaTipo,
  )

const PERFIL = doTipo('perfil-reiniciado')
const SESSAO = doTipo('sessao-iniciada')
const FIM_DE_SESSAO = doTipo('sessao-encerrada')
const FIM_DO_DIAGNOSTICO = doTipo('diagnostico-encerrado')
const REMEDIACAO_INICIADA = modelo(
  (e) => e['tipo'] === 'tarefa-iniciada' && (e['tarefa'] as Bruto)['motivo'] !== undefined,
)
const APRESENTACAO = doTipo('apresentacao-vista')
const ASSOCIACAO = resposta('diagnostico', 'associacao')
const CHUTE_DE_KP1 = modelo((e) => e['tipo'] === 'resposta-registrada' && (e['uso'] as Bruto)['kp'] === 1)
const ESCOLHA_CERTA = modelo((e) => e['tipo'] === 'resposta-registrada' && (e['uso'] as Bruto)['kp'] === 2)
const SONDAGEM = modelo((e) => e['tipo'] === 'resposta-registrada' && (e['uso'] as Bruto)['etapa'] === 'recordar')
const TEXTO_ERRADO = resposta('quiz', 'texto')
const DE_GRUPO = resposta('grupo', 'escolha')
const CRONOMETRADA = resposta('revisao', 'tempo-esgotado')
const ADIADA = doTipo('licao-adiada')
const CONCLUIDA = doTipo('licao-concluida')
const REMEDIACAO_CONCLUIDA = doTipo('remediacao-concluida')
const META = doTipo('meta-diaria-alterada')

const APAGAR = Symbol('apagar')
type Caminho = readonly (string | number)[]

/** Cópia profunda do modelo com a folha do caminho trocada pelo valor, ou apagada. */
function estragar(e: Bruto, caminho: Caminho, valor: unknown): unknown {
  const copia = structuredClone(e)
  let pai: Record<string | number, unknown> = copia
  for (const passo of caminho.slice(0, -1)) pai = pai[passo] as Record<string | number, unknown>
  const folha = caminho.at(-1) ?? ''
  if (valor === APAGAR) Reflect.deleteProperty(pai, folha)
  else pai[folha] = valor
  return copia
}

const recusa = (valor: unknown): ProblemaDeLeitura => {
  const lido = lerEvento(valor)
  if (lido.ok) throw new Error(`o leitor aceitou: ${JSON.stringify(valor)}`)
  return lido.erro
}

describe('lerEvento aceita', () => {
  it('todo evento do log de referência, e a ida e volta por JSON devolve o mesmo evento', () => {
    for (const bruto of brutos) {
      const lido = lerEvento(bruto)
      expect(lido.ok, String(bruto['tipo'])).toBe(true)
      if (!lido.ok) continue
      expect(lerEvento(JSON.parse(JSON.stringify(lido.valor)))).toStrictEqual(lido)
      expect(lido.valor).toStrictEqual(bruto)
    }
  })

  it('a associação sem avaliação, com o "Não sei" de uma linha como null', () => {
    const lido = lerEvento(ASSOCIACAO)
    expect(lido.ok && lido.valor.tipo === 'resposta-registrada' && lido.valor.avaliacao).toBe(undefined)
    expect(JSON.stringify(ASSOCIACAO)).toContain('"rotulo":null')
  })

  it('o texto digitado vazio e a semente em texto decimal', () => {
    expect(lerEvento(estragar(TEXTO_ERRADO, ['resposta', 'texto'], '')).ok).toBe(true)
    expect(PERFIL['semente']).toBe('42')
  })

  it('fuso nos extremos de um dia e instante zero', () => {
    for (const fuso of [1440, -1440, 0, 330.5]) expect(lerEvento(estragar(META, ['fusoMinutos'], fuso)).ok).toBe(true)
    expect(lerEvento(estragar(META, ['em'], 0)).ok).toBe(true)
  })

  it('ignora campo a mais em todo nível e devolve um objeto novo sem ele', () => {
    const comExtra = estragar(estragar(CRONOMETRADA, ['extra'], 1) as Bruto, ['questao', 'formato', 'extra'], [2])
    const lido = lerEvento(comExtra)
    expect(lido).toStrictEqual({ ok: true, valor: CRONOMETRADA })
    expect(lido.ok && lido.valor).not.toBe(comExtra)
  })

  it('não confere o catálogo, as opções nem a avaliação contra a questão', () => {
    expect(lerEvento(estragar(ESCOLHA_CERTA, ['resposta', 'escolhidas'], ['zz'])).ok).toBe(true)
    expect(lerEvento(estragar(ESCOLHA_CERTA, ['avaliacao', 'direcao'], 'recordar')).ok).toBe(true)
    expect(lerEvento(estragar(ESCOLHA_CERTA, ['avaliacao', 'deltaBruto'], 7)).ok).toBe(true)
    expect(lerEvento(estragar(CONCLUIDA, ['topico'], 'grupo:inexistente')).ok).toBe(true)
  })
})

describe('lerEvento recusa', () => {
  it('o que não é objeto', () => {
    for (const valor of [null, undefined, 42, 'evento', [PERFIL]]) {
      expect(recusa(valor)).toEqual({ parte: 'envelope', motivo: 'evento: não é objeto' })
    }
  })

  type Caso = readonly [nome: string, modelo: Bruto, caminho: Caminho, valor: unknown, parte: string, trecho: string]
  const casos: readonly Caso[] = [
    // Envelope.
    ['id ausente', PERFIL, ['id'], APAGAR, 'envelope', 'id: não é texto'],
    ['id com maiúscula', PERFIL, ['id'], 'ABCDEF0123456789', 'envelope', 'id: não tem 16'],
    ['id com 15 dígitos', PERFIL, ['id'], '0123456789abcde', 'envelope', 'id: não tem 16'],
    ['tipo que não é texto', PERFIL, ['tipo'], 7, 'envelope', 'tipo: não é texto'],
    ['instante fracionário', META, ['em'], 1.5, 'envelope', 'em: não é inteiro'],
    ['instante negativo', META, ['em'], -1, 'envelope', 'em: não é inteiro'],
    ['instante além do inteiro seguro', META, ['em'], 2 ** 53, 'envelope', 'em: não é inteiro'],
    ['instante em texto', META, ['em'], '1760000000000', 'envelope', 'em: não é inteiro'],
    ['aparelho vazio', META, ['dispositivo'], '', 'envelope', 'dispositivo: texto vazio'],
    ['aparelho com U+0000', META, ['dispositivo'], 'a\u0000b', 'envelope', 'dispositivo: texto com U+0000'],
    ['aparelho com metade solta', META, ['dispositivo'], 'a\ud800', 'envelope', 'dispositivo: texto com U+0000'],
    ['fuso não finito', META, ['fusoMinutos'], Number.NaN, 'envelope', 'fusoMinutos: não é número finito'],
    ['fuso infinito', META, ['fusoMinutos'], Number.POSITIVE_INFINITY, 'envelope', 'fusoMinutos: não é número'],
    ['fuso além de um dia', META, ['fusoMinutos'], 1441, 'envelope', 'fusoMinutos: fora de ±1440'],
    ['fuso aquém de um dia', META, ['fusoMinutos'], -1441, 'envelope', 'fusoMinutos: fora de ±1440'],
    ['fuso em texto', META, ['fusoMinutos'], '180', 'envelope', 'fusoMinutos: não é número'],
    // Tipo que esta versão não conhece, inclusive parametros-alterados, que a união não tem: os parâmetros vêm do
    // contexto da redução e valem para o passado inteiro do log, e nenhum evento os grava.
    ['tipo de versão futura', META, ['tipo'], 'x-futuro', 'tipo-desconhecido', "'x-futuro'"],
    ['parametros-alterados', META, ['tipo'], 'parametros-alterados', 'tipo-desconhecido', "'parametros-alterados'"],
    // Perfil.
    ['semente numérica', PERFIL, ['semente'], 42, 'corpo', 'semente: não é texto'],
    ['semente vazia', PERFIL, ['semente'], '', 'corpo', 'semente: texto vazio'],
    ['semente com U+0000', PERFIL, ['semente'], '4\u00002', 'corpo', 'semente: texto com U+0000'],
    ['hash do catálogo ausente', PERFIL, ['catalogoHash'], APAGAR, 'corpo', 'catalogoHash: não é texto'],
    ['versão negativa', PERFIL, ['versaoModelo'], -1, 'corpo', 'versaoModelo: não é inteiro'],
    ['versão fracionária', PERFIL, ['versaoModelo'], 1.5, 'corpo', 'versaoModelo: não é inteiro'],
    // Sessão e diagnóstico.
    ['orçamento não finito', SESSAO, ['orcamentoMin'], Number.NaN, 'corpo', 'orcamentoMin: não é número'],
    ['nova prevista vazia', SESSAO, ['novasPrevistas', 0], '', 'corpo', 'novasPrevistas: texto vazio'],
    ['fim de sessão sem motivo conhecido', FIM_DE_SESSAO, ['motivo'], 'fim', 'corpo', 'motivo: fora de'],
    ['fim de diagnóstico sem motivo conhecido', FIM_DO_DIAGNOSTICO, ['motivo'], 'pulado', 'corpo', 'motivo: fora de'],
    // Tarefa registrada.
    ['tipo de tarefa desconhecido', REMEDIACAO_INICIADA, ['tarefa', 'tipo'], 'treino', 'corpo', 'tarefa.tipo: fora'],
    ['motivo de remediação antigo', REMEDIACAO_INICIADA, ['tarefa', 'motivo'], 'familia', 'corpo', 'tarefa.motivo'],
    [
      'passo de tipo desconhecido',
      REMEDIACAO_INICIADA,
      ['tarefa', 'passos', 0, 'tipo'],
      'video',
      'corpo',
      'passos.tipo',
    ],
    ['apresentação sem item', REMEDIACAO_INICIADA, ['tarefa', 'passos', 0, 'itens'], [], 'corpo', 'itens: lista vazia'],
    ['alvo sem prefixo', REMEDIACAO_INICIADA, ['tarefa', 'alvos', 0], 'g', 'corpo', 'tarefa.alvos: não é id de tópico'],
    ['id de tarefa vazio', REMEDIACAO_INICIADA, ['tarefa', 'id'], '', 'corpo', 'tarefa.id: texto vazio'],
    // Apresentação.
    ['apresentação de lista vazia', APRESENTACAO, ['itens'], [], 'corpo', 'itens: lista vazia'],
    ['apresentação sem tarefa', APRESENTACAO, ['tarefaId'], '', 'corpo', 'tarefaId: texto vazio'],
    // Resposta: posição e uso.
    ['passo negativo', ESCOLHA_CERTA, ['passo'], -1, 'corpo', 'passo: não é inteiro'],
    ['passo fracionário', ESCOLHA_CERTA, ['passo'], 0.5, 'corpo', 'passo: não é inteiro'],
    ['uso desconhecido', ESCOLHA_CERTA, ['uso', 'tipo'], 'treino', 'corpo', 'uso.tipo: fora'],
    ['knowledge point 4', ESCOLHA_CERTA, ['uso', 'kp'], 4, 'corpo', 'uso.kp: fora de 1, 2, 3'],
    ['lição sem knowledge point', ESCOLHA_CERTA, ['uso', 'kp'], APAGAR, 'corpo', 'uso.kp: fora'],
    ['etapa da sondagem desconhecida', SONDAGEM, ['uso', 'etapa'], 'lembrar', 'corpo', 'uso.etapa: fora'],
    // Resposta: questão.
    ['alvo de outro item', ESCOLHA_CERTA, ['questao', 'alvo'], 'item:h', 'corpo', "não é o tópico de 'g'"],
    ['alvo sem prefixo na questão', ESCOLHA_CERTA, ['questao', 'alvo'], 'g', 'corpo', 'questao.alvo: não é id'],
    ['item alvo vazio', ESCOLHA_CERTA, ['questao', 'itemAlvo'], '', 'corpo', 'questao.itemAlvo: texto vazio'],
    ['formato desconhecido', ESCOLHA_CERTA, ['questao', 'formato', 'tipo'], 'desenho', 'corpo', 'formato.tipo: fora'],
    ['opções que não são lista', ESCOLHA_CERTA, ['questao', 'formato', 'opcoes'], 'g', 'corpo', 'opcoes: não é lista'],
    ['contexto desconhecido', ESCOLHA_CERTA, ['questao', 'contexto', 'tipo'], 'solta', 'corpo', 'contexto.tipo: fora'],
    ['contexto de grupo sem grupo', DE_GRUPO, ['questao', 'contexto', 'grupo'], '', 'corpo', 'contexto.grupo: texto'],
    ['limite negativo', CRONOMETRADA, ['questao', 'limiteMs'], -1, 'corpo', 'limiteMs: duração negativa'],
    // Resposta e avaliação.
    ['continuar como resposta', ESCOLHA_CERTA, ['resposta'], { tipo: 'continuar' }, 'corpo', 'resposta.tipo: fora'],
    ['latência negativa', ESCOLHA_CERTA, ['resposta', 'latencia'], -5, 'corpo', 'latencia: duração negativa'],
    ['latência infinita', ESCOLHA_CERTA, ['resposta', 'latencia'], Infinity, 'corpo', 'latencia: não é número'],
    ['escolhida vazia', ESCOLHA_CERTA, ['resposta', 'escolhidas', 0], '', 'corpo', 'escolhidas: texto vazio'],
    ['texto com U+0000', TEXTO_ERRADO, ['resposta', 'texto'], 'Item\u0000F', 'corpo', 'resposta.texto: texto com'],
    ['texto com metade solta', TEXTO_ERRADO, ['resposta', 'texto'], 'Item \udc00', 'corpo', 'resposta.texto: texto'],
    ['escolha sem avaliação', ESCOLHA_CERTA, ['avaliacao'], APAGAR, 'corpo', 'avaliacao: não é objeto'],
    ['acerto com qualidade de erro', ESCOLHA_CERTA, ['avaliacao', 'qualidade'], 'errada', 'corpo', 'lado errado'],
    ['erro com qualidade de acerto', TEXTO_ERRADO, ['avaliacao', 'qualidade'], 'perfeita', 'corpo', 'lado errado'],
    ['qualidade desconhecida', ESCOLHA_CERTA, ['avaliacao', 'qualidade'], 'otima', 'corpo', 'avaliacao.qualidade'],
    ['confusão num acerto', ESCOLHA_CERTA, ['avaliacao', 'confundidaCom'], 'f', 'corpo', 'confusão num acerto'],
    ['confusão vazia num erro', CHUTE_DE_KP1, ['avaliacao', 'confundidaCom'], '', 'corpo', 'confundidaCom: texto'],
    ['direção desconhecida', ESCOLHA_CERTA, ['avaliacao', 'direcao'], 'adivinhar', 'corpo', 'avaliacao.direcao'],
    ['delta não finito', ESCOLHA_CERTA, ['avaliacao', 'deltaBruto'], Number.NaN, 'corpo', 'deltaBruto: não é'],
    ['correta que não é booleano', ESCOLHA_CERTA, ['avaliacao', 'correta'], 'sim', 'corpo', 'correta: não é'],
    // Associação.
    ['associação com avaliação', ASSOCIACAO, ['avaliacao'], ESCOLHA_CERTA['avaliacao'], 'corpo', 'não tem avaliação'],
    [
      'associação em questão de rótulo digitado',
      ASSOCIACAO,
      ['questao', 'formato'],
      { tipo: 'rotulo-digitado' },
      'corpo',
      "resposta 'associacao' em questão de rotulo-digitado",
    ],
    [
      'escolha em questão de associação',
      ESCOLHA_CERTA,
      ['questao', 'formato'],
      { tipo: 'associacao', linhas: [['g']], rotulos: ['g'] },
      'corpo',
      "resposta 'escolha' em questão de associacao",
    ],
    ['linha fora do formato', ASSOCIACAO, ['resposta', 'ligacoes', 0, 'linha'], 3, 'corpo', 'fora das 3 do formato'],
    ['linha negativa', ASSOCIACAO, ['resposta', 'ligacoes', 0, 'linha'], -1, 'corpo', 'linha: não é inteiro'],
    ['linha fracionária', ASSOCIACAO, ['resposta', 'ligacoes', 0, 'linha'], 0.5, 'corpo', 'linha: não é inteiro'],
    ['rótulo vazio', ASSOCIACAO, ['resposta', 'ligacoes', 0, 'rotulo'], '', 'corpo', 'rotulo: texto vazio'],
    ['latência de ligação negativa', ASSOCIACAO, ['resposta', 'ligacoes', 1, 'latencia'], -1, 'corpo', 'duração'],
    // Lição, remediação e meta.
    ['adiada no knowledge point 4', ADIADA, ['kp'], 4, 'corpo', 'kp: fora de 1, 2, 3'],
    ['tópico sem prefixo', ADIADA, ['topico'], 'i', 'corpo', 'topico: não é id de tópico'],
    ['tópico de id vazio', ADIADA, ['topico'], 'item:', 'corpo', 'topico: não é id de tópico'],
    ['acelerada que não é booleano', CONCLUIDA, ['acelerada'], 'sim', 'corpo', 'acelerada: não é booleano'],
    ['remediação de família', REMEDIACAO_CONCLUIDA, ['motivo'], 'familia', 'corpo', 'motivo: fora de'],
    ['remediação sem alvo', REMEDIACAO_CONCLUIDA, ['alvos'], [], 'corpo', 'alvos: lista vazia'],
    ['meta zero', META, ['xp'], 0, 'corpo', 'xp: meta que não é positiva'],
    ['meta negativa', META, ['xp'], -5, 'corpo', 'xp: meta que não é positiva'],
    ['meta infinita', META, ['xp'], Number.POSITIVE_INFINITY, 'corpo', 'xp: não é número finito'],
  ]

  it.each(casos)('%s', (_, base, caminho, valor, parte, trecho) => {
    expect(lerEvento(base).ok).toBe(true)
    const problema = recusa(estragar(base, caminho, valor))
    expect(problema.parte).toBe(parte)
    expect(problema.motivo).toContain(trecho)
  })
})

/** Os caminhos de todas as chaves de objeto do valor, as de dentro das listas inclusive. */
function chaves(valor: unknown, prefixo: Caminho = []): Caminho[] {
  if (Array.isArray(valor)) return valor.flatMap((x: unknown, k) => chaves(x, [...prefixo, k]))
  if (typeof valor !== 'object' || valor === null) return []
  return Object.entries(valor).flatMap(([k, v]) => [[...prefixo, k], ...chaves(v, [...prefixo, k])])
}

// Os únicos campos opcionais da união: o limite da questão, a confusão do erro e o motivo da tarefa registrada.
const OPCIONAIS: ReadonlySet<string> = new Set(['limiteMs', 'confundidaCom', 'motivo'])
const ehOpcional = (caminho: Caminho): boolean =>
  OPCIONAIS.has(String(caminho.at(-1))) && !(caminho.length === 1 && caminho[0] === 'motivo')

describe('lerEvento sobre cada campo do log de referência', () => {
  it('recusa o evento sem qualquer campo obrigatório, e aceita sem um opcional', () => {
    let obrigatorios = 0
    for (const bruto of brutos) {
      for (const caminho of chaves(bruto)) {
        const lido = lerEvento(estragar(bruto, caminho, APAGAR))
        expect(lido.ok, `${String(bruto['tipo'])} sem ${caminho.join('.')}`).toBe(ehOpcional(caminho))
        if (!ehOpcional(caminho)) obrigatorios++
      }
    }
    expect(obrigatorios).toBeGreaterThan(300)
  })

  it('recusa o evento com qualquer folha trocada por um valor de outro tipo', () => {
    // O null do "Não sei" de uma linha vira número, porque um texto seria um rótulo válido.
    const deOutroTipo = (v: unknown): unknown =>
      typeof v === 'string' || v === null ? 7 : typeof v === 'number' ? '7' : 'x'
    let folhas = 0
    for (const bruto of brutos) {
      for (const caminho of chaves(bruto)) {
        const atual = caminho.reduce<unknown>((no, passo) => (no as Record<string | number, unknown>)[passo], bruto)
        if (typeof atual === 'object' && atual !== null) continue
        folhas++
        expect(lerEvento(estragar(bruto, caminho, deOutroTipo(atual))).ok, caminho.join('.')).toBe(false)
      }
    }
    expect(folhas).toBeGreaterThan(300)
  })
})

describe('lerEnvelope', () => {
  it('lê só o envelope e deixa passar o tipo desconhecido e o corpo estragado', () => {
    const futuro = estragar(META, ['tipo'], 'x-futuro')
    expect(lerEnvelope(futuro)).toStrictEqual({
      ok: true,
      valor: { id: META['id'], tipo: 'x-futuro', em: META['em'], dispositivo: META['dispositivo'], fusoMinutos: -60 },
    })
    expect(lerEnvelope(estragar(META, ['xp'], 0)).ok).toBe(true)
  })

  it('recusa o envelope estragado, com a mesma regra do evento inteiro', () => {
    for (const [caminho, valor] of [
      [['id'], 'X'],
      [['em'], 0.5],
      [['dispositivo'], ''],
      [['fusoMinutos'], 2000],
      [['tipo'], null],
    ] as const) {
      const lido = lerEnvelope(estragar(META, caminho, valor))
      expect(lido.ok, caminho.join('.')).toBe(false)
      expect(lido).toStrictEqual(lerEvento(estragar(META, caminho, valor)))
    }
  })
})
