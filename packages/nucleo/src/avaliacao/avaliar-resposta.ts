import { erro, ok, type Resultado } from '../base/resultado'
import type { Milis } from '../base/tempo'
import { casaComRotulo, indiceDeRotulos, resolverRotulo } from '../catalogo/normalizacao'
import type { Catalogo, Direcao, IdItem } from '../catalogo/tipos'
import type { Parametros } from '../memoria'
import { direcaoDoFormato, opcoesDe, parceirosIndiscerniveis, type Questao } from '../questoes'
import { medianaDoFormato, type NormasDeLatencia } from './normas-de-latencia'
import type { Avaliacao, ErroDeAvaliacao, QualidadeDeAcerto, QualidadeDeErro, Resposta } from './tipos'

const incompativel = (detalhe: string): Resultado<never, ErroDeAvaliacao> =>
  erro({ codigo: 'RESPOSTA_INCOMPATIVEL', detalhe })

function acerto(qualidade: QualidadeDeAcerto, direcao: Direcao, parametros: Parametros): Avaliacao {
  return { correta: true, qualidade, direcao, deltaBruto: parametros.deltaBruto[qualidade] }
}

function falha(
  qualidade: QualidadeDeErro,
  direcao: Direcao,
  parametros: Parametros,
  confundidaCom?: IdItem,
): Avaliacao {
  const base = { correta: false, qualidade, direcao, deltaBruto: parametros.deltaBruto[qualidade] } as const
  return confundidaCom === undefined ? base : { ...base, confundidaCom }
}

/**
 * Qualidade de um acerto pela latência.
 *
 * Acerto abaixo de `latenciaChuteMs` é `perfeita` antes de qualquer comparação: rapidez num acerto é automaticidade, o
 * que o livro quer, e nunca suspeita de chute. A linha vem antes da mediana porque uma mediana própria muito baixa
 * chamaria de lento um acerto que é rápido por qualquer régua. Depois disso, acerto até a mediana própria do formato, ou
 * sem amostras bastantes para ela, é `perfeita`; mais lento é `boa` sem limite e `lenta` com limite, para o acerto lento
 * valer menos só quando a questão já mede o tempo.
 */
function qualidadeDoAcerto(
  latencia: Milis,
  questao: Questao,
  normas: NormasDeLatencia,
  parametros: Parametros,
): QualidadeDeAcerto {
  if (latencia < parametros.latenciaChuteMs) return 'perfeita'
  const mediana = medianaDoFormato(normas, questao.formato.tipo, parametros)
  if (mediana === undefined || latencia <= mediana) return 'perfeita'
  return questao.limiteMs === undefined ? 'boa' : 'lenta'
}

/** Latência que é duração: finita e não negativa. A casca mede com relógio monotônico; outra coisa é defeito dela. */
const latenciaValida = (latencia: number): boolean => Number.isFinite(latencia) && latencia >= 0

/**
 * Avalia a resposta à questão. Devolve erro, e não avaliação, para resposta que não serve ao formato (ver
 * `ErroDeAvaliacao`), e a avaliação com a qualidade, a direção e o `deltaBruto` da qualidade.
 *
 * As regras, na ordem em que valem:
 *
 * - `nao-sei` é erro sem `confundidaCom`: não há item escolhido para chamar de confusão.
 * - `tempo-esgotado` só existe em questão com `limiteMs`, e escolha ou texto com latência acima do limite também o é.
 * - Na escolha, o par indiscernível conta: em `estimulo-para-rotulo` o parceiro do alvo é aceito (o estímulo não os
 *   distingue), em `rotulo-para-estimulo` só o alvo, e em `grupo-membros` só o conjunto exato do alvo com o parceiro.
 *   Escolha errada abaixo de `latenciaChuteMs` é `chute`, senão `errada`, e a primeira opção errada é `confundidaCom`.
 * - No texto, aceita-se o rótulo ou um alias do alvo ou do parceiro, pela normalização do catálogo. Texto vazio depois
 *   de aparado é `chute`; texto que não casa é `errada`, nunca chute, porque digitar um nome errado é tentativa, e o
 *   item cujo rótulo o texto é vira `confundidaCom`.
 *
 * Sem `limiteMs`, o que acontece sempre com a técnica `cronometragem` desligada, nem `lenta` nem `tempo-esgotado` saem
 * daqui.
 */
