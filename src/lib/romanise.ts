/**
 * Turning a lyric into the Latin alphabet.
 *
 * # What this does and does not attempt
 *
 * Cyrillic and Greek are *transliterations*: each letter has a settled Latin
 * equivalent, the mapping is reversible enough to sing from, and it needs no
 * dictionary. Those are done here.
 *
 * Japanese, Korean and Chinese are **not**, and that is a deliberate refusal
 * rather than a gap. Romanising them requires knowing the reading of each word
 * — 行 is `i`, `gyō` or `kō` depending on the word it is in — which needs a
 * morphological dictionary of tens of megabytes. A table-driven attempt would
 * produce plausible-looking nonsense, and plausible nonsense in a lyric is
 * worse than the original script, because the reader cannot tell it is wrong.
 *
 * `canRomanise` says which is which, so the UI offers the button only where it
 * will produce something true.
 */

/** Russian, Ukrainian and Serbian letters. BGN/PCGN, roughly. */
const CYRILLIC: Record<string, string> = {
  а: 'a',
  б: 'b',
  в: 'v',
  г: 'g',
  ґ: 'g',
  д: 'd',
  е: 'e',
  ё: 'yo',
  є: 'ye',
  ж: 'zh',
  з: 'z',
  и: 'i',
  і: 'i',
  ї: 'yi',
  й: 'y',
  к: 'k',
  л: 'l',
  м: 'm',
  н: 'n',
  о: 'o',
  п: 'p',
  р: 'r',
  с: 's',
  т: 't',
  у: 'u',
  ф: 'f',
  х: 'kh',
  ц: 'ts',
  ч: 'ch',
  ш: 'sh',
  щ: 'shch',
  ъ: '',
  ы: 'y',
  ь: '',
  э: 'e',
  ю: 'yu',
  я: 'ya',
  ђ: 'dj',
  ј: 'j',
  љ: 'lj',
  њ: 'nj',
  ћ: 'c',
  џ: 'dz',
};

/** Modern Greek, in the conventional scholarly transliteration. */
const GREEK: Record<string, string> = {
  α: 'a',
  β: 'v',
  γ: 'g',
  δ: 'd',
  ε: 'e',
  ζ: 'z',
  η: 'i',
  θ: 'th',
  ι: 'i',
  κ: 'k',
  λ: 'l',
  μ: 'm',
  ν: 'n',
  ξ: 'x',
  ο: 'o',
  π: 'p',
  ρ: 'r',
  σ: 's',
  ς: 's',
  τ: 't',
  υ: 'y',
  φ: 'f',
  χ: 'ch',
  ψ: 'ps',
  ω: 'o',
  ά: 'a',
  έ: 'e',
  ή: 'i',
  ί: 'i',
  ό: 'o',
  ύ: 'y',
  ώ: 'o',
  ϊ: 'i',
  ϋ: 'y',
};

/** Scripts a table can honestly handle. */
export type Script = 'latin' | 'cyrillic' | 'greek' | 'cjk' | 'other';

/**
 * Identifies the dominant script of a text.
 *
 * By majority rather than by first match: a Russian lyric with an English
 * title in it is still Russian, and one Cyrillic character in an English song
 * should not make it a candidate for transliteration.
 */
export function scriptOf(text: string): Script {
  let cyrillic = 0;
  let greek = 0;
  let cjk = 0;
  let latin = 0;
  let letters = 0;

  for (const char of text) {
    const code = char.codePointAt(0) ?? 0;
    const isLetter = /\p{L}/u.test(char);
    if (!isLetter) continue;
    letters += 1;

    if (code >= 0x0400 && code <= 0x04ff) cyrillic += 1;
    else if (code >= 0x0370 && code <= 0x03ff) greek += 1;
    else if (
      // CJK ideographs, hiragana, katakana, Hangul.
      (code >= 0x4e00 && code <= 0x9fff) ||
      (code >= 0x3040 && code <= 0x30ff) ||
      (code >= 0xac00 && code <= 0xd7af)
    )
      cjk += 1;
    else if (code < 0x0250) latin += 1;
  }

  if (letters === 0) return 'other';

  const majority = letters / 2;
  if (cyrillic > majority) return 'cyrillic';
  if (greek > majority) return 'greek';
  if (cjk > majority) return 'cjk';
  if (latin > majority) return 'latin';
  return 'other';
}

/**
 * Whether this text can be romanised truthfully.
 *
 * False for Latin (nothing to do), for CJK (needs a dictionary this app does
 * not carry) and for anything unrecognised.
 */
export function canRomanise(text: string): boolean {
  const script = scriptOf(text);
  return script === 'cyrillic' || script === 'greek';
}

/**
 * Transliterates Cyrillic or Greek into Latin letters.
 *
 * Case is preserved for the first letter of a mapping only: `Ш` becomes `Sh`
 * rather than `SH`, which is what a reader expects and what every published
 * transliteration does.
 *
 * Text in a script this cannot handle comes back unchanged rather than
 * mangled — the caller checks `canRomanise` first, and this is the second line
 * of defence for a mixed-script lyric.
 */
export function romanise(text: string): string {
  const script = scriptOf(text);
  if (script !== 'cyrillic' && script !== 'greek') return text;

  const table = script === 'cyrillic' ? CYRILLIC : GREEK;
  let out = '';

  for (const char of text) {
    const lower = char.toLowerCase();
    const mapped = table[lower];

    if (mapped === undefined) {
      out += char;
      continue;
    }
    if (mapped === '') continue;

    // Upper-case input gets a capitalised mapping, not an upper-cased one.
    out += char === lower ? mapped : mapped[0].toUpperCase() + mapped.slice(1);
  }

  return out;
}

/** Romanises each line of a lyric, keeping the line breaks. */
export function romaniseLines(text: string): string {
  return text
    .split('\n')
    .map((line) => romanise(line))
    .join('\n');
}
