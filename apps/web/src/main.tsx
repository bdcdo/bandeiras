import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { App } from './App'
import { registrarServiceWorker } from './atualizacao'

registrarServiceWorker()

const raiz = document.getElementById('raiz')
if (raiz === null) throw new Error('index.html sem o elemento #raiz')
createRoot(raiz).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
