/**
 * Tello visual and performance check: loads the built page (public/modules/tello.html) in Chrome, steps out, then
 * stands at fixed spots around Montello, saving a screenshot with the frame time and scene counts for each.
 *
 *   node scripts/tello-capture.mjs [baseUrl] [outDir] [spot,spot]
 *
 * baseUrl serves public/ (default http://127.0.0.1:3200, for example `python3 -m http.server 3200 -d public`).
 * Results go to outDir (default docs/tello/captures). Spots are in map coordinates (x east, z north of City Hall).
 * Set TELLO_SOFTWARE=1 to render without a GPU (slow; for machines with no graphics card).
 */
import { chromium } from 'playwright'
import { mkdirSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'

const base = process.argv[2] ?? 'http://127.0.0.1:3200'
const outDir = resolve(process.argv[3] ?? 'docs/tello/captures')
const only = (process.argv[4] ?? '').split(',').filter(Boolean)
mkdirSync(outDir, { recursive: true })

const SPOTS = [
  { name: 'main-street', hour: 15, at: null, facing: null, pitch: 0.12 },
  { name: 'downtown', hour: 16, at: [150, 30], facing: Math.PI * 0.5, pitch: 0.1 },
  { name: 'buffalo-lake', hour: 17, at: [-160, -230], facing: Math.PI * 1.25, pitch: 0.1 },
  { name: 'fox-river-bridge', hour: 15, at: [205, -760], facing: Math.PI, pitch: 0.12 },
  { name: 'neighborhood', hour: 15, at: [420, 300], facing: 0, pitch: 0.12 },
  { name: 'school', hour: 12, at: [560, 520], facing: 0.3, pitch: 0.1 },
  { name: 'highway-22-south', hour: 16, at: [230, -1150], facing: 0, pitch: 0.08 },
  { name: 'night-main-street', hour: 21.5, at: null, facing: null, pitch: 0.1 },
  { name: 'west-montello-from-west-street', hour: 16, at: [-31, -11], facing: 1.25, pitch: 0.05 },
  { name: 'west-montello-from-the-east', hour: 17.5, at: [53.5, 13.6], facing: -1.88, pitch: 0.05 },
  { name: 'water-tower', hour: 15, at: [100, 20], facing: 1.23, pitch: -0.12 },
  { name: 'main-and-montello-corner', hour: 15, at: [112, 26], facing: -2.45, pitch: -0.02 },
  { name: 'main-street-east-side', hour: 15, at: [111, -4], facing: 2.3, pitch: 0.02 },
  { name: 'corner-from-west-montello', hour: 16, at: [86, 18.5], facing: 2.75, pitch: 0.0 },
  { name: 'main-street-north-to-the-light', hour: 15, at: [129, -72], facing: -0.12, pitch: 0.03 },
  { name: 'the-light-and-falls', hour: 15, at: [118.5, 4], facing: 0, pitch: 0.0 },
  { name: 'falls', hour: 15, at: [121, 22], facing: 0, pitch: -0.06 },
  { name: 'west-montello-over-the-bridge', hour: 15, at: [100, 18.5], facing: -1.78, pitch: 0.03 },
  { name: 'bridge-from-the-river', hour: 15, at: [55, 45], facing: 2.49, pitch: 0.06 },
  { name: 'main-street-from-the-split', hour: 15, at: [112, 0], facing: 2.36, pitch: 0.03 },
  { name: 'main-street-south-of-the-alley', hour: 15, at: [125, -40], facing: 2.64, pitch: 0.03 },
  { name: 'east-montello-theatre', hour: 15, at: [200, 24], facing: 3.03, pitch: 0.03 },
].filter((s) => !only.length || only.includes(s.name))

const software = process.env.TELLO_SOFTWARE === '1'
const args = software ? ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] : ['--enable-unsafe-webgpu', '--ignore-gpu-blocklist']
const browser = await chromium.launch({ channel: 'chrome', headless: true, args })
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } })
const errors = []
page.on('pageerror', (e) => errors.push(String(e)))
page.on('console', (m) => { if (m.type() === 'error' && !/404|Failed to load resource/.test(m.text())) errors.push(m.text()) })

await page.goto(`${base}/modules/tello.html?hour=15`, { waitUntil: 'load' })
await page.waitForFunction(() => !document.getElementById('start')?.hidden || /could not start/.test(document.getElementById('load-text')?.textContent ?? ''), null, { timeout: 600000, polling: 1000 })
if (await page.evaluate(() => document.getElementById('start')?.hidden)) {
  console.error('Tello did not start:', errors)
  await page.screenshot({ path: join(outDir, 'failed.png') })
  await browser.close()
  process.exit(1)
}
await page.evaluate(async () => {
  const wait = (ms) => new Promise((r) => setTimeout(r, ms))
  document.getElementById('start-btn').click()
  await wait(2500)
  ;[...document.querySelectorAll('button')].find((b) => b.textContent.trim() === 'Create character')?.click()
  await wait(2500)
})
await page.addStyleTag({ content: '#pause{display:none!important}' })
if (software) await page.evaluate(() => { window.__telloSoftware = true })

const stats = async () => page.evaluate(async () => {
  const { game, town } = window.__tello
  const h = game.host()
  const { engine, scene } = h.ctx
  const times = []
  let last = performance.now()
  for (let i = 0; i < (navigator.webdriver && window.__telloSoftware ? 8 : 60); i++) {
    await new Promise((r) => requestAnimationFrame(r))
    const now = performance.now()
    times.push(now - last)
    last = now
  }
  times.sort((a, b) => a - b)
  const p = (q) => Math.round(times[Math.floor(times.length * q)] * 10) / 10
  const mem = performance.memory ? Math.round(performance.memory.usedJSHeapSize / 1048576) : null
  return { p50: p(0.5), p95: p(0.95), meshes: scene.meshes.length, active: scene.getActiveMeshes().length, materials: scene.materials.length, textures: scene.textures.length, heapMB: mem, backend: engine.isWebGPU ? 'webgpu' : 'webgl2', place: document.getElementById('place')?.textContent, town: town.debug() }
})

const report = []
for (const spot of SPOTS) {
  await page.evaluate(async (s) => {
    const { game, land, town } = window.__tello
    const h = game.host()
    h.clock.set(s.hour)
    h.lighting.update?.(true)
    const home = town.spawn()
    const x = s.at ? land.toSceneX(s.at[0]) : home.at.x
    const z = s.at ? land.toSceneZ(s.at[1]) : home.at.z
    const facing = s.facing ?? home.facing
    const at = home.at.clone()
    at.set(x, h.terrain.heightAt(x, z), z)
    h.teleport(at, facing)
    h.ctx.camera.rotation.set(s.pitch, facing, 0)
    await new Promise((r) => setTimeout(r, 2500))
  }, spot)
  const st = await stats()
  await page.screenshot({ path: join(outDir, `${spot.name}.png`) })
  report.push({ spot: spot.name, ...st })
  console.log(spot.name, JSON.stringify({ p50: st.p50, p95: st.p95, active: st.active, meshes: st.meshes, place: st.place }))
}
writeFileSync(join(outDir, 'report.json'), JSON.stringify({ errors, report }, null, 1))
if (errors.length) console.log('errors:', errors.slice(0, 12))
await browser.close()
