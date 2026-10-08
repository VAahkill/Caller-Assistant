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
