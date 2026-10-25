// Deriva de apps/web/public/icone.svg os ícones PNG de 192 e 512 px que o manifesto do PWA pede (instalação no Android e
// tela inicial) e os acrescenta a manifest.webmanifest. Rodar à mão com `pnpm gerar:icones` depois de mudar o icone.svg;
// os PNGs são commitados, como os demais dados gerados.
import { readFileSync, writeFileSync } from 'node:fs'
import sharp from 'sharp'

const PUBLICO = new URL('../apps/web/public/', import.meta.url)
const TAMANHOS = [192, 512]
// O icone.svg só declara viewBox 64x64, e o librsvg do sharp o lê como 64 px a 72 dpi. A densidade sobe a resolução da
// rasterização até o tamanho final, para o PNG sair desenhado em 512 px, e não ampliado de 64.
const LADO_DO_SVG = 64

/** @typedef {{ src: string; sizes: string; type: string; purpose?: string }} Icone */
/** @typedef {{ icons: Icone[] } & Record<string, unknown>} Manifesto */

const svg = readFileSync(new URL('icone.svg', PUBLICO))
for (const tamanho of TAMANHOS) {
  const png = await sharp(svg, { density: (72 * tamanho) / LADO_DO_SVG })
    .resize(tamanho, tamanho)
    .png()
    .toBuffer()
  writeFileSync(new URL(`icone-${String(tamanho)}.png`, PUBLICO), png)
}

const caminhoDoManifesto = new URL('manifest.webmanifest', PUBLICO)
/** @type {unknown} */
const lido = JSON.parse(readFileSync(caminhoDoManifesto, 'utf8'))
const manifesto = /** @type {Manifesto} */ (lido)
// O SVG continua primeiro; os PNGs entram uma vez só, mesmo rodando o script de novo.
for (const tamanho of TAMANHOS) {
  const src = `/bandeiras/icone-${String(tamanho)}.png`
  if (!manifesto.icons.some((icone) => icone.src === src)) {
    manifesto.icons.push({ src, sizes: `${String(tamanho)}x${String(tamanho)}`, type: 'image/png', purpose: 'any' })
  }
}
writeFileSync(caminhoDoManifesto, JSON.stringify(manifesto, null, 2) + '\n')
console.log(
  `ícones: ${TAMANHOS.map((t) => `icone-${String(t)}.png`).join(', ')}; manifesto com ${String(manifesto.icons.length)}`,
)
