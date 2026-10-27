import fc from 'fast-check'
import { describe, expect, it } from 'vitest'
import { catalogoFixo, catalogoFixoSem } from '../apoio-a-testes/catalogo-de-teste'
import {
  gerarLogLivre,
  gerarRoteiro,
  reduzirRoteiro,
  type PassoDoRoteiro,
  type Roteiro,
} from '../apoio-a-testes/gerador-de-log'
import { instantaneoDoEstado } from '../apoio-a-testes/instantaneo-do-estado'
import { desembrulhar } from '../base/resultado'
import { sorteioComSemente, type SorteioComSemente } from '../base/sorteio-com-semente'
import type { Instante } from '../base/tempo'
import { TECNICAS_TODAS_DESLIGADAS, TECNICAS_TODAS_LIGADAS, type Tecnicas } from '../catalogo/tecnicas'
import type { Catalogo, IdItem } from '../catalogo/tipos'
import { compararEventos, idDeEvento, VERSAO_MODELO, type Evento } from '../eventos'
import { PARAMETROS_PADRAO } from '../memoria'
import { TIPOS_DE_TAREFA } from '../questoes'
import { criarContextoDeReducao, type ContextoDeReducao } from './contexto'
import { emitir } from './emitir'
import { conferirInvariantes } from './invariantes'
import { reconstruir } from './reconstruir'
import { reduzir } from './reduzir'
import { sorteioDoEstado } from './sorteio'
import type { EstadoMotor, Transicao } from './tipos'

// As propriedades da camada sobre os dois geradores de apoio-a-testes: o roteirizado, coerente, para a equivalência
// entre o estado vivo e o reconstruído; o livre, incoerente de propósito, para a totalidade.
//
// O tamanho das listas de escolhas é explícito. No tamanho padrão, o fast-check 4 não gera lista com mais de 10
// elementos, qualquer que seja o maxLength: o roteiro nunca passaria da parte obrigatória, que consome umas trezentas
// escolhas, e o log livre teria um ou dois eventos. Com `size: 'max'` o comprimento vai até o maxLength. O roteiro pede
// ao menos 400 escolhas para toda execução chegar à parte livre, a única com chute, "não sei", tempo esgotado e avaliação
// trocada; o teto de 800 rende umas centenas de eventos a mais e mantém cada execução abaixo de um décimo de segundo. As
// propriedades contam, nas próprias execuções, quantas chegaram a cada caso, e reprovam se algum não aparece: um gerador
// que deixe de chegar a eles reprova em vez de passar por vacuidade.

const catalogo = catalogoFixo()
const contexto = (cat: Catalogo = catalogo, tecnicas: Tecnicas = TECNICAS_TODAS_LIGADAS): ContextoDeReducao =>
  desembrulhar(criarContextoDeReducao({ catalogo: cat, tecnicas, parametros: PARAMETROS_PADRAO }))
const ctx = contexto()
const escolhas = fc.array(fc.nat(), { minLength: 400, maxLength: 800, size: 'max' })
const escolhasDoLivre = (maxLength: number) => fc.array(fc.nat(), { maxLength, size: 'max' })
const DIA = 86_400_000

const CASOS_DO_ROTEIRO = [
  'parte livre',
  'chute',
  'não sei ou tempo esgotado',
  'relógio parado, fracionário ou atrás',
  'remediação de par confundido na parte livre',
]
const CASOS_DO_LIVRE = ['em igual entre aparelhos', 'perfil no meio do log', 'mais de dez eventos']

/** Os casos de `CASOS_DO_ROTEIRO` a que o roteiro chega. */
function casosDoRoteiro(roteiro: Roteiro): string[] {
  const qualidades = new Set(
    roteiro.passos.flatMap((p) =>
      p.corpos.flatMap((c) => (c.tipo === 'resposta-registrada' && c.avaliacao ? [c.avaliacao.qualidade] : [])),
    ),
  )
  const anomalo = roteiro.passos.some((p, k) => {
    const antes = roteiro.passos[k - 1]?.origem.agora
    return antes !== undefined && (p.origem.agora <= antes || !Number.isInteger(p.origem.agora))
  })
  return [
    roteiro.passos.length > roteiro.inicioDaParteLivre ? 'parte livre' : '',
    qualidades.has('chute') ? 'chute' : '',
    qualidades.has('nao-sei') || qualidades.has('tempo-esgotado') ? 'não sei ou tempo esgotado' : '',
    anomalo ? 'relógio parado, fracionário ou atrás' : '',
    roteiro.passos
      .slice(roteiro.inicioDaParteLivre)
      .some((p) => p.corpos.some((c) => c.tipo === 'remediacao-concluida' && c.motivo === 'confusao'))
      ? 'remediação de par confundido na parte livre'
      : '',
  ].filter((caso) => caso !== '')
}

