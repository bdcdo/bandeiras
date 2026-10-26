import fc from 'fast-check'
import { describe, expect, it } from 'vitest'
import { diasEntre, somarDias, type Dias, type Instante } from '../base/tempo'
import { estadoMemoriaInicial, type EstadoMemoria } from './estado-memoria'
import {
  aplicarRepeticao,
  decaimentoPorAtraso,
  devidoEm,
  fase,
  fatorPrecocidade,
  intervaloIdeal,
  memoriaEm,
  reagendar,
  type OrigemDeRepeticao,
} from './modelo'
import { PARAMETROS_PADRAO as P } from './parametros'

const T0 = 1_700_000_000_000 as Instante
const em = (dias: number, a: Instante = T0): Instante => somarDias(a, dias as Dias)
const estado = (campos: Partial<EstadoMemoria>): EstadoMemoria => ({
  ...estadoMemoriaInicial(P.acuraciaNeutra),
  ...campos,
})
const I = (numRepeticoes: number): number => intervaloIdeal(numRepeticoes, P)
const devido = (e: EstadoMemoria): Instante => {
  const d = devidoEm(e, P)
  if (d === undefined) throw new Error('o cenário pede um estado que já repetiu')
  return d
}

// Tolerâncias de ponto flutuante. Os instantes são milissegundos perto de 1,7e12, onde o double resolve cerca de 2e-4
// ms; em dias, isso é da ordem de 1e-12, e 1e-6 dia (menos de um décimo de segundo) sobra com folga.
const TOLERANCIA_DIAS = 1e-6
const TOLERANCIA_RELATIVA = 1e-9

const numRepeticoes = fc.double({ min: 0, max: 12, noNaN: true })
const velocidade = fc.double({ min: P.velocidadeMin, max: P.velocidadeMax, noNaN: true })
const deltaDeAcerto = fc.constantFrom(P.deltaBruto.perfeita, P.deltaBruto.boa, P.deltaBruto.lenta)
const deltaDeErro = fc.constantFrom(
  P.deltaBruto.errada,
  P.deltaBruto.chute,
  P.deltaBruto['nao-sei'],
  P.deltaBruto['tempo-esgotado'],
)
const deltaQualquer = fc.oneof(deltaDeAcerto, deltaDeErro, fc.double({ min: -1, max: 1, noNaN: true }))
const origem = fc.constantFrom<OrigemDeRepeticao>('explicita', 'implicita')
// Memória base acima do teto inclusive, como `reagendar` e o diagnóstico gravam; o piso de 1e-6 evita base subnormal,
// em que 0,5 elevado ao número de intervalos até o vencimento estoura o double.
const memoriaBase = fc.oneof(fc.constant(0), fc.double({ min: 1e-6, max: 3, noNaN: true }))

type Cenario = { e: EstadoMemoria; agora: Instante }

/** Estado que já repetiu, com tentativa explícita opcional antes da última repetição, e um instante depois dela. */
const repetido: fc.Arbitrary<Cenario> = fc
  .record({
    numRepeticoes,
    memoriaBase,
    diasDesdeRep: fc.double({ min: 0, max: 400, noNaN: true }),
    tentativaAntes: fc.option(fc.double({ min: 0, max: 400, noNaN: true }), { nil: undefined }),
    acuracia: fc.double({ min: 0, max: 1, noNaN: true }),
  })
  .map((g) => ({
    e: estado({
      numRepeticoes: g.numRepeticoes,
      memoriaBase: g.memoriaBase,
      ultimaRepEm: T0,
      acuracia: g.acuracia,
      ...(g.tentativaAntes === undefined ? {} : { ultimaTentativaEm: em(-g.tentativaAntes) }),
    }),
    agora: em(g.diasDesdeRep),
  }))

/** Qualquer cenário, inclusive o de quem nunca repetiu. */
const qualquer: fc.Arbitrary<Cenario> = fc.oneof(
  repetido,
  fc.constant({ e: estadoMemoriaInicial(P.acuraciaNeutra), agora: T0 }),
)

const aplicar = (
  e: EstadoMemoria,
  deltaBruto: number,
  agora: Instante,
  v: number,
  o: OrigemDeRepeticao = 'explicita',
) => aplicarRepeticao(e, { deltaBruto, agora, velocidade: v, origem: o }, P)

