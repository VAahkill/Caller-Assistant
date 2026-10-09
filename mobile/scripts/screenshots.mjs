#!/usr/bin/env node
// Screenshots of every screen, dark and light, at the owner's phone size
// (412 x 915 dp, OnePlus 11R), for design review without an Android device.
//
// It exports the web build in mock mode (EXPO_PUBLIC_OPENCALL_MOCK=1, an
// in-memory v2 server with demo data, so no backend is needed), serves it,
// and drives Chromium with Playwright.
//
//   npm run screenshots                     # export, then shoot every route
//   npm run screenshots -- --no-export      # reuse dist-web/
//   npm run screenshots -- --only=voices,location --scheme=dark
//
// Needs Playwright with Chromium. Set PLAYWRIGHT_MODULE to its folder if it is
// not installed in this project (default: /opt/node-tools/node_modules/playwright)
// and PLAYWRIGHT_BROWSERS_PATH to where its browsers are.
//
// Output: screenshots/<scheme>/<name>[-2,-3].png (one per screenful of a long
// page) and screenshots/report.json with console errors per screen. Requests
// that leave this machine are blocked and counted. Exits 1 if a screen threw
// an uncaught error.
//
// Android draws Telugu, Hindi and Tamil with its Noto fonts. A machine without
// them shows those scripts unshaped; point INDIC_FONTS_DIR at a folder with
// noto-sans-{telugu,devanagari,tamil}-*-{400,500,600,700}-normal.woff2 (from
// the @fontsource packages) and they are used the same way, as fallbacks.

