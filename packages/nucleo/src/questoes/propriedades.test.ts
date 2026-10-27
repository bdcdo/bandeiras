import fc from 'fast-check'
import { describe, expect, it } from 'vitest'
import { catalogoDe, type EspecificacaoDeCatalogo } from '../apoio-a-testes/catalogo-de-teste'
import { estadoDeTeste } from '../apoio-a-testes/estado-de-teste'
import { desembrulhar } from '../base/resultado'
import { sorteioComSemente } from '../base/sorteio-com-semente'
import type { Catalogo, IdItem } from '../catalogo/tipos'
import { topicoDeItem, type IdTopico } from '../grafo/topico'
import type { EstadoMemoria } from '../memoria'
import { resolverParametros, type Parametros } from '../memoria/parametros'
import {
  chaveDeOpcoes,
  contextoDeSessao,
  registrarApresentacao,
  registrarQuestao,
  type ContextoDeSessao,
} from './contexto-de-sessao'
import { escolherDistratores, type ModoDeDistratores } from './distratores'
import { gerarQuestao, type PedidoDeQuestao } from './gerar-questao'
import { parceirosIndiscerniveis } from './pares'
import { opcoesDe, type Questao } from './questao'
import { gerarQuestoesDeGrupo } from './tarefa-de-grupo'

// Catálogos genéricos sorteados: de 8 a 20 itens com ids de letra, até quatro classes e três categorias, até quatro
// grupos de dois a cinco membros, metade deles com par indiscernível, até quatro vizinhos e duas vizinhanças ao acaso.
const especificacao: fc.Arbitrary<EspecificacaoDeCatalogo> = fc.integer({ min: 8, max: 20 }).chain((n) =>
  fc.record({
    classes: fc.array(fc.integer({ min: 1, max: 4 }), { minLength: n, maxLength: n }),
    categorias: fc.array(fc.integer({ min: 1, max: 3 }), { minLength: n, maxLength: n }),
    aliases: fc.array(fc.nat(2), { minLength: n, maxLength: n }),
    vizinhos: fc.array(fc.array(fc.nat(n - 1), { maxLength: 4 }), { minLength: n, maxLength: n }),
    grupos: fc.array(
      fc.record({ membros: fc.array(fc.nat(n - 1), { minLength: 2, maxLength: 5 }), par: fc.boolean() }),
      { maxLength: 4 },
    ),
    vizinhancas: fc.array(fc.array(fc.nat(n - 1), { minLength: 2, maxLength: 4 }), { maxLength: 2 }),
  }),
)

const USOS = ['kp1', 'kp2', 'kp3', 'sondar', 'confirmar', 'revisao', 'discriminacao'] as const
type Uso = (typeof USOS)[number]

function pedidoDe(uso: Uso, item: IdItem): PedidoDeQuestao {
  switch (uso) {
    case 'kp1':
      return { tipo: 'licao', item, kp: 1 }
    case 'kp2':
      return { tipo: 'licao', item, kp: 2 }
    case 'kp3':
      return { tipo: 'licao', item, kp: 3 }
    case 'sondar':
      return { tipo: 'sondagem', item, etapa: 'recordar' }
    case 'confirmar':
      return { tipo: 'sondagem', item, etapa: 'confirmar' }
    case 'revisao':
      return { tipo: 'revisao', item }
    case 'discriminacao':
      return { tipo: 'discriminacao', item }
  }
}

// Um passo da sessão: uma questão isolada (com `doPar`, sobre um item de par indiscernível, para a regra do par ser
// exercitada com frequência), uma tarefa de grupo ou a apresentação de um item.
type Passo =
  | { tipo: 'questao'; uso: Uso; k: number; doPar: boolean }
  | { tipo: 'grupo'; g: number; alvos: number[] }
  | { tipo: 'apresentar'; k: number }

const passo: fc.Arbitrary<Passo> = fc.oneof(
  fc.record({ tipo: fc.constant('questao' as const), uso: fc.constantFrom(...USOS), k: fc.nat(), doPar: fc.boolean() }),
  fc.record({
    tipo: fc.constant('grupo' as const),
    g: fc.nat(),
    alvos: fc.array(fc.nat(), { minLength: 1, maxLength: 3 }),
  }),
  fc.record({ tipo: fc.constant('apresentar' as const), k: fc.nat() }),
)

