import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { catalogoFixoSem } from '../apoio-a-testes/catalogo-de-teste'
import {
  abrirSessaoNaCena,
  contextoDosCasos,
  emitirUm,
  HORA,
  INICIO_DA_CENA,
  licaoDeItem,
  novaCena,
  type Cena,
} from '../apoio-a-testes/cena-do-estado'
import { instantaneoDoEstado } from '../apoio-a-testes/instantaneo-do-estado'
import { desembrulhar } from '../base/resultado'
import type { Instante } from '../base/tempo'
import type { IdItem } from '../catalogo/tipos'
import { criarEvento, VERSAO_MODELO, type Evento } from '../eventos'
import { topicoDeItem } from '../grafo'
import { PARAMETROS_PADRAO } from '../memoria'
import { conferirInvariantes } from './invariantes'
import { reconstruir } from './reconstruir'
import { estadoDoPerfil, reduzir } from './reduzir'

const ctx = contextoDosCasos()
const I = (id: string): IdItem => id as IdItem
const copia = (eventos: readonly unknown[]): unknown[] => JSON.parse(JSON.stringify(eventos)) as unknown[]
const ID_LIVRE = 'ffffffffffffffff'

/** Uma cena com uma sessão, a lição de `item` e a sessão encerrada. */
function cenaComLicao(item: string, campos: Parameters<typeof novaCena>[1] = {}): Cena {
  const c = novaCena(ctx, campos)
  abrirSessaoNaCena(c, [I(item)])
  licaoDeItem(c, I(item))
  emitirUm(c, { tipo: 'sessao-encerrada', motivo: 'usuario' })
  return c
}

describe('reconstruir sobre o log de referência', () => {
  // O log de referência cobre cada tipo e cada variante, não uma história coerente: começa num perfil reiniciado, tem
  // um perfil criado dentro da época, um diagnóstico pulado depois de encerrado, uma tarefa de grupo sobre itens sem
  // grupo e uma remediação de item sem confusão. O relato e o estado ficam presos aqui; mudar um deles muda o que um
  // aparelho com esse log gravado vê ao abrir o app.
  const bruto = JSON.parse(
    readFileSync(new URL('../eventos/log-de-referencia.json', import.meta.url), 'utf8'),
  ) as readonly unknown[]
  const padrao = contextoDosCasos({ parametros: PARAMETROS_PADRAO })

  it('reconstrói, com o relato e o estado de sempre', () => {
    const { estado, relato } = desembrulhar(reconstruir(padrao, bruto))
    expect(relato).toStrictEqual({
      duplicados: 0,
      divergentes: 0,
      anterioresAEpoca: 0,
      catalogoTrocado: false,
      absorvidos: {
        'perfil-criado-na-epoca': 1,
        'diagnostico-fora-de-ordem': 1,
        'tarefa-de-grupo-sem-alvo-valido': 1,
        'remediacao-sem-par-confundido': 1,
      },
    })
    expect(conferirInvariantes(padrao, estado)).toStrictEqual([])
    expect(estado.nEventos).toBe(33)
    expect(estado.semente).toBe('42')
    expect(estado.diagnostico).toBe('encerrado')
    expect(estado.metaDiariaXp).toBe(20)
    expect(estado.sessao).toBeUndefined()
    expect(estado.tarefa).toBeUndefined()
    expect([...estado.licoes]).toStrictEqual([
      ['item:g', { status: 'concluida', em: 1760000630000, acelerada: false, viaDiagnostico: false }],
      ['item:h', { status: 'concluida', em: 1760000810000, acelerada: true, viaDiagnostico: false }],
      ['item:i', { status: 'adiada', liberadoEm: 1760087795000, tentativas: 1, kpDaFalha: 1 }],
    ])
    expect([...estado.memorias.keys()]).toStrictEqual(['item:g', 'item:h'])
    expect([...estado.confusoes]).toStrictEqual([['f\u001fh', 1]])
    expect([...estado.metaPorDia]).toStrictEqual([['2025-10-09', 20]])
    expect([...estado.xpPorDia.keys()]).toStrictEqual(['2025-10-09'])
    expect(estado.xpPorDia.get('2025-10-09' as never)).toBeCloseTo(1.962, 9)
  })

  it('reconstrói o mesmo estado com o log de trás para a frente', () => {
    const direto = desembrulhar(reconstruir(padrao, bruto))
    const invertido = desembrulhar(reconstruir(padrao, [...bruto].reverse()))
    expect(instantaneoDoEstado(invertido.estado)).toStrictEqual(instantaneoDoEstado(direto.estado))
  })
})

