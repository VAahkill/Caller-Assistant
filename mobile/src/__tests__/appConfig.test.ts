/// <reference types="node" />
// (Node types come with jest; this test reads app.json and font files from disk.)

// The native config that the app code relies on but cannot check at run time.

import { existsSync } from 'fs';
import { basename, join } from 'path';

import { dark, light } from '../lib/design/palette';
import { fonts } from '../lib/design/tokens';

const ROOT = join(__dirname, '..', '..');
const app = require('../../app.json').expo as {
  plugins: (string | [string, Record<string, unknown>])[];
  android: { adaptiveIcon: Record<string, string>; permissions: string[]; blockedPermissions: string[] };
};

const plugin = (name: string) => {
  const entry = app.plugins.find((p) => (Array.isArray(p) ? p[0] : p) === name);
  return Array.isArray(entry) ? entry[1] : undefined;
};

test('the splash is the app background in each scheme, so opening has no white flash', () => {
  const splash = plugin('expo-splash-screen') as { backgroundColor: string; image: string; dark: { backgroundColor: string; image: string } };
  expect(splash.backgroundColor).toBe(light.bg);
  expect(splash.dark.backgroundColor).toBe(dark.bg);
  expect(existsSync(join(ROOT, splash.image))).toBe(true);
  expect(existsSync(join(ROOT, splash.dark.image))).toBe(true);
});

test('Android embeds exactly the Inter files whose names the Text styles use', () => {
  const embedded = (plugin('expo-font') as { fonts: string[] }).fonts;
  for (const f of embedded) expect(existsSync(join(ROOT, f))).toBe(true);
  // An embedded font's family name is its file name.
  const families = embedded.map((f) => basename(f, '.ttf')).sort();
  expect(families).toEqual([...new Set(Object.values(fonts))].sort());
});

test('the adaptive icon layers exist', () => {
  for (const key of ['foregroundImage', 'backgroundImage', 'monochromeImage']) {
    expect(existsSync(join(ROOT, app.android.adaptiveIcon[key]))).toBe(true);
  }
});

test('Android asks only for what the app uses: contacts are read, never changed', () => {
  expect(app.android.permissions).toEqual(expect.arrayContaining(['READ_CONTACTS', 'RECORD_AUDIO', 'POST_NOTIFICATIONS']));
  // expo-contacts adds WRITE_CONTACTS ("modify your contacts"); it asks for it only when the manifest has it.
  expect(app.android.blockedPermissions).toContain('android.permission.WRITE_CONTACTS');
  expect(app.android.permissions).not.toContain('WRITE_CONTACTS');
});
