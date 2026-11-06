import { chromium } from 'playwright'
import { mkdirSync } from 'node:fs'
const base = process.argv[2] || 'http://localhost:4173'
const outDir = process.argv[3] || 'docs/gate/shorttrack-next'
mkdirSync(outDir, { recursive: true })
const runs = [
  { name: 'webgpu-swiftshader', classic: false, args: ['--enable-unsafe-webgpu', '--use-webgpu-adapter=swiftshader', '--enable-features=Vulkan', '--use-angle=swiftshader'], q: '?engine=next' },
  { name: 'webgl2-forced', classic: false, args: ['--use-angle=swiftshader'], q: '?engine=next&gpu=webgl' },
  { name: 'classic', args: ['--use-angle=swiftshader'], q: '', classic: true },
  { name: 'classic-race', args: ['--use-angle=swiftshader'], q: '?track=dells', classic: true, race: true },
  { name: 'classic-dirt', args: ['--use-angle=swiftshader'], q: '?track=dirt', classic: true },
]
let bad = 0
for (const run of runs) {
  const browser = await chromium.launch({ args: run.args })
  const page = await browser.newPage({ viewport: { width: 1280, height: 720 } })
  const errors = [], external = [], pageErrors = []
  page.on('pageerror', (e) => { errors.push(String(e)); pageErrors.push(String(e)) })
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()) })
  page.on('request', (r) => { const u = r.url(); if (!u.startsWith(base) && !u.startsWith('data:') && !u.startsWith('blob:')) external.push(u) })
  await page.goto(`${base}/modules/shorttrack${run.q}`)
  await page.waitForTimeout(run.classic ? 8000 : 16000)
  if (run.race) {
    await page.evaluate(() => document.querySelector('[data-act="flow:solo"]')?.click())
    await page.waitForTimeout(1500)
    await page.evaluate(() => document.getElementById('setupNext')?.click())
    for (let i = 0; i < 20 && (await page.evaluate(() => window.__stClassic?.phase === 'idle')); i += 1) await page.waitForTimeout(1000)
    await page.waitForTimeout(25000)
  }
  const status = await page.evaluate(() => (window.__stNext ?? window.__stClassic) ?? null)
  await page.screenshot({ path: `${outDir}/${run.name}.png`, timeout: 15000 }).catch(() => console.log(`no screenshot for ${run.name}`))
  const ok = !pageErrors.length && (!run.classic ? status && status.physics === 'havok' && status.frames > 5 && !status.error : status && status.frames > 0 && (!run.race || (status.phase !== 'idle' && status.cars > 1 && status.moved > 0)))
  if (!ok) bad++
  console.log(JSON.stringify({ run: run.name, ok, status, errors: errors.slice(0, 5), external: [...new Set(external)].filter((u) => !/fonts\.(googleapis|gstatic)|peerjs/.test(u)) }))
  await browser.close()
}
process.exit(bad ? 1 : 0)
