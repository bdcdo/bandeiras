import type { IdItem, Item } from './tipos'

const ARTIGOS_INICIAIS: ReadonlySet<string> = new Set(['a', 'o', 'as', 'os', 'the'])

/**
 * Forma canônica de um rótulo, para comparar o que a pessoa digitou com o rótulo e os aliases de um item.
 *
 * A ordem dos passos importa:
 * 1. NFD separa cada letra acentuada em letra base mais sinal combinante ("é" vira "e" + U+0301), e só assim o passo
 *    seguinte consegue apagar o acento sem apagar a letra.
 * 2. Remove os sinais combinantes do bloco U+0300 a U+036F, que cobre os acentos do português e das línguas europeias.
 * 3. Minúsculas.
 * 4. Hífen, traços de U+2010 a U+2015 e apóstrofo reto ou curvo viram espaço: "Guiné-Bissau" e "Guiné Bissau" se
 *    encontram, e "d'Ivoire" separa as palavras como quem digita sem apóstrofo.
 * 5. A pontuação restante some sem deixar espaço, para "E.U.A." encontrar "EUA".
 * 6. Espaços em sequência viram um, e as pontas são aparadas.
 * 7. Artigos iniciais caem enquanto sobrar mais de uma palavra: "O Brasil" vira "brasil", mas "O" sozinho fica. Cair
 *    todos, e não só o primeiro, é o que torna a função idempotente ("a a b" e "a b" chegam ambos a "b").
 * 8. NFD de novo no fim. Apagar um caractere (o U+034F do passo 2, ou pontuação) pode juntar dois sinais combinantes
 *    fora do bloco que estavam separados, e o NFD os reordenaria numa segunda passada; reordenar aqui garante que
 *    normalizar o que já foi normalizado não muda nada.
 */
export function normalizarRotulo(texto: string): string {
  const palavras = texto
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[-\u2010-\u2015'\u2019]/g, ' ')
    .replace(/\p{P}/gu, '')
    .replace(/\s+/g, ' ')
    .trim()
    .split(' ')
  let inicio = 0
  while (palavras.length - inicio > 1 && ARTIGOS_INICIAIS.has(palavras[inicio] ?? '')) inicio++
  return palavras.slice(inicio).join(' ').normalize('NFD')
}

/** Rótulo e aliases de um item, já normalizados, na ordem em que o item os declara. */
export function formasNormalizadas(item: Pick<Item, 'rotulo' | 'aliases'>): string[] {
  return [item.rotulo, ...item.aliases].map(normalizarRotulo)
}

/**
 * Verdadeiro se o texto, normalizado, é exatamente o rótulo ou um alias normalizado do item.
 *
 * Sem casamento aproximado, de propósito. Na recordação a pessoa precisa produzir o nome inteiro; aceitar o parecido
 * transformaria a pergunta em reconhecimento. No domínio das bandeiras, aceitar "Dominica" por "República Dominicana"
 * daria o crédito de recordar um nome a quem só lembrou um pedaço dele, que por acaso é outro item. Grafia alternativa
 * legítima entra como alias, declarada pelo domínio.
 */
export function casaComRotulo(texto: string, item: Pick<Item, 'rotulo' | 'aliases'>): boolean {
  return formasNormalizadas(item).includes(normalizarRotulo(texto))
}

/**
 * Índice da forma normalizada de cada rótulo e alias para o item. Num catálogo carregado cada forma resolve um item só,
 * porque `carregarCatalogo` recusa forma ambígua; com itens soltos e ambíguos, vence o primeiro que a declara.
 */
export function indiceDeRotulos(itens: Iterable<Item>): ReadonlyMap<string, IdItem> {
  const indice = new Map<string, IdItem>()
  for (const item of itens) {
    for (const forma of formasNormalizadas(item)) {
      if (!indice.has(forma)) indice.set(forma, item.id)
    }
  }
  return indice
}

/** Item cujo rótulo ou alias normalizado é o texto normalizado, ou `undefined` se nenhum for. */
export function resolverRotulo(indice: ReadonlyMap<string, IdItem>, texto: string): IdItem | undefined {
  return indice.get(normalizarRotulo(texto))
}
