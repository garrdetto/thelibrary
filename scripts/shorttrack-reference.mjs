// Short Track Showdown reference recorder (Phase 1 of docs/shorttrack/PLAN.md): serves the built
// `public/` folder and drives the classic module through its `?record=1` hook.
//
//   pnpm build (or a learning-module build), then
//   node scripts/shorttrack-reference.mjs [--channel msedge|chrome] [--only fixtures,shots]
//                                         [--tracks prison,dirt] [--engine classic|next]
//
// fixtures: an all-AI race per track and AI level (seed 20261105, 19 AI plus the host car driven by the AI,
//   5 laps) written to modules-src/shorttrack/tests/fixtures/<track>-<level>.json: lap times per car and mean
//   speed per 2 m of track; the medium runs also carry the golden states (every car, every 0.5 s, first 3 laps).
// shots: the same race frozen at tick 2400 (20 s) by day and by night, chase camera, into docs/screenshots/shorttrack/ (WebP).
import { createServer } from 'node:http'
import { mkdirSync, writeFileSync } from 'node:fs'
import { readFile, stat } from 'node:fs/promises'
import { extname, join, normalize, resolve } from 'node:path'
import { chromium } from 'playwright'
import sharp from 'sharp'

const args = process.argv.slice(2)
const option = (name, fallback) => {
  const index = args.indexOf(`--${name}`)
  return index === -1 ? fallback : args[index + 1]
}
const channel = option('channel', undefined)
const only = new Set(option('only', 'fixtures,shots').split(','))
const engine = option('engine', 'classic')
const tracks = option('tracks', 'prison,bullring,dells,dellswide,dirt').split(',')
const levels = ['easy', 'medium', 'hard']
const SEED = 20261105
const root = resolve(import.meta.dirname, '../public')
const fixtureDir = resolve(import.meta.dirname, '../modules-src/shorttrack/tests/fixtures')
const shotDir = resolve(import.meta.dirname, '../docs/screenshots/shorttrack')
const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.wasm': 'application/wasm', '.webp': 'image/webp', '.png': 'image/png', '.bin': 'application/octet-stream', '.glb': 'model/gltf-binary', '.woff2': 'font/woff2' }

// Lap-record baselines (seconds) used for the AI lap targets: the live top-20 Time Attack average, fetched once
// on 2026-11-05 when the fixtures were first recorded, frozen here so reruns stay identical.
const BASELINES = { prison: 11.666, bullring: 13.708, dells: 12.812, dellswide: 12.317, dirt: 15.138 }

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

const browser = await chromium.launch({ channel, args: ['--enable-unsafe-webgpu', '--ignore-gpu-blocklist'] })
const failures = []

async function open(query) {
  const page = await browser.newPage({ viewport: { width: 1280, height: 720 } })
  const errors = []
  page.on('pageerror', (error) => errors.push(error.message))
  page.on('console', (msg) => msg.type() === 'error' && !/\/api\/|Failed to load resource/.test(msg.text()) && errors.push(msg.text()))
  await page.goto(`${base}?${query}`, { waitUntil: 'load' })
  return { page, errors }
}

function summary(result) {
  const all = Object.values(result.laps).flat()
  const mean = all.reduce((a, b) => a + b, 0) / Math.max(1, all.length)
  return { laps: all.length, mean: +mean.toFixed(3), best: +Math.min(...all).toFixed(3) }
}

if (only.has('fixtures')) {
  mkdirSync(fixtureDir, { recursive: true })
  for (const track of tracks) {
    for (const diff of levels) {
      const { page, errors } = await open(`track=${track}&record=1&engine=classic`)
      await page.waitForFunction(() => typeof window.__stsRecord === 'function', null, { timeout: 60000 })
      const result = await page.evaluate((o) => window.__stsRecord(o), { seed: SEED, diff, ai: 19, laps: 5, base: BASELINES[track], veh: 'truck', golden: diff === 'medium' ? 60 : 0 })
      writeFileSync(join(fixtureDir, `${track}-${diff}.json`), JSON.stringify(result))
      const s = summary(result)
      console.log(`${track} ${diff}: ${result.meta.ticks} ticks, phase ${result.meta.phase}, ${s.laps} laps, mean ${s.mean}s, best ${s.best}s, ${result.states.length} golden frames`)
      if (errors.length) failures.push(`${track} ${diff}: ${errors.join(' | ')}`)
      await page.close()
    }
  }
}

if (only.has('shots')) {
  mkdirSync(shotDir, { recursive: true })
  for (const track of tracks) {
    for (const night of [false, true]) {
      const { page, errors } = await open(`track=${track}&record=1&engine=${engine}${night ? '&night=1' : ''}`)
      await page.waitForFunction(() => typeof window.__stsRecord === 'function', null, { timeout: 60000 })
      await page.evaluate((o) => window.__stsRecord(o), { seed: SEED, diff: 'medium', ai: 19, laps: 5, base: BASELINES[track], veh: 'truck', stop: 2400 })
      await page.waitForTimeout(5000)
      const file = join(shotDir, `${engine}-${track}-${night ? 'night' : 'day'}.webp`)
      await sharp(await page.screenshot()).webp({ quality: 88 }).toFile(file)
      console.log(`shot ${file}`)
      if (errors.length) failures.push(`${track} ${night ? 'night' : 'day'}: ${errors.join(' | ')}`)
      await page.close()
    }
  }
}

await browser.close()
server.close()
if (failures.length) {
  console.error(failures.join('\n'))
  process.exit(1)
}
