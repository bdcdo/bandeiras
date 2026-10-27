/**
 * Invariantes dos dados commitados do domínio: curadoria/, gerado/ e imagens/. O gerador roda à mão e este teste é o
 * que valida o resultado no CI; por isso ele lê os arquivos como estão no repositório, sem regenerar nada.
 */
import {
  carregarCatalogo,
  desembrulhar,
  indiceDeRotulos,
  normalizarRotulo,
  resolverRotulo,
  type IdItem,
} from '@bandeiras/nucleo'
import { createHash } from 'node:crypto'
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import commons from '../curadoria/commons.json'
import descricoes from '../curadoria/descricoes.json'
import dificuldade from '../curadoria/dificuldade.json'
import familias from '../curadoria/familias.json'
import fora from '../curadoria/fora.json'
import inscricoesJson from '../curadoria/inscricoes.json'
import nomes from '../curadoria/nomes.json'
import regioesM49 from '../curadoria/regioes-m49.json'
import vizinhancas from '../curadoria/vizinhancas.json'
import gerado from '../gerado/bandeiras.json'
import revisoes from '../gerado/commons-revisoes.json'
import hashes from '../gerado/hashes.json'
import licencas from '../gerado/licencas.json'
import vizinhosGerados from '../gerado/vizinhos.json'
import type { CaixaNaImagem, Inscricao, RegioesM49 } from '../scripts/comum.ts'
import { fraseDaModificacao } from '../scripts/inscricoes.ts'
import { MEMBROS_ONU } from '../scripts/membros.ts'
import { PADROES_VISUAIS } from './classes'
import { DADOS_DE_CATALOGO } from './dados'

const PASTA_IMAGENS = new URL('../imagens/', import.meta.url)
const bandeiras = gerado.bandeiras
const codigos = bandeiras.map((b) => b.codigo)
const membros = new Set<string>(MEMBROS_ONU)
const ordenados = (lista: Iterable<string>): string[] => [...lista].sort()

/** Todos os rótulos aceitos de cada bandeira: o nome exibido e os aliases. */
const rotulos = new Map(bandeiras.map((b) => [b.codigo, [b.nome, ...b.aliases]]))

let indice: ReadonlyMap<string, IdItem> | undefined

/**
 * O texto resolvido como o núcleo resolve o que a pessoa digita: pela normalização dele, sobre o índice de rótulos do
 * catálogo carregado a partir destes mesmos dados. O índice nasce na primeira chamada, e não na carga do arquivo, para
 * um catálogo recusado reprovar só os testes que resolvem rótulo, com o erro do núcleo na mensagem.
 */
