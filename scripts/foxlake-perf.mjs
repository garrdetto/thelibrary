/**
 * Life Sim (Fox Lake) load, frame-time and leak probe. Loads the built page (public/modules/foxlake.html, solo mode) in
 * Chrome and reports:
 *
 * - load: when the map arrived, when the start button showed, when Montello finished building, the longest build slice;
 * - frames: p50 / p95 / p99 frame time, active meshes and draw calls at fixed Montello spots, standing and turning;
 * - memory: JS heap after a forced collection at each step, and Babylon's mesh, material, texture and geometry counts;
 * - leaks: the same counts after several laps between far-apart spots (the ground, trees and colliders stream in and out).
 *
 *   node scripts/foxlake-perf.mjs [baseUrl] [out.json]
 *
 * baseUrl serves public/ (default http://127.0.0.1:3040). Headless timings are noisy: compare runs with each other.
 */
import { chromium } from 'playwright'
import { writeFileSync } from 'node:fs'

const base = process.argv[2] ?? 'http://127.0.0.1:3040'
const out = process.argv[3] ?? null
const laps = Number(process.env.FOXLAKE_LAPS ?? 4)

/** Map coordinates (x east, z north, metres from City Hall); scene = (map.x - 4200, y, map.z - 6600). */
const SPOTS = [
  { name: 'main-street', map: [0, 0], facing: 1.2, hour: 15 },
  { name: 'downtown-north', map: [120, 260], facing: Math.PI, hour: 16 },
  { name: 'lake-dock', map: [34, 329], facing: -0.6, hour: 18 },
  { name: 'houses-west', map: [-700, 300], facing: 0.4, hour: 14 },
  { name: 'country-east', map: [2200, -600], facing: -1.7, hour: 13 },
  { name: 'night-downtown', map: [0, 0], facing: 1.2, hour: 21.5 },
]

const browser = await chromium.launch({ channel: 'chrome', headless: true, args: ['--enable-unsafe-webgpu', '--ignore-gpu-blocklist', '--use-angle=d3d11', '--js-flags=--expose-gc'] })
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } })
const cdp = await page.context().newCDPSession(page)
const errors = []
page.on('pageerror', (e) => errors.push(String(e)))
page.on('console', (m) => {
  if (m.type() === 'error' && !m.text().includes('404')) errors.push(m.text())
})

const t0 = Date.now()
const marks = {}
const mark = (k) => {
  if (!(k in marks)) marks[k] = (Date.now() - t0) / 1000
}
page.on('response', (r) => {
  if (/montello\.[0-9a-f.]*bin$/.test(r.url())) mark('mapBinResponse')
})
const profileDir = process.env.FOXLAKE_PROFILE ?? null
await cdp.send('Profiler.enable')
const startProfile = async () => {
  if (!profileDir) return
  await cdp.send('Profiler.setSamplingInterval', { interval: 500 })
  await cdp.send('Profiler.start')
}
const stopProfile = async (name) => {
  if (!profileDir) return null
  const { profile } = await cdp.send('Profiler.stop')
  writeFileSync(`${profileDir}/${name}.cpuprofile`, JSON.stringify(profile))
  const self = new Map()
  const dt = profile.timeDeltas
  const byId = new Map(profile.nodes.map((n) => [n.id, n]))
  for (let i = 0; i < profile.samples.length; i++) {
    const n = byId.get(profile.samples[i])
    const f = n.callFrame
    const key = `${f.functionName || '(anon)'} ${f.url.split('/').pop()}:${f.lineNumber + 1}`
    self.set(key, (self.get(key) ?? 0) + (dt[i] ?? 0) / 1000)
  }
  const top = [...self.entries()].sort((a, b) => b[1] - a[1]).slice(0, 30).map(([k, ms]) => `${Math.round(ms)} ms  ${k}`)
  console.log(`--- ${name} top self time\n${top.join('\n')}`)
  return top
}
await startProfile()
await page.goto(`${base}/modules/foxlake.html?solo=1&hour=15`, { waitUntil: 'load' })
mark('pageLoad')
const texts = []
const watchText = setInterval(() => {
  page.evaluate(() => document.getElementById('load-text')?.textContent ?? '').then((t) => {
    if (t && texts[texts.length - 1]?.text !== t) texts.push({ at: (Date.now() - t0) / 1000, text: t })
  }, () => {})
}, 150)
await page.waitForFunction(() => !document.getElementById('start')?.hidden, null, { timeout: 300000, polling: 200 })
mark('startButton')
clearInterval(watchText)
marks.loadSteps = texts
await stopProfile('load')
const heapMB = async () => {
  await cdp.send('HeapProfiler.collectGarbage')
  const { usedSize } = await cdp.send('Runtime.getHeapUsage')
  return Math.round(usedSize / 1048576)
}
const heapAtStart = await heapMB()
await page.evaluate(async () => {
  const wait = (ms) => new Promise((r) => setTimeout(r, ms))
  document.getElementById('start-btn').click()
  await wait(2500)
  ;[...document.querySelectorAll('button')].find((b) => b.textContent.trim() === 'Create character')?.click()
  await wait(1000)
})
await page.addStyleTag({ content: '#pause{display:none!important}' })
mark('playing')
await startProfile()
await page.waitForFunction(() => window.__foxlake?.town?.debug?.().montello?.ready === true, null, { timeout: 600000, polling: 250 })
mark('townReady')
await stopProfile('town-build')
if (process.env.FOXLAKE_STOP_AFTER_BUILD === "1") {
  console.log('marks', JSON.stringify(marks))
  console.log('build', JSON.stringify(await page.evaluate(() => window.__foxlake.town.montello?.buildStats ?? null)))
  await browser.close()
  process.exit(0)
}
const build = await page.evaluate(() => window.__foxlake.town.montello?.buildStats ?? null)

