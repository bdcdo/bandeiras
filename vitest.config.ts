import { configDefaults, defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    projects: [
      {
        // O teste de desempenho roda só por vitest.desempenho.config.ts, fora do laço rápido e da porta única.
        test: {
          name: 'nucleo',
          root: './packages/nucleo',
          include: ['src/**/*.test.ts'],
          exclude: [...configDefaults.exclude, 'src/**/*.desempenho.test.ts'],
          environment: 'node',
        },
      },
      {
        test: {
          name: 'dominio',
          root: './packages/dominio-bandeiras',
          include: ['src/**/*.test.ts'],
          environment: 'node',
        },
      },
      {
        // Herda os plugins do Vite da casca (React); o plugin do service worker só age no build.
        extends: './apps/web/vite.config.ts',
        test: {
          name: 'web',
          root: './apps/web',
          include: ['src/**/*.test.{ts,tsx}'],
          environment: 'jsdom',
          setupFiles: ['./src/teste/configurar.ts'],
        },
      },
    ],
    coverage: {
      provider: 'v8',
      include: ['packages/*/src/**', 'apps/web/src/**'],
      exclude: ['**/*.test.{ts,tsx}', '**/teste/**', '**/apoio-a-testes/**'],
      // Piso medido depois da primeira suíte completa, escrito com o número; só sobe.
    },
  },
})
