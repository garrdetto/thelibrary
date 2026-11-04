// Gate check for learning modules: builds are served with `vite preview`, every
// embedded module is opened inside the hub iframe (`/#module-<id>`), console
// errors and page errors are collected, and a screenshot of each module is saved.
//
//   node scripts/module-gate.mjs [--out docs/gate] [--port 4173] [--only id,id]
//
// Exit code 1 when any module reports an error. Requires a preview server to be
// running on the port (`pnpm preview --port 4173`) or starts one itself.
import { spawn } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { chromium } from 'playwright';

const args = process.argv.slice(2);
const option = (name, fallback) => {
  const index = args.indexOf(`--${name}`);
  return index === -1 ? fallback : args[index + 1];
};
const outDir = option('out', 'docs/gate');
const port = Number(option('port', '4173'));
const only = option('only', '')
  .split(',')
  .map((id) => id.trim())
  .filter(Boolean);
const settleMs = Number(option('settle', '6000'));

const moduleIds = ['sandlot3d', 'maplestreet', 'sandlot', 'botwreck', 'chess', 'checkers', '2048', 'helicopter', 'shorttrack', 'fairway'];
const targets = only.length ? moduleIds.filter((id) => only.includes(id)) : moduleIds;
const base = `http://localhost:${port}`;

// Third-party failures outside this site (fonts, CDNs blocked by a sandbox) and
// `/api/*` responses (preview has no D1 or KV bindings) are reported but never
// fail the gate; only errors from our own pages count.
const isOwnOrigin = (text) => !/https?:\/\/(?!localhost)/.test(text) && !/\/api\//.test(text);

async function serverUp() {
  try {
    const response = await fetch(`${base}/`);
    return response.ok;
  } catch {
    return false;
  }
}

async function ensureServer() {
  if (await serverUp()) return null;
  const child = spawn('pnpm', ['preview', '--port', String(port)], { stdio: 'ignore', detached: true });
  for (let i = 0; i < 60; i += 1) {
    await new Promise((resolve) => setTimeout(resolve, 1000));
    if (await serverUp()) return child;
  }
  child.kill();
  throw new Error(`preview server did not start on port ${port}`);
}

async function checkModule(browser, id) {
  const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
  const errors = [];
  const external = [];
  const record = (text, source) => (isOwnOrigin(text) ? errors : external).push(`${source}: ${text}`);
  page.on('console', (message) => {
    if (message.type() === 'error') record(`${message.text()} @ ${message.location().url}`, 'console');
  });
  page.on('pageerror', (error) => record(error.message, 'pageerror'));
  page.on('requestfailed', (request) => record(`${request.url()} ${request.failure()?.errorText ?? ''}`, 'request'));
  await page.goto(`${base}/#module-${id}`, { waitUntil: 'load' });
  const frame = await page.waitForSelector('.play-frame iframe', { timeout: 20000 }).catch(() => null);
  if (!frame) errors.push('hub: module iframe did not mount');
  await page.waitForTimeout(settleMs);
  const shot = join(outDir, `${id}.png`);
  await page.screenshot({ path: shot, timeout: 90000, animations: 'disabled', caret: 'initial' }).catch((error) => {
    external.push(`screenshot: ${error.message.split('\n')[0]}`);
  });
  await page.close().catch(() => {});
  return { id, errors, external, screenshot: shot };
}

mkdirSync(outDir, { recursive: true });
const server = await ensureServer();
const browser = await chromium.launch({ executablePath: process.env.PLAYWRIGHT_CHROME || undefined, args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
const results = [];
for (const id of targets) results.push(await checkModule(browser, id));
await browser.close();
if (server) process.kill(-server.pid);

const lines = [];
let failed = 0;
for (const result of results) {
  const ok = result.errors.length === 0;
  if (!ok) failed += 1;
  lines.push(`${ok ? 'PASS' : 'FAIL'} ${result.id} (${result.errors.length} errors, ${result.external.length} third-party notes) -> ${result.screenshot}`);
  for (const error of result.errors) lines.push(`    ${error}`);
  for (const note of result.external) lines.push(`    (external) ${note}`);
}
const report = lines.join('\n');
console.log(report);
writeFileSync(join(outDir, 'report.txt'), `${report}\n`);
process.exit(failed ? 1 : 0);
