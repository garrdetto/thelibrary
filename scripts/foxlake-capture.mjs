/**
 * Fox Lake visual and performance check: loads the built page (public/modules/foxlake.html, solo mode) in Chrome,
 * heads out, then stands at fixed spots, saving a screenshot and the frame time, draw and memory counts for each.
 * The last pass walks town -> lake -> town five times and reports whether mesh, material and texture counts grew.
 *
 *   node scripts/foxlake-capture.mjs [baseUrl] [outDir] [spot,spot]
 *
 * baseUrl serves public/ (default http://127.0.0.1:3200). Results go to outDir (default docs/foxlake/captures).
 * Naming spots takes only those (and skips the casino and leak passes). Set FOXLAKE_SOFTWARE=1 to render without a GPU.
 */
import { chromium } from 'playwright'
import { mkdirSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'

const base = process.argv[2] ?? 'http://127.0.0.1:3200'
const outDir = resolve(process.argv[3] ?? 'docs/foxlake/captures')
const only = (process.argv[4] ?? '').split(',').filter(Boolean)
mkdirSync(outDir, { recursive: true })

const SPOTS = [
  { name: 'town-main-st', hour: 15, at: [-468, 1147], facing: Math.PI * 0.5, pitch: 0.12 },
  { name: 'downtown', hour: 17, at: [-170, 1152], facing: Math.PI * 0.5, pitch: 0.08 },
  { name: 'county-road', hour: 16, at: [-269, 640], facing: Math.PI, pitch: 0.1 },
  { name: 'seam-to-town', hour: 16, at: [-262, 470], facing: 0, pitch: 0.1 },
  { name: 'lake-dock', hour: 18, at: null, facing: null, pitch: 0.15 },
  { name: 'vehicles-outfit', hour: 14, at: [-474, 1128], facing: 0.55, pitch: 0.18, outfit: ['jacket-tee-white', 'vest-none', 'cap-none', 'pants-darkjeans', 'pack-none'] },
  { name: 'outfit-hoodie', hour: 14, at: [-474, 1128], facing: 2.6, pitch: 0.18, outfit: ['jacket-hoodie-grey', 'vest-none', 'cap-backwards', 'pants-joggers', 'pack-none'] },
  { name: 'casino-outside', hour: 19, at: [-240, 1098], facing: Math.PI, pitch: 0.12 },
  { name: 'casino-inside', hour: 15, at: [-240, 1082], facing: Math.PI, pitch: 0.18 },
  { name: 'casino-slots', hour: 15, at: [-250, 1078], facing: -Math.PI / 2, pitch: 0.12 },
  { name: 'town-night', hour: 21.5, at: [-468, 1147], facing: Math.PI * 0.5, pitch: 0.1 },
  { name: 'county-road-f', hour: 15, at: [-99, 1834], facing: 1.25, pitch: 0.1 },
  { name: 'into-montello', hour: 16, at: [372, 1990], facing: 0.68, pitch: 0.08 },
  { name: 'montello-main-street', hour: 15, at: [405.4, 3579.9], facing: 1.27, pitch: 0.12 },
  { name: 'montello-downtown', hour: 16, at: [602, 3638], facing: Math.PI * 0.5, pitch: 0.1 },
  { name: 'montello-night', hour: 21.5, at: [405.4, 3579.9], facing: 1.27, pitch: 0.1 },
].filter((s) => !only.length || only.includes(s.name))

const software = process.env.FOXLAKE_SOFTWARE === '1'
const browser = await chromium.launch({ channel: 'chrome', headless: true, args: software ? ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] : ['--enable-unsafe-webgpu', '--ignore-gpu-blocklist', '--use-angle=d3d11'] })
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } })
const errors = []
page.on('pageerror', (e) => errors.push(String(e)))
page.on('console', (m) => { if (m.type() === 'error' && !m.text().includes('404')) errors.push(m.text()) })

await page.goto(`${base}/modules/foxlake.html?solo=1&hour=15`, { waitUntil: 'load' })
await page.waitForFunction(() => !document.getElementById('start')?.hidden, null, { timeout: 180000, polling: 1000 })
await page.evaluate(async () => {
  const wait = (ms) => new Promise((r) => setTimeout(r, ms))
  document.getElementById('start-btn').click()
  await wait(2500)
  ;[...document.querySelectorAll('button')].find((b) => b.textContent.trim() === 'Create character')?.click()
  await wait(2500)
  const pause = document.getElementById('pause')
  if (pause) pause.style.display = 'none'
})
await page.addStyleTag({ content: '#pause{display:none!important}' })

const stats = async () => page.evaluate(async (frames) => {
  const { game } = window.__foxlake
  const h = game.host()
  const { engine, scene } = h.ctx
  const times = []
  let last = performance.now()
  for (let i = 0; i < frames; i++) {
    await new Promise((r) => requestAnimationFrame(r))
    const now = performance.now()
    times.push(now - last)
    last = now
  }
  times.sort((a, b) => a - b)
  const p = (q) => Math.round(times[Math.floor(times.length * q)] * 10) / 10
  const mem = performance.memory ? Math.round(performance.memory.usedJSHeapSize / 1048576) : null
  return { p50: p(0.5), p95: p(0.95), meshes: scene.meshes.length, active: scene.getActiveMeshes().length, materials: scene.materials.length, textures: scene.textures.length, geometries: scene.geometries.length, heapMB: mem, backend: engine.isWebGPU ? 'webgpu' : 'webgl2', town: window.__foxlake.town.debug() }
}, software ? 12 : 90)

