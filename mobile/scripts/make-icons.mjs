#!/usr/bin/env node
// Draws the app icon, Android adaptive icon layers, splash mark and favicon
// into assets/. The mark is a receptionist's headset (Ionicons "headset", the
// Assistant tab's icon) in white on the indigo of the Today hero.
//
//   npm run icons
//
// Needs Playwright with Chromium, found the same way as scripts/screenshots.mjs
// (PLAYWRIGHT_MODULE, PLAYWRIGHT_BROWSERS_PATH).

import { Buffer } from 'node:buffer';
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { loadPlaywright } from './playwright.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const VENDOR = join(ROOT, 'node_modules/@expo/vector-icons/build/vendor/react-native-vector-icons');
const FONT = readFileSync(join(VENDOR, 'Fonts/Ionicons.ttf')).toString('base64');
const GLYPHS = JSON.parse(readFileSync(join(VENDOR, 'glyphmaps/Ionicons.json'), 'utf8'));

// Brand colours: the light theme's hero gradient (lib/design/palette.ts).
const FROM = '#5B54F0';
const TO = '#2E2A8F';

/**
 * Each asset: canvas size, whether to fill the gradient, the tile (a rounded
 * square of the gradient, as a fraction of the canvas), and the mark's size,
 * all as fractions of the canvas. Monochrome icons are masks: only the
 * mark's shape counts.
 */
const ASSETS = [
  { file: 'icon.png', size: 1024, fill: true, mark: 0.5 },
  { file: 'android-icon-background.png', size: 512, fill: true, mark: 0 },
  // Adaptive icons show the middle 72 of 108 dp and mask it to a launcher shape.
  { file: 'android-icon-foreground.png', size: 512, fill: false, mark: 0.36 },
  { file: 'android-icon-monochrome.png', size: 432, fill: false, mark: 0.36 },
  // Android 12+ shows the splash image inside a circle two thirds its width.
  { file: 'splash-icon.png', size: 1024, fill: false, tile: 0.46, mark: 0.24 },
  { file: 'favicon.png', size: 48, fill: false, tile: 1, mark: 0.56 },
];

/** Runs in the page: draws one asset and returns it as a PNG data URL. */
function draw({ size, fill, tile, mark, from, to, char }) {
  const c = document.createElement('canvas');
  c.width = c.height = size;
  const ctx = c.getContext('2d');
  const gradient = (x, y, w) => {
    const g = ctx.createLinearGradient(x, y, x + w, y + w);
    g.addColorStop(0, from);
    g.addColorStop(1, to);
    return g;
  };
  if (fill) {
    ctx.fillStyle = gradient(0, 0, size);
    ctx.fillRect(0, 0, size, size);
  }
  if (tile) {
    const w = size * tile;
    const x = (size - w) / 2;
    ctx.fillStyle = gradient(x, x, w);
    ctx.beginPath();
    ctx.roundRect(x, x, w, w, w * 0.24);
    ctx.fill();
  }
  if (!mark) return c.toDataURL('image/png');

  // Draws a glyph with its ink (not its em box) centred on (cx, cy).
  const glyph = (ch, px, cx, cy) => {
    ctx.font = `${px}px Ionicons`;
    ctx.textAlign = 'left';
    ctx.textBaseline = 'alphabetic';
    const m = ctx.measureText(ch);
    const x = cx - (m.actualBoundingBoxRight - m.actualBoundingBoxLeft) / 2;
    const y = cy - (m.actualBoundingBoxDescent - m.actualBoundingBoxAscent) / 2;
    ctx.fillText(ch, x, y);
  };
  ctx.fillStyle = '#FFFFFF';
  glyph(char, size * mark, size / 2, size / 2);
  return c.toDataURL('image/png');
}

async function main() {
  const { chromium } = loadPlaywright();
  const browser = await chromium.launch();
  try {
    const page = await browser.newPage();
    await page.setContent(`<style>@font-face { font-family: Ionicons; src: url(data:font/ttf;base64,${FONT}); }</style><span style="font-family: Ionicons">x</span>`);
    await page.evaluate(() => document.fonts.load('64px Ionicons'));
    const char = String.fromCodePoint(GLYPHS.headset);
    for (const a of ASSETS) {
      const url = await page.evaluate(draw, { ...a, from: FROM, to: TO, char });
      writeFileSync(join(ROOT, 'assets', a.file), Buffer.from(url.split(',')[1], 'base64'));
      console.log(`assets/${a.file} (${a.size} x ${a.size})`);
    }
  } finally {
    await browser.close();
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
