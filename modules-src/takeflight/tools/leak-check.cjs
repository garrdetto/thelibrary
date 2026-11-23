/**
 * Browser leak suite: loads the page, flies every aircraft and airport pair once to warm the caches and pools, then flies
 * `cycles` more loads (50 by default) and checks that scene meshes, materials, textures, geometries and nodes never exceed
 * what the same aircraft and airport needed in the warm-up round. Usage: node modules-src/takeflight/tools/leak-check.cjs <page url> [cycles]
 * (Playwright; WebGL through SwiftShader works headless).
 */
const { chromium } = require('playwright')

const url = process.argv[2] ?? 'http://127.0.0.1:5173/modules/takeflight.html'
const cycles = Number(process.argv[3] ?? 50)
const AIRCRAFT = ['halden-wren', 'arden-duet', 'corvane-sprite', 'solent-vesta', 'corvane-haulmaster']
const AIRPORTS = ['harrow', 'millbrook', 'ashby', 'fenwick', 'corran', 'halvard', 'cragnotch']

;(async () => {
  const browser = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--enable-precise-memory-info'] })
  const page = await browser.newPage({ viewport: { width: 960, height: 600 } })
  const errors = []
  page.on('pageerror', (error) => errors.push(error.message))
  await page.addInitScript(() => localStorage.setItem('takeflight.career.v1', JSON.stringify({ xp: 900000, licences: ['student', 'ppl', 'instrument', 'multi', 'commercial', 'atp'], seconds: { single: 900000 } })))
  await page.goto(`${url}${url.includes('?') ? '&' : '?'}quality=low`, { waitUntil: 'load' })
  await page.waitForFunction(() => window.__takeflight, null, { timeout: 180000 })
  const seen = new Map()
  let failures = 0
  const warmup = AIRCRAFT.length * AIRPORTS.length
  for (let i = 0; i < warmup + cycles; i++) {
    const aircraft = AIRCRAFT[i % AIRCRAFT.length]
    const airport = AIRPORTS[i % AIRPORTS.length]
    await page.evaluate(({ aircraft, airport }) => window.__takeflight.debug.fly({ aircraft, airport, start: 'runway1', weather: 'clear', time: 'noon', checkride: null, job: null, route: null }), { aircraft, airport })
    await page.waitForFunction(() => window.__takeflight.debug.phase === 'flying', null, { timeout: 60000 })
    await page.waitForTimeout(1500)
    const counts = await page.evaluate(() => window.__takeflight.debug.counts())
    const key = `${aircraft}@${airport}`
    const before = seen.get(key)
    if (i >= warmup && before) {
      for (const name of ['meshes', 'materials', 'textures', 'geometries', 'nodes']) {
        if (counts[name] > before[name]) {
          failures++
          console.log(`cycle ${i} ${key}: ${name} grew ${before[name]} -> ${counts[name]}`)
        }
      }
    }
    if (i < warmup) seen.set(key, counts)
    if (i % 10 === 9) console.log(`cycle ${i + 1}: ${JSON.stringify(counts)}`)
  }
  await browser.close()
  if (errors.length) console.log(`page errors:\n${errors.slice(0, 10).join('\n')}`)
  console.log(failures === 0 && errors.length === 0 ? 'leak check passed' : `leak check failed: ${failures} growths, ${errors.length} errors`)
  process.exit(failures === 0 && errors.length === 0 ? 0 : 1)
})()
