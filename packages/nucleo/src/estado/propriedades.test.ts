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
import { sorteioComSemente } from '../base/sorteio-com-semente'
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
// entre o estado vivo e o reconstruído; o livre, incoerente de propósito, para a totalidade. As listas de escolhas são
// curtas porque cada roteiro já traz a parte obrigatória, de umas centenas de eventos, e cada execução o reduz mais de
// uma vez.

const catalogo = catalogoFixo()
const contexto = (cat: Catalogo = catalogo, tecnicas: Tecnicas = TECNICAS_TODAS_LIGADAS): ContextoDeReducao =>
  desembrulhar(criarContextoDeReducao({ catalogo: cat, tecnicas, parametros: PARAMETROS_PADRAO }))
const ctx = contexto()
const escolhas = fc.array(fc.nat(), { maxLength: 60 })
const DIA = 86_400_000

/** O log embaralhado, com cópias de um terço dos eventos e as chaves reordenadas pela ida e volta por JSON. */
function embaralhado(eventos: readonly Evento[], semente: number): unknown[] {
  const copias = eventos.filter((_, k) => k % 3 === 0)
  return sorteioComSemente(String(semente))
    .embaralhar([...eventos, ...copias])
    .map((e) => JSON.parse(JSON.stringify(e)) as unknown)
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

describe('o estado vivo e o reconstruído', () => {
  it('são iguais com o log embaralhado e com cópias, e o roteiro não absorve nada', () => {
    fc.assert(
      fc.property(escolhas, fc.nat(), (es, semente) => {
        const vivo = reduzirRoteiro(ctx, gerarRoteiro(catalogo, es))
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
        const semReinicio = r2.passos.flatMap((p): PassoDoRoteiro[] => {
          const corpos = p.corpos.filter((c) => c.tipo !== 'perfil-reiniciado')
          const [primeiro, ...resto] = corpos
          return primeiro === undefined ? [] : [{ ...p, corpos: [primeiro, ...resto] }]
        })
        const b = continuar(prefixo.estado, semReinicio, (p) => ({
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
    fc.assert(
      fc.property(fc.array(fc.nat(), { maxLength: 400 }), (es) => {
        const log = gerarLogLivre(catalogo, es)
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
    fc.assert(
      fc.property(fc.array(fc.nat(), { maxLength: 200 }), (es) => {
        intacto(gerarLogLivre(catalogo, es))
      }),
      { numRuns: 60 },
    )
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
