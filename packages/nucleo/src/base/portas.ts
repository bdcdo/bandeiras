import type { Instante } from './tempo'

// Portas por onde tempo, acaso e identidade entram no núcleo. O núcleo não lê Date, Math.random nem crypto (o lint
// reprova): recebe estas interfaces de quem o chama, e por isso um teste ou uma reconstrução do log reproduz exatamente
// a mesma sessão trocando só a implementação.

export interface Relogio {
  agora(): Instante
}

export interface Sorteio {
  /** Número uniforme em [0, 1), como `Math.random()`. */
  proximo(): number
}

export interface GeradorDeIds {
  proximo(): string
}
