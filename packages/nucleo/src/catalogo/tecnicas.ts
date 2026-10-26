import { erro, ok, type Resultado } from '../base/resultado'

export type NomeDeTecnica =
  | 'grupos'
  | 'fire'
  | 'compressao'
  | 'naoInterferencia'
  | 'interleaving'
  | 'diagnostico'
  | 'sondagem'
  | 'remediacao'
  | 'cronometragem'
  | 'quiz'
  | 'gamificacao'
  | 'velocidadeAdaptativa'

/**
 * Um interruptor por técnica pedagógica. O domínio declara quais quer, e cada camada do motor consulta só o seu: com
 * tudo desligado, sobra repetição espaçada simples por item.
 */
export type Tecnicas = Readonly<Record<NomeDeTecnica, boolean>>

function todas(valor: boolean): Tecnicas {
  return Object.freeze({
    grupos: valor,
    fire: valor,
    compressao: valor,
    naoInterferencia: valor,
    interleaving: valor,
    diagnostico: valor,
    sondagem: valor,
    remediacao: valor,
    cronometragem: valor,
    quiz: valor,
    gamificacao: valor,
    velocidadeAdaptativa: valor,
  })
}

export const TECNICAS_TODAS_LIGADAS: Tecnicas = todas(true)
export const TECNICAS_TODAS_DESLIGADAS: Tecnicas = todas(false)

export type ErroDeTecnicas = { codigo: 'TECNICAS_INCOERENTES'; detalhe: string }

// Combinações sem sentido: a técnica não tem sobre o que agir sem a outra. Toda combinação fora desta tabela vale.
const DEPENDENCIAS: readonly { tecnica: NomeDeTecnica; exige: NomeDeTecnica; motivo: string }[] = [
  { tecnica: 'fire', exige: 'grupos', motivo: 'sem grupos o grafo não tem aresta por onde o crédito se propague' },
  { tecnica: 'compressao', exige: 'grupos', motivo: 'sem grupos não há tópico que cubra outros' },
]

/** Confere a coerência das técnicas pedidas. Quem cria o motor chama antes de qualquer outra coisa. */
export function conferirTecnicas(tecnicas: Tecnicas): Resultado<Tecnicas, ErroDeTecnicas> {
  const incoerencias = DEPENDENCIAS.filter((d) => tecnicas[d.tecnica] && !tecnicas[d.exige])
  if (incoerencias.length === 0) return ok(tecnicas)
  return erro({
    codigo: 'TECNICAS_INCOERENTES',
    detalhe: incoerencias.map((d) => `${d.tecnica} exige ${d.exige}: ${d.motivo}`).join('; '),
  })
}
