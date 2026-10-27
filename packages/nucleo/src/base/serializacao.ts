/**
 * JSON com as chaves de todo objeto em ordem, e as listas na ordem dada: dois objetos iguais em conteúdo dão o mesmo
 * texto mesmo que as chaves tenham sido escritas em ordens diferentes, e trocar a ordem de uma lista muda o texto. A
 * ordenação é por unidade de código UTF-16 (o padrão de `sort`), e não `localeCompare`, para o hash não depender do
 * idioma do aparelho. Chave com valor `undefined` some, como no `JSON.stringify`.
 *
 * É a entrada do FNV-1a em tudo o que o núcleo identifica pelo conteúdo: o hash do catálogo, o id de cada evento e o de
 * cada tarefa registrada. Mudar a saída desta função para o mesmo valor muda esses ids, e um log gravado antes deixaria
 * de se reconhecer; por isso o teste fixa a saída de exemplos e o hash do catálogo de teste.
 */
export function serializarCanonico(valor: unknown): string {
  if (Array.isArray(valor)) return `[${valor.map(serializarCanonico).join(',')}]`
  if (typeof valor === 'object' && valor !== null) {
    const registro = valor as Readonly<Record<string, unknown>>
    const partes = Object.keys(registro)
      .filter((chave) => registro[chave] !== undefined)
      .sort()
      .map((chave) => `${JSON.stringify(chave)}:${serializarCanonico(registro[chave])}`)
    return `{${partes.join(',')}}`
  }
  return JSON.stringify(valor)
}
