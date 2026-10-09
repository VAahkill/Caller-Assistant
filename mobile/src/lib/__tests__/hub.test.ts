import { setupChecklist, voiceSummary } from '../hub';
import { createFixtures } from '../mock/fixtures';
import { emptyLocation } from '../normalize';

const fx = createFixtures(1_760_000_000);

describe('setupChecklist', () => {
  test('the fixture profile has contacts, a pin and rules, but not every language has a voice', () => {
    const items = setupChecklist(fx.profile);
    expect(items.map((i) => [i.id, i.done])).toEqual([
      ['contacts', true],
      ['location', true],
      ['instructions', true],
      ['voices', false],
    ]);
    // English falls back to the main voice; Tamil has nothing picked.
    expect(items[3].detail).toBe('Not picked yet: Tamil.');
  });

  test('a new profile has everything to do, each with where to go', () => {
    const p = { ...fx.profile, contacts: [], location: emptyLocation(), instructions: [], voices_by_language: {}, voice: '' };
    const items = setupChecklist(p);
    expect(items.every((i) => !i.done)).toBe(true);
    expect(items.map((i) => i.href)).toEqual(['/screening', '/location', '/instructions', '/voices']);
  });

  test('a paused or ended instruction does not count', () => {
    const now = Math.floor(Date.now() / 1000);
    const rule = fx.profile.instructions[0];
    const p = { ...fx.profile, instructions: [{ ...rule, enabled: false }, { ...rule, id: 'x', expires_at: now - 60 }] };
    expect(setupChecklist(p).find((i) => i.id === 'instructions')!.done).toBe(false);
  });
});

test('voiceSummary names the picks in caller-language order', () => {
  expect(voiceSummary(fx.profile, undefined)).toBe('Pick a voice per language, or record your own');
  expect(voiceSummary(fx.profile, fx.voices)).toBe('Telugu: Padmavathi · English: Heart +1');
  expect(voiceSummary({ ...fx.profile, voices_by_language: {}, voice: '' }, fx.voices)).toBe('Pick a voice per language, or record your own');
});