const acuracia = fc.double({ min: 0, max: 1, noNaN: true })
const sessao = fc.record({
  espec: especificacao,
  // Um item em cada quatro, em média, com lição pendente: com mais, quase toda tarefa de grupo cairia por alvo não
  // apresentado, e a regra dos exibidos quase não seria exercitada.
  pendentes: fc.array(
    fc.nat(3).map((x) => x === 0),
    { minLength: 20, maxLength: 20 },
  ),
  aprendidos: fc.array(fc.boolean(), { minLength: 20, maxLength: 20 }),
  direcoes: fc.array(fc.tuple(acuracia, acuracia, acuracia), { minLength: 20, maxLength: 20 }),
  passos: fc.array(passo, { minLength: 1, maxLength: 12 }),
  opcoes: fc.constantFrom(3, 4, 5),
  usos: fc.constantFrom(1, 2, 3),
  minimasDeGrupo: fc.constantFrom(3, 4, 5),
  semente: fc.string({ maxLength: 8 }),
})
type Sessao = typeof sessao extends fc.Arbitrary<infer S> ? S : never

/** Uma questão gerada, com o contexto em que foi gerada e o pedido que a gerou, se isolada. */
// `passo` é o índice do passo da sessão que gerou a questão: as questões de uma tarefa de grupo têm o mesmo.
type Registro = { questao: Questao; antes: ContextoDeSessao; passo: number; uso?: Uso }

type Simulacao = { catalogo: Catalogo; parametros: Parametros; registros: Registro[] }

/** Roda a sessão: cada questão gerada vai para os registros e, depois, para o contexto. */
function simular(s: Sessao): Simulacao {
  const catalogo = catalogoDe(s.espec)
  const parametros = desembrulhar(
    resolverParametros({
      opcoesMultiplaEscolha: s.opcoes,
      usosMaximosComoDistrator: s.usos,
      opcoesMinimasDeGrupo: s.minimasDeGrupo,
    }),
  )
  const itens = [...catalogo.itens.keys()]
  const item = (k: number): IdItem => itens[k % itens.length] as IdItem
  const pares = [...catalogo.grupos.values()].flatMap((g) => g.paresIndiscerniveis ?? [])
  const memorias = new Map<IdTopico, EstadoMemoria>(
    itens.map((id, k) => {
      const [reconhecer, produzir, recordar] = s.direcoes[k] ?? [0.85, 0.85, 0.85]
      return [topicoDeItem(id).id, estadoDeTeste({ porDirecao: { reconhecer, produzir, recordar } })]
    }),
  )
  const sorteio = sorteioComSemente(s.semente)
  let ctx = contextoDeSessao({
    pendentesNovas: itens.filter((_, k) => s.pendentes[k] === true),
    aprendidos: itens.filter((_, k) => s.aprendidos[k] === true),
  })
  const registros: Registro[] = []
  for (const [indice, p] of s.passos.entries()) {
    if (p.tipo === 'apresentar') {
      ctx = registrarApresentacao(ctx, item(p.k))
    } else if (p.tipo === 'questao') {
      const par = pares[p.k % Math.max(1, pares.length)]
      const alvo = p.doPar && par !== undefined ? (par[p.k % 2] ?? par[0]) : item(p.k)
      const r = gerarQuestao(pedidoDe(p.uso, alvo), catalogo, ctx, sorteio, parametros)
      if (r.ok) {
        registros.push({ questao: r.valor, antes: ctx, passo: indice, uso: p.uso })
        ctx = registrarQuestao(ctx, r.valor)
      }
    } else {
      const grupos = [...catalogo.grupos.values()]
      const grupo = grupos[p.g % Math.max(1, grupos.length)]
      if (grupo === undefined) continue
      const alvos = [...new Set(p.alvos.map((k) => grupo.membros[k % grupo.membros.length] as IdItem))]
      const r = gerarQuestoesDeGrupo(grupo.id, alvos, memorias, catalogo, ctx, sorteio, parametros)
      if (r.ok) for (const questao of r.valor) registros.push({ questao, antes: ctx, passo: indice })
    }
  }
  return { catalogo, parametros, registros }
}

