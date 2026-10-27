import { defineConfig } from 'vitest/config'

// Só os testes de desempenho do núcleo (`*.desempenho.test.ts`), que o projeto `nucleo` de vitest.config.ts exclui. O
// tempo deles depende da máquina e da carga, e por isso não entram em `pnpm test` nem em `pnpm verify`: rodam à mão por
// `pnpm test:desempenho`, um arquivo por vez, para dois testes não disputarem a CPU que cada um mede.
export default defineConfig({
  test: {
    name: 'desempenho',
    root: './packages/nucleo',
    include: ['src/**/*.desempenho.test.ts'],
    environment: 'node',
    fileParallelism: false,
  },
})