describe('intervaloIdeal', () => {
  it('segue a sequência 1; 2,2; 4,84; 10,65 dias para numRepeticoes de 1 a 4', () => {
    expect(I(1)).toBe(1)
    expect(I(2)).toBeCloseTo(2.2, 12)
    expect(I(3)).toBeCloseTo(4.84, 12)
    expect(I(4)).toBeCloseTo(10.648, 12)
    expect(Number(I(4).toFixed(2))).toBe(10.65)
  })

  it('para no teto de um ano', () => {
    expect(I(8)).toBeCloseTo(2.2 ** 7, 9)
    expect(I(9)).toBe(365)
    expect(I(50)).toBe(365)
  })
})

describe('memoriaEm', () => {
  it('vale zero para quem nunca repetiu', () => {
    expect(memoriaEm(estadoMemoriaInicial(0.5), em(10), P)).toBe(0)
  })

  it('cai pela metade a cada intervalo ideal', () => {
    const e = estado({ numRepeticoes: 2, memoriaBase: 1, ultimaRepEm: T0 })
    expect(memoriaEm(e, T0, P)).toBe(1)
    expect(memoriaEm(e, em(2.2), P)).toBeCloseTo(0.5, 12)
    expect(memoriaEm(e, em(4.4), P)).toBeCloseTo(0.25, 12)
  })
})

describe('devidoEm', () => {
  it('não existe para quem nunca repetiu e é a última repetição para memória zero', () => {
    expect(devidoEm(estadoMemoriaInicial(0.5), P)).toBeUndefined()
    expect(devidoEm(estado({ memoriaBase: 0, ultimaRepEm: T0 }), P)).toBe(T0)
  })

  it('vence um intervalo ideal depois de um acerto que deixou a memória em 1', () => {
    expect(diasEntre(T0, devido(estado({ numRepeticoes: 3, memoriaBase: 1, ultimaRepEm: T0 })))).toBeCloseTo(4.84, 9)
  })

  it('é o instante em que a memória chega ao limiar, quando a memória base é positiva', () => {
    fc.assert(
      fc.property(
        repetido.filter(({ e }) => e.memoriaBase > 0),
        ({ e }) => {
          expect(Math.abs(memoriaEm(e, devido(e), P) - P.limiarDevido)).toBeLessThanOrEqual(TOLERANCIA_RELATIVA)
        },
      ),
    )
  })

  it('cresce com numRepeticoes quando a memória base está no limiar ou acima', () => {
    fc.assert(
      fc.property(
        numRepeticoes,
        numRepeticoes,
        fc.double({ min: P.limiarDevido, max: 3, noNaN: true }),
        (a, b, base) => {
          const [menor, maior] = a <= b ? [a, b] : [b, a]
          const vence = (n: number): Instante =>
            devido(estado({ numRepeticoes: n, memoriaBase: base, ultimaRepEm: T0 }))
          expect(vence(menor)).toBeLessThanOrEqual(vence(maior))
        },
      ),
    )
  })
})

describe('fatorPrecocidade', () => {
  it('vale 0 logo depois de um acerto e 1 no dia devido', () => {
    const e = estado({ numRepeticoes: 2, memoriaBase: 1, ultimaRepEm: T0, ultimaTentativaEm: T0 })
    expect(fatorPrecocidade(e, T0, P)).toBe(0)
    expect(fatorPrecocidade(e, em(2.2), P)).toBeCloseTo(1, 12)
  })

  it('sem tentativa explícita anterior, depende só da memória', () => {
    const e = estado({ numRepeticoes: 1, memoriaBase: 0, ultimaRepEm: T0 })
    expect(fatorPrecocidade(e, em(1 / 24), P)).toBe(1)
  })

  it('uma hora depois de uma tentativa explícita, vale uma hora em intervalos ideais', () => {
    const e = estado({ numRepeticoes: 2, memoriaBase: 0, ultimaRepEm: T0, ultimaTentativaEm: T0 })
    expect(fatorPrecocidade(e, em(1 / 24), P)).toBeCloseTo(1 / 24 / 2.2, 12)
  })

  it('fica em [0, 1] em qualquer cenário', () => {
    fc.assert(
      fc.property(qualquer, ({ e, agora }) => {
        const f = fatorPrecocidade(e, agora, P)
        expect(f).toBeGreaterThanOrEqual(0)
        expect(f).toBeLessThanOrEqual(1)
      }),
    )
  })
})