import { spawnSync } from 'node:child_process';
import { createReadStream, existsSync, mkdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { dirname, extname, join, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';

import { loadPlaywright } from './playwright.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const DIST = join(ROOT, 'dist-web');
const OUT = join(ROOT, 'screenshots');
const VIEWPORT = { width: 412, height: 915 };

// Every route in src/app, plus a few states reached by tapping.
const SHOTS = [
  { name: 'today', path: '/' },
  { name: 'inbox', path: '/inbox' },
  { name: 'inbox-calls', path: '/inbox', tap: 'Calls' },
  { name: 'call-for-me', path: '/tasks' },
  { name: 'assistant', path: '/assistant' },
  { name: 'settings', path: '/settings' },
  { name: 'call-live', path: '/call/call-live-swiggy' },
  { name: 'call-ended', path: '/call/call-rajesh' },
  { name: 'call-scam', path: '/call/call-kyc' },
  { name: 'today-server', path: '/', tap: 'Connected · everything ready' },
  { name: 'call-live-reply', path: '/call/call-live-swiggy', tap: ['Yes, that works'], wait: 2500 },
  { name: 'chat', path: '/chat' },
  { name: 'chat-reply', path: '/chat', tap: ['Call Paradise and book a table for 4 at 8'], wait: 2500 },
  { name: 'practice', path: '/practice' },
  { name: 'practice-live', path: '/practice', tap: 'Start practice call', wait: 3500 },
  { name: 'practice-chat', path: '/practice', tap: ['Start practice call', 'Hi, I have a Swiggy order for you. Where should I come?'], wait: 4500 },
  { name: 'voices', path: '/voices' },
  { name: 'voices-record', path: '/voices', tap: 'Record another voice' },
  { name: 'instructions', path: '/instructions' },
  { name: 'instructions-off', path: '/instructions', tap: 'Off' },
  { name: 'instructions-edit', path: '/instructions', tap: 'New instruction' },
  { name: 'instructions-date', path: '/instructions', tap: ['New instruction', 'Pick a date'] },
  { name: 'instructions-numbers', path: '/instructions', tap: ['New instruction', 'Specific numbers'] },
  { name: 'instructions-ideas', path: '/instructions', tap: 'Ideas' },
  { name: 'notes', path: '/notes' },
  { name: 'notes-edit', path: '/notes', tap: 'New note' },
  { name: 'location', path: '/location' },
  { name: 'persona', path: '/persona' },
  { name: 'languages', path: '/languages' },
  { name: 'screening', path: '/screening' },
  { name: 'screening-add', path: '/screening', tap: 'Add' },
  { name: 'away', path: '/away' },
  { name: 'onboarding-welcome', path: '/onboarding' },
  { name: 'onboarding-connect', path: '/onboarding/connect' },
  { name: 'onboarding-names', path: '/onboarding/names' },
  { name: 'onboarding-region', path: '/onboarding/region' },
  { name: 'onboarding-contacts', path: '/onboarding/contacts' },
  { name: 'onboarding-voice', path: '/onboarding/voice' },
  { name: 'onboarding-done', path: '/onboarding/done' },
  { name: 'gallery', path: '/gallery' },
];

const args = new Map(
  process.argv.slice(2).map((a) => {
    const [k, v] = a.replace(/^--/, '').split('=');
    return [k, v ?? true];
  }),
);
const only = typeof args.get('only') === 'string' ? new Set(args.get('only').split(',')) : null;
const schemes = typeof args.get('scheme') === 'string' ? [args.get('scheme')] : ['dark', 'light'];
const maxParts = Number(args.get('parts') ?? 4);

function exportWeb() {
  console.log('Exporting the web build in mock mode...');
  const r = spawnSync('npx', ['expo', 'export', '--platform', 'web', '--output-dir', 'dist-web'], {
    cwd: ROOT,
    stdio: 'inherit',
    env: { ...process.env, CI: '1', EXPO_PUBLIC_OPENCALL_MOCK: '1' },
  });
  if (r.status !== 0) throw new Error(`expo export failed (exit ${r.status})`);
}

const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.png': 'image/png', '.ttf': 'font/ttf', '.woff2': 'font/woff2', '.ico': 'image/x-icon' };

const FONTS_DIR = process.env.INDIC_FONTS_DIR;
const INDIC = [
  { file: 'noto-sans-telugu-telugu', range: 'U+0C00-0C7F, U+200C-200D, U+25CC' },
  { file: 'noto-sans-devanagari-devanagari', range: 'U+0900-097F, U+1CD0-1CFF, U+A8E0-A8FF, U+200C-200D, U+25CC' },
  { file: 'noto-sans-tamil-tamil', range: 'U+0B80-0BFF, U+200C-200D, U+25CC' },
];
const WEIGHTS = { Inter_400Regular: 400, Inter_500Medium: 500, Inter_600SemiBold: 600, Inter_700Bold: 700 };

/** @font-face rules that add the Indic scripts to each Inter family the app uses, as Android's fallback does. */
function indicFontCss() {
  if (!FONTS_DIR) return '';
  const rules = [];
  for (const [family, weight] of Object.entries(WEIGHTS)) {
    for (const f of INDIC) {
      const file = `${f.file}-${weight}-normal.woff2`;
      if (!existsSync(join(FONTS_DIR, file))) throw new Error(`INDIC_FONTS_DIR has no ${file}`);
      rules.push(`@font-face{font-family:'${family}';src:url('/__fonts/${file}') format('woff2');unicode-range:${f.range};font-display:block}`);
    }
  }
  return rules.join('\n');
}

/** A static server with single-page fallback, so deep links load index.html. */
function serve() {
  const server = createServer((req, res) => {
    const url = decodeURIComponent((req.url ?? '/').split('?')[0]);
    if (FONTS_DIR && url.startsWith('/__fonts/')) {
      const font = normalize(join(FONTS_DIR, url.slice('/__fonts/'.length)));
      if (font.startsWith(FONTS_DIR) && existsSync(font)) {
        res.writeHead(200, { 'Content-Type': 'font/woff2' });
        createReadStream(font).pipe(res);
        return;
      }
    }
    let file = normalize(join(DIST, url));
    if (!file.startsWith(DIST) || !existsSync(file) || statSync(file).isDirectory()) file = join(DIST, 'index.html');
    res.writeHead(200, { 'Content-Type': TYPES[extname(file)] ?? 'application/octet-stream' });
    createReadStream(file).pipe(res);
  });
  return new Promise((resolve) => server.listen(0, '127.0.0.1', () => resolve(server)));
}

/** Scrolls the page's main scroll view one screenful; false at the bottom. */
async function scrollOnce(page) {
  return page.evaluate(() => {
    const all = [...document.querySelectorAll('div')].filter((el) => {
      const s = getComputedStyle(el);
      return (s.overflowY === 'auto' || s.overflowY === 'scroll') && el.scrollHeight > el.clientHeight + 8 && el.clientHeight > 200;
    });
    // An open sheet is rendered after the screen, so the last one in the
    // document is the one in front.
    const el = all[all.length - 1];
    if (!el || el.scrollTop + el.clientHeight >= el.scrollHeight - 4) return false;
    el.scrollTop += Math.round(el.clientHeight * 0.8);
    return true;
  });
}

async function main() {
  if (!args.get('no-export')) exportWeb();
  if (!existsSync(join(DIST, 'index.html'))) throw new Error('No dist-web/index.html. Run without --no-export.');
  const { chromium } = loadPlaywright();
  const server = await serve();
  const base = `http://127.0.0.1:${server.address().port}`;
  const browser = await chromium.launch();
  const fontCss = indicFontCss();
  const report = {};
  let crashed = false;
  try {
    for (const scheme of schemes) {
      const dir = join(OUT, scheme);
      rmSync(dir, { recursive: true, force: true });
      mkdirSync(dir, { recursive: true });
      for (const shot of SHOTS.filter((s) => !only || only.has(s.name))) {
        const ctx = await browser.newContext({ viewport: VIEWPORT, deviceScaleFactor: 2, colorScheme: scheme, isMobile: true, hasTouch: true });
        // The demo data points recordings at a host that doesn't exist; block
        // everything off this machine so no screen waits on the network.
        let blocked = 0;
        await ctx.route(
          (url) => !url.href.startsWith(base) && !url.protocol.startsWith('data') && !url.protocol.startsWith('blob'),
          (route) => {
            blocked++;
            return route.abort('blockedbyclient');
          },
        );
        const page = await ctx.newPage();
        if (fontCss) {
          await page.addInitScript((css) => {
            document.addEventListener('DOMContentLoaded', () => {
              const style = document.createElement('style');
              style.textContent = css;
              document.head.appendChild(style);
            });
          }, fontCss);
        }
        const errors = [];
        page.on('pageerror', (e) => {
          crashed = true;
          errors.push(`uncaught: ${e.message}`);
        });
        page.on('console', (m) => m.type() === 'error' && !m.text().includes('ERR_BLOCKED_BY_CLIENT') && errors.push(m.text()));
        await page.goto(base + shot.path, { waitUntil: 'networkidle' });
        await page.waitForTimeout(1500);
        // One tap, or several in order (each waits for the screen to settle).
        for (const tap of shot.tap ? [shot.tap].flat() : []) {
          await page.getByText(tap, { exact: true }).last().click();
          await page.waitForTimeout(shot.wait ?? 900);
        }
        const files = [];
        for (let part = 1; part <= maxParts; part++) {
          const file = join(dir, `${shot.name}${part > 1 ? `-${part}` : ''}.png`);
          await page.screenshot({ path: file });
          files.push(file.slice(ROOT.length + 1));
          if (part === maxParts || !(await scrollOnce(page))) break;
          await page.waitForTimeout(250);
        }
        report[`${scheme}/${shot.name}`] = { files, errors: [...new Set(errors)], blockedRequests: blocked };
        console.log(`${scheme.padEnd(5)} ${shot.name.padEnd(22)} ${files.length} shot(s)${errors.length ? `, ${errors.length} console error(s)` : ''}`);
        await ctx.close();
      }
    }
  } finally {
    await browser.close();
    server.close();
  }
  writeFileSync(join(OUT, 'report.json'), JSON.stringify(report, null, 2));
  const withErrors = Object.entries(report).filter(([, r]) => r.errors.length);
  for (const [name, r] of withErrors) console.log(`\n${name}:\n  ${r.errors.slice(0, 5).join('\n  ')}`);
  console.log(`\nSaved to ${OUT}`);
  if (crashed) process.exit(1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
