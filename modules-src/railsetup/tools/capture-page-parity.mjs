// Records tests/fixtures/page-parity.json from the owner's original page, unchanged (original/, three@0.128.0 and the
// car.glb pieces), in headless Chromium. Each case drives the page with real input events: random Setup values, LF/RF
// and rear Kinematics moves, slugs, track bar type, fixed MR, Advanced mode, and a loaded hardpoints file part way
// through. The Heave, Roll and Steer view sliders stay at zero: they move the picture, not the car (railVehicle zeroes
// them too). `rack` is the page's steering rack travel as it stands: the original only
// re-solves it when Steer moves or the geometry is rebuilt, so after some Kinematics moves it is the previous geometry's. It stores the page's state (`readPage` in site/page.ts) and every number in the page's `model`.
//
//   node modules-src/railsetup/tools/capture-page-parity.mjs [cases] [seed]
import { createServer } from 'node:http'
import { readFileSync, writeFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, extname, join, resolve } from 'node:path'
import { gunzipSync } from 'node:zlib'
import { chromium } from 'playwright'

const cases = Number(process.argv[2] || 60)
const seed = Number(process.argv[3] || 20261127)
const here = import.meta.dirname
const original = resolve(here, '../original')
const manifest = JSON.parse(readFileSync(join(original, 'MANIFEST.json'), 'utf8'))
const three = dirname(createRequire(import.meta.url).resolve('three-r128/package.json'))
const npm = { '/lib/three.min.js': 'build/three.min.js', '/lib/GLTFLoader.js': 'examples/js/loaders/GLTFLoader.js', '/lib/OrbitControls.js': 'examples/js/controls/OrbitControls.js' }
const car = gunzipSync(Buffer.concat(manifest.car.pieces.map(p => readFileSync(join(original, 'car', p)))))
const types = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.woff2': 'font/woff2', '.glb': 'model/gltf-binary', '.txt': 'text/plain' }

const server = createServer((req, res) => {
  const path = decodeURIComponent(new URL(req.url, 'http://x').pathname)
  if (req.method === 'POST') return res.writeHead(204).end()
  try {
    const body = path === '/car.glb' ? car : npm[path] ? readFileSync(join(three, npm[path])) : readFileSync(join(original, path === '/' ? 'index.html' : path.slice(1)))
    res.writeHead(200, { 'content-type': types[extname(path)] || 'text/html; charset=utf-8' }).end(body)
  } catch {
    res.writeHead(404).end()
  }
})
await new Promise(r => server.listen(0, '127.0.0.1', r))
const browser = await chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] })
const page = await browser.newPage({ viewport: { width: 1200, height: 800 } })
const errors = []
page.on('pageerror', e => errors.push(e.message))
await page.goto(`http://127.0.0.1:${server.address().port}/`)
await page.waitForFunction(() => typeof loaded !== 'undefined' && loaded, null, { timeout: 180000 })
await page.evaluate(() => { renderer.render = () => {} })

const out = await page.evaluate(async ({ cases, seed }) => {
  let s = seed >>> 0
  const rnd = () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296)
  const tick = () => new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)))
  const fire = e => { e.dispatchEvent(new Event('input', { bubbles: true })); e.dispatchEvent(new Event('change', { bubbles: true })) }
  const setRange = e => { const min = +e.min, max = +e.max, step = +e.step || 0.01; e.value = String(min + Math.round(rnd() * (max - min) / step) * step); fire(e) }
  const pick = e => { if (e && e.options.length) { e.selectedIndex = Math.floor(rnd() * e.options.length); fire(e) } }
  const R = x => typeof x === 'number' ? (Number.isFinite(x) ? +x.toPrecision(12) : null) : x
  const leaves = (o, path, acc, seen = new Set()) => {
    if (o == null || seen.has(o)) return
    if (typeof o === 'number') { acc[path] = R(o); return }
    if (typeof o !== 'object') return
    seen.add(o)
    for (const k of Object.keys(o)) leaves(o[k], path ? path + '.' + k : k, acc, seen)
  }
  const clone = x => JSON.parse(JSON.stringify(x))
  const state = () => {
    const inputs = {}
    SETUP_EL.forEach(e => inputs[e.id] = e.value)
    return { hp: clone({ L: HP.L, R: HP.R, rear: HP.rear }), inputs, adj: clone(adj), radj: { ...radj }, mrFixed: document.getElementById('mr-fixed').checked, view: { heave: +document.getElementById('k-heave').value, roll: +document.getElementById('k-roll').value, steer: +document.getElementById('k-steer').value, rack: STEER } }
  }
  const list = []
  for (let c = 0; c < cases; c++) {
    if (c === Math.floor(cases / 2)) {
      const j = clone({ L: HP0.L, R: HP0.R, rear: HP0.rear })
      for (const side of ['L', 'R']) for (const p of ['LBJ', 'UBJ', 'TRO']) j[side][p] = j[side][p].map(v => v + (rnd() - 0.5) * 0.6)
      j.rear.TB = j.rear.TB.map(pt => pt.map(v => v + (rnd() - 0.5) * 0.8))
      useHardpoints(j, 'capture.json')
    }
    if (c > 0) {
      for (const side of ['c-lf', 'c-rf']) {
        document.getElementById(side).click()
        document.querySelectorAll('#p-kin input[type=range][id^="k-"]').forEach(e => { if (rnd() < 0.35 && e.id !== 'k-steer') setRange(e) })
        for (const id of ['k-lslug', 'k-uslug']) if (rnd() < 0.3) pick(document.getElementById(id))
      }
      document.getElementById('c-rear').click()
      document.querySelectorAll('#p-kin input[type=range][id^="r-"]').forEach(e => { if (rnd() < 0.3) setRange(e) })
      if (rnd() < 0.3) pick(document.getElementById('r-TBtype'))
      if (rnd() < 0.2) pick(document.getElementById('r-TBflip'))
      document.querySelectorAll('#p-setup input[type=range]').forEach(e => { if (rnd() < 0.5 && e.id !== 'k-heave' && e.id !== 'k-roll') setRange(e) })
      document.querySelectorAll('#p-setup input[type=number]').forEach(e => { if (rnd() < 0.2 && e.min !== '') setRange(e) })
      if (rnd() < 0.3) pick(document.getElementById('wt'))
      const mr = document.getElementById('mr-fixed'); if (rnd() < 0.2) { mr.checked = !mr.checked; fire(mr) }
      const adv = document.getElementById('adv'); if (adv && rnd() < 0.25) { adv.value = adv.value === '1' ? '0' : '1'; fire(adv) }
    }
    await tick()
    const m = {}
    leaves(model, '', m)
    list.push({ ...state(), model: m })
  }
  const def = { ...DEF }
  return { def, cases: list }
}, { cases, seed })

const hp0 = JSON.stringify(out.cases[0].hp)
for (const c of out.cases) if (JSON.stringify(c.hp) === hp0) c.hp = null
const file = resolve(here, '../tests/fixtures/page-parity.json')
writeFileSync(file, JSON.stringify({ seed, hp0: JSON.parse(hp0), ...out }) + '\n')
console.log(`${out.cases.length} cases → ${file}`, errors.length ? `page errors: ${errors.join('; ')}` : '')
await browser.close()
server.close()
