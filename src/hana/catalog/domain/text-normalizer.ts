/**
 * Text normalization shared by the index and the queries (POV 5.4): lowercase, no diacritics,
 * identifiers split on `_`, light plural/gender stemming for Spanish and English, no stopwords.
 * Index and query use the same function, so the stem only has to be consistent, not linguistic.
 */
const STOPWORDS: ReadonlySet<string> = new Set([
  // Spanish
  'el',
  'la',
  'los',
  'las',
  'un',
  'una',
  'unos',
  'unas',
  'de',
  'del',
  'al',
  'en',
  'por',
  'para',
  'con',
  'sin',
  'que',
  'cual',
  'cuales',
  'cuanto',
  'cuantos',
  'cuanta',
  'cuantas',
  'hay',
  'son',
  'fue',
  'fueron',
  'ser',
  'se',
  'su',
  'sus',
  'mi',
  'mis',
  'me',
  'dame',
  'dime',
  'quiero',
  'necesito',
  'muestra',
  'muestrame',
  'mostrar',
  'listar',
  'lista',
  'listado',
  'ver',
  'como',
  'donde',
  'cuando',
  'entre',
  'desde',
  'hasta',
  'sobre',
  'todos',
  'todas',
  'cada',
  'mas',
  'menos',
  'y',
  'o',
  'a',
  'e',
  // English
  'the',
  'an',
  'of',
  'in',
  'on',
  'for',
  'to',
  'with',
  'without',
  'and',
  'or',
  'is',
  'are',
  'was',
  'were',
  'be',
  'by',
  'per',
  'each',
  'all',
  'show',
  'list',
  'give',
  'get',
  'me',
  'my',
  'how',
  'many',
  'much',
  'what',
  'which',
  'who',
  'where',
  'when',
  'from',
  'that',
  'this',
  'there',
  'do',
  'does',
  'have',
  'has',
  'want',
  'need',
  'see',
  'top',
]);

const MIN_STEM_LENGTH = 4;

export function stripDiacritics(text: string): string {
  return text.normalize('NFD').replace(/\p{M}+/gu, '');
}

export function stemToken(token: string): string {
  let stem = token;
  if (stem.length >= MIN_STEM_LENGTH && stem.endsWith('s') && !stem.endsWith('ss')) {
    stem = stem.slice(0, -1);
  }
  if (stem.length > MIN_STEM_LENGTH && /[aeo]$/.test(stem)) stem = stem.slice(0, -1);
  return stem;
}

/** Stemmed, deduplicated-free (order preserved) terms of a text. Deterministic. */
export function tokenize(text: string): string[] {
  return stripDiacritics(text.toLowerCase())
    .split(/[^a-z0-9]+/)
    .filter((word) => word.length > 0 && !STOPWORDS.has(word))
    .map(stemToken)
    .filter((term) => term.length > 1);
}
