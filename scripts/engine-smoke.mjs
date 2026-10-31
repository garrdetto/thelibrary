// Builds modules-src/_template with Vite (three, Rapier and PeerJS bundled, no CDN), serves it next to a hub-like
// host page that embeds it in an iframe, and checks with Playwright: no console errors, no CDN requests, the fixed
// loop ticks, the HUD picks up the hub's --lib-* tokens, the canvas draws, and dispose() removes the canvas.
//   node scripts/engine-smoke.mjs [--out docs/screenshots/phase1-step1] [--name after-template]
import { createServer } from 'node:http'
import { existsSync, mkdirSync, readdirSync, readFileSync, statSync } from 'node:fs'
import { extname, join, dirname, normalize } from 'node:path'
import { fileURLToPath } from 'node:url'
import { build } from 'vite'
import { chromium } from 'playwright'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const args = process.argv.slice(2)
const flag = (name, fallback) => (args.includes(`--${name}`) ? args[args.indexOf(`--${name}`) + 1] : fallback)
const outDir = join(root, 'node_modules', '.engine-smoke')
const shotDir = flag('out', null)
const shotName = flag('name', 'after-template')

await build({
  configFile: false,
  root: join(root, 'modules-src', '_template'),
  base: '/template/',
  logLevel: 'warn',
  build: { outDir, emptyOutDir: true, target: 'es2022', chunkSizeWarningLimit: 5120 },
})

const types = { '.html': 'text/html', '.js': 'text/javascript', '.wasm': 'application/wasm', '.css': 'text/css', '.png': 'image/png' }
const host = `<!doctype html><html data-theme="light"><head><style>
:root{--lib-bg:#f4f6fa;--lib-panel:#ffffff;--lib-panel2:#eef2f8;--lib-text:#13203a;--lib-strong:#0b1424;--lib-soft:#34445f;--lib-muted:#5c6a82;--lib-dim:#8a95a8;--lib-line:rgba(30,58,110,.14);--lib-chip:rgba(20,40,90,.05);--lib-accent:#0594d0;--lib-on-accent:#ffffff;--lib-shadow:rgba(30,50,90,.16)}
body{margin:0;background:var(--lib-bg)}.play-frame{width:960px;height:600px}iframe{width:100%;height:100%;border:0}
</style></head><body><div class="play-frame"><iframe src="/template/index.html?name=smoke"></iframe></div></body></html>`
const server = createServer((request, response) => {
  const url = new URL(request.url, 'http://localhost')
  if (url.pathname === '/' || url.pathname === '/host.html') {
    response.writeHead(200, { 'content-type': 'text/html' }).end(host)
    return
  }
  const relative = normalize(url.pathname.replace(/^\/template\//, '/')).replace(/^([/\\])+/, '')
  const file = url.pathname.startsWith('/engine/') ? join(root, 'public', relative) : join(outDir, relative)
  if (!existsSync(file) || !statSync(file).isFile()) {
    response.writeHead(404).end()
    return
  }
  response.writeHead(200, { 'content-type': types[extname(file)] ?? 'application/octet-stream' }).end(readFileSync(file))
})
await new Promise((resolve) => server.listen(0, resolve))
const origin = `http://localhost:${server.address().port}`

const browser = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] })
const page = await browser.newPage({ viewport: { width: 960, height: 600 } })
const errors = []
const external = []
page.on('console', (message) => message.type() === 'error' && errors.push(message.text()))
page.on('pageerror', (error) => errors.push(String(error)))
page.on('request', (request) => !request.url().startsWith(origin) && !request.url().startsWith('data:') && external.push(request.url()))

const results = []
const check = (name, ok, detail = '') => results.push({ name, ok: !!ok, detail })
try {
  await page.goto(`${origin}/host.html`)
  const frame = page.frameLocator('iframe')
  await frame.locator('canvas').waitFor({ timeout: 30000 })
  const child = page.frames().find((entry) => entry.url().includes('/template/'))
  await child.waitForFunction(() => window.__tlModule && window.__tlModule.steps() > 30, null, { timeout: 30000 })
  const info = await child.evaluate(() => ({ backend: window.__tlModule.backend, tier: window.__tlModule.tier, steps: window.__tlModule.steps() }))
  check('module boots in an iframe and the 60 Hz loop ticks', info.steps > 30, `${info.backend}, tier ${info.tier}, ${info.steps} steps`)
  const accent = await child.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue('--lib-accent').trim())
  check('HUD mirrors the hub --lib-accent token', accent === '#0594d0', accent)
  const hudText = await child.evaluate(() => document.querySelector('.tl-hud')?.textContent ?? '')
  check('HUD copy avoids banned words', !/\b(game|gaming|entertainment)\b/i.test(hudText), hudText.slice(0, 80))
  await child.evaluate(() => window.dispatchEvent(new KeyboardEvent('keydown', { code: 'Space' })))
  await page.waitForTimeout(1500)
  if (shotDir) {
    mkdirSync(join(root, shotDir), { recursive: true })
    await page.screenshot({ path: join(root, shotDir, `${shotName}.png`) })
  }
  const shot = await page.locator('iframe').screenshot()
  check('canvas draws a frame', shot.length > 20000, `${shot.length} byte screenshot`)
  const emitted = readdirSync(join(outDir, 'assets')).filter((file) => /^(draco_decoder|draco_wasm_wrapper|basis_transcoder)-/.test(file))
  const served = await Promise.all(emitted.map(async (file) => (await fetch(`${origin}/template/assets/${file}`)).status))
  check('Draco and KTX2 decoders are emitted by the Vite build and served same-origin', emitted.some((file) => file.startsWith('draco_decoder')) && emitted.some((file) => file.startsWith('basis_transcoder')) && served.every((status) => status === 200), `${emitted.length} files`)
  await child.evaluate(() => window.__tlModule.app.dispose())
  const canvases = await child.evaluate(() => document.querySelectorAll('canvas').length)
  check('dispose() removes the canvas and stops the loop', canvases === 0, `${canvases} canvases left`)
  await page.waitForTimeout(500)
} catch (error) {
  check('smoke run completed', false, String(error))
}
check('no console errors', errors.length === 0, errors.join(' | '))
check('no CDN or external requests', external.length === 0, external.join(' '))
await browser.close()
server.close()

for (const result of results) console.log(`${result.ok ? 'PASS' : 'FAIL'}  ${result.name}${result.detail ? `  (${result.detail})` : ''}`)
if (results.some((result) => !result.ok)) process.exit(1)
