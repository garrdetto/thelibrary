/**
 * Life Sim (Fox Lake) flicker check: loads the built page in Chrome (solo mode), waits for Montello to finish building, then
 * at each spot holds the camera still and grabs frames, and slowly turns and grabs frames. Static buildings should look the
 * same from one still frame to the next; this reports how much of the picture changed between frames (share of pixels
 * whose brightness moved by more than 24 of 255) and saves the frames with the most change for a look.
 *
 *   node scripts/foxlake-flicker.mjs [baseUrl] [outDir]
 */
import { chromium } from 'playwright'
import { mkdirSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'

const base = process.argv[2] ?? 'http://127.0.0.1:3040'
const outDir = resolve(process.argv[3] ?? 'docs/foxlake/flicker')
mkdirSync(outDir, { recursive: true })

const SPOTS = [
  { name: 'main-street', map: [0, 0], facing: 1.2, hour: 15 },
  { name: 'downtown-north', map: [120, 260], facing: Math.PI, hour: 16 },
  { name: 'houses-west', map: [-700, 300], facing: 0.4, hour: 14 },
  { name: 'dusk-downtown', map: [0, 0], facing: 1.2, hour: 19.6 },
  { name: 'night-downtown', map: [0, 0], facing: 1.2, hour: 22 },
]

const browser = await chromium.launch({ channel: 'chrome', headless: true, args: ['--enable-unsafe-webgpu', '--ignore-gpu-blocklist', '--use-angle=d3d11'] })
const page = await browser.newPage({ viewport: { width: 960, height: 540 } })
const errors = []
page.on('pageerror', (e) => errors.push(String(e)))
await page.goto(`${base}/modules/foxlake.html?solo=1&hour=15`, { waitUntil: 'load' })
await page.waitForFunction(() => !document.getElementById('start')?.hidden, null, { timeout: 300000, polling: 250 })
await page.evaluate(async () => {
  document.getElementById('start-btn').click()
  await new Promise((r) => setTimeout(r, 2500))
  ;[...document.querySelectorAll('button')].find((b) => b.textContent.trim() === 'Create character')?.click()
})
await page.addStyleTag({ content: '#pause{display:none!important} .hud,#prompt,#controls,#town-tags,#hud,#toasts{visibility:hidden!important}' })
await page.waitForFunction(() => window.__foxlake?.town?.debug?.().montello?.ready === true, null, { timeout: 600000, polling: 500 })

/** Grabs `count` frames from the canvas as greyscale, `turn` radians of yaw apart, one rendered frame between grabs. */
const grab = (count, turn) =>
  page.evaluate(async ({ count, turn }) => {
    const h = window.__foxlake.game.host()
    const canvas = h.ctx.engine.getRenderingCanvas()
    const w = Math.min(960, canvas.width)
    const ht = Math.round((canvas.height / canvas.width) * w)
    const c = document.createElement('canvas')
    c.width = w
    c.height = ht
    const g = c.getContext('2d', { willReadFrequently: true })
    const frames = []
    for (let i = 0; i < count; i++) {
      h.ctx.camera.rotation.y += turn
      await new Promise((r) => requestAnimationFrame(() => r()))
      await new Promise((r) => requestAnimationFrame(() => r()))
      g.drawImage(canvas, 0, 0, w, ht)
      const px = g.getImageData(0, 0, w, ht).data
      const grey = new Array(w * ht)
      for (let k = 0; k < w * ht; k++) grey[k] = Math.round(px[k * 4] * 0.3 + px[k * 4 + 1] * 0.59 + px[k * 4 + 2] * 0.11)
      frames.push({ grey, url: c.toDataURL('image/png') })
    }
    return { w, h: ht, frames }
  }, { count, turn })

const report = {}
for (const s of SPOTS) {
  await page.evaluate(async (s) => {
    const h = window.__foxlake.game.host()
    h.clock.set(s.hour)
    h.lighting.update?.(true)
    const p = h.player.clone()
    p.set(s.map[0] - 4200, 0, s.map[1] - 6600)
    h.teleport(p, s.facing)
    h.ctx.camera.rotation.set(0.06, s.facing, 0)
    const t = performance.now()
    while (performance.now() - t < 4000) await new Promise((r) => requestAnimationFrame(r))
  }, s)
  const out = { still: [], turning: [] }
  for (const [kind, turn] of [['still', 0], ['turning', 0.002]]) {
    const { w, h, frames } = await grab(16, turn)
    let worst = { share: -1, i: 0 }
    for (let i = 1; i < frames.length; i++) {
      const a = frames[i - 1].grey
      const b = frames[i].grey
      let changed = 0
      for (let k = 0; k < a.length; k++) if (Math.abs(a[k] - b[k]) > 24) changed++
      const share = changed / (w * h)
      out[kind].push(Math.round(share * 10000) / 100)
      if (share > worst.share) worst = { share, i }
    }
    for (const j of [worst.i - 1, worst.i]) writeFileSync(join(outDir, `${s.name}-${kind}-${j}.png`), Buffer.from(frames[j].url.split(',')[1], 'base64'))
    report[`${s.name}-${kind}-diff`] = await page.evaluate(({ a, b, w, h }) => {
      const c = document.createElement('canvas')
      c.width = w
      c.height = h
      const g = c.getContext('2d')
      const img = g.createImageData(w, h)
      for (let k = 0; k < a.length; k++) {
        const d = Math.abs(a[k] - b[k]) > 24 ? 255 : Math.round(a[k] * 0.25)
        img.data[k * 4] = d
        img.data[k * 4 + 1] = Math.round(a[k] * 0.25)
        img.data[k * 4 + 2] = Math.round(a[k] * 0.25)
        img.data[k * 4 + 3] = 255
      }
      g.putImageData(img, 0, 0)
      return c.toDataURL('image/png')
    }, { a: frames[worst.i - 1].grey, b: frames[worst.i].grey, w, h })
    writeFileSync(join(outDir, `${s.name}-${kind}-diff.png`), Buffer.from(report[`${s.name}-${kind}-diff`].split(',')[1], 'base64'))
    delete report[`${s.name}-${kind}-diff`]
  }
  report[s.name] = out
  console.log(s.name, 'still % changed', out.still.join(' '), '| turning', out.turning.join(' '))
}
writeFileSync(join(outDir, 'report.json'), JSON.stringify({ report, errors }, null, 1))
console.log('errors', errors.length ? errors.slice(0, 5) : 'none')
await browser.close()
