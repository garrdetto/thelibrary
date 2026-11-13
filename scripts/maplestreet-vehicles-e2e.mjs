/**
 * End-to-end check of the Fox Plains vehicle pipeline against a local dev
 * server (pnpm dev) and the Meshy stand-in (node scripts/meshy-mock.mjs):
 *
 *   1. Meshy: text → previews → refine → remesh, cancel, balance and costs.
 *   2. Admin → Fox Plains vehicles: open the Meshy model in the editor and
 *      walk its six steps (Model & size, Clean up, Lights, Wheels & driving,
 *      Paint, Publish): match it to the sedan, smooth out bumps, find the
 *      windows and lights, test-drive it on the game physics, publish it
 *      with its HD texture pack.
 *   3. Solo Fox Plains: buy it at Maple Motors, drive it, see it in traffic.
 *   4. Shared world (Durable Object): the same vehicle is valid there too.
 *
 *   ADMIN_PASSWORD=… node scripts/maplestreet-vehicles-e2e.mjs [baseUrl]
 */
import { chromium } from 'playwright'
import { build } from 'esbuild'
import { mkdirSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'

const BASE = process.argv[2] ?? 'http://localhost:3000'
const PASSWORD = process.env.ADMIN_PASSWORD ?? 'local-admin-pass'
const OUT = resolve(import.meta.dirname, '../.e2e')
mkdirSync(OUT, { recursive: true })

const root = resolve(import.meta.dirname, '..')
const layoutFile = join(OUT, 'layout.mjs')
await build({ entryPoints: [join(root, 'modules-src/maplestreet/shared/WorldLayout.ts')], bundle: true, platform: 'node', format: 'esm', outfile: layoutFile, logLevel: 'warning' })
const { SHOP_DOORS } = await import(pathToFileURL(layoutFile).href)
const dealer = SHOP_DOORS.find(d => d.kind === 'dealer')

const log = (...args) => console.log('•', ...args)
const assert = (ok, message) => { if (!ok) throw new Error(`FAILED: ${message}`); log('ok', message) }
const sleep = ms => new Promise(r => setTimeout(r, ms))

const launchArgs = { args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] }
let browser = await chromium.launch(launchArgs)
let context = await browser.newContext({ baseURL: BASE, viewport: { width: 1440, height: 1000 } })
let api = context.request
const headers = { Origin: BASE, 'Content-Type': 'application/json' }
const errors = []

