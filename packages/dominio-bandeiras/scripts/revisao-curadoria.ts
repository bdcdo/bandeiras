/**
 * Gera uma página HTML autocontida para revisar a curadoria à mão: cada família e cada vizinhança com as bandeiras lado
 * a lado e o traço de cada membro, a lista "fora", os candidatos a família da medida de semelhança, os 193 nomes com o
 * valor do ICU e o override, as 193 descrições com a classe e as licenças por tipo.
 *
 * Quando rodar: depois de `pnpm gerar:dados`, sempre que a curadoria mudar e alguém precisar revisá-la.
 * Uso: `node scripts/revisao-curadoria.ts [saida.html] [--notas notas.json]`. Sem saída, escreve no stdout. As notas são
 * uma lista `[{ "titulo": "...", "texto": "..." }]` que abre a página (decisões e dúvidas da rodada de curadoria); ficam
 * fora do repositório porque valem para uma revisão só.
 *
 * As imagens vão embutidas em base64, uma vez cada, para o arquivo abrir sozinho fora do repositório. A página não é
 * commitada: é material de revisão, não dado.
 */
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { CAMINHOS, lerCuradoria, lerJson, type Familia, type Licenca, type Vizinhanca } from './comum.ts'
import { MEMBROS_EM_ORDEM } from './membros.ts'
import { assinarTodas, candidatosAFamilia, type Candidato } from './similaridade.ts'

type Bandeira = {
  codigo: string
  nome: string
  aliases: string[]
  classe: string
  descricao: string
  dificuldadeAPriori: number
  grupos: string[]
  vizinhos: string[]
  imagem: { formato: 'svg' } | { formato: 'webp'; larguras: number[] }
}
type Nota = { titulo: string; texto: string }

function esc(texto: string): string {
  return texto.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
}

function argumentos(): { saida: string | undefined; notas: Nota[] } {
  const args = process.argv.slice(2)
  const iNotas = args.indexOf('--notas')
  const caminhoNotas = iNotas >= 0 ? args[iNotas + 1] : undefined
  const saida = args.find((a, i) => !a.startsWith('--') && (iNotas < 0 || i !== iNotas + 1))
  return { saida, notas: caminhoNotas === undefined ? [] : (lerJson(caminhoNotas) as Nota[]) }
}

function dadosDasImagens(bandeiras: Bandeira[]): Record<string, string> {
  const dados: Record<string, string> = {}
  for (const b of bandeiras) {
    const [arquivo, tipo] =
      b.imagem.formato === 'svg' ? [`${b.codigo}.svg`, 'image/svg+xml'] : [`${b.codigo}-480.webp`, 'image/webp']
    dados[b.codigo] = `data:${tipo};base64,${readFileSync(CAMINHOS.imagens + arquivo).toString('base64')}`
  }
  return dados
}

