import { awayMessage, spokenTime, untilFor } from '../away';
import { dialerName } from '../format';
import { callerName, engineName, greetingLine } from '../labels';
import { moveLanguage, toggleLanguage } from '../languages';
import { directionsText, geocodeLine, locationChanged } from '../location';
import { emptyLocation } from '../normalize';
import { ONBOARDING_STEPS, nextStep, stepHref } from '../onboarding';
import { expiryFor, expiryText, instructionPreview, isExpired, notePreview, parseNumbers, presetOf } from '../rules';

// 8 Oct 2026, 14:10 local time.
const NOW = new Date(2026, 9, 8, 14, 10, 0).getTime();
const at = (d: number, h: number, m = 0) => new Date(2026, 9, d, h, m, 0).getTime() / 1000;

describe('rules: expiry', () => {
  test('presets give end of today, a week from now, or never', () => {
    expect(expiryFor('never', NOW)).toBeNull();
    expect(expiryFor('today', NOW)).toBe(at(8, 23, 59));
    expect(expiryFor('week', NOW)).toBe(NOW / 1000 + 7 * 86400);
  });

  test('a stored expiry maps back to its chip, or custom', () => {
    expect(presetOf(null, NOW)).toBe('never');
    expect(presetOf(at(8, 23, 59), NOW)).toBe('today');
    expect(presetOf(NOW / 1000 + 7 * 86400 + 30, NOW)).toBe('week');
    expect(presetOf(at(20, 9), NOW)).toBe('custom');
  });

  test('expiry text reads naturally and marks ended rules', () => {
    expect(expiryText(null, NOW)).toBeNull();
    expect(expiryText(at(8, 9), NOW)).toBe('Ended');
    expect(isExpired(at(8, 9), NOW)).toBe(true);
    expect(isExpired(null, NOW)).toBe(false);
    expect(expiryText(at(8, 23, 59), NOW)).toMatch(/^Ends today, /);
    expect(expiryText(at(8, 18), NOW)).toBe('Ends today, 6 PM');
    expect(expiryText(at(9, 10), NOW)).toBe('Ends tomorrow, 10 AM');
    expect(expiryText(at(9, 23, 59), NOW)).toBe('Ends tomorrow');
    expect(expiryText(at(15, 9, 30), NOW)).toBe('Ends 15 Oct, 9:30 AM');
    expect(expiryText(at(15, 23, 59), NOW)).toBe('Ends 15 Oct');
  });
});

describe('rules: numbers and previews', () => {
  test('numbers split on commas and lines, are put in the server form and de-duplicated', () => {
    expect(parseNumbers('+91 98480-12345, 9848012345\n098480 12345; 12, 91770 01122')).toEqual(['+919848012345', '+919177001122']);
    expect(parseNumbers('07700 900123', '+44')).toEqual(['+447700900123']);
    expect(parseNumbers('')).toEqual([]);
  });

  test('instruction preview says who it applies to and when it ends', () => {
    expect(instructionPreview('Leave parcels with the guard.', 'delivery', 'Ava', null, NOW)).toBe(
      'When a delivery partner calls, Ava follows: "Leave parcels with the guard."',
    );
    expect(instructionPreview('Say I am at the dentist', 'everyone', 'Ava', at(9, 10), NOW)).toBe(
      'When anyone calls, Ava follows: "Say I am at the dentist." Ends tomorrow, 10 AM.',
    );
    expect(instructionPreview('  ', 'everyone', 'Ava', null, NOW)).toBe('Write what Ava should do, and when.');
  });

  test('note preview says who may hear it and that anything else is checked first', () => {
    expect(notePreview("I'm free after 6", 'contacts', 'Ava', null, NOW)).toBe(
      'Ava may tell your saved contacts when they ask: "I\'m free after 6." Anything else, it checks with you first.',
    );
  });
});

describe('location', () => {
  const base = { ...emptyLocation(), lat: 17.4612, lng: 78.3672, floor_unit: 'Flat 402, 4th floor', building: 'Lakeview Residency' };

  test('changes are detected, ignoring surrounding spaces and the server hint', () => {
    expect(locationChanged(base, { ...base })).toBe(false);
    expect(locationChanged(base, { ...base, building: ' Lakeview Residency ' })).toBe(false);
    expect(locationChanged(base, { ...base, geocoded_hint: 'Kondapur' })).toBe(false);
    expect(locationChanged(base, { ...base, landmarks: 'Opposite Ratnadeep' })).toBe(true);
    expect(locationChanged(base, { ...base, lat: 17.4613 })).toBe(true);
    expect(locationChanged(base, { ...base, lat: null })).toBe(true);
  });

  test('directions go from the place to the door to the way in', () => {
    expect(
      directionsText({
        ...base,
        address: 'Road No. 2, Kondapur',
        landmarks: 'Opposite Ratnadeep supermarket',
        gate_instructions: 'Use Gate 2 and tell security the flat number',
      }),
    ).toBe(
      'Flat 402, 4th floor, Lakeview Residency, Road No. 2, Kondapur. Landmark: Opposite Ratnadeep supermarket. ' +
        'To get in: Use Gate 2 and tell security the flat number. I can also send you the map pin by SMS.',
    );
  });

  test('with only a pin, the map hint stands in for the address', () => {
    expect(directionsText({ ...emptyLocation(), lat: 1, lng: 2, geocoded_hint: 'Kondapur, Hyderabad' })).toBe(
      'Near Kondapur, Hyderabad. I can also send you the map pin by SMS.',
    );
    expect(directionsText(emptyLocation())).toBe('');
  });

  test('a reverse-geocoded address becomes one short line', () => {
    expect(geocodeLine({ street: 'Road No. 2', district: 'Kondapur', city: 'Hyderabad', postalCode: '500084' })).toBe('Road No. 2, Kondapur, Hyderabad 500084');
    expect(geocodeLine({ name: 'Kondapur', district: 'Kondapur', subregion: 'Rangareddy' })).toBe('Kondapur, Rangareddy');
  });
});

