import fc from 'fast-check'
import { describe, expect, it } from 'vitest'
import { catalogoDe, idDeTeste, type EspecificacaoDeCatalogo } from '../apoio-a-testes/catalogo-de-teste'
import { desembrulhar } from '../base/resultado'
import type { Milis } from '../base/tempo'
import type { Catalogo, IdItem } from '../catalogo/tipos'
import { resolverParametros, type Parametros } from '../memoria/parametros'
import { parceirosIndiscerniveis } from '../questoes/pares'
import { criarQuestao, FORMATOS_DE_QUESTAO, type FormatoDeQuestao, type Questao } from '../questoes/questao'
import { avaliarResposta } from './avaliar-resposta'
import type { NormasDeLatencia } from './normas-de-latencia'

// Catálogos genéricos sorteados, de 3 a 10 itens, com até três aliases por item e até três grupos de dois a quatro
// membros, metade com par indiscernível: o que a avaliação lê do catálogo são os rótulos, os aliases e os pares.
const especificacao: fc.Arbitrary<EspecificacaoDeCatalogo> = fc.integer({ min: 3, max: 10 }).chain((n) =>
  fc.record({
    classes: fc.array(fc.integer({ min: 1, max: 3 }), { minLength: n, maxLength: n }),
    categorias: fc.array(fc.integer({ min: 1, max: 2 }), { minLength: n, maxLength: n }),
    aliases: fc.array(fc.nat(3), { minLength: n, maxLength: n }),
    vizinhos: fc.constant([]),
    grupos: fc.array(
      fc.record({ membros: fc.array(fc.nat(n - 1), { minLength: 2, maxLength: 4 }), par: fc.boolean() }),
      { maxLength: 3 },
    ),
    vizinhancas: fc.constant([]),
  }),
)

// Normas sorteadas por formato, de nenhuma a trinta latências entre 0 e 2 s: a mediana cai em qualquer lugar, inclusive
// abaixo de `latenciaChuteMs`, e o mínimo de amostras ora é atingido, ora não.
const normas: fc.Arbitrary<NormasDeLatencia> = fc.record(
  Object.fromEntries(
    FORMATOS_DE_QUESTAO.map((f) => [
      f,
      fc.array(
        fc.nat(2000).map((x) => x as Milis),
        { maxLength: 30 },
      ),
    ]),
  ) as Record<(typeof FORMATOS_DE_QUESTAO)[number], fc.Arbitrary<Milis[]>>,
)

// O limiar de chute sorteado entre três valores, para a propriedade não depender do padrão.
const parametros: fc.Arbitrary<Parametros> = fc
  .constantFrom(300, 600, 900)
  .map((latenciaChuteMs) => desembrulhar(resolverParametros({ latenciaChuteMs })))

type Cenario = { catalogo: Catalogo; alvo: IdItem; parceiros: ReadonlySet<IdItem>; outros: IdItem[] }
const cenario = (espec: EspecificacaoDeCatalogo, k: number): Cenario => {
  const catalogo = catalogoDe(espec)
  const alvo = idDeTeste(k % catalogo.itens.size)
  const parceiros = parceirosIndiscerniveis(alvo, catalogo)
  const outros = [...catalogo.itens.keys()].filter((id) => id !== alvo && !parceiros.has(id))
  return { catalogo, alvo, parceiros, outros }
}

/** Questão de escolha no formato, com o alvo, os parceiros se o formato os admite, e os outros itens dados. */
function questaoDeEscolha(
  tipo: 'estimulo-para-rotulo' | 'rotulo-para-estimulo' | 'grupo-membros',
  c: Cenario,
  outros: readonly IdItem[],
  limiteMs: number | undefined,
): Questao {
  const doPar = tipo === 'rotulo-para-estimulo' ? [] : [...c.parceiros]
  const formato: FormatoDeQuestao = { tipo, opcoes: [c.alvo, ...doPar, ...outros] }
  return criarQuestao(c.alvo, formato, { tipo: 'isolada' }, limiteMs as Milis | undefined)
}