export function avaliarResposta(
  questao: Questao,
  resposta: Resposta,
  catalogo: Catalogo,
  normas: NormasDeLatencia,
  parametros: Parametros,
): Resultado<Avaliacao, ErroDeAvaliacao> {
  const { formato } = questao
  // A associação é o formato do diagnóstico: uma linha por estímulo, cada uma com o próprio acerto, e a avaliação dela
  // não cabe numa qualidade só. Ela chega com a camada do diagnóstico; até lá o formato existe no tipo e é recusado aqui.
  if (formato.tipo === 'associacao') {
    return erro({ codigo: 'FORMATO_NAO_SUPORTADO', detalhe: 'a associação é avaliada pelo diagnóstico' })
  }
  const alvo = catalogo.itens.get(questao.itemAlvo)
  if (alvo === undefined)
    return erro({ codigo: 'ITEM_INEXISTENTE', detalhe: `item que não existe: '${questao.itemAlvo}'` })
  const direcao = direcaoDoFormato(formato.tipo)
  const aceitos = new Set([alvo.id, ...parceirosIndiscerniveis(alvo.id, catalogo)])

  switch (resposta.tipo) {
    case 'continuar':
      return incompativel('continuar fecha apresentação e não responde questão')
    case 'nao-sei':
      return ok(falha('nao-sei', direcao, parametros))
    case 'tempo-esgotado':
      if (questao.limiteMs === undefined) return incompativel('tempo esgotado em questão sem limite')
      return ok(falha('tempo-esgotado', direcao, parametros))
    case 'escolha': {
      if (formato.tipo === 'rotulo-digitado') return incompativel('escolha em questão de rótulo digitado')
      if (!latenciaValida(resposta.latencia))
        return incompativel(`latência que não é duração: ${String(resposta.latencia)}`)
      const { escolhidas } = resposta
      const opcoes = new Set(opcoesDe(formato))
      if (escolhidas.length === 0) return incompativel('escolha sem item escolhido')
      if (new Set(escolhidas).size !== escolhidas.length) return incompativel('item escolhido mais de uma vez')
      const fora = escolhidas.find((id) => !opcoes.has(id))
      if (fora !== undefined) return incompativel(`item escolhido fora das opções: '${fora}'`)
      if (formato.tipo !== 'grupo-membros' && escolhidas.length > 1) {
        return incompativel('mais de um item escolhido em questão de uma resposta')
      }
      if (questao.limiteMs !== undefined && resposta.latencia > questao.limiteMs) {
        return ok(falha('tempo-esgotado', direcao, parametros))
      }
      // Quem conta como certo: o parceiro vale onde a pergunta mostra o estímulo e pede o rótulo, porque o estímulo não
      // distingue os dois. Onde ela mostra o rótulo e pede o estímulo, só o do alvo responde; a geração nunca põe o do
      // parceiro entre as opções, e quem o puser recebe erro com ele como confundido.
      const certos = formato.tipo === 'rotulo-para-estimulo' ? new Set([alvo.id]) : aceitos
      const todasCertas = escolhidas.every((id) => certos.has(id))
      const certa = formato.tipo === 'grupo-membros' ? todasCertas && escolhidas.length === certos.size : todasCertas
      if (certa)
        return ok(acerto(qualidadeDoAcerto(resposta.latencia, questao, normas, parametros), direcao, parametros))
      const qualidade = resposta.latencia < parametros.latenciaChuteMs ? 'chute' : 'errada'
      return ok(
        falha(
          qualidade,
          direcao,
          parametros,
          escolhidas.find((id) => !certos.has(id)),
        ),
      )
    }
    case 'texto': {
      if (formato.tipo !== 'rotulo-digitado') return incompativel('texto em questão de múltipla escolha')
      if (!latenciaValida(resposta.latencia))
        return incompativel(`latência que não é duração: ${String(resposta.latencia)}`)
      if (questao.limiteMs !== undefined && resposta.latencia > questao.limiteMs) {
        return ok(falha('tempo-esgotado', direcao, parametros))
      }
      if (resposta.texto.trim() === '') return ok(falha('chute', direcao, parametros))
      const casa = [...aceitos].some((id) => {
        const item = catalogo.itens.get(id)
        return item !== undefined && casaComRotulo(resposta.texto, item)
      })
      if (casa)
        return ok(acerto(qualidadeDoAcerto(resposta.latencia, questao, normas, parametros), direcao, parametros))
      const confundida = resolverRotulo(indiceDeRotulos(catalogo.itens.values()), resposta.texto)
      return ok(falha('errada', direcao, parametros, confundida))
    }
  }
}