function pagina(notas: Nota[]): string {
  const { commons, nomes, familias, vizinhancas, fora } = lerCuradoria()
  const gerado = lerJson(`${CAMINHOS.gerado}bandeiras.json`) as { geradoEm: string; bandeiras: Bandeira[] }
  const licencas = lerJson(`${CAMINHOS.gerado}licencas.json`) as Licenca[]
  const porCodigo = new Map(gerado.bandeiras.map((b) => [b.codigo, b]))
  const icu = new Intl.DisplayNames(['pt-BR'], { type: 'region' })

  const nomeDe = (codigo: string): string => porCodigo.get(codigo)?.nome ?? codigo
  const figura = (codigo: string, legenda = ''): string =>
    `<figure><img data-codigo="${codigo}" alt="Bandeira: ${esc(nomeDe(codigo))}"><figcaption><b>${codigo}</b> ` +
    `${esc(nomeDe(codigo))}<span class="dif">dificuldade ${String(porCodigo.get(codigo)?.dificuldadeAPriori ?? '?')}</span>` +
    `${legenda === '' ? '' : `<span class="traco">${esc(legenda)}</span>`}</figcaption></figure>`

  const grupo = (g: Familia | Vizinhanca, extra = '') =>
    `<section class="grupo"><h3>${esc(g.nome)} <code>${g.id}</code> <small>${String(g.membros.length)} membros</small></h3>${extra}` +
    `<div class="lado">${g.membros.map((m) => figura(m, g.tracoDistintivo[m] ?? '')).join('')}</div></section>`

  let candidatos: Candidato[] | undefined
  if (MEMBROS_EM_ORDEM.every((c) => existsSync(`${CAMINHOS.cache}${c}.svg`))) {
    candidatos = candidatosAFamilia(assinarTodas(), familias, vizinhancas)
  }

  const contagemDeLicencas = new Map<string, number>()
  for (const l of licencas) contagemDeLicencas.set(l.licenca, (contagemDeLicencas.get(l.licenca) ?? 0) + 1)
  const comMotivo = commons.filter((c) => c.motivo !== undefined)
  const semAutor = licencas.filter((l) => l.autor.trim() === '')

  const secoes = [
    notas.length === 0
      ? ''
      : `<section id="notas"><h2>Notas desta rodada</h2>${notas
          .map((n) => `<article class="nota"><h3>${esc(n.titulo)}</h3><p>${esc(n.texto)}</p></article>`)
          .join('')}</section>`,
    `<section id="familias"><h2>Famílias (${String(familias.length)})</h2><p>Tópicos de discriminação, de 2 a 6 membros. ` +
      `Abaixo de cada bandeira, o traço que a lição mostra ao confrontar os membros.</p>${familias
        .map((f) =>
          grupo(
            f,
            f.paresIndiscerniveis === undefined
              ? ''
              : `<p class="aviso">Pares indiscerníveis na tela: ${f.paresIndiscerniveis.map((p) => p.join(' e ')).join('; ')}</p>`,
          ),
        )
        .join('')}</section>`,
    `<section id="vizinhancas"><h2>Vizinhanças (${String(vizinhancas.length)})</h2><p>Grupos parecidos demais e ` +
      `numerosos demais para virar tópico; alimentam vizinhos, distratores e dificuldade.</p>${vizinhancas.map((v) => grupo(v)).join('')}</section>`,
    `<section id="fora"><h2>Fora de família e de vizinhança (${String(fora.codigos.length)})</h2><p>${esc(fora.motivo)}</p>` +
      `<div class="lado">${fora.codigos.map((c) => figura(c)).join('')}</div></section>`,
    `<section id="candidatos"><h2>Candidatos a família</h2>${
      candidatos === undefined
        ? '<p>Os originais não estão em .cache/commons/; rode baixar-commons.ts para ver os candidatos.</p>'
        : `<p>Os ${String(candidatos.length)} pares mais próximos pela medida de semelhança (grade 3x3 de cor em Lab e ` +
          `orientação das faixas) que não dividem família. Distância menor é mais parecido. A medida só propõe.</p>` +
          candidatos
            .map(
              (c) =>
                `<div class="par"><p>${c.a} e ${c.b}: distância ${c.distancia.toFixed(1)}${c.mesmaVizinhanca ? ', mesma vizinhança' : ''}</p>` +
                `<div class="lado">${figura(c.a)}${figura(c.b)}</div></div>`,
            )
            .join('')
    }</section>`,
    `<section id="nomes"><h2>Nomes (193)</h2><table><thead><tr><th scope="col">Código</th><th scope="col">ICU (pt-BR)</th>` +
      `<th scope="col">Override</th><th scope="col">Aliases</th></tr></thead><tbody>${MEMBROS_EM_ORDEM.map((c) => {
        const override = nomes.overrides[c]
        return (
          `<tr${override === undefined ? '' : ' class="marcada"'}><td><code>${c}</code></td><td>${esc(icu.of(c.toUpperCase()) ?? '')}</td>` +
          `<td>${override === undefined ? '' : `<b>${esc(override.nome)}</b><br><small>${esc(override.motivo)}</small>`}</td>` +
          `<td>${esc((nomes.aliases[c] ?? []).join(', '))}</td></tr>`
        )
      }).join('')}</tbody></table></section>`,
    `<section id="descricoes"><h2>Descrições (193)</h2><table><thead><tr><th scope="col">Bandeira</th><th scope="col">Código</th>` +
      `<th scope="col">Classe</th><th scope="col">Descrição</th><th scope="col">Famílias</th></tr></thead><tbody>${gerado.bandeiras
        .map(
          (b) =>
            `<tr><td>${figura(b.codigo)}</td><td><code>${b.codigo}</code></td><td>${b.classe}</td><td>${esc(b.descricao)} ` +
            `<small>(${String(b.descricao.length)} caracteres)</small></td><td>${b.grupos.join(', ')}</td></tr>`,
        )
        .join('')}</tbody></table></section>`,
    `<section id="licencas"><h2>Licenças</h2><table><thead><tr><th scope="col">Licença</th><th scope="col">Arquivos</th></tr></thead>` +
      `<tbody>${[...contagemDeLicencas].map(([l, n]) => `<tr><td>${esc(l)}</td><td>${String(n)}</td></tr>`).join('')}</tbody></table>` +
      `<p>Sem autor informado no Commons: ${semAutor.length === 0 ? 'nenhum' : semAutor.map((l) => l.codigo).join(', ')}.</p>` +
      `<h3>Títulos com motivo (${String(comMotivo.length)})</h3><div class="lado">${comMotivo
        .map((c) => figura(c.codigo, `${c.titulo}: ${c.motivo ?? ''}`))
        .join('')}</div></section>`,
  ]

  const imagens = JSON.stringify(dadosDasImagens(gerado.bandeiras)).replace(/</g, '\\u003c')
  return `<!doctype html>
<html lang="pt-BR">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Revisão da curadoria</title>
<style>
:root { color-scheme: light dark; --fundo: #ffffff; --texto: #1d232b; --suave: #4b5563; --borda: #8a93a0; --realce: #fff4cc; --link: #1f5fbf; }
@media (prefers-color-scheme: dark) { :root { --fundo: #15191f; --texto: #e7ebf0; --suave: #b4bcc8; --borda: #6b7480; --realce: #3d3413; --link: #8db8f5; } }
body { margin: 0 auto; max-width: 1200px; padding: 16px; background: var(--fundo); color: var(--texto); font: 15px/1.45 system-ui, sans-serif; }
nav a { color: var(--link); margin-right: 12px; }
h2 { margin-top: 40px; border-bottom: 1px solid var(--borda); }
.lado { display: flex; flex-wrap: wrap; gap: 14px; align-items: flex-start; }
figure { margin: 0; width: 150px; }
figure img { display: block; width: 150px; height: auto; border: 1px solid var(--borda); }
figcaption { font-size: 13px; margin-top: 4px; }
.dif, .traco { display: block; color: var(--suave); }
.traco { color: var(--texto); }
.grupo { margin: 18px 0; }
.aviso, tr.marcada td { background: var(--realce); }
.par { margin: 10px 0 18px; }
table { border-collapse: collapse; width: 100%; }
th, td { border: 1px solid var(--borda); padding: 6px 8px; text-align: left; vertical-align: top; }
td figure, td figure img { width: 96px; }
small { color: var(--suave); }
.nota { border-left: 4px solid var(--borda); padding-left: 12px; }
</style>
</head>
<body>
<h1>Revisão da curadoria das bandeiras</h1>
<p>Dados gerados em ${esc(gerado.geradoEm)}. ${String(familias.length)} famílias, ${String(vizinhancas.length)} vizinhanças, ${String(fora.codigos.length)} bandeiras fora, ${String(comMotivo.length)} títulos do Commons com motivo.</p>
<nav>${notas.length === 0 ? '' : '<a href="#notas">Notas</a>'}<a href="#familias">Famílias</a><a href="#vizinhancas">Vizinhanças</a><a href="#fora">Fora</a><a href="#candidatos">Candidatos</a><a href="#nomes">Nomes</a><a href="#descricoes">Descrições</a><a href="#licencas">Licenças</a></nav>
${secoes.join('\n')}
<script>
const IMAGENS = ${imagens};
for (const img of document.querySelectorAll('img[data-codigo]')) img.src = IMAGENS[img.dataset.codigo];
</script>
</body>
</html>
`
}

if (import.meta.main) {
  const { saida, notas } = argumentos()
  const html = pagina(notas)
  if (saida === undefined) process.stdout.write(html)
  else {
    writeFileSync(saida, html)
    console.log(`página de revisão gravada em ${saida} (${String(Math.round(html.length / 1024))} KB)`)
  }
}
