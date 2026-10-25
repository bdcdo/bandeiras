import { existsSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { defineConfig, devices } from '@playwright/test'

// As chaves do Clerk e do usuário de teste vêm de apps/web/.env.local na máquina local e do ambiente no CI. Variável
// ausente num spec que precisa dela é falha com mensagem, nunca skip.
const envLocal = fileURLToPath(new URL('./.env.local', import.meta.url))
if (existsSync(envLocal)) process.loadEnvFile(envLocal)

// O e2e roda sobre o build de produção servido pelo vite preview, com a mesma base do GitHub Pages.
const BASE_URL = 'http://localhost:4173/bandeiras/'

export default defineConfig({
  testDir: './e2e',
  // real.spec.ts fala com Supabase e Clerk reais e roda à mão por playwright.real.config.ts.
  testIgnore: ['**/real.spec.ts'],
  fullyParallel: false,
  workers: 1,
  forbidOnly: process.env['CI'] !== undefined,
  retries: 0,
  reporter: 'list',
  use: { baseURL: BASE_URL, trace: 'retain-on-failure' },
  webServer: {
    command: 'pnpm exec vite preview --port 4173 --strictPort',
    url: BASE_URL,
    reuseExistingServer: false,
    timeout: 60_000,
  },
  projects: [
    { name: 'desktop', use: { ...devices['Desktop Chrome'] } },
    // O celular roda só os specs de abertura, início e lição: o que muda com a tela é o layout dessas telas.
    { name: 'celular', use: { ...devices['Pixel 7'] }, testMatch: /(abrir|inicio|licao)\.spec\.ts$/ },
  ],
})
