/**
 * Invariantes dos dados commitados do domínio: curadoria/, gerado/ e imagens/. O gerador roda à mão e este teste é o
 * que valida o resultado no CI; por isso ele lê os arquivos como estão no repositório, sem regenerar nada.
 */
import { createHash } from 'node:crypto'
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import commons from '../curadoria/commons.json'
import descricoes from '../curadoria/descricoes.json'
import dificuldade from '../curadoria/dificuldade.json'
import familias from '../curadoria/familias.json'
import fora from '../curadoria/fora.json'
import nomes from '../curadoria/nomes.json'
import regioesM49 from '../curadoria/regioes-m49.json'
import vizinhancas from '../curadoria/vizinhancas.json'
import gerado from '../gerado/bandeiras.json'
import revisoes from '../gerado/commons-revisoes.json'
import hashes from '../gerado/hashes.json'
import licencas from '../gerado/licencas.json'
import { MEMBROS_ONU } from '../scripts/membros.ts'
import { PADROES_VISUAIS } from './classes'

const PASTA_IMAGENS = new URL('../imagens/', import.meta.url)
const bandeiras = gerado.bandeiras
const codigos = bandeiras.map((b) => b.codigo)
const membros = new Set<string>(MEMBROS_ONU)
const ordenados = (lista: Iterable<string>): string[] => [...lista].sort()

/**
 * Cópia local da normalização de rótulos do plano (NFD, sem diacríticos, minúsculas, hífen, traço e apóstrofo viram
 * espaço, sem a pontuação restante, espaços colapsados, sem artigo inicial). A normalização de verdade vive no núcleo;
 * quando o domínio passar a depender dele, este teste importa a de lá e esta função sai.
 */
