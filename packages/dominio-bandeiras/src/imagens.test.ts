/**
 * Um registro de bandeiras.json com formato de imagem desconhecido, simulado por mock do JSON. O defeito tem de
 * reprovar quem usa as imagens, e só quem as usa: dados.ts carrega sem olhar o formato, para o teste de dados rodar
 * inteiro e relatar na mesma rodada todos os invariantes, inclusive o que acusa esse formato.
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import gerado from '../gerado/bandeiras.json'

const BANDEIRAS_JSON = '../gerado/bandeiras.json'

// Cópia de bandeiras.json em que o Brasil declara PNG, formato que o gerador não grava.
const comPng = {
  ...gerado,
  bandeiras: gerado.bandeiras.map((b) => (b.codigo === 'br' ? { ...b, imagem: { ...b.imagem, formato: 'png' } } : b)),
}

// Cada teste carrega os módulos de novo, já com o JSON trocado. O mock e o cache de módulos saem depois de cada um,
// para o JSON trocado não vazar para outro teste.
function comRegistroPng(): void {
  vi.resetModules()
  vi.doMock(BANDEIRAS_JSON, () => ({ default: comPng }))
}

afterEach(() => {
  vi.doUnmock(BANDEIRAS_JSON)
  vi.resetModules()
})

describe('formato de imagem desconhecido', () => {
  it('reprova a carga do estímulo, com o código e o formato na mensagem', async () => {
    comRegistroPng()
    await expect(import('./estimulo')).rejects.toThrow(
      "A bandeira 'br' declara o formato de imagem 'png', que não é svg nem webp.",
    )
  })

  it('não reprova a carga dos dados do catálogo, de que o teste de dados depende', async () => {
    comRegistroPng()
    const { DADOS_DE_CATALOGO } = await import('./dados')
    expect(DADOS_DE_CATALOGO.itens).toHaveLength(193)
  })
})
