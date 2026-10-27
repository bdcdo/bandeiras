import { serializarCanonico } from '../base/serializacao'
import type { ArmazenamentoDeEventos, EnvelopeDeEvento } from '../eventos/armazenamento'

// Suíte de contrato de `ArmazenamentoDeEventos`. A fake em memória do núcleo e o IndexedDB da casca rodam os mesmos
// casos, e é por eles que as duas se provam equivalentes. O módulo não importa o Vitest nem o fast-check: fora dos
// arquivos de teste, o núcleo só importa do núcleo. Cada caso lança `Error` com a mensagem do que falhou, e o teste de
// cada implementação monta o `describe` com um laço sobre a lista.
//
// Os ids são textos quaisquer, e não ids de evento de verdade: o armazenamento trata o evento como envelope opaco, e
// alguns casos precisam de ids que separem a ordem por unidade de código da ordem do idioma.

export type CasoDoContratoDeArmazenamento = Readonly<{
  nome: string
  /** Roda o caso sobre um armazenamento novo e vazio, pedido à fábrica; lança na falha. */
  executar(fabrica: () => Promise<ArmazenamentoDeEventos>): Promise<void>
}>

type Envelope = EnvelopeDeEvento & Readonly<Record<string, unknown>>

const evento = (em: number, id: string, extra: Readonly<Record<string, unknown>> = {}): Envelope => ({
  id,
  tipo: 'meta-diaria-alterada',
  em,
  dispositivo: 'aparelho-a',
  ...extra,
})

// Serialização canônica, e não JSON direto: um armazenamento pode devolver as chaves em outra ordem sem violar nada, e
// a ordem das listas, que conta, continua conferida.
const mesmo = (a: unknown, b: unknown): boolean => serializarCanonico(a) === serializarCanonico(b)

function afirmar(condicao: boolean, mensagem: string): asserts condicao {
  if (!condicao) throw new Error(mensagem)
}

async function afirmarLeitura(
  armazenamento: ArmazenamentoDeEventos,
  esperado: readonly unknown[],
  oQue: string,
  desde?: Readonly<{ em: number; id: string }>,
): Promise<void> {
  const lidos = await armazenamento.ler(desde)
  afirmar(
    mesmo(lidos, esperado),
    `${oQue}: esperado ${serializarCanonico(esperado)}, lido ${serializarCanonico(lidos)}`,
  )
}

const ids = (eventos: readonly Envelope[]): string => eventos.map((e) => e.id).join(',')

