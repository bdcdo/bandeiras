import { expect, test } from '@playwright/test'

test('abre com o título, registra o service worker e não loga erro', async ({ page }) => {
  const erros: string[] = []
  page.on('console', (mensagem) => {
    if (mensagem.type() === 'error') erros.push(mensagem.text())
  })
  page.on('pageerror', (erro) => erros.push(erro.message))

  await page.goto('./')

  await expect(page).toHaveTitle('Bandeiras')
  await expect(page.getByRole('heading', { level: 1, name: 'Bandeiras' })).toBeVisible()
  // O preview serve o build, então o service worker existe e tem de estar ativo; em dev o plugin não o gera.
  const scriptDoWorker = await page.evaluate(async () => {
    const registro = await navigator.serviceWorker.ready
    return registro.active?.scriptURL ?? null
  })
  expect(scriptDoWorker).toContain('/bandeiras/sw.js')
  expect(erros).toEqual([])
})
