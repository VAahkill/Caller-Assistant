// Finds Playwright for the screenshot and icon scripts. It is not a project
// dependency (it brings its own browsers), so point PLAYWRIGHT_MODULE at an
// install if it is not at the default path, and PLAYWRIGHT_BROWSERS_PATH at
// its browsers.
import { existsSync } from 'node:fs';
import { createRequire } from 'node:module';

export function loadPlaywright() {
  const dir = process.env.PLAYWRIGHT_MODULE ?? '/opt/node-tools/node_modules/playwright';
  if (!process.env.PLAYWRIGHT_BROWSERS_PATH && existsSync('/opt/pw-browsers')) process.env.PLAYWRIGHT_BROWSERS_PATH = '/opt/pw-browsers';
  const require = createRequire(import.meta.url);
  try {
    return require(existsSync(dir) ? dir : 'playwright');
  } catch (e) {
    throw new Error(`Playwright not found. Set PLAYWRIGHT_MODULE to its folder. (${e.message})`);
  }
}
