import { describe, expect, it } from 'vitest'
import { catalogoFixo } from '../apoio-a-testes/catalogo-de-teste'
import { estadoDeTeste } from '../apoio-a-testes/estado-de-teste'
import { desembrulhar } from '../base/resultado'
import { sorteioComSemente } from '../base/sorteio-com-semente'
import type { Milis } from '../base/tempo'
import { TECNICAS_TODAS_LIGADAS, type Tecnicas } from '../catalogo/tecnicas'
import type { IdItem } from '../catalogo/tipos'
import type { EstadoMemoria } from '../memoria'
import { PARAMETROS_PADRAO as P, resolverParametros } from '../memoria/parametros'
import { contextoDeSessao } from '../questoes/contexto-de-sessao'
import { gerarQuestao } from '../questoes/gerar-questao'
import { criarQuestao, type Questao, type TipoDeFormato } from '../questoes/questao'
import { avaliarResposta } from './avaliar-resposta'
import {
  limiteCronometrado,
  medianaDoFormato,
  NORMAS_DE_LATENCIA_VAZIAS,
  registrarLatencia,
  type NormasDeLatencia,
} from './normas-de-latencia'
import type { Avaliacao, Resposta } from './tipos'

const catalogo = catalogoFixo()
const A = 'a' as IdItem
const ms = (n: number) => n as Milis
const normasCom = (latencias: readonly number[]): NormasDeLatencia => ({
  ...NORMAS_DE_LATENCIA_VAZIAS,
  'rotulo-digitado': latencias.map(ms),
})
const OITO = [1000, 1100, 1200, 1400, 1600, 1800, 1900, 2000]
const pronto = (repeticoes: number, acuracia: number): EstadoMemoria => estadoDeTeste({ repeticoes, acuracia })

describe('registrarLatencia', () => {
  const questao = criarQuestao(A, { tipo: 'rotulo-digitado' }, { tipo: 'isolada' })
  const certa: Avaliacao = { correta: true, qualidade: 'boa', direcao: 'recordar', deltaBruto: 1 }
  const texto = (latencia: number): Resposta => ({ tipo: 'texto', texto: 'Item A', latencia: ms(latencia) })

  it('guarda a latência do acerto explícito no formato da questão, sem mexer nas normas recebidas', () => {
    const normas = registrarLatencia(NORMAS_DE_LATENCIA_VAZIAS, questao, texto(1234), certa, P)
    expect(normas['rotulo-digitado']).toEqual([1234])
    expect(normas['estimulo-para-rotulo']).toEqual([])
    expect(NORMAS_DE_LATENCIA_VAZIAS['rotulo-digitado']).toEqual([])
    expect(Object.isFrozen(normas)).toBe(true)
  })

  it('deixa de fora o erro, o chute e a resposta sem latência', () => {
    const errada: Avaliacao = { correta: false, qualidade: 'errada', direcao: 'recordar', deltaBruto: -1 }
    const chute: Avaliacao = { correta: false, qualidade: 'chute', direcao: 'recordar', deltaBruto: -1 }
    const normas = normasCom([1000])
    expect(registrarLatencia(normas, questao, texto(500), errada, P)).toBe(normas)
    expect(registrarLatencia(normas, questao, texto(100), chute, P)).toBe(normas)
    const limitada = criarQuestao(A, { tipo: 'rotulo-digitado' }, { tipo: 'isolada' }, ms(4000))
    expect(registrarLatencia(normas, limitada, { tipo: 'tempo-esgotado' }, certa, P)).toBe(normas)
  })

  it('mantém só as últimas da janela, com a janela ajustada', () => {
    // Janela de três, e não as vinte do padrão.
    const p = desembrulhar(resolverParametros({ janelaNormasDeLatencia: 3, amostrasMinimasDeLatencia: 2 }))
    const normas = [1, 2, 3, 4].reduce(
      (n, x) => registrarLatencia(n, questao, texto(x), certa, p),
      NORMAS_DE_LATENCIA_VAZIAS,
    )
    expect(normas['rotulo-digitado']).toEqual([2, 3, 4])
    expect(
      registrarLatencia(normasCom(Array.from({ length: 20 }, (_, i) => i)), questao, texto(99), certa, P)[
        'rotulo-digitado'
      ],
    ).toHaveLength(20)
  })
})

describe('medianaDoFormato', () => {
  it('é a do conjunto, com a média das duas do meio quando o número é par', () => {
    expect(medianaDoFormato(normasCom(OITO), 'rotulo-digitado', P)).toBe(1500)
    expect(medianaDoFormato(normasCom([...OITO, 5000]), 'rotulo-digitado', P)).toBe(1600)
    expect(medianaDoFormato(normasCom([2000, 900, 1000, 1100, 1200, 1400, 1600, 1800]), 'rotulo-digitado', P)).toBe(
      1300,
    )
  })

  it('não existe abaixo das amostras mínimas, com o mínimo ajustado', () => {
    expect(medianaDoFormato(normasCom(OITO.slice(1)), 'rotulo-digitado', P)).toBeUndefined()
    const cinco = desembrulhar(resolverParametros({ amostrasMinimasDeLatencia: 5 }))
    expect(medianaDoFormato(normasCom(OITO.slice(3)), 'rotulo-digitado', cinco)).toBe(1800)
    expect(medianaDoFormato(normasCom(OITO.slice(4)), 'rotulo-digitado', cinco)).toBeUndefined()
  })
})