/** Os casos de `CASOS_DO_LIVRE` a que o log livre chega. */
function casosDoLivre(log: readonly Evento[]): string[] {
  const aparelhosPorEm = new Map<number, Set<string>>()
  for (const e of log) aparelhosPorEm.set(e.em, (aparelhosPorEm.get(e.em) ?? new Set()).add(e.dispositivo))
  return [
    [...aparelhosPorEm.values()].some((aparelhos) => aparelhos.size > 1) ? 'em igual entre aparelhos' : '',
    log.slice(1).some((e) => e.tipo === 'perfil-criado' || e.tipo === 'perfil-reiniciado') ? 'perfil no meio do log' : '',
    log.length > 10 ? 'mais de dez eventos' : '',
  ].filter((caso) => caso !== '')
}

/**
 * O valor com as chaves de todo objeto, em todo nível, numa ordem sorteada, e as listas na ordem dada: a cópia que volta
 * do jsonb do servidor tem as chaves em outra ordem. A ida e volta por JSON sozinha preserva a ordem de inserção.
 */
function chavesReordenadas(valor: unknown, sorteio: SorteioComSemente): unknown {
  if (Array.isArray(valor)) return valor.map((v: unknown) => chavesReordenadas(v, sorteio))
  if (typeof valor !== 'object' || valor === null) return valor
  const pares = sorteio.embaralhar(Object.entries(valor as Readonly<Record<string, unknown>>))
  return Object.fromEntries(pares.map(([chave, v]) => [chave, chavesReordenadas(v, sorteio)]))
}

/** O log embaralhado, com cópias de um terço dos eventos, cada um pela ida e volta por JSON e com as chaves reordenadas. */
function embaralhado(eventos: readonly Evento[], semente: number): unknown[] {
  const copias = eventos.filter((_, k) => k % 3 === 0)
  const sorteio = sorteioComSemente(String(semente))
  return sorteio
    .embaralhar([...eventos, ...copias])
    .map((e) => chavesReordenadas(JSON.parse(JSON.stringify(e)), sorteio))
}

/** Quantos ids distintos tem a época do log: do último perfil reiniciado, ou do primeiro criado, até o fim. */
function idsDaEpoca(eventos: readonly Evento[]): number {
  const unicos = [...new Map(eventos.map((e) => [e.id, e])).values()].sort(compararEventos)
  const reinicio = unicos.findLastIndex((e) => e.tipo === 'perfil-reiniciado')
  return unicos.length - (reinicio >= 0 ? reinicio : unicos.findIndex((e) => e.tipo === 'perfil-criado'))
}

/** Continua do estado dado com os passos, cada um reemitido com a origem que `origem` devolve. */
function continuar(
  inicio: EstadoMotor,
  passos: readonly PassoDoRoteiro[],
  origem: (p: PassoDoRoteiro) => PassoDoRoteiro['origem'] = (p) => p.origem,
): Transicao {
  let estado = inicio
  const eventos: Evento[] = []
  for (const passo of passos) {
    const t = desembrulhar(emitir(ctx, estado, passo.corpos, origem(passo)))
    estado = t.estado
    eventos.push(...t.eventos)
  }
  return { estado, eventos }
}

const comPassos = (roteiro: Roteiro, passos: readonly PassoDoRoteiro[]): Roteiro => ({ ...roteiro, passos })

/** Os passos sem o reinício do perfil; o passo que só tinha o reinício some. */
function semReinicio(passos: readonly PassoDoRoteiro[]): PassoDoRoteiro[] {
  return passos.flatMap((p): PassoDoRoteiro[] => {
    const [primeiro, ...resto] = p.corpos.filter((c) => c.tipo !== 'perfil-reiniciado')
    return primeiro === undefined ? [] : [{ ...p, corpos: [primeiro, ...resto] }]
  })
}

