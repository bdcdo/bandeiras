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
import { conferirRemocao, GATE_SO_PELO_LIBRSVG, principal } from '../scripts/gerar.ts'

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

const SVG =
  '<svg xmlns="http://www.w3.org/2000/svg" width="30" height="20" viewBox="0 0 3 2"><path d="M0 0h3v2H0z"/></svg>'

afterAll(() => {
  if (CAMINHOS.raizDoRepositorio.startsWith(tmpdir())) rmSync(CAMINHOS.raizDoRepositorio, { recursive: true })
})

describe('gerar.ts', () => {
  it('uma validação que falha depois do processamento das imagens não deixa nada gravado', async () => {
    // Trava: se a troca de comum.ts não pegasse, o principal() gravaria no pacote de verdade.
    const pastas = [CAMINHOS.cache, CAMINHOS.gerado, CAMINHOS.imagens]
    for (const pasta of pastas) expect(pasta.startsWith(tmpdir())).toBe(true)
    for (const pasta of pastas) mkdirSync(pasta, { recursive: true })
    for (const codigo of ['br', 'zw']) writeFileSync(`${CAMINHOS.cache}${codigo}.svg`, SVG)
    writeFileSync(`${CAMINHOS.imagens}anterior.svg`, SVG)
    writeFileSync(`${CAMINHOS.gerado}vizinhos.json`, JSON.stringify({ br: ['zw'], zw: ['br'] }))
    writeFileSync(`${CAMINHOS.gerado}licencas.json`, '[]')

    await expect(principal()).rejects.toThrow('zw: sem descrição')

    expect(readdirSync(CAMINHOS.imagens)).toEqual(['anterior.svg'])
    expect(readdirSync(CAMINHOS.gerado).sort()).toEqual(['licencas.json', 'vizinhos.json'])
    expect(existsSync(`${CAMINHOS.raizDoRepositorio}LICENCAS-DE-DADOS.md`)).toBe(false)
  })

  it('o gate da remoção aceita mudança só dentro da caixa e reprova mudança fora dela ou nenhuma mudança', () => {
    // Um retângulo amarelo no centro de 100x50 (x de 40% a 60%, y de 40% a 60%) é a "inscrição" que sai.
    const fundo = '<path fill="#00f" d="M0 0h100v50H0z"/>'
    const svg = (corpo: string): string =>
      `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 50">${fundo}${corpo}</svg>`
    const original = svg('<path fill="#fc0" d="M40 20h20v10H40z"/>')
    const derivado = svg('')
    const comCaixa = (x0: number, y0: number, x1: number, y1: number) => ({
      codigo: 'xx',
      texto: 'TESTE',
      lugar: 'no teste',
      caixa: { x0, y0, x1, y1 },
      operacoes: [],
    })
    expect(conferirRemocao(comCaixa(0.39, 0.39, 0.61, 0.61), original, derivado)).toBeGreaterThan(0)
    expect(() => conferirRemocao(comCaixa(0.45, 0.39, 0.61, 0.61), original, derivado)).toThrow('fora da caixa')
    expect(() => conferirRemocao(comCaixa(0.39, 0.39, 0.61, 0.61), original, original)).toThrow(
      'não mudou nenhum pixel dentro da caixa',
    )
    // A caixa da imagem inteira, ou uma com 5% de sobra em cada borda, não serve de régua.
    expect(() => conferirRemocao(comCaixa(0, 0, 1, 1), original, derivado)).toThrow('longe da borda da caixa')
    expect(() => conferirRemocao(comCaixa(0.35, 0.35, 0.65, 0.65), original, derivado)).toThrow('longe da borda')
  })

  it('o gate da remoção reprova a operação que tira outra parte do desenho dentro da caixa', () => {
    // Como em ni e sv: uma "legenda" em anel (x e y de 30% a 70%) cerca um "emblema" no meio (de 45% a 55%), e a caixa
    // justa na legenda contém o emblema. Tirar o emblema no lugar da legenda não muda nada fora da caixa.
    const svg = (corpo: string): string =>
      `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><path fill="#00f" d="M0 0h100v100H0z"/>${corpo}</svg>`
    const legenda = '<path fill="#fc0" fill-rule="evenodd" d="M30 30h40v40H30z M35 35v30h30V35z"/>'
    const emblema = '<path fill="#c00" d="M45 45h10v10H45z"/>'
    const naLegenda = {
      codigo: 'xx',
      texto: 'TESTE',
      lugar: 'no teste',
      caixa: { x0: 0.29, y0: 0.29, x1: 0.71, y1: 0.71 },
      operacoes: [],
    }
    const original = svg(legenda + emblema)
    expect(conferirRemocao(naLegenda, original, svg(emblema))).toBeGreaterThan(0)
    expect(() => conferirRemocao(naLegenda, original, svg(legenda))).toThrow(
      'ou a operação tirou outra parte do desenho, menor, dentro dela',
    )
  })

  it('só o Paquistão é isento do gate pelo resvg', () => {
    // A isenção é um desvio aceito, com a razão no comentário da constante; um código novo nela tem de passar por aqui.
    expect([...GATE_SO_PELO_LIBRSVG]).toEqual(['pk'])
  })
})