describe('away', () => {
  test('lengths round up to five minutes so the spoken time is natural', () => {
    expect(untilFor(60, NOW)).toBe(at(8, 15, 10));
    expect(untilFor(30, new Date(2026, 9, 8, 14, 12).getTime())).toBe(at(8, 14, 45));
    expect(untilFor('none', NOW)).toBeNull();
  });

  test('"until morning" means 7 AM tomorrow, or today if it is still night', () => {
    expect(untilFor('morning', NOW)).toBe(at(9, 7));
    expect(untilFor('morning', new Date(2026, 9, 8, 2, 0).getTime())).toBe(at(8, 7));
  });

  test('messages are in plain English, as the server stores them', () => {
    expect(spokenTime(at(8, 15), NOW)).toBe('3 PM');
    expect(spokenTime(at(8, 15, 30), NOW)).toBe('3:30 PM');
    expect(spokenTime(at(9, 7), NOW)).toBe('7 AM tomorrow');
    expect(spokenTime(at(12, 0), NOW)).toBe('12 AM on 12 Oct');
    expect(awayMessage('In a meeting', at(8, 15), NOW)).toBe('In a meeting until 3 PM');
    expect(awayMessage(' Travelling ', null, NOW)).toBe('Travelling');
  });
});

describe('languages', () => {
  test('toggle adds at the end and never removes the last one', () => {
    expect(toggleLanguage(['en', 'te'], 'hi')).toEqual(['en', 'te', 'hi']);
    expect(toggleLanguage(['en', 'te'], 'en')).toEqual(['te']);
    expect(toggleLanguage(['te'], 'te')).toEqual(['te']);
  });

  test('move swaps with a neighbour and stops at the ends', () => {
    const list = ['en', 'hi', 'te'];
    expect(moveLanguage(list, 'te', -1)).toEqual(['en', 'te', 'hi']);
    expect(moveLanguage(list, 'en', -1)).toBe(list);
    expect(moveLanguage(list, 'te', 1)).toBe(list);
    expect(moveLanguage(list, 'ta', 1)).toBe(list);
  });
});

describe('onboarding', () => {
  test('steps run welcome -> connect -> ... -> done', () => {
    expect(ONBOARDING_STEPS[0]).toBe('index');
    expect(nextStep('index')).toBe('connect');
    expect(nextStep('voice')).toBe('done');
    expect(nextStep('done')).toBeNull();
    expect(stepHref('index')).toBe('/onboarding');
    expect(stepHref('names')).toBe('/onboarding/names');
  });
});

describe('greeting', () => {
  test('matches the opening line the server speaks', () => {
    expect(greetingLine('arjun', 'Ava')).toBe("Hi, this is Ava, arjun's assistant. Arjun can't take the call right now. How can I help?");
    expect(greetingLine(' ', '')).toBe("Hi, this is the assistant, the owner's assistant. The owner can't take the call right now. How can I help?");
  });
});

describe('caller name', () => {
  test('a saved name wins, else the number is spaced for reading', () => {
    expect(callerName({ contact_name: 'Amma', number: '+919848012345' })).toBe('Amma');
    expect(callerName({ contact_name: '', number: '+919848012345' })).toBe('+91 98480 12345');
    expect(callerName({ contact_name: '', number: '' })).toBe('Unknown caller');
  });
});

describe('engine name', () => {
  test('known engines get their proper names, others are capitalised', () => {
    expect(engineName('kokoro')).toBe('Kokoro');
    expect(engineName('mms')).toBe('MMS');
    expect(engineName('parler')).toBe('Parler');
  });
});

describe('dialer name', () => {
  test('says how outbound calls are placed', () => {
    expect(dialerName('bluetooth')).toBe('Bluetooth phone');
    expect(dialerName('none')).toBe('Not set up');
    expect(dialerName('custom')).toBe('Custom');
  });
});
