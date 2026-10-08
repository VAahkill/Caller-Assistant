/// <reference types="node" />
// (Node types come with jest; this test reads the source files from disk.)

// Icons come from Ionicons only. Emoji and symbol characters render
// differently on every phone (or as boxes) and TalkBack reads them oddly, so
// none may appear in app code. Text punctuation such as "·" and "…" is fine.

import { readdirSync, readFileSync, statSync } from 'fs';
import { join, relative } from 'path';

const SRC = join(__dirname, '..');

// Arrows, technical symbols, enclosed numbers, shapes, dingbats, misc symbols,
// emoji, the emoji variation selector, and the bullet.
const BANNED = /[•←-⇿⌀-⏿①-⓿■-➿⤀-⥿⬀-⯿️]|[\u{1F000}-\u{1FAFF}]/u;

function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return name === '__tests__' || name === 'test' ? [] : sourceFiles(path);
    return /\.(ts|tsx)$/.test(name) ? [path] : [];
  });
}

test('the scan covers the app', () => {
  const files = sourceFiles(SRC).map((f) => relative(SRC, f));
  expect(files).toEqual(expect.arrayContaining(['app/(tabs)/_layout.tsx', 'components/ui/Button.tsx', 'lib/design/icons.tsx']));
});

test('no emoji or symbol characters are used as icons anywhere in the app', () => {
  const found: string[] = [];
  for (const file of sourceFiles(SRC)) {
    readFileSync(file, 'utf8')
      .split('\n')
      .forEach((line, i) => {
        const m = BANNED.exec(line);
        if (m) found.push(`${relative(SRC, file)}:${i + 1} U+${m[0].codePointAt(0)!.toString(16).toUpperCase()} ${line.trim()}`);
      });
  }
  expect(found).toEqual([]);
});

test('the pattern catches the glyphs the old screens used', () => {
  for (const glyph of ['✕', '\u{1F4CD}', '• ', '▶', '★', '→', '☎']) expect(BANNED.test(glyph)).toBe(true);
  for (const ok of ['Last synced 2 min ago · 312 numbers', 'Connecting…', 'Telugu తెలుగు', "It's “fine” – really"]) {
    expect(BANNED.test(ok)).toBe(false);
  }
});
