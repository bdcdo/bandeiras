import type { ArmazenamentoDeEventos, EnvelopeDeEvento } from './armazenamento'
import { compararEventos } from './ordem'

// Cópia por JSON nas duas pontas: mudar depois o objeto anexado, ou o devolvido, não muda o que está guardado, como num
// armazenamento de verdade, que serializa.
const copia = (e: EnvelopeDeEvento): EnvelopeDeEvento => JSON.parse(JSON.stringify(e)) as EnvelopeDeEvento

/** Armazenamento em memória, para testes e para o núcleo rodar sem a casca. Cumpre o contrato de `ArmazenamentoDeEventos`. */
export function armazenamentoEmMemoria(): ArmazenamentoDeEventos {
  const porId = new Map<string, EnvelopeDeEvento>()
  return {
    anexar(eventos) {
      for (const e of eventos) if (!porId.has(e.id)) porId.set(e.id, copia(e))
      return Promise.resolve()
    },
    ler(desde) {
      const ordenados = [...porId.values()].sort(compararEventos)
      const depois = desde === undefined ? ordenados : ordenados.filter((e) => compararEventos(e, desde) > 0)
      return Promise.resolve(depois.map(copia))
    },
    contar() {
      return Promise.resolve(porId.size)
    },
  }
}