export const CASOS_DO_CONTRATO_DE_ARMAZENAMENTO: readonly CasoDoContratoDeArmazenamento[] = [
  {
    nome: 'vazio lê lista vazia e conta zero',
    async executar(fabrica) {
      const a = await fabrica()
      await afirmarLeitura(a, [], 'ler do vazio')
      afirmar((await a.contar()) === 0, 'contar do vazio não é zero')
    },
  },
  {
    nome: 'anexado fora de ordem, lê em ordem de instante',
    async executar(fabrica) {
      const a = await fabrica()
      const [primeiro, segundo, terceiro] = [evento(10, 'c'), evento(20, 'a'), evento(30, 'b')]
      await a.anexar([terceiro, primeiro, segundo])
      await afirmarLeitura(
        a,
        [primeiro, segundo, terceiro],
        `ler depois de anexar ${ids([terceiro, primeiro, segundo])}`,
      )
    },
  },
  {
    nome: 'no empate de instante, ordena pelo id em unidade de código',
    async executar(fabrica) {
      const a = await fabrica()
      // 'B' (U+0042) vem antes de 'a' (U+0061) por unidade de código; localeCompare poria 'a' primeiro.
      const [maiusculo, minusculo, digito] = [evento(5, 'B'), evento(5, 'a'), evento(5, '9')]
      await a.anexar([minusculo, maiusculo])
      await a.anexar([digito])
      await afirmarLeitura(a, [digito, maiusculo, minusculo], 'ler com três ids no mesmo instante')
    },
  },
  {
    nome: 'id repetido, no mesmo lote ou em outro, grava uma vez e mantém o primeiro',
    async executar(fabrica) {
      const a = await fabrica()
      const primeiro = evento(1, 'x', { xp: 10 })
      await a.anexar([primeiro, evento(1, 'x', { xp: 20 })])
      await a.anexar([evento(2, 'x', { xp: 30 }), evento(3, 'y')])
      await afirmarLeitura(a, [primeiro, evento(3, 'y')], 'ler depois de anexar x três vezes')
      afirmar((await a.contar()) === 2, 'contar depois de anexar x três vezes não é 2')
    },
  },
  {
    nome: 'desde é exclusivo pelo par de instante e id, com instante repetido entre aparelhos',
    async executar(fabrica) {
      const a = await fabrica()
      const [antes, b1, b2, b3, depois] = [
        evento(1, 'z'),
        evento(2, 'b', { dispositivo: 'aparelho-b' }),
        evento(2, 'c'),
        evento(2, 'd', { dispositivo: 'aparelho-b' }),
        evento(3, 'a'),
      ]
      await a.anexar([depois, b3, antes, b2, b1])
      await afirmarLeitura(a, [b3, depois], 'ler desde (2, c)', { em: 2, id: 'c' })
      await afirmarLeitura(a, [b1, b2, b3, depois], 'ler desde (1, z)', { em: 1, id: 'z' })
      // Um cursor que não é evento gravado também vale: o par (2, 'bb') fica entre b e c.
      await afirmarLeitura(a, [b2, b3, depois], 'ler desde (2, bb)', { em: 2, id: 'bb' })
    },
  },
  {
    nome: 'desde depois do último lê vazio',
    async executar(fabrica) {
      const a = await fabrica()
      await a.anexar([evento(1, 'a'), evento(2, 'b')])
      await afirmarLeitura(a, [], 'ler desde o último', { em: 2, id: 'b' })
      await afirmarLeitura(a, [], 'ler desde depois do último', { em: 9, id: '' })
    },
  },
  {
    nome: 'campos fora do envelope voltam intactos',
    async executar(fabrica) {
      const a = await fabrica()
      const completo = evento(1, 'a', {
        tipo: 'resposta-registrada',
        fusoMinutos: -330,
        questao: { formato: { linhas: [['a', 'b'], ['c']] }, limiteMs: 4500 },
        resposta: { texto: 'São Tomé 👍', rotulo: null, ligacoes: [] },
        acelerada: false,
        xp: 0.17,
      })
      await a.anexar([completo])
      await afirmarLeitura(a, [completo], 'ler o evento com corpo')
    },
  },
  {
    nome: 'lotes sucessivos não apagam nada, e contar é o tamanho da leitura depois de cada um',
    async executar(fabrica) {
      const a = await fabrica()
      const lotes = [[evento(3, 'c')], [evento(1, 'a'), evento(5, 'e')], [], [evento(3, 'c'), evento(2, 'b')]]
      const gravados: Envelope[] = []
      for (const lote of lotes) {
        await a.anexar(lote)
        for (const e of lote) if (!gravados.some((g) => g.id === e.id)) gravados.push(e)
        const lidos = await a.ler()
        afirmar(
          lidos.length === gravados.length,
          `ler tem ${String(lidos.length)} e foram gravados ${String(gravados.length)}`,
        )
        afirmar((await a.contar()) === lidos.length, 'contar difere do tamanho de ler')
      }
      await afirmarLeitura(
        a,
        [...gravados].sort((x, y) => x.em - y.em),
        'ler depois de todos os lotes',
      )
    },
  },
  {
    nome: 'mudar o objeto anexado ou o lido não muda o que está guardado',
    async executar(fabrica) {
      const a = await fabrica()
      const original = evento(1, 'a', { questao: { opcoes: ['a', 'b'] } })
      const anexado = JSON.parse(JSON.stringify(original)) as Envelope
      await a.anexar([anexado])
      // O tipo diz readonly, mas um chamador em JavaScript, ou um cast, muda o objeto do mesmo jeito; é isso que o caso
      // simula, no topo e num nível abaixo.
      const estragar = (e: unknown, xp: number, opcao: string): void => {
        const mutavel = e as { xp: number; questao: { opcoes: string[] } }
        mutavel.xp = xp
        mutavel.questao.opcoes.push(opcao)
      }
      estragar(anexado, 99, 'c')
      const [lido] = await a.ler()
      afirmar(lido !== undefined, 'ler depois de anexar um evento veio vazio')
      estragar(lido, 98, 'd')
      await afirmarLeitura(a, [original], 'ler depois de mudar o anexado e o lido')
    },
  },
  {
    nome: 'anexar lista vazia não falha nem muda nada',
    async executar(fabrica) {
      const a = await fabrica()
      await a.anexar([])
      await afirmarLeitura(a, [], 'ler depois de anexar lista vazia ao vazio')
      await a.anexar([evento(1, 'a')])
      await a.anexar([])
      await afirmarLeitura(a, [evento(1, 'a')], 'ler depois de anexar lista vazia')
    },
  },
]