const ehMultiplaEscolha = (q: Questao): boolean =>
  q.formato.tipo === 'estimulo-para-rotulo' || q.formato.tipo === 'rotulo-para-estimulo'
const isolada = (q: Questao): boolean => q.contexto.tipo === 'isolada'
const exibidosDe = (q: Questao): readonly IdItem[] => (q.contexto.tipo === 'grupo' ? q.contexto.exibidos : [])

/** Pares indiscerníveis do catálogo com os dois itens na lista. */
function paresDentro(catalogo: Catalogo, lista: readonly IdItem[]): string[] {
  const conjunto = new Set(lista)
  return [...catalogo.grupos.values()]
    .flatMap((g) => g.paresIndiscerniveis ?? [])
    .filter(([a, b]) => conjunto.has(a) && conjunto.has(b))
    .map(([a, b]) => `${a}|${b}`)
}

/** As questões de cada tarefa de grupo da sessão, na ordem em que a tarefa as devolveu. */
function tarefasDeGrupo(registros: readonly Registro[]): Questao[][] {
  const porTarefa = new Map<number, Questao[]>()
  for (const { questao, passo } of registros) {
    if (questao.contexto.tipo === 'grupo') porTarefa.set(passo, [...(porTarefa.get(passo) ?? []), questao])
  }
  return [...porTarefa.values()]
}

// Contagens fora das propriedades, para a suíte reprovar se o gerador parar de produzir os casos que elas conferem.
const vistos = {
  multiplaIsolada: 0,
  deParecidos: 0,
  deGrupo: 0,
  grupoMembros: 0,
  comPendentes: 0,
  digitadoComOpcoes: 0,
}

