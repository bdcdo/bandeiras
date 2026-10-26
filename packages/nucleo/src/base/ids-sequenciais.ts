import type { GeradorDeIds } from './portas'

/** Gerador de ids previsíveis (`id-1`, `id-2`, ...) para testes e cenários. */
export function idsSequenciais(prefixo = 'id'): GeradorDeIds {
  let contador = 0
  return {
    proximo: () => {
      contador += 1
      return `${prefixo}-${String(contador)}`
    },
  }
}