describe('limiteCronometrado', () => {
  // Fator 2 e piso de 2500 ms, e não 1,5 e 3000 do padrão, para o limite vir dos parâmetros.
  const p = desembrulhar(resolverParametros({ fatorLimiteCronometrado: 2, limiteCronometradoMinMs: 2500 }))
  const limite = (e: EstadoMemoria, normas: NormasDeLatencia, parametros = p, tecnicas = TECNICAS_TODAS_LIGADAS) =>
    limiteCronometrado(e, normas, 'rotulo-digitado', parametros, tecnicas)

  it('é o fator vezes a mediana, com o piso, e o piso sem amostras bastantes', () => {
    expect(limite(pronto(3, 0.9), normasCom(OITO))).toBe(3000)
    expect(limite(pronto(3, 0.9), normasCom(OITO.map((x) => x / 2)))).toBe(2500)
    expect(limite(pronto(3, 0.9), NORMAS_DE_LATENCIA_VAZIAS)).toBe(2500)
  })

  it('lê a mediana do formato pedido', () => {
    // Mediana de 1500 ms na múltipla escolha e de 3000 ms no texto digitado: o fator 2 dá 3000 e 6000. O formato sem
    // amostras fica no piso.
    const normas = { ...normasCom(OITO.map((x) => 2 * x)), 'estimulo-para-rotulo': OITO.map(ms) }
    const noFormato = (formato: TipoDeFormato) =>
      limiteCronometrado(pronto(3, 0.9), normas, formato, p, TECNICAS_TODAS_LIGADAS)
    expect(noFormato('estimulo-para-rotulo')).toBe(3000)
    expect(noFormato('rotulo-digitado')).toBe(6000)
    expect(noFormato('rotulo-para-estimulo')).toBe(2500)
  })

  it('não existe antes das repetições e da acurácia mínimas, que o tópico atinge sem tempo', () => {
    expect(limite(pronto(2.9, 0.95), normasCom(OITO))).toBeUndefined()
    expect(limite(pronto(5, 0.89), normasCom(OITO))).toBeUndefined()
    const exigente = desembrulhar(
      resolverParametros({ numRepeticoesMinimaCronometrada: 4, acuraciaMinimaCronometrada: 0.8 }),
    )
    expect(limite(pronto(3.5, 0.95), normasCom(OITO), exigente)).toBeUndefined()
    expect(limite(pronto(4, 0.85), normasCom(OITO), exigente)).toBe(3000)
  })
})

describe('interruptor cronometragem', () => {
  // O mesmo cenário com a técnica ligada e desligada: tópico pronto para o cronômetro, normas com mediana 1500 ms no
  // texto digitado, uma revisão e três respostas.
  const normas = normasCom(OITO)
  const DESLIGADA: Tecnicas = { ...TECNICAS_TODAS_LIGADAS, cronometragem: false }
  const cenario = (tecnicas: Tecnicas) => {
    const limiteMs = limiteCronometrado(pronto(5, 0.95), normas, 'rotulo-digitado', P, tecnicas)
    const questao: Questao = desembrulhar(
      gerarQuestao({ tipo: 'revisao', item: A }, catalogo, contextoDeSessao({}), sorteioComSemente('x'), P, limiteMs),
    )
    const avaliar = (resposta: Resposta) => avaliarResposta(questao, resposta, catalogo, normas, P)
    return {
      limiteMs: questao.limiteMs,
      lenta: avaliar({ tipo: 'texto', texto: 'Item A', latencia: ms(2500) }),
      depoisDoLimite: avaliar({ tipo: 'texto', texto: 'Item A', latencia: ms(6000) }),
      tempoEsgotado: avaliar({ tipo: 'tempo-esgotado' }),
    }
  }

  it('ligada, cronometra, chama de lenta o acerto devagar e esgota o tempo', () => {
    const ligada = cenario(TECNICAS_TODAS_LIGADAS)
    expect(ligada.limiteMs).toBe(3000)
    expect(ligada.lenta).toMatchObject({ ok: true, valor: { correta: true, qualidade: 'lenta' } })
    expect(ligada.depoisDoLimite).toMatchObject({ ok: true, valor: { correta: false, qualidade: 'tempo-esgotado' } })
    expect(ligada.tempoEsgotado).toMatchObject({ ok: true, valor: { qualidade: 'tempo-esgotado' } })
  })

  it('desligada, nunca cronometra: o acerto é só perfeita ou boa, e o tempo esgotado é incompatível', () => {
    const desligada = cenario(DESLIGADA)
    expect(desligada.limiteMs).toBeUndefined()
    expect(desligada.lenta).toMatchObject({ ok: true, valor: { correta: true, qualidade: 'boa' } })
    expect(desligada.depoisDoLimite).toMatchObject({ ok: true, valor: { correta: true, qualidade: 'boa' } })
    expect(desligada.tempoEsgotado).toMatchObject({ ok: false, erro: { codigo: 'RESPOSTA_INCOMPATIVEL' } })
  })
})
