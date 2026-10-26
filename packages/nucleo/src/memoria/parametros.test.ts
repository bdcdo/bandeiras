import { describe, expect, it } from 'vitest'
import { desembrulhar } from '../base/resultado'
import { PARAMETROS_PADRAO, QUALIDADES_DE_RESPOSTA, resolverParametros, type Parametros } from './parametros'

/** Todo caminho de parâmetro com o valor padrão, como o domínio escreveria em `AjustesDeParametros`. */
function caminhosPadrao(p: Parametros): [string, number][] {
  return Object.entries(p).flatMap(([chave, valor]): [string, number][] =>
    typeof valor === 'number'
      ? [[chave, valor]]
      : Object.entries(valor as Record<string, number>).map(([sub, v]): [string, number] => [`${chave}.${sub}`, v]),
  )
}

function codigo(ajustes: Record<string, number>): string | undefined {
  const r = resolverParametros(ajustes)
  return r.ok ? undefined : r.erro.codigo
}

describe('PARAMETROS_PADRAO', () => {
  it('traz os valores da tabela de parâmetros iniciais', () => {
    expect(PARAMETROS_PADRAO).toMatchObject({
      intervaloBaseDias: 1,
      crescimentoIntervalo: 2.2,
      intervaloMaximoDias: 365,
      limiarDevido: 0.5,
      tetoMemoria: 1,
      alfaAcuracia: 0.3,
      acuraciaNeutra: 0.85,
      desaceleracaoPorDificuldade: { 1: 0.8, 2: 1, 3: 1.3 },
      velocidadeMin: 0.25,
      velocidadeMax: 2,
      limiarTopicoLento: 1,
      kDecaimentoPorAtraso: 0.5,
      tetoDecaimentoPorAtraso: 3,
      deltaBruto: { perfeita: 1, boa: 1, lenta: 0.6, errada: -1, chute: -1, 'nao-sei': -1, 'tempo-esgotado': -0.5 },
      fatorExposicaoDistrator: 0.5,
      fatorMultiplaEscolha: 0.5,
      tetoNumRepeticoesDiagnostico: 3,
      novasPorSessaoMax: 4,
      cotaLicaoMin: 0.25,
      numRepeticoesSaiDoAprendizado: 2,
      janelaAntecipacaoDias: 2,
      orcamentoPadraoMin: 15,
      latenciaChuteMs: 600,
      quizACada: 3,
      tamanhoQuiz: 8,
      acuraciaMinimaCronometrada: 0.9,
      limiteCronometradoMinMs: 3000,
      fatorLimiteCronometrado: 1.5,
    })
    expect(Object.keys(PARAMETROS_PADRAO.deltaBruto)).toEqual([...QUALIDADES_DE_RESPOSTA])
  })

  it('é congelado em profundidade', () => {
    expect(Object.isFrozen(PARAMETROS_PADRAO)).toBe(true)
    expect(Object.isFrozen(PARAMETROS_PADRAO.deltaBruto)).toBe(true)
    expect(Object.isFrozen(PARAMETROS_PADRAO.desaceleracaoPorDificuldade)).toBe(true)
  })
})