describe('decaimentoPorAtraso', () => {
  it('vale 1,5 com a memória na metade do limiar e 2 num quarto', () => {
    expect(decaimentoPorAtraso(P.limiarDevido / 2, P)).toBeCloseTo(1.5, 12)
    expect(decaimentoPorAtraso(P.limiarDevido / 4, P)).toBeCloseTo(2, 12)
  })

  it('vale 1 com a memória no limiar ou acima e o teto com memória zero ou negativa', () => {
    expect(decaimentoPorAtraso(P.limiarDevido, P)).toBe(1)
    expect(decaimentoPorAtraso(2, P)).toBe(1)
    expect(decaimentoPorAtraso(0, P)).toBe(3)
    expect(decaimentoPorAtraso(-0.1, P)).toBe(3)
    expect(decaimentoPorAtraso(1e-300, P)).toBe(3)
  })

  it('fica entre 1 e o teto para qualquer memória', () => {
    fc.assert(
      fc.property(fc.double({ min: -1, max: 3, noNaN: true }), (m) => {
        const d = decaimentoPorAtraso(m, P)
        expect(d).toBeGreaterThanOrEqual(1)
        expect(d).toBeLessThanOrEqual(P.tetoDecaimentoPorAtraso)
      }),
    )
  })
})

describe('aplicarRepeticao', () => {
  it('leva quem nunca repetiu a uma repetição e memória 1 num acerto perfeito', () => {
    const e = aplicar(estadoMemoriaInicial(0.85), P.deltaBruto.perfeita, T0, 1)
    expect(e).toMatchObject({ numRepeticoes: 1, memoriaBase: 1, ultimaRepEm: T0, ultimaTentativaEm: T0 })
  })

  it('recua com decay 1,5 num erro feito com a memória na metade do limiar', () => {
    // Três repetições e memória 1 no instante zero; dois intervalos ideais (2 x 4,84 dias) depois, a memória é 0,25.
    const e = estado({ numRepeticoes: 3, memoriaBase: 1, ultimaRepEm: T0, ultimaTentativaEm: T0 })
    const depois = aplicar(e, P.deltaBruto.errada, em(2 * 4.84), 1)
    expect(depois.numRepeticoes).toBeCloseTo(3 - 1.5, 9)
    expect(depois.memoriaBase).toBe(0)
  })

  it('avança sem decay no acerto que vem depois de um erro', () => {
    // O erro deixou memória zero; um dia depois da tentativa, o fator de precocidade é 1 / I(1,5).
    const e = estado({ numRepeticoes: 1.5, memoriaBase: 0, ultimaRepEm: T0, ultimaTentativaEm: T0 })
    const depois = aplicar(e, P.deltaBruto.perfeita, em(1), 1)
    expect(depois.numRepeticoes).toBeCloseTo(1.5 + 1 / 2.2 ** 0.5, 9)
  })

  it('mantém numRepeticoes >= 0 e a memória base entre 0 e o teto, mesmo partindo de base acima do teto', () => {
    fc.assert(
      fc.property(qualquer, deltaQualquer, velocidade, origem, ({ e, agora }, delta, v, o) => {
        const depois = aplicar(e, delta, agora, v, o)
        expect(depois.numRepeticoes).toBeGreaterThanOrEqual(0)
        expect(depois.memoriaBase).toBeGreaterThanOrEqual(0)
        expect(depois.memoriaBase).toBeLessThanOrEqual(P.tetoMemoria)
      }),
    )
  })

  it('nunca diminui numRepeticoes num acerto nem aumenta num erro', () => {
    fc.assert(
      fc.property(qualquer, deltaDeAcerto, deltaDeErro, velocidade, origem, ({ e, agora }, acerto, erro, v, o) => {
        expect(aplicar(e, acerto, agora, v, o).numRepeticoes).toBeGreaterThanOrEqual(e.numRepeticoes)
        expect(aplicar(e, erro, agora, v, o).numRepeticoes).toBeLessThanOrEqual(e.numRepeticoes)
      }),
    )
  })

  it('não altera numRepeticoes num acerto feito com a memória em 1 ou mais', () => {
    const cenario = fc
      .record({
        numRepeticoes,
        base: fc.double({ min: 1, max: 3, noNaN: true }),
        fracao: fc.double({ min: 0, max: 1, noNaN: true }),
      })
      .map(({ numRepeticoes: n, base, fracao }) => ({
        e: estado({ numRepeticoes: n, memoriaBase: base, ultimaRepEm: T0 }),
        // Até o instante em que a memória cai a 1: log2(base) intervalos depois da última repetição.
        agora: em(fracao * I(n) * Math.log2(base)),
      }))
    fc.assert(
      fc.property(cenario, deltaDeAcerto, velocidade, origem, ({ e, agora }, delta, v, o) => {
        fc.pre(memoriaEm(e, agora, P) >= 1)
        const depois = aplicar(e, delta, agora, v, o)
        expect(depois.numRepeticoes).toBe(e.numRepeticoes)
        expect(depois.memoriaBase).toBeLessThanOrEqual(P.tetoMemoria)
      }),
    )
  })

  it('aplica o decay só ao erro da resposta atual, e nunca ao acerto', () => {
    fc.assert(
      fc.property(qualquer, deltaQualquer, velocidade, origem, ({ e, agora }, delta, v, o) => {
        const depois = aplicar(e, delta, agora, v, o)
        const m = memoriaEm(e, agora, P)
        const esperado =
          delta > 0
            ? e.numRepeticoes + v * delta * fatorPrecocidade(e, agora, P)
            : Math.max(0, e.numRepeticoes + v * decaimentoPorAtraso(m, P) * delta)
        expect(depois.numRepeticoes).toBeCloseTo(esperado, 9)
      }),
    )
  })

  it('tem decay 1 num erro feito com a memória no limiar ou acima', () => {
    const cenario = fc
      .record({
        numRepeticoes,
        base: fc.double({ min: P.limiarDevido, max: 3, noNaN: true }),
        fracao: fc.double({ min: 0, max: 1, noNaN: true }),
      })
      .map(({ numRepeticoes: n, base, fracao }) => ({
        e: estado({ numRepeticoes: n, memoriaBase: base, ultimaRepEm: T0 }),
        agora: em(fracao * I(n) * Math.log2(base / P.limiarDevido)),
      }))
    fc.assert(
      fc.property(cenario, deltaDeErro, velocidade, origem, ({ e, agora }, delta, v, o) => {
        fc.pre(memoriaEm(e, agora, P) >= P.limiarDevido)
        expect(aplicar(e, delta, agora, v, o).numRepeticoes).toBeCloseTo(Math.max(0, e.numRepeticoes + v * delta), 9)
      }),
    )
  })

  it('num acerto no dia devido, vence de novo exatamente um intervalo ideal depois', () => {
    const cenario = fc
      .record({
        numRepeticoes,
        base: fc.double({ min: 1e-6, max: P.tetoMemoria, noNaN: true }),
        // Tentativa explícita anterior, se houver, a pelo menos um intervalo ideal do dia devido, para o segundo termo
        // do fator de precocidade valer 1.
        folga: fc.option(fc.double({ min: 0, max: 10, noNaN: true }), { nil: undefined }),
      })
      .map(({ numRepeticoes: n, base, folga }) => {
        const semTentativa = estado({ numRepeticoes: n, memoriaBase: base, ultimaRepEm: T0 })
        const agora = devido(semTentativa)
        const e =
          folga === undefined ? semTentativa : { ...semTentativa, ultimaTentativaEm: em(-(1 + folga) * I(n), agora) }
        return { e, agora }
      })
    fc.assert(
      fc.property(cenario, deltaDeAcerto, velocidade, ({ e, agora }, delta, v) => {
        const depois = aplicar(e, delta, agora, v)
        expect(Math.abs(diasEntre(agora, devido(depois)) - I(depois.numRepeticoes))).toBeLessThanOrEqual(
          TOLERANCIA_DIAS,
        )
      }),
    )
  })

  it('dois acertos seguidos no dia devido dão intervalos na razão crescimento ^ velocidade', () => {
    fc.assert(
      fc.property(fc.double({ min: 0, max: 4, noNaN: true }), memoriaBase, velocidade, (n, base, v) => {
        fc.pre(base > 0)
        const e0 = estado({ numRepeticoes: n, memoriaBase: base, ultimaRepEm: T0 })
        const t1 = devido(e0)
        const e1 = aplicar(e0, P.deltaBruto.perfeita, t1, v)
        const t2 = devido(e1)
        const e2 = aplicar(e1, P.deltaBruto.perfeita, t2, v)
        const razao = diasEntre(t2, devido(e2)) / diasEntre(t1, t2)
        expect(Math.abs(razao / P.crescimentoIntervalo ** v - 1)).toBeLessThanOrEqual(TOLERANCIA_RELATIVA)
      }),
    )
  })

  it('num reteste até uma hora depois de um erro, avança no máximo velocidade * (1/24) / intervaloIdeal', () => {
    // O reteste conta como prática e quase nada como repetição: o erro zera o primeiro termo do fator de precocidade, e
    // o segundo, uma hora em intervalos ideais, é o resíduo que sobra.
    fc.assert(
      fc.property(
        qualquer,
        deltaDeErro,
        deltaDeAcerto,
        velocidade,
        fc.double({ min: 0, max: 1 / 24, noNaN: true }),
        ({ e, agora }, erro, acerto, v, horas) => {
          const errou = aplicar(e, erro, agora, v)
          const retestou = aplicar(errou, acerto, em(horas, agora), v)
          const limite = (v * (1 / 24)) / I(errou.numRepeticoes)
          expect(retestou.numRepeticoes - errou.numRepeticoes).toBeLessThanOrEqual(limite * (1 + TOLERANCIA_RELATIVA))
        },
      ),
    )
  })

  it('grava ultimaRepEm em toda repetição e ultimaTentativaEm só na explícita', () => {
    fc.assert(
      fc.property(qualquer, deltaQualquer, velocidade, ({ e, agora }, delta, v) => {
        const explicita = aplicar(e, delta, agora, v, 'explicita')
        const implicita = aplicar(e, delta, agora, v, 'implicita')
        expect(explicita.ultimaRepEm).toBe(agora)
        expect(implicita.ultimaRepEm).toBe(agora)
        expect(explicita.ultimaTentativaEm).toBe(agora)
        expect(implicita.ultimaTentativaEm).toBe(e.ultimaTentativaEm)
        expect('ultimaTentativaEm' in implicita).toBe('ultimaTentativaEm' in e)
      }),
    )
  })

  it('não mexe na acurácia, na contagem de avaliações nem na marca de condicional', () => {
    fc.assert(
      fc.property(qualquer, deltaQualquer, velocidade, origem, ({ e, agora }, delta, v, o) => {
        const depois = aplicar({ ...e, condicional: true }, delta, agora, v, o)
        expect(depois).toMatchObject({
          acuracia: e.acuracia,
          nAvaliacoes: e.nAvaliacoes,
          acuraciaPorDirecao: e.acuraciaPorDirecao,
          condicional: true,
        })
      }),
    )
  })
})