describe('propriedades de avaliarResposta', () => {
  it('rótulo digitado aceita rótulo e aliases do alvo e do parceiro e rejeita os de todo outro item', () => {
    fc.assert(
      fc.property(especificacao, fc.nat(), normas, parametros, (espec, k, n, p) => {
        const { catalogo, alvo, parceiros } = cenario(espec, k)
        const questao = criarQuestao(alvo, { tipo: 'rotulo-digitado' }, { tipo: 'isolada' })
        for (const item of catalogo.itens.values()) {
          const aceito = item.id === alvo || parceiros.has(item.id)
          for (const forma of [item.rotulo, ...item.aliases]) {
            // A forma como o item a declara e uma variação de caixa e de espaço, que a normalização desfaz.
            for (const texto of [forma, ` ${forma.toUpperCase()} `]) {
              const r = desembrulhar(
                avaliarResposta(questao, { tipo: 'texto', texto, latencia: 2000 as Milis }, catalogo, n, p),
              )
              expect(r.correta, `${texto} para ${alvo}`).toBe(aceito)
              if (!r.correta) expect(r).toMatchObject({ qualidade: 'errada', confundidaCom: item.id })
            }
          }
        }
      }),
    )
  })

  it('acerto abaixo de latenciaChuteMs é perfeita, em todo formato e com quaisquer normas', () => {
    const formatos = ['estimulo-para-rotulo', 'rotulo-para-estimulo', 'grupo-membros', 'rotulo-digitado'] as const
    fc.assert(
      fc.property(
        especificacao,
        fc.nat(),
        fc.constantFrom(...formatos),
        fc.subarray([0, 1, 2, 3, 4, 5, 6, 7, 8, 9]),
        fc.double({ min: 0, max: 1, maxExcluded: true, noNaN: true }),
        fc.option(fc.integer({ min: 900, max: 10_000 }), { nil: undefined }),
        normas,
        parametros,
        (espec, k, tipo, indices, fracao, limiteMs, n, p) => {
          const c = cenario(espec, k)
          const latencia = (fracao * p.latenciaChuteMs) as Milis
          const outros = indices.flatMap((i) => c.outros.slice(i, i + 1))
          const r =
            tipo === 'rotulo-digitado'
              ? avaliarResposta(
                  criarQuestao(c.alvo, { tipo }, { tipo: 'isolada' }, limiteMs as Milis | undefined),
                  { tipo: 'texto', texto: c.catalogo.itens.get(c.alvo)?.rotulo ?? '', latencia },
                  c.catalogo,
                  n,
                  p,
                )
              : avaliarResposta(
                  questaoDeEscolha(tipo, c, outros, limiteMs),
                  {
                    tipo: 'escolha',
                    escolhidas: tipo === 'grupo-membros' ? [c.alvo, ...c.parceiros] : [c.alvo],
                    latencia,
                  },
                  c.catalogo,
                  n,
                  p,
                )
          expect(desembrulhar(r)).toMatchObject({ correta: true, qualidade: 'perfeita' })
        },
      ),
    )
  })

  it('erro de escolha abaixo de latenciaChuteMs é chute, com a opção errada como confundida', () => {
    const formatos = ['estimulo-para-rotulo', 'rotulo-para-estimulo', 'grupo-membros'] as const
    fc.assert(
      fc.property(
        especificacao,
        fc.nat(),
        fc.constantFrom(...formatos),
        fc.nat(),
        fc.double({ min: 0, max: 1, maxExcluded: true, noNaN: true }),
        fc.option(fc.integer({ min: 900, max: 10_000 }), { nil: undefined }),
        normas,
        parametros,
        (espec, k, tipo, j, fracao, limiteMs, n, p) => {
          const c = cenario(espec, k)
          const errado = c.outros[j % Math.max(1, c.outros.length)]
          // Catálogo em que todo item é o alvo ou parceiro dele não tem opção errada a escolher.
          fc.pre(errado !== undefined)
          const escolhidas = tipo === 'grupo-membros' ? [c.alvo, errado] : [errado]
          const r = avaliarResposta(
            questaoDeEscolha(tipo, c, [errado], limiteMs),
            { tipo: 'escolha', escolhidas, latencia: (fracao * p.latenciaChuteMs) as Milis },
            c.catalogo,
            n,
            p,
          )
          expect(desembrulhar(r)).toMatchObject({ correta: false, qualidade: 'chute', confundidaCom: errado })
        },
      ),
    )
  })
})
