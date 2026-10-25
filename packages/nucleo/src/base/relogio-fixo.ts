import type { Relogio } from './portas'
import { somarMilis, type Instante, type Milis } from './tempo'

/** Relógio que só anda quando mandado: testes e simulador avançam o tempo de propósito, sem esperar. */
export type RelogioFixo = Relogio & {
  avancar(milis: Milis): void
  irPara(instante: Instante): void
}

export function relogioFixo(inicio: Instante): RelogioFixo {
  let atual = inicio
  return {
    agora: () => atual,
    avancar: (milis) => {
      atual = somarMilis(atual, milis)
    },
    irPara: (instante) => {
      atual = instante
    },
  }
}
