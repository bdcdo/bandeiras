/**
 * Os 193 Estados-membros da ONU, em ISO 3166-1 alfa-2 minúsculo, que é o id de cada bandeira em todo o pacote.
 *
 * Fonte: lista oficial de Estados-membros, https://www.un.org/en/about-us/member-states, consultada em 2026-10-25. A
 * lista foi digitada pelo projeto a partir dela, agrupada por continente só para facilitar a conferência. Ficam de fora
 * os observadores e os territórios sem assento: Vaticano (va), Palestina (ps), Taiwan (tw) e Kosovo (xk). O teste de
 * dados confere a contagem e essas ausências.
 *
 * Os scripts e o teste importam daqui; a constante não é exportada por src/ porque a casca recebe os ids pelo catálogo.
 */
export const MEMBROS_ONU = [
  // África (54)
  ...['dz', 'ao', 'bj', 'bw', 'bf', 'bi', 'cv', 'cm', 'cf', 'td', 'km', 'cg', 'cd', 'ci', 'dj', 'eg', 'gq', 'er'],
  ...['sz', 'et', 'ga', 'gm', 'gh', 'gn', 'gw', 'ke', 'ls', 'lr', 'ly', 'mg', 'mw', 'ml', 'mr', 'mu', 'ma', 'mz'],
  ...['na', 'ne', 'ng', 'rw', 'st', 'sn', 'sc', 'sl', 'so', 'za', 'ss', 'sd', 'tz', 'tg', 'tn', 'ug', 'zm', 'zw'],
  // Ásia (47)
  ...['af', 'am', 'az', 'bh', 'bd', 'bt', 'bn', 'kh', 'cn', 'cy', 'ge', 'in', 'id', 'ir', 'iq', 'il', 'jp', 'jo'],
  ...['kz', 'kw', 'kg', 'la', 'lb', 'my', 'mv', 'mn', 'mm', 'np', 'kp', 'om', 'pk', 'ph', 'qa', 'sa', 'sg', 'kr'],
  ...['lk', 'sy', 'tj', 'th', 'tl', 'tr', 'tm', 'ae', 'uz', 'vn', 'ye'],
  // Europa (43)
  ...['al', 'ad', 'at', 'by', 'be', 'ba', 'bg', 'hr', 'cz', 'dk', 'ee', 'fi', 'fr', 'de', 'gr', 'hu', 'is', 'ie'],
  ...['it', 'lv', 'li', 'lt', 'lu', 'mt', 'md', 'mc', 'me', 'nl', 'mk', 'no', 'pl', 'pt', 'ro', 'ru', 'sm', 'rs'],
  ...['sk', 'si', 'es', 'se', 'ch', 'ua', 'gb'],
  // Américas (35)
  ...['ag', 'ar', 'bs', 'bb', 'bz', 'bo', 'br', 'ca', 'cl', 'co', 'cr', 'cu', 'dm', 'do', 'ec', 'sv', 'gd', 'gt'],
  ...['gy', 'ht', 'hn', 'jm', 'mx', 'ni', 'pa', 'py', 'pe', 'kn', 'lc', 'vc', 'sr', 'tt', 'us', 'uy', 've'],
  // Oceania (14)
  ...['au', 'fj', 'ki', 'mh', 'fm', 'nr', 'nz', 'pw', 'pg', 'ws', 'sb', 'to', 'tv', 'vu'],
] as const

export type CodigoMembro = (typeof MEMBROS_ONU)[number]

/** Os mesmos códigos em ordem alfabética, a ordem de todo arquivo gerado (o diff de regeneração fica estável). */
export const MEMBROS_EM_ORDEM: readonly string[] = [...MEMBROS_ONU].sort()
