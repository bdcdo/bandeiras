/// <reference lib="webworker" />

// `self` já existe na lib WebWorker com o tipo genérico de worker; o cast dá o tipo de service worker.
const sw = self as unknown as ServiceWorkerGlobalScope

// Injetados pelo plugin no build: a lista de arquivos e um hash dela, que dá nome ao cache desta versão.
declare const __PRECACHE__: readonly string[]
declare const __VERSAO__: string

const PRECACHE: readonly string[] = __PRECACHE__
const CACHE = `bandeiras-${__VERSAO__}`
// O primeiro item é a base do site, servida no lugar de index.html em toda navegação.
const BASE = PRECACHE[0] ?? '/'

sw.addEventListener('install', (evento) => {
  evento.waitUntil(caches.open(CACHE).then((cache) => cache.addAll([...PRECACHE])))
})

sw.addEventListener('activate', (evento) => {
  evento.waitUntil(
    (async () => {
      const nomes = await caches.keys()
      await Promise.all(nomes.filter((nome) => nome !== CACHE).map((nome) => caches.delete(nome)))
      await sw.clients.claim()
    })(),
  )
})

// A página manda `ativar` quando a pessoa aceita a versão nova; até então o worker novo espera.
sw.addEventListener('message', (evento) => {
  const dado: unknown = evento.data
  if (typeof dado === 'object' && dado !== null && 'tipo' in dado && dado.tipo === 'ativar') void sw.skipWaiting()
})

sw.addEventListener('fetch', (evento) => {
  const pedido = evento.request
  if (pedido.method !== 'GET') return
  // Clerk e Supabase ficam fora do worker: nunca cacheados, nunca interceptados.
  if (new URL(pedido.url).origin !== sw.location.origin) return
  if (pedido.mode === 'navigate') {
    evento.respondWith(caches.match(BASE).then((resposta) => resposta ?? fetch(pedido)))
    return
  }
  evento.respondWith(caches.match(pedido).then((resposta) => resposta ?? fetch(pedido)))
})
