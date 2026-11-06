// Bush League Baseball smoke test: serves the built `public/` folder, opens the
// module on the WebGPU path and on the forced WebGL2 path (`?webgl`), and plays a
// three-inning contest to the final on each: one watched, one with the page
// pitching through the three-press meter and batting with the keyboard.
//
//   pnpm build (or a learning-module build), then
//   node scripts/bushleague-smoke.mjs [--channel msedge|chrome] [--out docs/screenshots/bushleague]
//
// Exit code 1 on any page error or a contest that does not reach the final.
import { createServer } from 'node:http'
import { readFile, stat } from 'node:fs/promises'
import { extname, join, normalize, resolve } from 'node:path'
import { chromium } from 'playwright'

const args = process.argv.slice(2)
const option = (name, fallback) => {
  const index = args.indexOf(`--${name}`)
  return index === -1 ? fallback : args[index + 1]
}
const channel = option('channel', undefined)
const out = option('out', null)
const root = resolve(import.meta.dirname, '../public')
const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.wasm': 'application/wasm', '.webp': 'image/webp', '.png': 'image/png' }

const server = createServer(async (request, response) => {
  const url = new URL(request.url ?? '/', 'http://localhost')
  let path = normalize(join(root, decodeURIComponent(url.pathname)))
  if (!path.startsWith(root)) return void response.writeHead(403).end()
  try {
    if ((await stat(path)).isDirectory()) path = join(path, 'index.html')
    response.writeHead(200, { 'content-type': types[extname(path)] ?? 'application/octet-stream' })
    response.end(await readFile(path))
  } catch {
    response.writeHead(404).end()
  }
})
await new Promise((done) => server.listen(0, '127.0.0.1', done))
const base = `http://127.0.0.1:${server.address().port}/modules/bushleague.html`

const browser = await chromium.launch({ channel, args: ['--enable-unsafe-webgpu'] })
let failed = false

async function run(label, query, side) {
  const page = await browser.newPage({ viewport: { width: 1280, height: 720 } })
  const errors = []
  page.on('console', (message) => { if (message.type() === 'error') errors.push(message.text()) })
  page.on('pageerror', (error) => errors.push(String(error)))
  await page.goto(`${base}${query}`)
  await page.waitForFunction(() => window.__tlModule && window.__bushleague, null, { timeout: 60_000 })
  const backend = await page.evaluate(() => window.__tlModule.backend)
  await page.evaluate(() => window.__tlModule.app.stop())
  const step = (seconds) => page.evaluate((s) => { const d = window.__bushleague.director; for (let t = 0; t < s; t += 1 / 30) d.update(1 / 30); return d.stage }, seconds)
  await page.evaluate((who) => window.__bushleague.start({ side: who, innings: 3, pace: 'rookie' }, 2026), side)
  let guard = 0
  while (guard++ < 3000) {
    const stage = await page.evaluate(() => window.__bushleague.director.stage)
    if (stage === 'final') break
    if (stage === 'aim') {
      for (const wait of [0.7, 0.55, 0.1]) {
        await page.keyboard.press('Space')
        await step(wait)
      }
      continue
    }
    if (stage === 'flight' && guard % 2) await page.keyboard.press('Space')
    await step(0.3)
  }
  const result = await page.evaluate(() => {
    const contest = window.__bushleague.contest()
    return { stage: window.__bushleague.director.stage, inning: contest.inning, score: contest.score, pitches: contest.pitchCount, finalCard: !document.getElementById('screen-final').hidden }
  })
  if (out) {
    await page.evaluate(() => window.__tlModule.app.renderOnce())
    await page.screenshot({ path: join(out, `smoke-${label}.png`) })
  }
  const ownErrors = errors.filter((text) => !/favicon|404/.test(text))
  const ok = result.stage === 'final' && result.finalCard && result.inning >= 3 && ownErrors.length === 0
  if (!ok) failed = true
  console.log(`${ok ? 'ok' : 'FAIL'} ${label}: ${backend}, final ${result.score.join('-')} after ${result.inning} innings, ${result.pitches} pitches${ownErrors.length ? `, errors: ${ownErrors.join(' | ')}` : ''}`)
  await page.close()
}

try {
  await run('webgpu-watch', '', 'watch')
  await run('webgl2-home', '?webgl', 'home')
} finally {
  await browser.close()
  server.close()
}
process.exitCode = failed ? 1 : 0