describe('reconstruir: erros, na ordem das regras', () => {
  const c = cenaComLicao('k')
  const [perfil, ...resto] = c.eventos as [Evento, ...Evento[]]
  const desconhecido = { ...resto[0], id: ID_LIVRE, tipo: 'tipo-novo' }

  it('lista vazia, ou sem perfil, dá SEM_PERFIL', () => {
    for (const log of [[], copia(resto)]) {
      const r = reconstruir(ctx, log)
      expect(r.ok ? undefined : r.erro).toStrictEqual({
        codigo: 'SEM_PERFIL',
        detalhe: 'o log não tem perfil-criado nem perfil-reiniciado',
        ocorrencias: [],
      })
    }
  })

  it('envelope malformado vem antes da falta de perfil, com o índice e o id quando ele se lê', () => {
    const log = [...copia(resto), { ...resto[1], fusoMinutos: Number.NaN }, 'nem objeto']
    const r = reconstruir(ctx, log)
    expect(r.ok).toBe(false)
    if (r.ok) return
    expect(r.erro.codigo).toBe('EVENTO_MALFORMADO')
    expect(r.erro.ocorrencias.map((o) => [o.indice, o.id])).toStrictEqual([
      [resto.length, resto[1]?.id],
      [resto.length + 1, undefined],
    ])
    expect(r.erro.detalhe).toMatch(/^2 evento\(s\): \[\d+\] .+; \[\d+\] .+$/)
  })

  it('tipo desconhecido na época dá VERSAO_DE_MODELO_FUTURA, antes do corpo malformado', () => {
    const corpoRuim = { ...resto[1], tipo: 'meta-diaria-alterada', xp: -1 }
    const r = reconstruir(ctx, [...copia(c.eventos), desconhecido, corpoRuim])
    expect(r.ok ? undefined : r.erro.codigo).toBe('VERSAO_DE_MODELO_FUTURA')
    expect(r.ok ? [] : r.erro.ocorrencias).toStrictEqual([
      { indice: c.eventos.length, id: ID_LIVRE, motivo: "tipo que esta versão não conhece: 'tipo-novo'" },
    ])
  })

  it('perfil de versão acima da desta dá VERSAO_DE_MODELO_FUTURA', () => {
    const futuro = { ...perfil, versaoModelo: VERSAO_MODELO + 1 }
    const r = reconstruir(ctx, [futuro, ...copia(resto)])
    expect(r.ok ? undefined : r.erro.codigo).toBe('VERSAO_DE_MODELO_FUTURA')
    expect(r.ok ? [] : r.erro.ocorrencias.map((o) => o.indice)).toStrictEqual([0])
  })

  it('corpo malformado na época dá EVENTO_MALFORMADO, com o índice', () => {
    const corpoRuim = { ...resto[1], id: ID_LIVRE, tipo: 'meta-diaria-alterada', xp: -1 }
    const r = reconstruir(ctx, [...copia(c.eventos), corpoRuim])
    expect(r.ok ? undefined : r.erro.codigo).toBe('EVENTO_MALFORMADO')
    expect(r.ok ? [] : r.erro.ocorrencias.map((o) => [o.indice, o.id])).toStrictEqual([[c.eventos.length, ID_LIVRE]])
  })

  it('tipo desconhecido e corpo malformado antes da época são ignorados e contam no relato', () => {
    const antes = (k: number) => ({ ...resto[0], id: `${'0'.repeat(15)}${String(k)}`, em: perfil.em - 10 + k })
    const log = [
      { ...antes(1), tipo: 'tipo-novo' },
      { ...antes(2), tipo: 'meta-diaria-alterada', xp: -1 },
      ...copia(c.eventos),
    ]
    const { estado, relato } = desembrulhar(reconstruir(ctx, log))
    expect(relato.anterioresAEpoca).toBe(2)
    expect(instantaneoDoEstado(estado)).toStrictEqual(instantaneoDoEstado(c.estado))
  })
})

describe('reconstruir: deduplicação', () => {
  const c = cenaComLicao('k')
  const meta = emitirUm(c, { tipo: 'meta-diaria-alterada', xp: 20 })

  it('duplicata ignorada: nEventos conta os ids distintos', () => {
    const { estado, relato } = desembrulhar(reconstruir(ctx, copia([...c.eventos, meta, meta])))
    expect(relato.duplicados).toBe(2)
    expect(relato.divergentes).toBe(0)
    expect(estado.nEventos).toBe(c.eventos.length)
    expect(instantaneoDoEstado(estado)).toStrictEqual(instantaneoDoEstado(c.estado))
  })

  it('duas versões do mesmo id dão o mesmo estado nas duas ordens de entrada, com a menor serialização', () => {
    const outra = { ...meta, xp: 30 }
    const base = copia(c.eventos.slice(0, -1))
    const primeiro = desembrulhar(reconstruir(ctx, [...base, meta, outra]))
    const segundo = desembrulhar(reconstruir(ctx, [...base, outra, meta]))
    expect(primeiro.relato).toStrictEqual({ ...segundo.relato, divergentes: 1, duplicados: 0 })
    expect(instantaneoDoEstado(segundo.estado)).toStrictEqual(instantaneoDoEstado(primeiro.estado))
    expect(primeiro.estado.metaDiariaXp).toBe(20)
  })
})

