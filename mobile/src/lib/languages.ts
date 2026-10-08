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
