import { describe, expect, it } from 'vitest'
import { desembrulhar } from '../base/resultado'
import { PARAMETROS_PADRAO as P, resolverParametros, type QualidadeDeResposta } from '../memoria/parametros'
import { chuteSistematico } from './chute-sistematico'

/** Qualidades por letra: c é chute, p é perfeita, e é errada. */
const q = (texto: string): QualidadeDeResposta[] =>
  texto.split('').map((l) => (l === 'c' ? 'chute' : l === 'e' ? 'errada' : 'perfeita'))

describe('chuteSistematico', () => {
  it('dois chutes na tarefa bastam; um só, não', () => {
    expect(chuteSistematico(q('pcpc'), [], P)).toBe(true)
    expect(chuteSistematico(q('pcpe'), [], P)).toBe(false)
  })

  it('três chutes entre as dez últimas respostas, contadas as da tarefa, também', () => {
    expect(chuteSistematico(q('pc'), q('cppppppc'), P)).toBe(true)
    // O primeiro chute das anteriores cai fora da janela de dez.
    expect(chuteSistematico(q('pc'), q('cpppppppc'), P)).toBe(false)
    // Erro comum não é chute.
    expect(chuteSistematico(q('pe'), q('eeeeeeee'), P)).toBe(false)
  })

  it('tarefa sem chute nenhum não é chute sistemático, por mais chutes que venham antes', () => {
    expect(chuteSistematico(q('ppp'), q('ccc'), P)).toBe(false)
    expect(chuteSistematico(q('pe'), q('cccccccc'), P)).toBe(false)
    // Um chute na tarefa basta para a janela voltar a contar.
    expect(chuteSistematico(q('pc'), q('cc'), P)).toBe(true)
  })

  it('segue os limiares e a janela ajustados', () => {
    // Três na tarefa, quatro em seis, e não os dois, três e dez do padrão.
    const p = desembrulhar(
      resolverParametros({ chutesNaTarefaSistematico: 3, chutesNasUltimasSistematico: 4, janelaChuteSistematico: 6 }),
    )
    expect(chuteSistematico(q('cpc'), [], p)).toBe(false)
    expect(chuteSistematico(q('ccc'), [], p)).toBe(true)
    expect(chuteSistematico(q('cpc'), q('cc'), p)).toBe(true)
    expect(chuteSistematico(q('cpc'), q('ccppp'), p)).toBe(false)
  })
})