describe('o estado vivo e o reconstruído', () => {
  it('são iguais com o log embaralhado e com cópias, e o roteiro não absorve nada', () => {
    const vistos = new Set<string>()
    fc.assert(
      fc.property(escolhas, fc.nat(), (es, semente) => {
        const roteiro = gerarRoteiro(catalogo, es)
        for (const caso of casosDoRoteiro(roteiro)) vistos.add(caso)
        const vivo = reduzirRoteiro(ctx, roteiro)
        const { estado, relato } = desembrulhar(reconstruir(ctx, embaralhado(vivo.eventos, semente)))
        expect(instantaneoDoEstado(estado)).toStrictEqual(instantaneoDoEstado(vivo.estado))
        const anteriores = Math.max(
          0,
          vivo.eventos.findLastIndex((e) => e.tipo === 'perfil-reiniciado'),
        )
        expect(relato).toStrictEqual({
          duplicados: Math.ceil(vivo.eventos.length / 3),
          divergentes: 0,
          anterioresAEpoca: anteriores,
          catalogoTrocado: false,
          absorvidos: {},
        })
        expect(sorteioDoEstado(estado, 'teste').inteiro(0, 1e9)).toBe(
          sorteioDoEstado(vivo.estado, 'teste').inteiro(0, 1e9),
        )
        expect(conferirInvariantes(ctx, estado)).toEqual([])
      }),
      { numRuns: 60 },
    )
    expect([...vistos].sort()).toStrictEqual([...CASOS_DO_ROTEIRO].sort())
  })

  it('a união de dois aparelhos a partir de um prefixo comum reconstrói sem erro e sem perder evento', () => {
    fc.assert(
      fc.property(escolhas, escolhas, fc.nat(), (e1, e2, corte) => {
        const r1 = gerarRoteiro(catalogo, e1)
        const r2 = gerarRoteiro(catalogo, e2)
        const k = corte % (r1.passos.length + 1)
        const prefixo = reduzirRoteiro(ctx, comPassos(r1, r1.passos.slice(0, k)))
        const a = continuar(prefixo.estado, r1.passos.slice(k))
        // O outro aparelho continua com os passos de outro roteiro, sem o reinício dele, trinta dias à frente.
        const b = continuar(prefixo.estado, semReinicio(r2.passos), (p) => ({
          dispositivo: 'aparelho-c',
          agora: (p.origem.agora + 30 * DIA) as Instante,
          fusoMinutos: -540,
        }))
        const uniao = [...prefixo.eventos, ...a.eventos, ...prefixo.eventos, ...b.eventos]
        const r = reconstruir(ctx, embaralhado(uniao, corte))
        expect(r.ok).toBe(true)
        if (!r.ok) return
        expect(r.valor.estado.nEventos).toBe(idsDaEpoca(uniao))
        expect(conferirInvariantes(ctx, r.valor.estado)).toEqual([])
      }),
      { numRuns: 40 },
    )
  })

  it('dois aparelhos que começaram sem conta, unidos: a época abre no perfil criado mais antigo e guarda os dois', () => {
    fc.assert(
      fc.property(escolhas, escolhas, fc.boolean(), fc.nat(), (e1, e2, outroAntes, semente) => {
        const r1 = gerarRoteiro(catalogo, e1)
        const r2 = gerarRoteiro(catalogo, e2)
        // Sem os reinícios, a época só pode abrir num dos dois perfis criados.
        const passosA = semReinicio(r1.passos)
        const passosB = semReinicio(r2.passos)
        const a = reduzirRoteiro(ctx, comPassos(r1, passosA))
        // O outro aparelho cria o próprio perfil, com outra semente, e termina um dia antes do primeiro começar ou começa
        // um dia depois de ele terminar; os dois logs não se entremeiam, e o perfil mais antigo é sabido de antemão.
        const fim = (inicio: number, passos: readonly PassoDoRoteiro[]): number =>
          Math.max(inicio, ...passos.map((p) => p.origem.agora))
        const deslocamento = outroAntes
          ? -(fim(r2.inicio.origem.agora, passosB) - r2.inicio.origem.agora + DIA)
          : fim(r1.inicio.origem.agora, passosA) - r1.inicio.origem.agora + DIA
        const mover = (o: PassoDoRoteiro['origem']): PassoDoRoteiro['origem'] => ({
          dispositivo: 'aparelho-b',
          agora: (o.agora + deslocamento) as Instante,
          fusoMinutos: -540,
        })
        const sementeDoOutro = `${r2.inicio.corpo.semente}-outro`
        const b = reduzirRoteiro(ctx, {
          inicio: { corpo: { ...r2.inicio.corpo, semente: sementeDoOutro }, origem: mover(r2.inicio.origem) },
          passos: passosB.map((p) => ({ ...p, origem: mover(p.origem) })),
          inicioDaParteLivre: r2.inicioDaParteLivre,
        })
        const { estado, relato } = desembrulhar(reconstruir(ctx, embaralhado([...a.eventos, ...b.eventos], semente)))
        expect(estado.semente).toBe(outroAntes ? sementeDoOutro : r1.inicio.corpo.semente)
        expect(estado.nEventos).toBe(a.eventos.length + b.eventos.length)
        expect(relato.anterioresAEpoca).toBe(0)
        expect(relato.absorvidos['perfil-criado-na-epoca']).toBe(1)
        expect(conferirInvariantes(ctx, estado)).toEqual([])
      }),
      { numRuns: 30 },
    )
  })

  it('o sufixo a partir de um reinício reconstrói o mesmo estado que o log inteiro', () => {
    fc.assert(
      fc.property(escolhas, fc.nat(), fc.nat(), (es, posicao, semente) => {
        const roteiro = gerarRoteiro(catalogo, es)
        // O reinício cai na segunda metade, para o prefixo trazer a meta trocada, o diagnóstico e o XP.
        const metade = Math.floor(roteiro.passos.length / 2)
        const k = metade + (posicao % (roteiro.passos.length - metade + 1))
        const reinicio: PassoDoRoteiro = {
          corpos: [
            {
              tipo: 'perfil-reiniciado',
              semente: `r${String(semente)}`,
              catalogoHash: catalogo.hash,
              versaoModelo: VERSAO_MODELO,
            },
          ],
          origem: roteiro.passos[k]?.origem ?? roteiro.inicio.origem,
        }
        const vivo = reduzirRoteiro(ctx, comPassos(roteiro, roteiro.passos.toSpliced(k, 0, reinicio)))
        const sufixo = vivo.eventos.slice(vivo.eventos.findLastIndex((e) => e.tipo === 'perfil-reiniciado'))
        const doSufixo = desembrulhar(reconstruir(ctx, embaralhado(sufixo, semente))).estado
        const doTodo = desembrulhar(reconstruir(ctx, embaralhado(vivo.eventos, semente))).estado
        expect(instantaneoDoEstado(doSufixo)).toStrictEqual(instantaneoDoEstado(vivo.estado))
        expect(instantaneoDoEstado(doTodo)).toStrictEqual(instantaneoDoEstado(vivo.estado))
      }),
      { numRuns: 40 },
    )
  })
})