describe('propriedades das questões numa sessão sorteada', () => {
  it('nenhuma questão de múltipla escolha, isolada ou de grupo, tem os dois itens de um par como opções', () => {
    fc.assert(
      fc.property(sessao, (s) => {
        const { catalogo, registros } = simular(s)
        for (const { questao, uso } of registros) {
          if (uso === 'confirmar' || uso === 'discriminacao') vistos.deParecidos++
          if (ehMultiplaEscolha(questao)) expect(paresDentro(catalogo, opcoesDe(questao.formato))).toEqual([])
          expect(paresDentro(catalogo, exibidosDe(questao))).toEqual([])
          if (questao.contexto.tipo === 'grupo') vistos.deGrupo++
        }
      }),
    )
  })

  it('nenhum item de lição pendente é opção nem exibido antes da apresentação', () => {
    fc.assert(
      fc.property(sessao, (s) => {
        for (const { questao, antes } of simular(s).registros) {
          if (antes.pendentesNovas.size > 0) vistos.comPendentes++
          const outros = [...opcoesDe(questao.formato), ...exibidosDe(questao)].filter((o) => o !== questao.itemAlvo)
          expect(outros.filter((o) => antes.pendentesNovas.has(o))).toEqual([])
        }
      }),
    )
  })

  it('nenhum item é distrator de questão isolada mais vezes que o parâmetro na sessão', () => {
    fc.assert(
      fc.property(sessao, (s) => {
        const { parametros, registros } = simular(s)
        // Conta pelas questões, e não pelo contexto, para a propriedade não depender de registrarQuestao estar certo.
        const usos = new Map<IdItem, number>()
        for (const { questao } of registros) {
          if (!isolada(questao) || !ehMultiplaEscolha(questao)) continue
          for (const o of opcoesDe(questao.formato)) if (o !== questao.itemAlvo) usos.set(o, (usos.get(o) ?? 0) + 1)
        }
        for (const vezes of usos.values()) expect(vezes).toBeLessThanOrEqual(parametros.usosMaximosComoDistrator)
      }),
    )
  })

  it('a múltipla escolha isolada tem o tamanho pedido, sem repetição, com o alvo uma vez', () => {
    fc.assert(
      fc.property(sessao, (s) => {
        const { parametros, registros } = simular(s)
        for (const { questao } of registros.filter((r) => isolada(r.questao) && ehMultiplaEscolha(r.questao))) {
          vistos.multiplaIsolada++
          const opcoes = opcoesDe(questao.formato)
          expect(opcoes).toHaveLength(parametros.opcoesMultiplaEscolha)
          expect(new Set(opcoes).size).toBe(opcoes.length)
          expect(opcoes.filter((o) => o === questao.itemAlvo)).toHaveLength(1)
        }
      }),
    )
  })

  it('a tarefa de grupo chega às opções mínimas, deixa duas sobrando e recorda metade dos alvos que podem', () => {
    fc.assert(
      fc.property(sessao, (s) => {
        const { catalogo, parametros, registros } = simular(s)
        for (const questoes of tarefasDeGrupo(registros)) {
          const exibidos = exibidosDe(questoes[0] as Questao)
          expect(exibidos.length).toBeGreaterThanOrEqual(parametros.opcoesMinimasDeGrupo)
          const alvos = new Set(questoes.map((q) => q.itemAlvo))
          expect(alvos.size).toBeLessThanOrEqual(exibidos.length - 2)
          const deParDeTarefa = questoes.filter((q) => parceirosIndiscerniveis(q.itemAlvo, catalogo).size > 0)
          for (const q of deParDeTarefa) {
            vistos.grupoMembros++
            expect(q.formato.tipo).toBe('grupo-membros')
            for (const parceiro of parceirosIndiscerniveis(q.itemAlvo, catalogo)) {
              expect(opcoesDe(q.formato)).toContain(parceiro)
              expect(exibidos).not.toContain(parceiro)
            }
          }
          const recordando = questoes.filter((q) => q.formato.tipo === 'rotulo-digitado').length
          const podem = questoes.length - deParDeTarefa.length
          expect(recordando).toBeGreaterThanOrEqual(Math.min(podem, Math.ceil(alvos.size / 2)))
        }
      }),
    )
  })

  it('na tarefa de grupo, nenhum rótulo digitado vem depois de uma questão cujas opções contêm o alvo dele', () => {
    fc.assert(
      fc.property(sessao, (s) => {
        for (const questoes of tarefasDeGrupo(simular(s).registros)) {
          const formatos = new Set(questoes.map((q) => q.formato.tipo))
          if (formatos.has('rotulo-digitado') && formatos.size > 1) vistos.digitadoComOpcoes++
          const mostradas = new Set<IdItem>()
          for (const q of questoes) {
            if (q.formato.tipo === 'rotulo-digitado') expect(mostradas.has(q.itemAlvo)).toBe(false)
            for (const o of opcoesDe(q.formato)) mostradas.add(o)
          }
        }
      }),
    )
  })

  it('no grupo-membros, os rótulos errados fora da fileira são ao menos tantos quanto os certos, e ao menos um', () => {
    // A ordem entre grupo-membros e estimulo-para-rotulo e as mesmas opções em todo grupo-membros da tarefa ficam com os
    // casos fixos de tarefa-de-grupo.test.ts: com até três alvos, como aqui, a metade recordando não deixa um
    // grupo-membros com uma estimulo-para-rotulo na mesma tarefa, e o gerador quase nunca põe dois alvos de par juntos.
    fc.assert(
      fc.property(sessao, (s) => {
        const { catalogo, registros } = simular(s)
        for (const questoes of tarefasDeGrupo(registros)) {
          const exibidos = new Set(exibidosDe(questoes[0] as Questao))
          for (const q of questoes.filter((x) => x.formato.tipo === 'grupo-membros')) {
            const certos = new Set([q.itemAlvo, ...parceirosIndiscerniveis(q.itemAlvo, catalogo)])
            const foraDaFileira = opcoesDe(q.formato).filter((o) => !exibidos.has(o))
            const certosFora = foraDaFileira.filter((o) => certos.has(o)).length
            expect(foraDaFileira.length - certosFora).toBeGreaterThanOrEqual(Math.max(1, certosFora))
          }
        }
      }),
    )
  })

  it('o gerador produz os casos que as propriedades conferem', () => {
    // Roda depois das propriedades acima, no mesmo arquivo: o Vitest executa os testes de um arquivo em ordem. Os pisos
    // ficam perto de um terço do que três rodadas de 100 sessões mediram (de 83 a 95 múltiplas escolhas isoladas, de 48
    // a 66 questões de parecidos, de 49 a 84 de grupo, de 12 a 16 de grupo-membros e de 208 a 226 com pendentes). As
    // tarefas de grupo com um rótulo digitado e uma questão de outro formato, que a ordem da tarefa protege, mediram de 9
    // a 17.
    expect(vistos.multiplaIsolada).toBeGreaterThan(40)
    expect(vistos.deParecidos).toBeGreaterThan(20)
    expect(vistos.deGrupo).toBeGreaterThan(20)
    expect(vistos.grupoMembros).toBeGreaterThan(3)
    expect(vistos.comPendentes).toBeGreaterThan(100)
    expect(vistos.digitadoComOpcoes).toBeGreaterThan(3)
  })
})

