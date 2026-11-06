import { chromium } from 'playwright'
import { mkdirSync } from 'node:fs'
const base = process.argv[2] || 'http://localhost:4173'
const outDir = process.argv[3] || 'docs/gate/shorttrack-next'
mkdirSync(outDir, { recursive: true })
const runs = [
  { name: 'webgpu-swiftshader', args: ['--enable-unsafe-webgpu', '--use-webgpu-adapter=swiftshader', '--enable-features=Vulkan', '--use-angle=swiftshader'], q: '?engine=next' },
  { name: 'webgl2-forced', args: ['--use-angle=swiftshader'], q: '?engine=next&gpu=webgl' },
  { name: 'classic', args: ['--use-angle=swiftshader'], q: '' },
]
let bad = 0
for (const run of runs) {
  const browser = await chromium.launch({ args: run.args })
  const page = await browser.newPage({ viewport: { width: 1280, height: 720 } })
  const errors = [], external = []
  page.on('pageerror', (e) => errors.push(String(e)))
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()) })
  page.on('request', (r) => { const u = r.url(); if (!u.startsWith(base) && !u.startsWith('data:') && !u.startsWith('blob:')) external.push(u) })
  await page.goto(`${base}/modules/shorttrack${run.q}`)
  await page.waitForTimeout(run.q ? 16000 : 8000)
  const status = await page.evaluate(() => window.__stNext ?? null)
  await page.screenshot({ path: `${outDir}/${run.name}.png`, timeout: 15000 }).catch(() => console.log(`no screenshot for ${run.name}`))
  const ok = run.q ? status && status.physics === 'havok' && status.frames > 5 && !status.error : true
  if (!ok) bad++
  console.log(JSON.stringify({ run: run.name, ok, status, errors: errors.slice(0, 5), external: [...new Set(external)].filter((u) => !/fonts\.(googleapis|gstatic)|peerjs/.test(u)) }))
  await browser.close()
}
process.exit(bad ? 1 : 0)
