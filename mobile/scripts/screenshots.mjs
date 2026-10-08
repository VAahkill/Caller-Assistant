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
  { name: 'chat', path: '/chat' },
  { name: 'practice', path: '/practice' },
  { name: 'practice-live', path: '/practice', tap: 'Start practice call', wait: 3500 },
  { name: 'voices', path: '/voices' },
  { name: 'instructions', path: '/instructions' },
  { name: 'instructions-edit', path: '/instructions', tap: 'New instruction' },
  { name: 'instructions-ideas', path: '/instructions', tap: 'Ideas' },
  { name: 'notes', path: '/notes' },
  { name: 'location', path: '/location' },
  { name: 'persona', path: '/persona' },
  { name: 'languages', path: '/languages' },
  { name: 'screening', path: '/screening' },
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

const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.png': 'image/png', '.ttf': 'font/ttf', '.ico': 'image/x-icon' };

/** A static server with single-page fallback, so deep links load index.html. */
function serve() {
  const server = createServer((req, res) => {
    const url = decodeURIComponent((req.url ?? '/').split('?')[0]);
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
    // The visible sheet or screen: the last (topmost) of the largest ones.
    all.sort((a, b) => a.clientHeight - b.clientHeight);
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
        const errors = [];
        page.on('pageerror', (e) => {
          crashed = true;
          errors.push(`uncaught: ${e.message}`);
        });
        page.on('console', (m) => m.type() === 'error' && !m.text().includes('ERR_BLOCKED_BY_CLIENT') && errors.push(m.text()));
        await page.goto(base + shot.path, { waitUntil: 'networkidle' });
        await page.waitForTimeout(1500);
        if (shot.tap) {
          await page.getByText(shot.tap, { exact: true }).last().click();
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