function normalizar(texto: string): string {
  return texto
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .toLowerCase()
    .replace(/[-‐-―'‘’`´]/g, ' ')
    .replace(/[^\p{L}\p{N}\s]/gu, '')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/^(o|a|os|as) /, '')
}

/** Todos os rótulos aceitos de cada bandeira: o nome exibido e os aliases. */
const rotulos = new Map(bandeiras.map((b) => [b.codigo, [b.nome, ...b.aliases]]))

function resolver(texto: string): string[] {
  const alvo = normalizar(texto)
  return [...rotulos].filter(([, lista]) => lista.some((r) => normalizar(r) === alvo)).map(([codigo]) => codigo)
}

function sha256(conteudo: Buffer): string {
  return createHash('sha256').update(conteudo).digest('hex')
}

describe('membros', () => {
  it('a constante tem os 193 membros, sem repetição e sem observadores nem territórios', () => {
    expect(MEMBROS_ONU).toHaveLength(193)
    expect(membros.size).toBe(193)
    for (const ausente of ['va', 'tw', 'xk', 'ps']) expect(membros.has(ausente)).toBe(false)
  })

  it('bandeiras.json tem um registro por membro, com códigos únicos', () => {
    expect(bandeiras).toHaveLength(193)
    expect(new Set(codigos).size).toBe(193)
    expect(ordenados(codigos)).toEqual(ordenados(membros))
    expect(codigos).not.toContain('va')
  })

  it('commons.json, descricoes.json e regioes-m49.json cobrem exatamente os 193', () => {
    expect(ordenados(commons.map((c) => c.codigo))).toEqual(ordenados(membros))
    expect(ordenados(descricoes.map((d) => d.codigo))).toEqual(ordenados(membros))
    expect(ordenados(Object.keys(regioesM49.paises))).toEqual(ordenados(membros))
    expect(commons).toHaveLength(193)
    expect(descricoes).toHaveLength(193)
  })

  it('a revisão fixada e as licenças cobrem os 193, com os títulos de commons.json', () => {
    const titulo = new Map(commons.map((c) => [c.codigo, c.titulo]))
    expect(ordenados(revisoes.map((r) => r.codigo))).toEqual(ordenados(membros))
    expect(ordenados(licencas.map((l) => l.codigo))).toEqual(ordenados(membros))
    for (const r of revisoes) expect(r.titulo, r.codigo).toBe(titulo.get(r.codigo))
    for (const l of licencas) expect(l.titulo, l.codigo).toBe(titulo.get(l.codigo))
  })
})

describe('imagens', () => {
  const arquivos = readdirSync(PASTA_IMAGENS).sort()
  const ler = (nome: string): Buffer => readFileSync(new URL(nome, PASTA_IMAGENS))

  it('cada código tem o SVG ou o par de WebP que o registro declara, e nada sobra', () => {
    const esperados = bandeiras.flatMap((b) =>
      b.imagem.formato === 'svg'
        ? [`${b.codigo}.svg`]
        : (b.imagem.larguras ?? []).map((largura) => `${b.codigo}-${String(largura)}.webp`),
    )
    for (const b of bandeiras) {
      expect(['svg', 'webp'], b.codigo).toContain(b.imagem.formato)
      if (b.imagem.formato === 'webp') expect(b.imagem.larguras, b.codigo).toEqual([480, 960])
    }
    expect(arquivos).toEqual(esperados.sort())
  })

  it('o sha256 de cada arquivo é o de hashes.json, e hashes.json não lista arquivo ausente', () => {
    expect(Object.keys(hashes).sort()).toEqual(arquivos)
    const registrado = new Map(Object.entries(hashes))
    for (const nome of arquivos) expect(sha256(ler(nome)), nome).toBe(registrado.get(nome))
  })

  it('Síria e Afeganistão estão fixados: original do Commons e arquivo processado', () => {
    // A Síria trocou de bandeira em 2025 e o Afeganistão tem duas em disputa; uma regeneração que mudasse qualquer um
    // dos dois tem de reprovar aqui e passar por conferência à mão, com estes valores atualizados no mesmo commit.
    const sha1 = new Map(revisoes.map((r) => [r.codigo, r.sha1]))
    expect(sha1.get('sy')).toBe('ce342b675fcf2604f3cad0355397d72caf52a658')
    expect(sha1.get('af')).toBe('636a7f0a49f4793da6f75d7f503d28c9e1330f84')
    expect(sha256(ler('sy.svg'))).toBe('b42626405b126101b9ae0915acfd8cd7c9a5e0e93c6122a9e23c436f7dc412a8')
    expect(sha256(ler('af-480.webp'))).toBe('0cdcdf79f6c7dbcb31d0cb34367fb027c8ef6b45902e3c30c27b1e584c44fd95')
    expect(sha256(ler('af-960.webp'))).toBe('83b2dc272fded42c2adb71a8221e9c53704978130356de1ca0a25fb5637d84d3')
  })

  it('o conjunto de imagens soma até 6 MB', () => {
    const total = arquivos.reduce((soma, nome) => soma + statSync(new URL(nome, PASTA_IMAGENS)).size, 0)
    expect(total).toBeLessThanOrEqual(6 * 1024 * 1024)
  })

  it('a proporção de toda bandeira fica entre 0,5 e 3', () => {
    for (const b of bandeiras) {
      expect(b.proporcao, b.codigo).toBeGreaterThanOrEqual(0.5)
      expect(b.proporcao, b.codigo).toBeLessThanOrEqual(3)
    }
  })
})

describe('licenças', () => {
  const ATRIBUICAO = new Set(['CC BY 3.0', 'CC BY 4.0', 'CC BY-SA 3.0', 'CC BY-SA 4.0'])
  const aceita = (licenca: string): boolean =>
    ATRIBUICAO.has(licenca) || licenca === 'Public domain' || licenca === 'CC0' || licenca.startsWith('PD-')

  it('toda licença está no conjunto aceito, com autor quando a licença exige atribuição', () => {
    for (const l of licencas) {
      expect(aceita(l.licenca), `${l.codigo}: ${l.licenca}`).toBe(true)
      if (ATRIBUICAO.has(l.licenca)) expect(l.autor.trim(), l.codigo).not.toBe('')
    }
  })
})

describe('nomes', () => {
  it('nomes e aliases são únicos depois da normalização, e cada um resolve exatamente um país', () => {
    const todos = [...rotulos.values()].flat().map(normalizar)
    expect(todos.filter((r) => r === '')).toEqual([])
    const repetidos = todos.filter((r, i) => todos.indexOf(r) !== i)
    expect(repetidos).toEqual([])
    for (const [codigo, lista] of rotulos) {
      for (const rotulo of lista) expect(resolver(rotulo), rotulo).toEqual([codigo])
    }
  })

  it('a grafia com e sem hífen resolve o mesmo país, e "Congo" solto não resolve nenhum', () => {
    expect(resolver('Guiné Bissau')).toEqual(['gw'])
    expect(resolver('Guiné-Bissau')).toEqual(['gw'])
    expect(resolver('guine bissau')).toEqual(['gw'])
    expect(resolver('Congo')).toEqual([])
  })

  it('todo override e todo alias de nomes.json é de um membro', () => {
    for (const codigo of [...Object.keys(nomes.overrides), ...Object.keys(nomes.aliases)]) {
      expect(membros.has(codigo), codigo).toBe(true)
    }
  })
})

describe('famílias e vizinhanças', () => {
  it('toda família tem de 2 a 6 membros existentes, com traço para cada membro', () => {
    expect(new Set(familias.map((f) => f.id)).size).toBe(familias.length)
    for (const f of familias) {
      expect(f.membros.length, f.id).toBeGreaterThanOrEqual(2)
      expect(f.membros.length, f.id).toBeLessThanOrEqual(6)
      expect(new Set(f.membros).size, f.id).toBe(f.membros.length)
      for (const m of f.membros) expect(membros.has(m), `${f.id}: ${m}`).toBe(true)
      expect(ordenados(Object.keys(f.tracoDistintivo)), f.id).toEqual(ordenados(f.membros))
      for (const traco of Object.values(f.tracoDistintivo)) expect(traco.trim(), f.id).not.toBe('')
    }
  })

  it('os pares indiscerníveis são pares de membros da própria família', () => {
    for (const f of familias) {
      for (const par of 'paresIndiscerniveis' in f ? f.paresIndiscerniveis : []) {
        expect(par, f.id).toHaveLength(2)
        for (const m of par) expect(f.membros, f.id).toContain(m)
      }
    }
  })

  it('todo membro de vizinhança existe e tem traço', () => {
    for (const v of vizinhancas) {
      expect(v.membros.length, v.id).toBeGreaterThan(6)
      for (const m of v.membros) expect(membros.has(m), `${v.id}: ${m}`).toBe(true)
      expect(ordenados(Object.keys(v.tracoDistintivo)), v.id).toEqual(ordenados(v.membros))
    }
  })

  it('famílias, vizinhanças e a lista "fora" somam exatamente os 193, com "fora" disjunta das outras', () => {
    const agrupados = new Set([...familias, ...vizinhancas].flatMap((g) => g.membros))
    expect(fora.codigos).toHaveLength(29)
    for (const c of fora.codigos) expect(agrupados.has(c), c).toBe(false)
    expect(ordenados(new Set([...agrupados, ...fora.codigos]))).toEqual(ordenados(membros))
  })

  it('os grupos de cada registro são as famílias de que ele é membro', () => {
    for (const b of bandeiras) {
      const esperado = familias.filter((f) => f.membros.includes(b.codigo)).map((f) => f.id)
      expect(b.grupos, b.codigo).toEqual(esperado)
    }
  })
})

describe('vizinhos', () => {
  it('toda bandeira tem 6 vizinhos distintos, existentes e sem ela mesma', () => {
    for (const b of bandeiras) {
      expect(b.vizinhos, b.codigo).toHaveLength(6)
      expect(new Set(b.vizinhos).size, b.codigo).toBe(6)
      expect(b.vizinhos, b.codigo).not.toContain(b.codigo)
      for (const v of b.vizinhos) expect(membros.has(v), `${b.codigo}: ${v}`).toBe(true)
    }
  })

  it('todo membro de vizinhança tem pelo menos um co-membro entre os vizinhos', () => {
    const vizinhosDe = new Map(bandeiras.map((b) => [b.codigo, b.vizinhos]))
    for (const v of vizinhancas) {
      for (const m of v.membros) {
        const comuns = (vizinhosDe.get(m) ?? []).filter((c) => v.membros.includes(c))
        expect(comuns.length, `${v.id}: ${m}`).toBeGreaterThanOrEqual(1)
      }
    }
  })
})

describe('dificuldade a priori', () => {
  const overrides = new Map(Object.entries(dificuldade))

  it('segue a regra única, salvo os overrides com motivo', () => {
    for (const b of bandeiras) {
      const naVizinhanca = vizinhancas.some((v) => v.membros.includes(b.codigo))
      const pelaRegra = b.grupos.length >= 2 ? 3 : b.grupos.length === 1 || naVizinhanca ? 2 : 1
      expect(b.dificuldadeAPriori, b.codigo).toBe(overrides.get(b.codigo)?.dificuldade ?? pelaRegra)
    }
    for (const [codigo, o] of overrides) {
      expect(membros.has(codigo), codigo).toBe(true)
      expect(o.motivo.trim(), codigo).not.toBe('')
    }
  })

  it('fora dos overrides, nenhum membro de vizinhança tem dificuldade 1', () => {
    for (const b of bandeiras) {
      if (overrides.has(b.codigo)) continue
      if (vizinhancas.some((v) => v.membros.includes(b.codigo))) expect(b.dificuldadeAPriori, b.codigo).not.toBe(1)
    }
  })
})

describe('regiões', () => {
  const regioes = new Map(gerado.regioes.map((r) => [r.codigo, r]))

  it('há 5 regiões e 22 sub-regiões, todas com nome', () => {
    expect(ordenados(regioes.keys())).toEqual(['002', '009', '019', '142', '150'])
    const subRegioes = gerado.regioes.flatMap((r) => r.subRegioes)
    expect(subRegioes).toHaveLength(22)
    expect(new Set(subRegioes.map((s) => s.codigo)).size).toBe(22)
    for (const { codigo, nome } of [...gerado.regioes, ...subRegioes]) {
      expect(nome.trim(), codigo).not.toBe('')
      expect(nome, codigo).not.toBe(codigo)
    }
  })

  it('toda bandeira tem região entre as 5 e sub-região entre as 22 da sua região', () => {
    for (const b of bandeiras) {
      const regiao = regioes.get(b.regiao)
      expect(regiao, b.codigo).toBeDefined()
      expect(
        (regiao?.subRegioes ?? []).map((s) => s.codigo),
        b.codigo,
      ).toContain(b.subRegiao)
    }
  })
})

describe('descrições', () => {
  it('toda classe está em PADROES_VISUAIS', () => {
    const classes = new Set<string>(PADROES_VISUAIS)
    for (const b of bandeiras) expect(classes.has(b.classe), `${b.codigo}: ${b.classe}`).toBe(true)
  })

  it('toda descrição tem até 160 caracteres e não traz o nome nem alias do próprio país', () => {
    for (const b of bandeiras) {
      expect(b.descricao.trim(), b.codigo).not.toBe('')
      expect(b.descricao.length, b.codigo).toBeLessThanOrEqual(160)
      // Casamento por palavra inteira sobre o texto normalizado: "Guiné" não pode aparecer na descrição da Guiné.
      const texto = ` ${normalizar(b.descricao)} `
      for (const rotulo of rotulos.get(b.codigo) ?? []) {
        expect(texto.includes(` ${normalizar(rotulo)} `), `${b.codigo}: "${rotulo}"`).toBe(false)
      }
    }
  })
})

describe('arquivos de dados', () => {
  it('nenhum arquivo de curadoria/ ou gerado/ contém template literal', () => {
    for (const pasta of ['../curadoria/', '../gerado/']) {
      const url = new URL(pasta, import.meta.url)
      for (const nome of readdirSync(url)) {
        expect(readFileSync(new URL(nome, url), 'utf8').includes('${'), `${pasta}${nome}`).toBe(false)
      }
    }
  })
})
