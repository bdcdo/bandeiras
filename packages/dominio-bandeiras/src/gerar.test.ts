/**
 * gerar.ts monta em memória tudo o que grava e só toca no disco depois de passar por todas as validações: uma falha no
 * meio não pode deixar imagens/ e hashes.json novos ao lado de bandeiras.json e LICENCAS-DE-DADOS.md velhos.
 *
 * O teste roda o principal() de verdade sobre duas bandeiras. comum.ts é trocado por uma versão cujas pastas de saída
 * ficam num diretório temporário e cujo falhar lança um erro em vez de encerrar o processo; a curadoria é a real, menos
 * a descrição do Zimbábue.
 */
import { existsSync, mkdirSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { afterAll, describe, expect, it, vi } from 'vitest'
import type * as Comum from '../scripts/comum.ts'
import { CAMINHOS } from '../scripts/comum.ts'
import { GATE_SO_PELO_LIBRSVG, principal } from '../scripts/gerar.ts'

vi.mock('../scripts/membros.ts', () => ({ MEMBROS_EM_ORDEM: ['br', 'zw'] }))
vi.mock('../scripts/comum.ts', async (importOriginal) => {
  const original = await importOriginal<typeof Comum>()
  const { mkdtempSync } = await import('node:fs')
  const { tmpdir: pastaTemporaria } = await import('node:os')
  const { join } = await import('node:path')
  const raiz = mkdtempSync(join(pastaTemporaria(), 'gerar-'))
  return {
    ...original,
    CAMINHOS: {
      ...original.CAMINHOS,
      cache: join(raiz, 'cache/'),
      gerado: join(raiz, 'gerado/'),
      imagens: join(raiz, 'imagens/'),
      raizDoRepositorio: join(raiz, '/'),
    },
    falhar: (mensagem: string): never => {
      throw new Error(mensagem)
    },
    lerCuradoria: () => {
      const curadoria = original.lerCuradoria()
      return { ...curadoria, descricoes: curadoria.descricoes.filter((d) => d.codigo !== 'zw') }
    },
  }
})

const SVG = '<svg xmlns="http://www.w3.org/2000/svg" width="30" height="20" viewBox="0 0 3 2"><path d="M0 0h3v2H0z"/></svg>'

afterAll(() => {
  if (CAMINHOS.raizDoRepositorio.startsWith(tmpdir())) rmSync(CAMINHOS.raizDoRepositorio, { recursive: true })
})

describe('gerar.ts', () => {
  it('uma validação que falha depois do processamento das imagens não deixa nada gravado', async () => {
    // Trava: se a troca de comum.ts não pegasse, o principal() gravaria no pacote de verdade.
    for (const pasta of [CAMINHOS.cache, CAMINHOS.gerado, CAMINHOS.imagens]) expect(pasta.startsWith(tmpdir())).toBe(true)
    for (const pasta of [CAMINHOS.cache, CAMINHOS.gerado, CAMINHOS.imagens]) mkdirSync(pasta, { recursive: true })
    for (const codigo of ['br', 'zw']) writeFileSync(`${CAMINHOS.cache}${codigo}.svg`, SVG)
    writeFileSync(`${CAMINHOS.imagens}anterior.svg`, SVG)
    writeFileSync(`${CAMINHOS.gerado}vizinhos.json`, JSON.stringify({ br: ['zw'], zw: ['br'] }))
    writeFileSync(`${CAMINHOS.gerado}licencas.json`, '[]')

    await expect(principal()).rejects.toThrow('zw: sem descrição')

    expect(readdirSync(CAMINHOS.imagens)).toEqual(['anterior.svg'])
    expect(readdirSync(CAMINHOS.gerado).sort()).toEqual(['licencas.json', 'vizinhos.json'])
    expect(existsSync(`${CAMINHOS.raizDoRepositorio}LICENCAS-DE-DADOS.md`)).toBe(false)
  })

  it('só o Paquistão é isento do gate pelo resvg', () => {
    // A isenção é um desvio aceito, com a razão no comentário da constante; um código novo nela tem de passar por aqui.
    expect([...GATE_SO_PELO_LIBRSVG]).toEqual(['pk'])
  })
})