const counts = () =>
  page.evaluate(() => {
    const s = window.__foxlake.game.host().ctx.scene
    return { meshes: s.meshes.length, materials: s.materials.length, textures: s.textures.length, geometries: s.geometries.length }
  })

const frames = (turn) =>
  page.evaluate(async (turning) => {
    const h = window.__foxlake.game.host()
    const { engine, scene, camera } = h.ctx
    const times = []
    const draws0 = engine._drawCalls?.current ?? 0
    let last = performance.now()
    const yaw0 = camera.rotation.y
    for (let i = 0; i < 150; i++) {
      if (turning) camera.rotation.y = yaw0 + (i / 150) * Math.PI * 2
      await new Promise((r) => requestAnimationFrame(r))
      const now = performance.now()
      if (i >= 10) times.push(now - last)
      last = now
    }
    times.sort((a, b) => a - b)
    const p = (q) => Math.round(times[Math.min(times.length - 1, Math.floor(times.length * q))] * 10) / 10
    return { p50: p(0.5), p95: p(0.95), p99: p(0.99), active: scene.getActiveMeshes().length, draws: Math.round(((engine._drawCalls?.current ?? 0) - draws0) / 150) }
  }, turn)

const goTo = (spot) =>
  page.evaluate(async (s) => {
    const h = window.__foxlake.game.host()
    h.clock.set(s.hour)
    h.lighting.update?.(true)
    const p = h.player.clone()
    p.set(s.map[0] - 4200, 0, s.map[1] - 6600)
    h.teleport(p, s.facing)
    h.ctx.camera.rotation.set(0.1, s.facing, 0)
    const t = performance.now()
    while (performance.now() - t < 3000) await new Promise((r) => requestAnimationFrame(r))
  }, spot)

const report = { marks, build, heapAtStartMB: heapAtStart, spots: {}, leak: null, errors }
for (const spot of SPOTS) {
  await goTo(spot)
  if (spot === SPOTS[0]) await startProfile()
  const still = await frames(false)
  const turning = await frames(true)
  if (spot === SPOTS[0]) await stopProfile('frames-main-street')
  report.spots[spot.name] = { still, turning, heapMB: await heapMB(), ...(await counts()) }
  if (process.env.FOXLAKE_SHOTS) await page.screenshot({ path: `${process.env.FOXLAKE_SHOTS}/${spot.name}.png` })
  console.log(spot.name, JSON.stringify(report.spots[spot.name]))
}

const lapsOut = []
for (let lap = 0; lap < laps; lap++) {
  for (const spot of [SPOTS[0], SPOTS[4], SPOTS[3], SPOTS[2]]) await goTo(spot)
  lapsOut.push({ heapMB: await heapMB(), ...(await counts()) })
  console.log('lap', lap, JSON.stringify(lapsOut[lapsOut.length - 1]))
}
report.leak = lapsOut
console.log('marks', JSON.stringify(marks))
console.log('build', JSON.stringify(build))
console.log('heap at start', heapAtStart, 'MB')
console.log('errors', errors.length ? errors.slice(0, 10).join('\n') : 'none')
if (out) writeFileSync(out, JSON.stringify(report, null, 2))
await browser.close()
