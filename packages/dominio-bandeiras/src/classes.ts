/**
 * Padrões visuais das bandeiras: a lista fechada que o núcleo recebe como `classes` do catálogo e contra a qual valida
 * a `classe` de cada item. Serve aos distratores dissimilares (padrão diferente) e à descrição verbal.
 */
export const PADROES_VISUAIS = [
  'faixas-horizontais',
  'faixas-verticais',
  'cruz',
  'cantao',
  'triangulo-no-mastro',
  'diagonal',
  'campo-liso-com-emblema',
  'outro',
] as const

export type PadraoVisual = (typeof PADROES_VISUAIS)[number]
