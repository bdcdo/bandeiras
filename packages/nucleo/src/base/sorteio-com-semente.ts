import { hashFnv1a } from './hash'
import type { Sorteio } from './portas'

export type SorteioComSemente = Sorteio & {
  /** Inteiro uniforme em [min, maxExclusivo). Os dois limites são inteiros e o intervalo não é vazio. */
  inteiro(min: number, maxExclusivo: number): number
  /** Cópia embaralhada de `xs`; a lista recebida não muda. */
  embaralhar<T>(xs: readonly T[]): T[]
}

/**
 * Sorteio determinístico: a mesma semente gera sempre a mesma sequência, em qualquer aparelho.
 *
 * O gerador é o mulberry32. Trinta e dois bits de estado bastam para o que o núcleo sorteia (embaralhar listas de
 * algumas centenas de itens e escolher distratores), o período de 2^32 fica muito acima do número de sorteios de uma
 * sessão, e o algoritmo inteiro cabe em dez linhas que se conferem à mão, sem tabela nem biblioteca.
 *
 * A semente é texto, para quem chama poder compor contexto nela (semente do perfil, número do evento). Ela passa pelo
 * FNV-1a de 64 bits, e os 8 primeiros dígitos hexadecimais viram o estado inicial de 32 bits: textos parecidos dão
 * estados sem relação aparente, e o mesmo texto dá sempre o mesmo estado.
 */
export function sorteioComSemente(semente: string): SorteioComSemente {
  let estado = Number.parseInt(hashFnv1a(semente).slice(0, 8), 16) | 0

  function proximo(): number {
    // mulberry32: soma uma constante ímpar ao estado (sequência de Weyl) e embaralha os bits com duas multiplicações
    // inteiras de 32 bits. `| 0` e `>>> 0` mantêm cada passo em 32 bits, com e sem sinal; Math.imul multiplica sem
    // perder os bits baixos, o que a multiplicação em ponto flutuante faria.
    estado = (estado + 0x6d2b79f5) | 0
    let t = Math.imul(estado ^ (estado >>> 15), 1 | estado)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4_294_967_296
  }

  function inteiro(min: number, maxExclusivo: number): number {
    if (!Number.isInteger(min) || !Number.isInteger(maxExclusivo) || maxExclusivo <= min) {
      // Chamada fora do contrato é defeito de quem chama, não fluxo esperado: sem o erro, inteiro(3, 3) devolveria 3,
      // fora do intervalo pedido, e o defeito apareceria longe daqui.
      throw new RangeError(`inteiro(${String(min)}, ${String(maxExclusivo)}): limites inteiros com min < maxExclusivo`)
    }
    return min + Math.floor(proximo() * (maxExclusivo - min))
  }

  function embaralhar<T>(xs: readonly T[]): T[] {
    // Fisher-Yates de trás para a frente: cada posição troca com uma posição sorteada entre as que ainda não foram
    // fixadas, e assim toda permutação sai com a mesma probabilidade.
    const copia = [...xs]
    for (let i = copia.length - 1; i > 0; i--) {
      const j = inteiro(0, i + 1)
      const temporario = copia[i] as T
      copia[i] = copia[j] as T
      copia[j] = temporario
    }
    return copia
  }

  return { proximo, inteiro, embaralhar }
}