describe('reagendar', () => {
  it('põe o vencimento exatamente `dias` depois de agora, sem mexer em numRepeticoes', () => {
    fc.assert(
      fc.property(qualquer, fc.double({ min: 0, max: 400, noNaN: true }), ({ e, agora }, dias) => {
        const r = reagendar(e, agora, dias as Dias, P)
        expect(Math.abs(diasEntre(agora, devido(r)) - dias)).toBeLessThanOrEqual(TOLERANCIA_DIAS)
        expect(r.numRepeticoes).toBe(e.numRepeticoes)
        expect(r.ultimaTentativaEm).toBe(e.ultimaTentativaEm)
      }),
    )
  })

  it('pode gravar memória acima do teto, e aí um acerto antecipado não ganha crédito e volta a base ao teto', () => {
    const e = estado({ numRepeticoes: 2, memoriaBase: 1, ultimaRepEm: T0, ultimaTentativaEm: T0 })
    // Dois intervalos ideais à frente: base 0,5 * 2^2 = 2.
    const r = reagendar(e, T0, (2 * 2.2) as Dias, P)
    expect(r.memoriaBase).toBeCloseTo(2, 12)
    const amanha = em(1)
    expect(fatorPrecocidade(r, amanha, P)).toBe(0)
    const depois = aplicar(r, P.deltaBruto.perfeita, amanha, 1)
    expect(depois.numRepeticoes).toBe(2)
    expect(depois.memoriaBase).toBe(P.tetoMemoria)
  })
})

describe('fase', () => {
  it('separa não iniciado, aprendendo, revisando e dominado pelas faixas de numRepeticoes', () => {
    const com = (n: number): EstadoMemoria => estado({ numRepeticoes: n, memoriaBase: 1, ultimaRepEm: T0 })
    expect(fase(estadoMemoriaInicial(0.85), P)).toBe('nao-iniciado')
    expect(fase(com(0), P)).toBe('aprendendo')
    expect(fase(com(1.99), P)).toBe('aprendendo')
    expect(fase(com(2), P)).toBe('revisando')
    expect(fase(com(3.99), P)).toBe('revisando')
    expect(fase(com(4), P)).toBe('dominado')
  })
})
