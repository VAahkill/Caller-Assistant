// Languages the assistant can hear and speak. Codes match the server (ISO 639-1).

export interface Language {
  code: string;
  name: string; // in English
  native: string; // in its own script
}

export const LANGUAGES: Language[] = [
  { code: 'en', name: 'English', native: 'English' },
  { code: 'hi', name: 'Hindi', native: 'हिन्दी' },
  { code: 'te', name: 'Telugu', native: 'తెలుగు' },
  { code: 'ta', name: 'Tamil', native: 'தமிழ்' },
  { code: 'kn', name: 'Kannada', native: 'ಕನ್ನಡ' },
  { code: 'ml', name: 'Malayalam', native: 'മലയാളം' },
  { code: 'mr', name: 'Marathi', native: 'मराठी' },
  { code: 'bn', name: 'Bengali', native: 'বাংলা' },
  { code: 'gu', name: 'Gujarati', native: 'ગુજરાતી' },
  { code: 'pa', name: 'Punjabi', native: 'ਪੰਜਾਬੀ' },
  { code: 'ur', name: 'Urdu', native: 'اردو' },
];

/** The four languages the speech stack is tuned for (spec: caller_languages default). */
export const CALLER_LANGUAGES_DEFAULT = ['en', 'hi', 'te', 'ta'];

const BY_CODE = new Map(LANGUAGES.map((l) => [l.code, l]));

export const languageName = (code: string): string => BY_CODE.get(code)?.name ?? (code ? code.toUpperCase() : 'Unknown');

export const languageNative = (code: string): string => BY_CODE.get(code)?.native ?? languageName(code);

/** Short tag for bubbles and pills, e.g. "TE". */
export const languageTag = (code: string): string => (code ? code.slice(0, 2).toUpperCase() : '');

/** Adds a language at the end, or removes it (never the last one). */
export function toggleLanguage(list: string[], code: string): string[] {
  if (!list.includes(code)) return [...list, code];
  return list.length > 1 ? list.filter((c) => c !== code) : list;
}

/** Moves a language one place up (-1) or down (+1); the order is the detection prior. */
export function moveLanguage(list: string[], code: string, by: -1 | 1): string[] {
  const i = list.indexOf(code);
  const j = i + by;
  if (i < 0 || j < 0 || j >= list.length) return list;
  const next = [...list];
  [next[i], next[j]] = [next[j], next[i]];
  return next;
}