describe('resolverParametros', () => {
  it('sem ajustes devolve os valores padrão', () => {
    expect(desembrulhar(resolverParametros())).toEqual(PARAMETROS_PADRAO)
    expect(desembrulhar(resolverParametros({}))).toEqual(PARAMETROS_PADRAO)
  })

  it('aceita todo caminho com o próprio valor padrão: a tabela de faixas cobre e admite cada um', () => {
    const caminhos = caminhosPadrao(PARAMETROS_PADRAO)
    expect(caminhos.length).toBeGreaterThan(40)
    for (const [caminho, valor] of caminhos) {
      expect(resolverParametros({ [caminho]: valor }), caminho).toEqual({ ok: true, valor: PARAMETROS_PADRAO })
    }
    expect(desembrulhar(resolverParametros(Object.fromEntries(caminhos)))).toEqual(PARAMETROS_PADRAO)
  })

  it('aceita desaceleracaoPorDificuldade.3 e troca só aquela dificuldade', () => {
    const p = desembrulhar(resolverParametros({ 'desaceleracaoPorDificuldade.3': 1.6 }))
    expect(p.desaceleracaoPorDificuldade).toEqual({ 1: 0.8, 2: 1, 3: 1.6 })
    expect(PARAMETROS_PADRAO.desaceleracaoPorDificuldade[3]).toBe(1.3)
  })

  it('aplica escalares e aninhados juntos', () => {
    const p = desembrulhar(resolverParametros({ limiarDevido: 0.4, 'deltaBruto.lenta': 0.5, alfaAcuracia: 0.2 }))
    expect(p.limiarDevido).toBe(0.4)
    expect(p.alfaAcuracia).toBe(0.2)
    expect(p.deltaBruto).toEqual({ ...PARAMETROS_PADRAO.deltaBruto, lenta: 0.5 })
  })

  it('recusa chave desconhecida e lista todas', () => {
    expect(
      resolverParametros({
        inexistente: 1,
        deltaBruto: 1,
        'deltaBruto.otima': 1,
        'desaceleracaoPorDificuldade.4': 1,
        constructor: 1,
      }),
    ).toEqual({
      ok: false,
      erro: {
        codigo: 'PARAMETRO_DESCONHECIDO',
        detalhe:
          "parâmetro que não existe: 'inexistente'; 'deltaBruto'; 'deltaBruto.otima'; 'desaceleracaoPorDificuldade.4'; 'constructor'",
      },
    })
  })

  it('recusa valor negativo onde a faixa pede positivo', () => {
    expect(resolverParametros({ intervaloBaseDias: -1 })).toEqual({
      ok: false,
      erro: {
        codigo: 'PARAMETRO_INVALIDO',
        detalhe: 'parâmetro fora da faixa: intervaloBaseDias = -1 (precisa ser número finito maior que zero)',
      },
    })
  })

  it('recusa valor que não é número finito', () => {
    for (const valor of [Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY, '2' as unknown as number]) {
      expect(codigo({ tetoMemoria: valor }), String(valor)).toBe('PARAMETRO_INVALIDO')
    }
  })

  it('recusa valor fora da faixa que a fórmula exige', () => {
    expect(codigo({ limiarDevido: 1 })).toBe('PARAMETRO_INVALIDO')
    expect(codigo({ limiarDevido: 0 })).toBe('PARAMETRO_INVALIDO')
    expect(codigo({ crescimentoIntervalo: 0.9 })).toBe('PARAMETRO_INVALIDO')
    expect(codigo({ tetoDecaimentoPorAtraso: 0.5 })).toBe('PARAMETRO_INVALIDO')
    expect(codigo({ 'deltaBruto.perfeita': 1.5 })).toBe('PARAMETRO_INVALIDO')
    expect(codigo({ 'deltaBruto.errada': 0.2 })).toBe('PARAMETRO_INVALIDO')
    expect(codigo({ tamanhoQuiz: 2.5 })).toBe('PARAMETRO_INVALIDO')
    expect(codigo({ alfaAcuracia: 0 })).toBe('PARAMETRO_INVALIDO')
    expect(codigo({ fatorMultiplaEscolha: 1.1 })).toBe('PARAMETRO_INVALIDO')
  })

  it('recusa relação quebrada entre parâmetros que, sozinhos, estão na faixa', () => {
    expect(resolverParametros({ velocidadeMin: 3 })).toEqual({
      ok: false,
      erro: {
        codigo: 'PARAMETRO_INVALIDO',
        detalhe: 'relação entre parâmetros quebrada: velocidadeMin <= velocidadeMax',
      },
    })
    expect(codigo({ tetoMemoria: 0.4 })).toBe('PARAMETRO_INVALIDO')
    expect(codigo({ aceleracaoMin: 2 })).toBe('PARAMETRO_INVALIDO')
    expect(codigo({ intervaloMaximoDias: 0.5 })).toBe('PARAMETRO_INVALIDO')
    expect(codigo({ numRepeticoesDominado: 1 })).toBe('PARAMETRO_INVALIDO')
    expect(codigo({ velocidadeMin: 3, velocidadeMax: 4 })).toBeUndefined()
  })

  it('aceita teto entre o limiar e o limiar mais o rawDelta perfeito, e recusa o que passa disso', () => {
    // Acima disso nem o acerto perfeito no dia devido devolveria a memória ao teto, e o espaçamento real ficaria
    // abaixo do intervalo ideal em toda repetição.
    expect(codigo({ tetoMemoria: 0.8 })).toBeUndefined()
    expect(codigo({ tetoMemoria: 1.5 })).toBeUndefined()
    expect(codigo({ limiarDevido: 0.3, tetoMemoria: 0.6 })).toBeUndefined()
    expect(resolverParametros({ tetoMemoria: 1.6 })).toEqual({
      ok: false,
      erro: {
        codigo: 'PARAMETRO_INVALIDO',
        detalhe: 'relação entre parâmetros quebrada: tetoMemoria <= limiarDevido + deltaBruto.perfeita',
      },
    })
    expect(codigo({ 'deltaBruto.perfeita': 0.4 })).toBe('PARAMETRO_INVALIDO')
    expect(codigo({ limiarDevido: 0.2, tetoMemoria: 1.25 })).toBe('PARAMETRO_INVALIDO')
  })

  it('confere a chave desconhecida antes do valor inválido', () => {
    expect(codigo({ inexistente: 1, intervaloBaseDias: -1 })).toBe('PARAMETRO_DESCONHECIDO')
  })
})