// Catálogo sem o item c e sem o grupo-2: o log gravado sobre o catálogo fixo cita o que ele não tem.
const semC = catalogoFixoSem('c' as IdItem, 'grupo-2')
const CONTEXTOS: readonly Readonly<{ nome: string; ctx: ContextoDeReducao }>[] = [
  { nome: 'todas as técnicas', ctx },
  { nome: 'técnicas desligadas, sem grupos no grafo', ctx: contexto(catalogo, TECNICAS_TODAS_DESLIGADAS) },
  { nome: 'catálogo trocado', ctx: contexto(semC) },
]

describe.each(CONTEXTOS)('o redutor é total ($nome)', ({ ctx: c }) => {
  it('todo log livre reconstrói, com as invariantes valendo, e o fold vivo não falha', () => {
    const vistos = new Set<string>()
    fc.assert(
      fc.property(escolhasDoLivre(400), (es) => {
        const log = gerarLogLivre(catalogo, es)
        for (const caso of casosDoLivre(log)) vistos.add(caso)
        const r = reconstruir(c, log)
        expect(r.ok).toBe(true)
        if (!r.ok) return
        expect(conferirInvariantes(c, r.valor.estado)).toEqual([])
        const [perfil, ...resto] = log
        if (perfil?.tipo !== 'perfil-criado') throw new Error('o log livre começa pelo perfil')
        let estado = desembrulhar(reconstruir(c, [perfil])).estado
        for (const e of resto) estado = reduzir(c, estado, e)
        expect(estado.nEventos).toBeGreaterThan(0)
      }),
      { numRuns: 150 },
    )
    expect([...vistos].sort()).toStrictEqual([...CASOS_DO_LIVRE].sort())
  })
})

