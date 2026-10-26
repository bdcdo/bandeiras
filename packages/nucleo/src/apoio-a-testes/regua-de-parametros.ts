import {
  PARAMETROS_PADRAO as P,
  resolverParametros,
  type CaminhoDeParametro,
  type Parametros,
} from '../memoria/parametros'

// Régua de uma classe de defeito: a fórmula que lê um parâmetro no lugar de outro. Vários parâmetros têm o mesmo valor
// padrão, e uma troca entre dois deles dá os mesmos números em todo teste que roda com os padrões. Cada camada declara,
// para cada fórmula dela, de quais caminhos de parâmetro ela depende, inclusive pelas fórmulas que chama, e o teste da
// camada confere duas coisas com as funções daqui. Primeiro, que a fórmula lê exatamente esses caminhos, registrados por
// um Proxy; segundo, que cada um deles, ajustado sozinho por `resolverParametros`, muda a saída em ao menos um dos
// cenários fixos. Trocar todas as leituras de um caminho por outro reprova a primeira, porque o caminho declarado deixa
// de ser lido. A régua não garante pegar a troca parcial, em que só uma das leituras de um caminho lido em mais de um
// lugar passa a ler outro caminho declarado, nem a permuta de dois caminhos declarados: nas duas, os dois continuam
// lidos e movendo a saída. Essas trocas ficam com casos fixos de parâmetros ajustados nos testes de cada camada, como o
// da guarda de `decaimentoPorAtraso`. Uma fórmula que passe a ler um caminho novo reprova a primeira até ele entrar na
// lista dela, com um cenário em que mova a saída.
//
// O módulo não importa o Vitest: fora dos arquivos de teste, o núcleo só importa do núcleo. Cada teste de camada monta o
// `describe` com estas funções.

export type Formula = Readonly<{
  nome: string
  dependeDe: readonly CaminhoDeParametro[]
  /** Cenários fixos; cada caminho de `dependeDe` precisa mover a saída em ao menos um deles. */
  cenarios: readonly ((p: Parametros) => unknown)[]
}>

/**
 * Os parâmetros, com cada caminho lido anotado em `lidos`. O Proxy envolve uma cópia rasa de cada nível, e não o objeto
 * congelado: sobre uma propriedade congelada, o Proxy é obrigado a devolver o próprio valor dela, e não poderia devolver
 * o espião do objeto aninhado no lugar.
 */
export function espiao(p: Parametros, lidos: Set<string>): Parametros {
  const espiar = (alvo: object, prefixo: string): object =>
    new Proxy(
      { ...alvo },
      {
        get(copia, chave) {
          const valor: unknown = Reflect.get(copia, chave)
          if (typeof chave !== 'string') return valor
          if (typeof valor === 'object' && valor !== null) return espiar(valor, `${prefixo}${chave}.`)
          lidos.add(`${prefixo}${chave}`)
          return valor
        },
      },
    )
  return espiar(p, '') as Parametros
}

function valorPadrao(caminho: CaminhoDeParametro): number {
  const [chave = '', sub] = caminho.split('.')
  const valor: unknown = Reflect.get(P, chave)
  const folha: unknown = sub === undefined ? valor : Reflect.get(valor as object, sub)
  if (typeof folha !== 'number') throw new Error(`caminho sem valor numérico: ${caminho}`)
  return folha
}

/**
 * Múltiplos do valor padrão tentados em cada caminho; os que `resolverParametros` recusa, pela faixa ou por uma relação,
 * ficam de fora. Os múltiplos longe de 1 existem porque alguns parâmetros só agem longe do padrão, como os limites da
 * velocidade, que a razão nunca alcança com os padrões. Um caminho de padrão zero, como o multiplicador do XP abaixo da
 * barra, não tem múltiplo diferente dele, e recebe os próprios fatores como valores.
 */
const FATORES = [0.25, 0.5, 0.8, 1.25, 2, 4]

export function variacoes(caminho: CaminhoDeParametro): Parametros[] {
  const padrao = valorPadrao(caminho)
  return FATORES.flatMap((fator) => {
    const r = resolverParametros({ [caminho]: padrao === 0 ? fator : padrao * fator })
    return r.ok ? [r.valor] : []
  })
}

// A saída de toda fórmula sob a régua é número, booleano, texto ou objeto e lista deles, e o JSON compara todos bit a
// bit. Quem devolve Map ou Set converte no cenário, porque o JSON de um Map é sempre `{}`.
const mesmaSaida = (a: unknown, b: unknown): boolean => JSON.stringify(a) === JSON.stringify(b)

/** Caminhos de parâmetro que os cenários da fórmula leem, todos juntos. */
export function caminhosLidos(formula: Formula): ReadonlySet<string> {
  const lidos = new Set<string>()
  for (const cenario of formula.cenarios) cenario(espiao(P, lidos))
  return lidos
}

/** Verdadeiro se alguma variação aceita do caminho, sozinha, muda a saída de algum cenário. */
export function mudaASaida(formula: Formula, caminho: CaminhoDeParametro): boolean {
  const ajustes = variacoes(caminho)
  return formula.cenarios.some((cenario) => ajustes.some((p) => !mesmaSaida(cenario(p), cenario(P))))
}