try {
  const login = await api.post('/api/pool-account', { headers, data: { action: 'login', username: 'stoegbauer', password: PASSWORD } })
  assert(login.ok(), 'admin signs in')

  // ---------------------------------------------------------------- 1. Meshy
  const status = await (await api.get('/api/meshy?status=1')).json()
  assert(status.connected === true && typeof status.balance === 'number', `Meshy connected with a balance (${status.balance} credits)`)
  const startBalance = status.balance
  const anon = await chromium.launch()
  const anonCtx = await anon.newContext({ baseURL: BASE })
  const denied = await anonCtx.request.get('/api/meshy?status=1')
  assert(denied.status() === 401 || denied.status() === 403, 'Meshy routes are admin-only')
  await anon.close()

  const waitFor = async (ids, label) => {
    for (let i = 0; i < 40; i++) {
      const { jobs } = await (await api.get('/api/meshy')).json()
      const mine = jobs.filter(j => ids.includes(j.id))
      if (mine.length === ids.length && mine.every(j => j.status === 'SUCCEEDED')) return mine
      if (mine.some(j => j.status === 'FAILED')) throw new Error(`${label} failed`)
      await sleep(1500)
    }
    throw new Error(`${label} timed out`)
  }
  const text = await api.post('/api/meshy', { headers, data: { action: 'text', target: 'vehicle', prompt: 'boxy two-door utility wagon, no wheels, game asset', negativePrompt: 'wheels, logos', aiModel: 'latest', count: 2 } })
  assert(text.status() === 201, 'text → 3D starts two previews')
  const previews = await waitFor((await text.json()).ids, 'previews')
  assert(previews.every(p => p.thumbnailUrl), 'previews have thumbnails to pick from')
  const refine = await (await api.post('/api/meshy', { headers, data: { action: 'refine', jobId: previews[0].id, texturePrompt: 'sage green paint' } })).json()
  const [refined] = await waitFor(refine.ids, 'refine')
  assert(refined.modelReady && refined.modelBytes > 0, 'refined model is stored in KV')
  const remesh = await (await api.post('/api/meshy', { headers, data: { action: 'remesh', target: 'vehicle', source: { jobId: refined.id }, polycount: 12000 } })).json()
  const [remeshed] = await waitFor(remesh.ids, 'remesh')
  assert(remeshed.modelReady, 'remeshed .glb is stored in KV')
  const cancelMe = await (await api.post('/api/meshy', { headers, data: { action: 'text', target: 'vehicle', prompt: 'spare wagon to cancel', negativePrompt: '', aiModel: 'meshy-6-lite', count: 1 } })).json()
  const cancel = await api.post('/api/meshy', { headers, data: { action: 'cancel', jobId: cancelMe.ids[0] } })
  assert(cancel.ok(), 'a running job can be canceled')
  const after = await (await api.get('/api/meshy?status=1')).json()
  assert(after.balance === startBalance - (20 * 2 + 10 + 5 + 5), `balance went down by the estimated credits (${startBalance} → ${after.balance})`)
  const badInput = await api.post('/api/meshy', { headers, data: { action: 'refine', jobId: remeshed.id, texturePrompt: '' } })
  const badBody = await badInput.json()
  assert(badInput.status() === 409 && !/meshy\.ai|preview_task_id/i.test(badBody.error), 'errors are friendly, not Meshy’s raw text')

  // ---------------------------------------------------------------- 2. Editor
  const page = await context.newPage()
  page.on('pageerror', e => errors.push(`admin page: ${e.message}`))
  page.on('console', m => { if (m.type() === 'error' && !/favicon|404|net::ERR/.test(m.text())) errors.push(`admin console: ${m.text()}`) })
  await page.goto('/')
  await page.getByRole('button', { name: 'Admin', exact: true }).click()
  await page.getByRole('tab', { name: 'Vehicles', exact: true }).click()
  await page.getByRole('heading', { name: 'Publish vehicles' }).waitFor()
  await page.getByText('credits left').waitFor({ timeout: 20000 })
  log('vehicle editor and Meshy panel are open')
  const jobRow = page.locator('.ms-meshy-jobs li', { hasText: 'Remesh to 12,000' }).first()
  await jobRow.getByRole('button', { name: 'Open in editor' }).click()
  await page.waitForFunction(() => /Length\s*\d/.test(document.querySelector('.ms-veh-readout')?.textContent ?? ''), null, { timeout: 30000 })
  const before = await page.locator('.ms-veh-readout').innerText()
  log('model loaded:', before.replace(/\s+/g, ' '))
  assert(/Length\s+4\.9\d m/.test(before) && /Width\s+[12]\.\d\d m/.test(before), 'a model that faces +Z is turned nose-forward and sized like a sedan on load')
  const step = async name => { await page.locator('.adm-steps button', { hasText: name }).click(); await sleep(300) }
  const idle = () => page.waitForFunction(() => !document.querySelector('.ms-items-fields .spin'), null, { timeout: 180000 })
  const note = async () => (await page.locator('.ms-veh-status').last().innerText({ timeout: 3000 }).catch(() => '')).replace(/\s+/g, ' ')
  assert((await page.locator('.adm-steps button').count()) === 6, 'the editor has six steps')
  await page.getByRole('button', { name: /Match size of sedan/ }).click()
  await sleep(500)
  const readout = await page.locator('.ms-veh-readout').innerText()
  const length = Number(/Length\s+([\d.]+) m/.exec(readout)?.[1])
  assert(Math.abs(length - 4.92) < 0.05, `"Match size of sedan" scales it to the sedan's length (${length} m)`)
  assert(/Wheel diameter\s+0\.68 m/.test(readout), 'wheel diameter readout matches the sedan (0.68 m)')
  await page.getByLabel('Name', { exact: true }).fill('Sage Wagon')

  await step('Clean up')
  await page.getByRole('button', { name: 'Smooth out bumps' }).click()
  await idle()
  assert(/Smoothed the bumps|already smooth/.test(await note()), `one button smooths the body (${await note()})`)
  await page.getByRole('button', { name: 'Find windows' }).click()
  await idle()
  log('windows:', await note() || 'marked on the model')
  await page.getByRole('button', { name: 'Cancel', exact: true }).click()

  await step('Lights')
  assert(await page.getByLabel(/3D light/).first().isChecked(), 'new vehicles start with 3D lights')
  await page.getByRole('button', { name: 'Find the lights for me' }).click()
  await idle()
  log('lights:', await note())

  await step('Wheels & driving')
  await page.getByLabel('Top speed (mph)').fill('72')
  await page.getByLabel(/0–60 mph \(s\)/).fill('11')
  await page.screenshot({ path: join(OUT, 'vehicle-editor.png'), timeout: 60000 }).catch(() => log('(editor screenshot skipped)'))

  await page.getByRole('button', { name: 'Test drive' }).click()
  const drive = page.getByRole('dialog', { name: 'Test drive' })
  await drive.getByText(/target 72 mph/).waitFor()
  await drive.locator('dd').first().getByText(/^\d+(\.\d)? mph/).waitFor({ timeout: 90000 })
  const stats = await drive.locator('.ms-veh-drive-stats').innerText()
  const top = Number(/Top speed\s+([\d.]+) mph/.exec(stats)?.[1])
  const time = Number(/0–60 mph\s+([\d.]+) s/.exec(stats)?.[1])
  assert(Math.abs(top - 72) <= 2 && Math.abs(time - 11) <= 0.6, `test drive on the game physics hits the targets (${top} mph, 0–60 in ${time} s)`)
  await page.screenshot({ path: join(OUT, 'test-drive.png'), timeout: 60000 }).catch(() => log('(test drive screenshot skipped)'))
  await drive.getByRole('button', { name: 'Close test drive' }).click()

  await step('Publish')
  await page.getByLabel('Drives around town').check()
  await page.getByLabel(/^Price/).fill('14500')
  await page.locator('details.ms-veh-more summary').click()
  await page.getByLabel('Driver name').fill('Wanda Sage')
  assert(await page.getByLabel(/Best \(4K\)/).isChecked(), 'quality starts at Best (4K)')
  await page.getByRole('button', { name: 'Check the download size' }).click()
  const report = (await page.locator('.ms-veh-sizes').innerText({ timeout: 120000 })).replace(/\s+/g, ' ')
  assert(/baked-in wheel triangles removed/.test(report), `upload is packed and baked-in wheels are cut (${report})`)
  await page.getByRole('button', { name: 'Publish vehicle' }).click()
  await page.locator('.ms-items-fields .ms-items-ok, .ms-items-fields .ms-items-error').last().waitFor({ timeout: 30000 })
  const publishMessage = await page.locator('.ms-items-fields .ms-items-ok, .ms-items-fields .ms-items-error').last().innerText()
  assert(/Published “Sage Wagon”/.test(publishMessage), `publish succeeds (${publishMessage})`)
  const { vehicles } = await (await api.get('/api/maplestreet-vehicles')).json()
  const wagon = vehicles.filter(v => v.name === 'Sage Wagon').at(-1)
  assert(wagon && wagon.dealer.price === 14500 && wagon.traffic.enabled && wagon.wheelsRemoved, 'vehicle is published with dealer and traffic settings')
  assert(wagon.lampShapes?.headStyle?.kind === '3d' && wagon.lampShapes?.tailStyle?.kind === '3d', 'the 3D lamp styles are saved in the spec')
  assert(wagon.hdUrl === null || /\?hd=/.test(wagon.hdUrl), `the record carries its HD pack (${wagon.hdUrl ?? 'none: textures already fit the base model'})`)
  if (wagon.hdUrl) {
    const pack = await api.get(wagon.hdUrl)
    assert(pack.ok() && /immutable/.test(pack.headers()['cache-control'] ?? ''), 'the HD pack is served with the immutable cache')
  }
  const brand = await api.patch('/api/maplestreet-vehicles', { headers, data: { id: wagon.id, name: 'Mustang Wagon' } })
  assert(brand.status() === 400, 'brand names are refused')
  const kind = `custom:${wagon.id}`
  await page.close()

  // ---------------------------------------------------------------- 3. Solo game
  const game = await context.newPage()
  game.on('pageerror', e => errors.push(`game: ${e.message}`))
  await game.addInitScript(() => { localStorage.setItem('maplestreet/body', 'male'); localStorage.setItem('maplestreet/name', 'tester') })
  await game.goto('/modules/maplestreet.html?solo=1&webgl&noao')
  await game.waitForFunction(() => window.maple && window.maple.account, null, { timeout: 120000 })
  log('solo neighborhood loaded')
  const result = await game.evaluate(async ({ kind, dealer }) => {
    const g = window.maple
    const pos = g.character.position.clone()
    pos.set(dealer.x, 0, dealer.z)
    g.character.teleport(pos)
    await new Promise(r => setTimeout(r, 1500))
    const moneyBefore = g.account.money
    for (let i = 0; i < 100 && !g.account.garage.includes(kind); i++) {
      if (i % 15 === 0) g.send({ t: 'buy', shop: dealer.id, item: kind })
      await new Promise(r => setTimeout(r, 100))
    }
    const owned = g.account.garage.includes(kind)
    const paid = moneyBefore - g.account.money
    pos.set(60, 0, -2.5)
    g.character.teleport(pos)
    await new Promise(r => setTimeout(r, 500))
    if (!owned) return { owned, paid, traffic: false, note: document.getElementById('toast')?.textContent, money: g.account.money, at: g.character.position }
    g.garageAction(kind)
    const v = g.vehicles.get(kind)
    g.placeVehicle(v, 40, 2.5, 0)
    g.hud.closeModals()
    g.enterVehicle(v)
    const traffic = [...g.remotes.vehicles.values()].some(rv => rv.kind === kind)
    return { owned, paid, traffic }
  }, { kind, dealer })
  // Software WebGL in CI renders the whole town far below 1 fps, so drive by
  // stepping the game's own fixed update (input → Vehicle → Rapier) for 4 s.
  assert(result.owned && result.paid === 14500, `bought it at Maple Motors for $${result.paid} ${result.owned ? '' : JSON.stringify(result)}`)
  await game.keyboard.down('w')
  await game.evaluate(() => { const g = window.maple; for (let i = 0; i < 240; i++) g.fixed(1 / 60) })
  result.speed = await game.evaluate(kind => window.maple.vehicles.get(kind).speed, kind)
  await game.keyboard.up('w')
  assert(result.speed > 5, `drove it (${(result.speed * 2.237).toFixed(0)} mph after 4 s)`)
  assert(result.traffic, 'it drives around town as neighbor traffic')
  await game.screenshot({ path: join(OUT, 'solo-drive.png'), timeout: 5000 }).catch(() => log('(software renderer too slow for a game screenshot)'))
  await game.close()

  // ---------------------------------------------------------------- 4. Shared world
  // A fresh browser: software WebGL is slow enough that leftovers from the
  // earlier pages can make the page miss the shared world's handshake.
  await browser.close()
  browser = await chromium.launch(launchArgs)
  context = await browser.newContext({ baseURL: BASE, viewport: { width: 1024, height: 700 } })
  api = context.request
  await api.post('/api/pool-account', { headers, data: { action: 'login', username: 'stoegbauer', password: PASSWORD } })
  const openWorld = async () => {
    for (let attempt = 1; attempt <= 4; attempt++) {
      const page = await context.newPage()
      page.on('pageerror', e => errors.push(`world: ${e.message}`))
      await page.addInitScript(() => { localStorage.setItem('maplestreet/body', 'male') })
      await page.goto('/modules/maplestreet.html?world=1&webgl&noao', { waitUntil: 'domcontentloaded', timeout: 120000 })
      await page.waitForFunction(() => window.maple && window.maple.account, null, { timeout: 180000 })
      const label = await page.evaluate(() => window.maple.net?.label ?? '')
      if (!/offline/i.test(label)) { log(`connected to the shared world (${label}, attempt ${attempt})`); return page }
      log(`software renderer missed the shared-world handshake (attempt ${attempt}), retrying`)
      await page.close()
    }
    throw new Error('FAILED: could not reach the shared world')
  }
  const world = await openWorld()
  const shared = await world.evaluate(async ({ kind, dealer }) => {
    const g = window.maple
    const pos = g.character.position.clone()
    pos.set(dealer.x, 0, dealer.z)
    g.character.teleport(pos)
    await new Promise(r => setTimeout(r, 2500))
    for (let i = 0; i < 150 && !g.account.garage.includes(kind); i++) {
      if (i % 15 === 0) g.send({ t: 'buy', shop: dealer.id, item: kind })
      await new Promise(r => setTimeout(r, 100))
    }
    await new Promise(r => setTimeout(r, 2000))
    return { owned: g.account.garage.includes(kind), traffic: [...g.remotes.vehicles.values()].some(rv => rv.kind === kind) }
  }, { kind, dealer })
  assert(shared.owned, 'the shared world (Durable Object) sells and keeps the published vehicle')
  assert(shared.traffic, 'shared-world traffic includes it')

  const retire = await api.patch('/api/maplestreet-vehicles', { headers, data: { id: wagon.id, active: false } })
  assert(retire.ok(), 'retire works')
  await world.close()
  const again = await openWorld()
  const kept = await again.evaluate(kind => window.maple.account.garage.includes(kind), kind)
  assert(kept, 'owners keep a retired vehicle in their garage')
  await api.patch('/api/maplestreet-vehicles', { headers, data: { id: wagon.id, active: true } })

  const fatal = errors.filter(e => !/WebGPU|GPU stall|AudioContext/.test(e))
  writeFileSync(join(OUT, 'errors.txt'), errors.join('\n'))
  assert(fatal.length === 0, `no page errors (${errors.length} logged, see .e2e/errors.txt)`)
  log('ALL PASSED')
} catch (error) {
  console.error(error)
  writeFileSync(join(OUT, 'errors.txt'), errors.join('\n'))
  process.exitCode = 1
} finally {
  await browser.close()
}
