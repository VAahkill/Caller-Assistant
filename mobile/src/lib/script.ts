// Unicode blocks of the Indian scripts callers write in (Devanagari through
// Malayalam, plus Sinhala). Text in these needs taller lines.
const INDIC = /[ऀ-෿]/;

export const hasIndicScript = (text: string): boolean => INDIC.test(text);

const SCRIPTS: [RegExp, string][] = [
  [/[ऀ-ॿ]/, 'hi'],
  [/[ঀ-৿]/, 'bn'],
  [/[਀-੿]/, 'pa'],
  [/[઀-૿]/, 'gu'],
  [/[஀-௿]/, 'ta'],
  [/[ఀ-౿]/, 'te'],
  [/[ಀ-೿]/, 'kn'],
  [/[ഀ-ൿ]/, 'ml'],
  [/[؀-ۿ]/, 'ur'],
];

/** A language guess from the script alone; '' for Latin or unknown text. */
export function scriptLanguage(text: string): string {
  for (const [re, lang] of SCRIPTS) if (re.test(text)) return lang;
  return '';
}

// Languages the server writes in their own (non-Latin) script.
const OWN_SCRIPT = new Set(['hi', 'te', 'ta', 'kn', 'ml', 'bn', 'mr', 'gu', 'pa', 'ur', 'or', 'as']);

/**
 * The language the server takes the owner's typed words to be in when the app
 * sends none: their script says it, and Latin letters are English unless the
 * owner's own language is written in them. The app sends no language with
 * typed words so the server can tell; this is for showing the bubble.
 */
export function ownerTextLanguage(text: string, ownerLanguage: string): string {
  const owner = ownerLanguage || 'en';
  return scriptLanguage(text) || (OWN_SCRIPT.has(owner) ? 'en' : owner);
}
