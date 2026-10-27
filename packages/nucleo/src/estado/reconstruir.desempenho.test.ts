import { cpuUsage } from 'node:process'
import { expect, it } from 'vitest'
import { catalogoDe, type EspecificacaoDeCatalogo } from '../apoio-a-testes/catalogo-de-teste'
import { gerarRoteiro, reduzirRoteiro } from '../apoio-a-testes/gerador-de-log'
import { desembrulhar } from '../base/resultado'
import { sorteioComSemente } from '../base/sorteio-com-semente'
import { TECNICAS_TODAS_LIGADAS } from '../catalogo/tecnicas'
import type { Evento } from '../eventos'
import { PARAMETROS_PADRAO } from '../memoria'
import { criarContextoDeReducao } from './contexto'
import { reconstruir } from './reconstruir'

// O custo da reconstrução: 100 mil eventos de um roteiro sobre um catálogo do tamanho do real, 193 itens e 38 grupos
// de 2 a 6 membros, reconstruídos em no máximo 200 ms de CPU. Fica fora de `pnpm test` e de `pnpm verify`, porque o
// tempo depende da máquina e da carga dela; roda por `pnpm test:desempenho`, com a carga anotada ao lado do número.
// O log é gerado antes da medição, que toma o menor de três tempos de CPU (usuário mais sistema) da reconstrução.

const ITENS = 193
const EVENTOS = 100_000
const TETO_MS = 200

// Grupos de 2 a 6 membros, em ciclo, sobre itens consecutivos e sem membro repetido entre grupos: 38 grupos cobrem 149
// itens. Um grupo em cada três tem par indiscernível, e cada item é vizinho do seguinte.
const tamanhos = Array.from({ length: 38 }, (_, j) => 2 + (j % 5))
const inicios = tamanhos.map((_, j) => tamanhos.slice(0, j).reduce((s, t) => s + t, 0))
const ESPECIFICACAO: EspecificacaoDeCatalogo = {
  classes: Array.from({ length: ITENS }, (_, k) => 1 + (k % 6)),
  categorias: Array.from({ length: ITENS }, (_, k) => 1 + (k % 4)),
  aliases: [],
  vizinhos: Array.from({ length: ITENS }, (_, k) => [(k + 1) % ITENS]),
  grupos: tamanhos.map((t, j) => ({
    membros: Array.from({ length: t }, (_, m) => (inicios[j] ?? 0) + m),
    par: j % 3 === 0,
  })),
  vizinhancas: [],
}

/** Os primeiros `EVENTOS` eventos de um roteiro gerado com escolhas pseudoaleatórias de semente fixa. */
function logDoRoteiro(): readonly Evento[] {
  const catalogo = catalogoDe(ESPECIFICACAO)
  const ctx = desembrulhar(
    criarContextoDeReducao({ catalogo, tecnicas: TECNICAS_TODAS_LIGADAS, parametros: PARAMETROS_PADRAO }),
  )
  const sorteio = sorteioComSemente('desempenho')
  // Cada escolha rende perto de um quinto de evento; 600 mil escolhas passam dos 100 mil eventos com folga.
  const escolhas = Array.from({ length: 600_000 }, () => sorteio.inteiro(0, 1_000_000))
  const { eventos } = reduzirRoteiro(ctx, gerarRoteiro(catalogo, escolhas))
  return eventos.slice(0, EVENTOS)
}

it(`reconstrói ${String(EVENTOS)} eventos em no máximo ${String(TETO_MS)} ms de CPU`, () => {
  const catalogo = catalogoDe(ESPECIFICACAO)
  expect(catalogo.itens.size).toBe(ITENS)
  expect(catalogo.grupos.size).toBe(38)
  const ctx = desembrulhar(
    criarContextoDeReducao({ catalogo, tecnicas: TECNICAS_TODAS_LIGADAS, parametros: PARAMETROS_PADRAO }),
  )
  const eventos = logDoRoteiro()
  expect(eventos).toHaveLength(EVENTOS)

  const tempos = [0, 1, 2].map(() => {
    const antes = cpuUsage()
    const r = reconstruir(ctx, eventos)
    const gasto = cpuUsage(antes)
    expect(r.ok).toBe(true)
    return (gasto.user + gasto.system) / 1000
  })
  const menor = Math.min(...tempos)
  console.info(
    `reconstruir de ${String(EVENTOS)} eventos: ${tempos.map((t) => t.toFixed(1)).join(', ')} ms; menor ${menor.toFixed(1)} ms`,
  )
  expect(menor).toBeLessThanOrEqual(TETO_MS)
}, 600_000)