function resolver(texto: string): string | undefined {
  indice ??= indiceDeRotulos(desembrulhar(carregarCatalogo(DADOS_DE_CATALOGO)).itens.values())
  return resolverRotulo(indice, texto)
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

  it('Síria, Afeganistão, Bolívia e Moldávia estão fixados: original do Commons e arquivo processado', () => {
    // A Síria trocou de bandeira em 2025 e o Afeganistão tem duas em disputa. A Bolívia usa a bandeira de Estado, com
    // brasão, que é a que a ONU exibe, e não a civil, sem brasão; o arquivo de Estado no Commons já foi trocado e
    // revertido. O arquivo da Moldávia passou por reversões seguidas entre desenhos antigos e o atual. Uma regeneração
    // que mudasse qualquer um dos quatro tem de reprovar aqui e passar por conferência à mão, com estes valores
    // atualizados no mesmo commit.
    //
    // No Afeganistão e na Bolívia, o arquivo processado é o derivado sem a inscrição com o nome do país (a palavra na
    // fita sob o emblema e BOLIVIA na borda do oval), apagada pelas operações de curadoria/inscricoes.json. Uma entrada
    // apagada de lá, ou uma operação que passe a tirar outra coisa, muda estes hashes e reprova aqui.
    const sha1 = new Map(revisoes.map((r) => [r.codigo, r.sha1]))
    expect(sha1.get('sy')).toBe('ce342b675fcf2604f3cad0355397d72caf52a658')
    expect(sha1.get('af')).toBe('636a7f0a49f4793da6f75d7f503d28c9e1330f84')
    expect(sha1.get('bo')).toBe('d74c7ea8f1319eb29f25ea88556cc3a8b6f8212b')
    expect(sha1.get('md')).toBe('869c141fd01ec0ae4f6d911b535b1e6e18049e74')
    expect(sha256(ler('md.svg'))).toBe('2f9be5f7c39226728f38793f9886924bcfcae9545535e510d727cf7d058873f3')
    expect(sha256(ler('sy.svg'))).toBe('b42626405b126101b9ae0915acfd8cd7c9a5e0e93c6122a9e23c436f7dc412a8')
    expect(sha256(ler('af-480.webp'))).toBe('11cd1ab57ecd11f34439cf1836385957c73a88491aefdee9f41f5b47401cf280')
    expect(sha256(ler('af-960.webp'))).toBe('c6e027ee186b78ad0c396e2ebe3c2e886d4a4d0fd990a163873eef1098e150e4')
    expect(sha256(ler('bo-480.webp'))).toBe('e0169d830fa0ce4cb8ce22834c671f560606cd18d9523def546b505f02c8efd4')
    expect(sha256(ler('bo-960.webp'))).toBe('c39a5206775d84b8dfb7c03dfd67083526104a4ee7a6c62e60a2dae8fe3076aa')
  })

  it('o arquivo processado das outras seis bandeiras sem inscrição está fixado', () => {
    // Afeganistão e Bolívia estão fixados no teste acima. O gate da remoção, em gerar.ts, prova que nada mudou fora da
    // caixa de cada bandeira, mas não distingue duas remoções que ocupam a mesma região: tirar a legenda de ni junto com
    // o contorno do triângulo, que ela cerca, passa por ele. hashes.json não pega isso, porque a regeneração o reescreve
    // junto com a imagem. Uma mudança no que sai de qualquer uma destas reprova aqui, e o hash novo só entra depois de
    // alguém comparar à mão o original e o derivado.
    const fixados = {
      'bn.svg': '242bd1fba5fb1fa6ade4467aa6120b65dc18adf7002de752790543fd5c41c849',
      'do-480.webp': 'd7c3c81e90a77d5a74d4acfec0d8475164306a12097ec91784598e62ca3f73b0',
      'do-960.webp': 'a3ca0d3e29ed62ad5542e82f6807612bffa135106aa39c967611e98cfe743497',
      'eg.svg': '9414733ba309b9ade13c82c329e7c73552cb89df39370243d96f65ecb753ad96',
      'ni.svg': '729d20706bf5527de2223a7d17c7c499d16683b6d229b26a21df6cd5e5e6789d',
      'py.svg': '7ecdd8037fec52de6092b253a997dbcf9ba80d0e01b41d13d1042e641a1d76ed',
      'sv-480.webp': '0d73a2c59257f7a4c1d6a06b88ae1e6ef0d08847c679e36231f7aec55bff9e89',
      'sv-960.webp': '25d767eef82ba04d9e7cb0da996e350cde0aa9687229275d8a4b1800a357166b',
    }
    for (const [nome, hash] of Object.entries(fixados)) expect(sha256(ler(nome)), nome).toBe(hash)
  })

  it('nenhum SVG traz o nome do país em <title>, <desc> ou texto "Flag of"', () => {
    // A imagem é o estímulo da pergunta "que país é este?". O título do SVG aparece como título da aba quando a imagem é
    // aberta sozinha e em toda renderização fora de <img>; a casca não consegue tirá-lo de dentro do arquivo.
    for (const nome of arquivos.filter((n) => n.endsWith('.svg'))) {
      const svg = ler(nome).toString('utf8')
      for (const trecho of ['<title', '<desc', 'Flag of'])
        expect(svg.includes(trecho), `${nome}: ${trecho}`).toBe(false)
    }
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

describe('inscrições com o nome do país', () => {
  // A anotação dá ao JSON o tipo que o gerador lê; o teste confere o conteúdo campo a campo.
  const inscricoes: Inscricao[] = inscricoesJson as Inscricao[]
  const dentroDaImagem = (r: CaixaNaImagem): boolean =>
    r.x0 >= 0 && r.y0 >= 0 && r.x1 <= 1 && r.y1 <= 1 && r.x0 < r.x1 && r.y0 < r.y1

  it('inscricoes.json tem exatamente as oito bandeiras que escrevem o nome do país', () => {
    // A lista vem do levantamento visual das 193 imagens em 26/10/2026, feito por dois leitores independentes que
    // concordaram nas 193. Outras doze escrevem lema, data ou fórmula religiosa (ad, br, bz, es, gq, gt, ht, iq, ir, mt,
    // sa, sm); não nomeiam o país e ficam como estão. Quando uma bandeira nova, ou um arquivo novo do Commons, escrever o
    // nome do país, ela entra em curadoria/inscricoes.json com as operações que apagam a inscrição e entra aqui, no mesmo
    // commit; `pnpm gerar:dados` confere a remoção pelo gate de gerar.ts.
    const codigos = inscricoes.map((i) => i.codigo)
    expect(new Set(codigos).size, 'código repetido').toBe(codigos.length)
    for (const codigo of codigos) expect(membros.has(codigo), codigo).toBe(true)
    expect(ordenados(codigos)).toEqual(['af', 'bn', 'bo', 'do', 'eg', 'ni', 'py', 'sv'])
  })

  it('cada entrada tem texto, lugar, caixa dentro da imagem e operações completas', () => {
    for (const i of inscricoes) {
      expect(i.texto.trim(), i.codigo).not.toBe('')
      expect(i.lugar.trim(), i.codigo).not.toBe('')
      if (i.traducao !== undefined) expect(i.traducao.trim(), i.codigo).not.toBe('')
      expect(dentroDaImagem(i.caixa), `${i.codigo}: caixa`).toBe(true)
      expect(i.operacoes.length, i.codigo).toBeGreaterThanOrEqual(1)
      for (const [n, op] of i.operacoes.entries()) {
        const rotulo = `${i.codigo}: operação ${String(n + 1)}`
        expect(op.descricao.trim(), rotulo).not.toBe('')
        expect(['elementos', 'subcaminhos'], rotulo).toContain(op.remover)
        expect(Object.keys(op.atributos).length, rotulo).toBeGreaterThanOrEqual(1)
        expect(Number.isInteger(op.esperados) && op.esperados >= 1, rotulo).toBe(true)
        if (op.remover === 'subcaminhos') expect(op.dentroDe, rotulo).toBeDefined()
        for (const r of op.dentroDe ?? []) expect(dentroDaImagem(r), `${rotulo}: dentroDe`).toBe(true)
      }
    }
  })

  it('licencas.json registra a modificação nas bandeiras de inscricoes.json, e só nelas, com a frase da curadoria', () => {
    // Como bandeiras.json, licencas.json é gerado à mão; este teste pega a curadoria editada sem regenerar.
    const frase = new Map(inscricoes.map((i) => [i.codigo, fraseDaModificacao(i)]))
    for (const l of licencas) {
      const modificacao = 'modificacao' in l ? l.modificacao : undefined
      expect(modificacao, l.codigo).toBe(frase.get(l.codigo))
    }
  })
})

describe('nomes', () => {
  it('nomes e aliases são únicos depois da normalização, e cada um resolve exatamente um país', () => {
    // carregarCatalogo já recusa forma vazia, forma repetida entre itens (ROTULO_AMBIGUO) e forma repetida no mesmo
    // item (ROTULO_REPETIDO), e aí resolver() lança com o erro do núcleo. As conferências abaixo não dependem disso:
    // listam, pelos próprios dados, a forma vazia e as repetidas.
    const todos = [...rotulos.values()].flat().map(normalizarRotulo)
    expect(todos.filter((r) => r === '')).toEqual([])
    const repetidos = todos.filter((r, i) => todos.indexOf(r) !== i)
    expect(repetidos).toEqual([])
    for (const [codigo, lista] of rotulos) {
      for (const rotulo of lista) expect(resolver(rotulo), rotulo).toBe(codigo)
    }
  })

  it('a grafia com e sem hífen resolve o mesmo país, e "Congo" solto não resolve nenhum', () => {
    expect(resolver('Guiné Bissau')).toBe('gw')
    expect(resolver('Guiné-Bissau')).toBe('gw')
    expect(resolver('guine bissau')).toBe('gw')
    expect(resolver('Congo')).toBeUndefined()
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
      const texto = ` ${normalizarRotulo(b.descricao)} `
      for (const rotulo of rotulos.get(b.codigo) ?? []) {
        expect(texto.includes(` ${normalizarRotulo(rotulo)} `), `${b.codigo}: "${rotulo}"`).toBe(false)
      }
    }
  })
})

describe('curadoria e gerado em sincronia', () => {
  // Os invariantes acima olham bandeiras.json. Como o gerador roda à mão, um commit que edita a curadoria sem regenerar
  // deixaria bandeiras.json velho e o valor novo da curadoria sem validação até a próxima regeneração. Este bloco exige
  // que cada campo de bandeiras.json tirado da curadoria seja o que ela diz hoje, e assim os invariantes de
  // bandeiras.json valem também para a curadoria. Grupos e dificuldade já são conferidos contra a curadoria nos blocos
  // deles.
  //
  // O nome de país, de região ou de sub-região sem override vem do ICU, e a comparação desses nomes só roda com o ICU
  // que gerou bandeiras.json, o do Node fixado no .nvmrc, que é o do CI. Outro ICU pode trazer outro nome do CLDR sem
  // que a curadoria mude, e a comparação daria falso vermelho. Num Node com outro ICU, os dois testes do ICU ficam
  // pulados e só os overrides são conferidos.
  const comIcuDosDados = process.versions['icu'] === gerado.versoes.icu
  const overrides = new Map(Object.entries(nomes.overrides))
  const aliases = new Map(Object.entries(nomes.aliases))
  const descricaoDe = new Map(descricoes.map((d) => [d.codigo, d]))
  const regiaoDe = new Map(Object.entries(regioesM49.paises))
  // A anotação dá ao teste o campo opcional nomesDeRegiao, que o gerador lê e que o regioes-m49.json de hoje não traz.
  const curadoriaDeRegioes: RegioesM49 = regioesM49
  const nomesDeRegiao = new Map(Object.entries(curadoriaDeRegioes.nomesDeRegiao ?? {}))
  const regioesESubRegioes = [...gerado.regioes, ...gerado.regioes.flatMap((r) => r.subRegioes)]
  const vizinhosDe = new Map(Object.entries(vizinhosGerados))

  it('o nome é o override de nomes.json quando há override, e os aliases são os de nomes.json', () => {
    for (const b of bandeiras) {
      const override = overrides.get(b.codigo)
      if (override !== undefined) expect(b.nome, b.codigo).toBe(override.nome)
      expect(b.aliases, b.codigo).toEqual(aliases.get(b.codigo) ?? [])
    }
  })

  // O teste acima não pega o caso inverso: um override apagado de nomes.json sem regenerar deixa em bandeiras.json o nome
  // antigo do override, e o valor do ICU que ele escondia só é validado na regeneração. Sem override, o nome tem de ser o
  // do ICU.
  it.skipIf(!comIcuDosDados)('sem override, o nome é o do ICU que gerou os dados', () => {
    const icu = new Intl.DisplayNames(['pt-BR'], { type: 'region' })
    for (const b of bandeiras) {
      expect(b.nome, b.codigo).toBe(overrides.get(b.codigo)?.nome ?? icu.of(b.codigo.toUpperCase()))
    }
  })

  it('descrição e classe são as de descricoes.json', () => {
    for (const b of bandeiras) {
      expect({ descricao: b.descricao, classe: b.classe }, b.codigo).toEqual({
        descricao: descricaoDe.get(b.codigo)?.descricao,
        classe: descricaoDe.get(b.codigo)?.classe,
      })
    }
  })

  it('região e sub-região são as de regioes-m49.json, e a lista de regiões sai dela', () => {
    for (const b of bandeiras) {
      expect({ regiao: b.regiao, subRegiao: b.subRegiao }, b.codigo).toEqual(regiaoDe.get(b.codigo))
    }
    const subRegioesDe = new Map<string, Set<string>>()
    for (const { regiao, subRegiao } of regiaoDe.values()) {
      subRegioesDe.set(regiao, (subRegioesDe.get(regiao) ?? new Set()).add(subRegiao))
    }
    expect(gerado.regioes.map((r) => [r.codigo, r.subRegioes.map((s) => s.codigo)])).toEqual(
      [...subRegioesDe].sort(([a], [b]) => a.localeCompare(b)).map(([codigo, subs]) => [codigo, ordenados(subs)]),
    )
  })

  it('todo override de nomesDeRegiao em regioes-m49.json é o nome de uma região ou sub-região', () => {
    // Um override de código que não é região nem sub-região dos membros também reprova: o gerador o ignoraria.
    const nomeDe = new Map(regioesESubRegioes.map((r) => [r.codigo, r.nome]))
    for (const [codigo, override] of nomesDeRegiao) expect(nomeDe.get(codigo), codigo).toBe(override.nome)
  })

  // Como nos nomes de país, o teste acima não pega o override apagado sem regenerar.
  it.skipIf(!comIcuDosDados)('sem override, o nome de região e de sub-região é o do ICU que gerou os dados', () => {
    const icu = new Intl.DisplayNames(['pt-BR'], { type: 'region' })
    for (const { codigo, nome } of regioesESubRegioes) {
      expect(nome, codigo).toBe(nomesDeRegiao.get(codigo)?.nome ?? icu.of(codigo))
    }
  })

  it('os vizinhos são os de gerado/vizinhos.json, e o traço de vizinhança junta os traços das vizinhanças', () => {
    for (const b of bandeiras) {
      expect(b.vizinhos, b.codigo).toEqual(vizinhosDe.get(b.codigo))
      const tracos = vizinhancas.flatMap((v) => {
        const traco = (v.tracoDistintivo as Record<string, string | undefined>)[b.codigo]
        return v.membros.includes(b.codigo) && traco !== undefined ? [traco] : []
      })
      const tracoVizinhanca = 'tracoVizinhanca' in b ? b.tracoVizinhanca : undefined
      expect(tracoVizinhanca, b.codigo).toBe(tracos.length > 0 ? tracos.join('; ') : undefined)
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