describe('distratores com um item em pares de dois grupos', () => {
  // A sessão sorteada de cima quase nunca põe um item em dois pares; aqui todo catálogo ganha dois grupos com par que
  // dividem um item, o que faz a barragem dos parceiros depender da ordem do sorteio.
  const comCadeia = fc
    .record({ espec: especificacao, x: fc.nat(), y: fc.nat(), z: fc.nat() })
    .map(({ espec, x, y, z }): EspecificacaoDeCatalogo => {
      const n = espec.classes.length
      const par = (outro: number) => ({ membros: [x % n, outro % n], par: true })
      return { ...espec, grupos: [...espec.grupos, par(y), par(z)] }
    })

  it('o que o pool rende não depende da semente, e o sorteio tem n itens sem par, com o conjunto já mostrado ou não', () => {
    fc.assert(
      fc.property(
        comCadeia,
        fc.nat(),
        fc.constantFrom<ModoDeDistratores>('dissimilares', 'parecidos'),
        fc.integer({ min: 0, max: 6 }),
        fc.string({ maxLength: 8 }),
        fc.string({ maxLength: 8 }),
        (espec, k, modo, n, semente, outraSemente) => {
          const catalogo = catalogoDe(espec)
          const itens = [...catalogo.itens.keys()]
          const alvo = itens[k % itens.length] as IdItem
          const parametros = desembrulhar(resolverParametros({}))
          const escolher = (ctx: ContextoDeSessao, s: string) =>
            escolherDistratores(alvo, modo, n, catalogo, ctx, sorteioComSemente(s), parametros)
          const vazio = contextoDeSessao({})
          const uma = escolher(vazio, semente)
          expect(escolher(vazio, outraSemente).ok).toBe(uma.ok)
          if (!uma.ok) return
          const usado = { ...vazio, conjuntosUsados: new Set([chaveDeOpcoes([alvo, ...uma.valor])]) }
          for (const valor of [uma.valor, desembrulhar(escolher(usado, outraSemente))]) {
            expect(valor).toHaveLength(n)
            expect(paresDentro(catalogo, valor)).toEqual([])
          }
        },
      ),
    )
  })
})

describe('determinismo da geração', () => {
  it('o mesmo pedido, com o mesmo contexto e a mesma semente, dá a mesma questão e o mesmo id', () => {
    fc.assert(
      fc.property(
        especificacao,
        fc.constantFrom(...USOS),
        fc.nat(),
        fc.string({ maxLength: 8 }),
        (espec, uso, k, semente) => {
          const catalogo = catalogoDe(espec)
          const itens = [...catalogo.itens.keys()]
          const alvo = itens[k % itens.length] as IdItem
          const ctx = contextoDeSessao({ aprendidos: itens.filter((_, j) => j % 2 === 0) })
          const parametros = desembrulhar(resolverParametros({}))
          const uma = gerarQuestao(pedidoDe(uso, alvo), catalogo, ctx, sorteioComSemente(semente), parametros)
          const outra = gerarQuestao(pedidoDe(uso, alvo), catalogo, ctx, sorteioComSemente(semente), parametros)
          expect(outra).toEqual(uma)
          if (uma.ok && outra.ok) expect(outra.valor.id).toBe(uma.valor.id)
        },
      ),
    )
  })
})