describe('reduzir não muda o estado que recebe', () => {
  const intacto = (log: readonly Evento[]): void => {
    const [perfil, ...resto] = log
    if (perfil === undefined) return
    let estado = desembrulhar(reconstruir(ctx, [perfil])).estado
    for (const e of resto) {
      const antes = instantaneoDoEstado(estado)
      const depois = reduzir(ctx, estado, e)
      expect(instantaneoDoEstado(estado)).toStrictEqual(antes)
      estado = depois
    }
  }
  it('sobre o log livre', () => {
    const vistos = new Set<string>()
    fc.assert(
      fc.property(escolhasDoLivre(200), (es) => {
        const log = gerarLogLivre(catalogo, es)
        for (const caso of casosDoLivre(log)) vistos.add(caso)
        intacto(log)
      }),
      { numRuns: 60 },
    )
    expect([...vistos].sort()).toStrictEqual([...CASOS_DO_LIVRE].sort())
  })
  it('sobre o roteiro, e reconstruir não muda a lista que recebe', () => {
    fc.assert(
      fc.property(escolhas, (es) => {
        const { eventos } = reduzirRoteiro(ctx, gerarRoteiro(catalogo, es))
        intacto(eventos.filter((e) => e.tipo !== 'perfil-reiniciado'))
        const entrada = embaralhado(eventos, 1)
        const texto = JSON.stringify(entrada)
        reconstruir(ctx, entrada)
        expect(JSON.stringify(entrada)).toBe(texto)
      }),
      { numRuns: 15 },
    )
  })
})

describe('os eventos que o roteiro emite', () => {
  it('têm o id do próprio conteúdo, sem repetição, e instante inteiro estritamente crescente', () => {
    fc.assert(
      fc.property(escolhas, (es) => {
        const { eventos } = reduzirRoteiro(ctx, gerarRoteiro(catalogo, es))
        for (const { id, ...semId } of eventos) expect(idDeEvento(semId)).toBe(id)
        expect(new Set(eventos.map((e) => e.id)).size).toBe(eventos.length)
        eventos.forEach((e, k) => {
          expect(Number.isSafeInteger(e.em)).toBe(true)
          if (k > 0) expect(e.em).toBeGreaterThan(eventos[k - 1]?.em ?? Infinity)
        })
      }),
      { numRuns: 40 },
    )
  })

  it('cobrem todo tipo de tarefa e cada caminho da parte obrigatória, em todo roteiro', () => {
    fc.assert(
      fc.property(escolhas, (es) => {
        const roteiro = gerarRoteiro(catalogo, es)
        const corpos = roteiro.passos.flatMap((p) => p.corpos)
        const tarefas = corpos.flatMap((c) => (c.tipo === 'tarefa-iniciada' ? [c.tarefa] : []))
        const contar = (tipo: string): number => tarefas.filter((t) => t.tipo === tipo).length
        for (const tipo of ['licao', 'revisao', 'quiz', 'remediacao'] as const) expect(contar(tipo)).toBeGreaterThan(0)
        // Duas tarefas de grupo, a completa e a interrompida, mais a lição de família.
        expect(contar('revisao-grupo')).toBeGreaterThanOrEqual(2)
        expect(tarefas.filter((t) => t.tipo === 'licao' && t.passos.length > 0).length).toBeGreaterThan(0)
        expect(corpos.filter((c) => c.tipo === 'licao-concluida' && c.acelerada).length).toBeGreaterThan(0)
        expect(corpos.filter((c) => c.tipo === 'licao-adiada').length).toBeGreaterThan(0)
        expect(corpos.filter((c) => c.tipo === 'remediacao-concluida').length).toBeGreaterThan(0)
        expect(corpos.filter((c) => c.tipo === 'meta-diaria-alterada').length).toBeGreaterThanOrEqual(2)
        const diagnostico = corpos.filter((c) => c.tipo === 'diagnostico-encerrado' || c.tipo === 'diagnostico-pulado')
        expect(diagnostico.length).toBeGreaterThan(0)
        expect(new Set(roteiro.passos.map((p) => p.origem.dispositivo)).size).toBeGreaterThan(1)
        expect(new Set(roteiro.passos.map((p) => p.origem.fusoMinutos)).size).toBeGreaterThan(1)
        // Todo tipo de tarefa, menos o diagnóstico, que não abre tarefa.
        expect(new Set(tarefas.map((t) => t.tipo))).toEqual(new Set(TIPOS_DE_TAREFA.filter((t) => t !== 'diagnostico')))
      }),
      { numRuns: 40 },
    )
  })
})
