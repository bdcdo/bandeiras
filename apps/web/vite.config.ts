import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'
import { serviceWorker } from './plugins/service-worker.ts'

export default defineConfig({
  base: '/bandeiras/',
  plugins: [react(), serviceWorker()],
  build: {
    // Nenhuma imagem vira data: URI. As bandeiras entram no pré-cache como arquivos, e o CSP não precisa abrir data: para
    // nada além do que o Clerk pede.
    assetsInlineLimit: 0,
  },
  preview: { port: 4173, strictPort: true },
})