describe('reconstruir: época e união', () => {
  it('dois perfis anônimos unidos: a época abre no primeiro perfil criado e guarda o estudo dos dois', () => {
    const a = cenaComLicao('k')
    const b = cenaComLicao('l', { agora: INICIO_DA_CENA + HORA, dispositivo: 'aparelho-b', semente: 'outra' })
    const { estado, relato } = desembrulhar(reconstruir(ctx, copia([...b.eventos, ...a.eventos])))
    expect(relato).toStrictEqual({
      duplicados: 0,
      divergentes: 0,
      anterioresAEpoca: 0,
      catalogoTrocado: false,
      absorvidos: { 'perfil-criado-na-epoca': 1 },
    })
    expect(estado.semente).toBe('semente')
    expect(estado.nEventos).toBe(a.eventos.length + b.eventos.length)
    expect([...estado.licoes.keys()]).toStrictEqual([topicoDeItem(I('k')).id, topicoDeItem(I('l')).id])
  })

  it('perfil-reiniciado abre a época e zera tudo, a meta e as metas por dia inclusive', () => {
    const c = cenaComLicao('k')
    emitirUm(c, { tipo: 'meta-diaria-alterada', xp: 30 })
    const quantos = c.eventos.length
    const reinicio = emitirUm(c, {
      tipo: 'perfil-reiniciado',
      semente: 'nova',
      catalogoHash: ctx.catalogo.hash,
      versaoModelo: 1,
    })
    if (reinicio.tipo !== 'perfil-reiniciado') throw new Error('perfil reiniciado esperado')
    expect(instantaneoDoEstado(c.estado)).toStrictEqual(instantaneoDoEstado(estadoDoPerfil(ctx, reinicio)))
    abrirSessaoNaCena(c, [I('l')])
    licaoDeItem(c, I('l'))
    const { estado, relato } = desembrulhar(reconstruir(ctx, copia(c.eventos)))
    expect(relato.anterioresAEpoca).toBe(quantos)
    expect(estado.nEventos).toBe(c.eventos.length - quantos)
    expect(estado.metaPorDia.size).toBe(0)
    expect(estado.metaDiariaXp).toBe(ctx.parametros.orcamentoPadraoMin)
    expect(instantaneoDoEstado(estado)).toStrictEqual(instantaneoDoEstado(c.estado))
  })

  it('dois aparelhos no mesmo em: a ordem sai do id, e não da ordem de entrada', () => {
    const c = novaCena(ctx)
    const em = (INICIO_DA_CENA + HORA) as Instante
    const deA = desembrulhar(
      criarEvento({ em, dispositivo: 'aparelho-a', fusoMinutos: 180 }, { tipo: 'meta-diaria-alterada', xp: 20 }),
    )
    const deB = desembrulhar(
      criarEvento({ em, dispositivo: 'aparelho-b', fusoMinutos: 180 }, { tipo: 'meta-diaria-alterada', xp: 30 }),
    )
    const [primeiro, ultimo] = deA.id < deB.id ? [deA, deB] : [deB, deA]
    const vivo = reduzir(ctx, reduzir(ctx, c.estado, primeiro), ultimo)
    for (const ordem of [
      [deA, deB],
      [deB, deA],
    ]) {
      const { estado } = desembrulhar(reconstruir(ctx, copia([...c.eventos, ...ordem])))
      expect(instantaneoDoEstado(estado)).toStrictEqual(instantaneoDoEstado(vivo))
    }
    expect(vivo.metaDiariaXp).toBe(ultimo.tipo === 'meta-diaria-alterada' ? ultimo.xp : undefined)
  })
})

describe('reconstruir com o catálogo trocado', () => {
  it('o catálogo sem o item c reconstrói o log gravado com ele, absorve o que falta e avisa no relato', () => {
    const c = novaCena(ctx)
    abrirSessaoNaCena(c, [I('c'), I('k')])
    licaoDeItem(c, I('c'))
    licaoDeItem(c, I('k'))
    const semC = contextoDosCasos({ catalogo: catalogoFixoSem(I('c'), 'grupo-2') })
    const { estado, relato } = desembrulhar(reconstruir(semC, copia(c.eventos)))
    expect(relato.catalogoTrocado).toBe(true)
    // c nas novas previstas e na apresentação; as três respostas e a lição de c, fora do grafo; e a lição de c, que não
    // fecha sem tópico, fica aberta até a tarefa da lição de k a interromper.
    expect(relato.absorvidos).toStrictEqual({
      'item-fora-do-catalogo': 2,
      'topico-fora-do-grafo': 4,
      'tarefa-sobre-tarefa-aberta': 1,
    })
    expect([...estado.licoes.keys()]).toStrictEqual([topicoDeItem(I('k')).id])
    expect(estado.catalogoHash).toBe(ctx.catalogo.hash)
    expect(conferirInvariantes(semC, estado)).toStrictEqual([])
  })
})