const goTo = async (spot) => page.evaluate(async (s) => {
  const { game } = window.__foxlake
  const h = game.host()
  h.clock.set(s.hour)
  if (s.outfit) game.avatar.setOutfit(s.outfit)
  h.lighting.update?.(true)
  if (s.at) {
    const p = h.player.clone()
    p.set(s.at[0], 0, s.at[1])
    h.teleport(p, s.facing)
  } else {
    const cabin = h.ctx.scene.getMeshByName('cabin-cabin-i')
    const dock = h.ctx.scene.getMeshByName('dock')
    const c = cabin ? cabin.getBoundingInfo().boundingBox.centerWorld : { x: 123, z: -112 }
    const d = dock ? dock.getBoundingInfo().boundingBox.centerWorld : { x: 104, z: -88 }
    const p = h.player.clone()
    p.set(c.x + (d.x - c.x) * 0.6, 0, c.z + (d.z - c.z) * 0.6)
    s.facing = Math.atan2(d.x - c.x, d.z - c.z)
    h.teleport(p, s.facing)
  }
  h.ctx.camera.rotation.set(s.pitch, s.facing ?? h.facing, 0)
  await new Promise((r) => setTimeout(r, 2500))
}, spot)

const report = { spots: {}, leak: null, errors }
for (const spot of SPOTS) {
  await goTo(spot)
  report.spots[spot.name] = await stats()
  await page.screenshot({ path: join(outDir, `${spot.name}.png`) })
  console.log(spot.name, JSON.stringify(report.spots[spot.name]))
}
if (only.length) {
  writeFileSync(join(outDir, 'report.json'), JSON.stringify(report, null, 1))
  console.log('errors', errors.length ? errors : 'none')
  await browser.close()
  process.exit(0)
}

for (const [name, idx] of [['slot-machine', 4], ['slot-link', 0], ['slot-house', 2]]) {
  await page.evaluate(async (i) => {
    const town = window.__foxlake.town
    const casino = town.casino
    const h = window.__foxlake.game.host()
    const spot = casino.displays[i].spot
    const p = h.player.clone()
    const sx = spot.seat.x - 356
    const sz = 1152 - spot.seat.z
    p.set(sx, 0, sz)
    h.teleport(p, 0)
    casino.interact()
    await new Promise((r) => setTimeout(r, 1200))
    for (let n = 0; n < 3; n++) await casino.session.spin()
  }, idx)
  await page.waitForTimeout(1500)
  await page.screenshot({ path: join(outDir, `${name}.png`) })
  await page.evaluate(() => window.__foxlake.town.casino.session?.close())
}
for (const [name, idx, kind, after] of [['bonus-holdspin', 0, 'holdspin', 4200], ['bonus-wheel', 7, 'freegames', 3800], ['bonus-houses', 2, 'houses', 9000], ['bonus-collect', 8, 'cashcollect', 3500], ['bonus-pick', 9, 'jackpotpick', 6000], ['bonus-gold', 4, 'freegames', 9000]]) {
  await page.evaluate(async ([i, k]) => {
    const casino = window.__foxlake.town.casino
    const h = window.__foxlake.game.host()
    const spot = casino.displays[i].spot
    const p = h.player.clone()
    p.set(spot.seat.x - 356, 0, 1152 - spot.seat.z)
    h.teleport(p, 0)
    casino.interact()
    await new Promise((r) => setTimeout(r, 1000))
    void casino.session.demo(k)
  }, [idx, kind])
  await page.waitForTimeout(after)
  await page.screenshot({ path: join(outDir, `${name}.png`) })
  await page.evaluate(() => window.__foxlake.town.casino.session?.close())
  await page.waitForTimeout(400)
}
await page.evaluate(async () => {
  const town = window.__foxlake.town
  const h = window.__foxlake.game.host()
  const p = h.player.clone()
  p.set(116 - 356, 0, 1152 - 76.1)
  h.teleport(p, 0)
  town.casino.interact()
  await new Promise((r) => setTimeout(r, 1200))
  await town.casino.session.act('deal')
})
await page.waitForTimeout(1500)
await page.screenshot({ path: join(outDir, 'blackjack.png') })
await page.evaluate(() => { const s = window.__foxlake.town.casino.session; if (s) { s.view = null; s.close() } })

await goTo({ hour: 17.6, at: [-430, 1158], facing: Math.PI * 0.42, pitch: 0.06 })
await page.addStyleTag({ content: '.hud,#prompt,#controls,#town-tags{visibility:hidden!important}' })
await page.waitForTimeout(800)
await page.screenshot({ path: join(outDir, 'thumbnail.png') })
await page.addStyleTag({ content: '.hud,#prompt,#controls,#town-tags{visibility:visible!important}' })

const counts = () => page.evaluate(() => {
  const s = window.__foxlake.game.host().ctx.scene
  return { meshes: s.meshes.length, materials: s.materials.length, textures: s.textures.length, geometries: s.geometries.length, heapMB: performance.memory ? Math.round(performance.memory.usedJSHeapSize / 1048576) : null }
})
const laps = []
for (let lap = 0; lap < 5; lap++) {
  await goTo({ hour: 15, at: [-468, 1147], facing: 0, pitch: 0.1 })
  await goTo({ hour: 15, at: null, facing: null, pitch: 0.1 })
  await goTo({ hour: 15, at: [-468, 1147], facing: 0, pitch: 0.1 })
  laps.push(await counts())
}
const first = laps[0]
const lastLap = laps[laps.length - 1]
const grew = (k) => (first[k] ? (lastLap[k] - first[k]) / first[k] : 0)
report.leak = { laps, growth: { meshes: grew('meshes'), materials: grew('materials'), textures: grew('textures'), geometries: grew('geometries') } }
console.log('leak', JSON.stringify(report.leak.growth))
writeFileSync(join(outDir, 'report.json'), JSON.stringify(report, null, 2))
console.log('errors', errors.length ? errors.slice(0, 10).join('\n') : 'none')
await browser.close()
