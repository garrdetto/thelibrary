// Short Track Showdown play check: serves the built `public/` folder and drives the real page loop with
// `?autopilot=1` (the AI steers the player's car). Each track: a solo race through the menus to two
// completed laps. Then a two-tab online race over PeerJS (host opens a room, the guest joins with `?room=`)
// until both tabs have completed a lap. Fails on page errors, a stalled race or a guest that never races.
//
//   pnpm build (or a learning-module build), then
//   node scripts/shorttrack-play.mjs [--channel msedge|chrome] [--tracks prison,dirt] [--engine classic] [--no-online]
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
const engine = option('engine', 'classic')
const tracks = option('tracks', 'prison,bullring,dells,dellswide,dirt').split(',')
const online = !args.includes('--no-online')
const root = resolve(import.meta.dirname, '../public')
const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.wasm': 'application/wasm', '.webp': 'image/webp', '.png': 'image/png', '.bin': 'application/octet-stream', '.glb': 'model/gltf-binary', '.woff2': 'font/woff2' }

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
const base = `http://127.0.0.1:${server.address().port}/modules/shorttrack.html`
const browser = await chromium.launch({ channel, args: ['--enable-unsafe-webgpu', '--ignore-gpu-blocklist', '--autoplay-policy=no-user-gesture-required'] })
const failures = []

async function open(query) {
  const page = await browser.newPage({ viewport: { width: 1280, height: 720 } })
  const errors = []
  page.on('pageerror', (error) => errors.push(error.message))
  page.on('console', (msg) => msg.type() === 'error' && !/\/api\/|Failed to load resource|peerjs|WebSocket/i.test(msg.text()) && errors.push(msg.text()))
  await page.goto(`${base}?${query}`, { waitUntil: 'load' })
  return { page, errors }
}

const lapOf = (page) => page.evaluate(() => {
  const m = /LAP\s+(\d+)/i.exec(document.getElementById('lapTxt')?.textContent ?? '')
  return m ? Number(m[1]) : 0
})

async function clickVisible(page, acts) {
  for (const act of acts) {
    const button = page.locator(`[data-act="${act}"]:visible`).first()
    if (await button.count()) {
      await button.click()
      return act
    }
  }
  return null
}

async function waitForLap(page, lap, timeoutMs) {
  const end = Date.now() + timeoutMs
  let seen = 0
  while (Date.now() < end) {
    seen = await lapOf(page)
    if (seen >= lap) return seen
    await page.waitForTimeout(1000)
  }
  return seen
}

for (const track of tracks) {
  const { page, errors } = await open(`track=${track}&autopilot=1&engine=${engine}`)
  await clickVisible(page, ['flow:solo'])
  for (let i = 0; i < 6 && (await page.locator('#hud:not(.hidden)').count()) === 0; i++) {
    await clickVisible(page, ['track-next', 'setup-next', 'start'])
    await page.waitForTimeout(600)
  }
  const started = Date.now()
  const lap = await waitForLap(page, 3, 150000)
  const ok = lap >= 3
  console.log(`${track}: ${ok ? 'two laps done' : `stalled on lap ${lap}`} in ${((Date.now() - started) / 1000).toFixed(0)} s`)
  if (!ok) failures.push(`${track}: race stalled on lap ${lap}`)
  if (errors.length) failures.push(`${track}: ${errors.join(' | ')}`)
  await page.close()
}

if (online) {
  const host = await open(`track=prison&autopilot=1&engine=${engine}`)
  await clickVisible(host.page, ['flow:multi'])
  await clickVisible(host.page, ['multi-host'])
  for (const act of ['track-next', 'setup-next']) {
    await host.page.waitForTimeout(600)
    await clickVisible(host.page, [act])
  }
  const code = await host.page.waitForFunction(() => {
    const text = document.getElementById('codeTxt')?.textContent?.trim() ?? ''
    return /^[A-Z]{5}$/.test(text) ? text : null
  }, null, { timeout: 30000 }).then((handle) => handle.jsonValue()).catch(() => null)
  if (!code) failures.push('online: the host never opened a room (PeerJS unreachable?)')
  else {
    const guest = await open(`track=prison&autopilot=1&engine=${engine}&room=${code}`)
    const joined = await host.page.waitForFunction(() => document.querySelectorAll('#plist > div').length >= 2, null, { timeout: 30000 }).then(() => true).catch(() => false)
    if (!joined) failures.push(`online: the guest never reached room ${code}`)
    else {
      await clickVisible(host.page, ['start'])
      const [hostLap, guestLap] = await Promise.all([waitForLap(host.page, 2, 120000), waitForLap(guest.page, 2, 120000)])
      const rows = await guest.page.evaluate(() => document.querySelectorAll('#board .row').length)
      console.log(`online room ${code}: host lap ${hostLap}, guest lap ${guestLap}, guest board ${rows} cars`)
      if (hostLap < 2 || guestLap < 2) failures.push(`online: host lap ${hostLap}, guest lap ${guestLap}`)
    }
    if (guest.errors.length) failures.push(`online guest: ${guest.errors.join(' | ')}`)
    await guest.page.close()
  }
  if (host.errors.length) failures.push(`online host: ${host.errors.join(' | ')}`)
  await host.page.close()
}

await browser.close()
server.close()
if (failures.length) {
  console.error(failures.join('\n'))
  process.exit(1)
}
