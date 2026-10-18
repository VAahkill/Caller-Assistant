import { ownerTextLanguage, scriptLanguage } from '../script';

test('a language from the script alone', () => {
  expect(scriptLanguage('దయచేసి గేట్ దగ్గర ఇవ్వండి')).toBe('te');
  expect(scriptLanguage('कृपया गेट पर')).toBe('hi');
  expect(scriptLanguage('Please leave it at the gate')).toBe('');
});

describe('what the server takes the owner’s typed words to be in', () => {
  test('the script, whatever the owner speaks', () => {
    expect(ownerTextLanguage('దయచేసి గేట్ దగ్గర ఇవ్వండి', 'en')).toBe('te');
    expect(ownerTextLanguage('कृपया गेट पर', 'te')).toBe('hi');
  });

  test('Latin letters are English for an owner whose language has its own script', () => {
    expect(ownerTextLanguage('Please leave it at the gate', 'te')).toBe('en');
    expect(ownerTextLanguage('Please leave it at the gate', 'hi')).toBe('en');
  });

  test("Latin letters are the owner's own language when it is written in them", () => {
    expect(ownerTextLanguage('Bitte am Tor lassen', 'de')).toBe('de');
    expect(ownerTextLanguage('Please leave it', 'en')).toBe('en');
    expect(ownerTextLanguage('Please leave it', '')).toBe('en');
  });
});
