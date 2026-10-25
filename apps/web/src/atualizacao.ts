/**
 * Registra o service worker gerado no build. Em desenvolvimento não existe sw.js, então nada é registrado.
 *
 * `aoHaverVersaoNova` recebe uma função que ativa a versão nova; a casca a liga a uma faixa "versão nova, recarregar".
 * Até a pessoa aceitar, a versão antiga continua servindo, e nada muda no meio de uma sessão.
 */
export function registrarServiceWorker(aoHaverVersaoNova: (ativar: () => void) => void = () => {}): void {
  if (!import.meta.env.PROD || !('serviceWorker' in navigator)) return

  // Na primeira instalação `clients.claim()` também dispara controllerchange; só recarregar quando já havia um controlador
  // evita um reload na primeira visita.
  let tinhaControlador = navigator.serviceWorker.controller !== null
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (!tinhaControlador) {
      tinhaControlador = true
      return
    }
    window.location.reload()
  })

  void navigator.serviceWorker.register(`${import.meta.env.BASE_URL}sw.js`).then((registro) => {
    registro.addEventListener('updatefound', () => {
      const novo = registro.installing
      if (novo === null) return
      novo.addEventListener('statechange', () => {
        // `installed` com um controlador ativo é versão nova esperando; sem controlador é a primeira instalação.
        if (novo.state === 'installed' && navigator.serviceWorker.controller !== null) {
          aoHaverVersaoNova(() => {
            novo.postMessage({ tipo: 'ativar' })
          })
        }
      })
    })
  })
}
