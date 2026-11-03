/**
 * End-to-end check of Maple Street drafts and the reseeded neighborhood
 * against a local dev server (pnpm dev, with ADMIN_PASSWORD in .dev.vars and
 * the local D1 migrated):
 *
 *   1. /api/maplestreet-items: a draft is hidden from players, listed to the
 *      admin with ?drafts=1, and goes live when published. Items published
 *      through the old per-kind table are still listed.
 *   2. The developer instance (?dev=1) loads drafts into its own solo save,
 *      a draft item can be placed on a lot there, and F8 opens the dev panel.
 *   3. A fresh solo neighborhood has every starter house; screenshots of the
 *      streets, sidewalks, trees, Maple Commons and the downtown grid go to .e2e/.
 *   4. The admin item editor shows the draft badge and actions.
 *
 *   ADMIN_PASSWORD=… node scripts/maplestreet-drafts-e2e.mjs [baseUrl] [legacyItemId]
 */
import { build } from 'esbuild'
import { chromium } from 'playwright'
import { mkdirSync, readFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'

const BASE = process.argv[2] ?? 'http://localhost:3000'
const LEGACY_ID = process.argv[3] ?? null
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
const launchArgs = { args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] }
const browser = await chromium.launch(launchArgs)
const admin = await browser.newContext({ baseURL: BASE, viewport: { width: 1440, height: 900 } })
const guest = await browser.newContext({ baseURL: BASE, viewport: { width: 1100, height: 680 } })
const headers = { Origin: BASE, 'Content-Type': 'application/json' }
const errors = []

// Software WebGL in CI takes well over 30 s per frame of the whole town.
const shot = async (page, name) => { await page.screenshot({ path: join(OUT, `${name}.png`), timeout: 300000 }); log('screenshot', name) }

async function view(page, name, eye, at) {
  await page.evaluate(({ eye, at }) => {
    const g = window.maple
    g.cam.update = () => {}
    g.engine.camera.position.set(eye[0], eye[1], eye[2])
    g.engine.camera.lookAt(at[0], at[1], at[2])
  }, { eye, at })
  await page.waitForTimeout(2000)
  await shot(page, name)
}

try {
  const login = await admin.request.post('/api/pool-account', { headers, data: { action: 'login', username: 'stoegbauer', password: PASSWORD } })
  assert(login.ok(), 'admin signs in')

  // ---------------------------------------------------------------- 1. API
  const before = await (await admin.request.get('/api/maplestreet-items?drafts=1')).json()
  if (LEGACY_ID) assert(before.items.some(i => i.id === LEGACY_ID && i.status === 'published'), 'an item from the old table is copied into the asset registry')

  const model = readFileSync(join(root, 'public/models/maplestreet/furniture/bench.glb'))
  const publish = async (name, status) => {
    const res = await admin.request.post('/api/maplestreet-items', {
      headers: { Origin: BASE },
      multipart: {
        model: { name: 'bench.glb', mimeType: 'model/gltf-binary', buffer: model },
        name, price: '320', scale: JSON.stringify({ x: 1, y: 1, z: 1 }), room: 'outdoor', func: 'seating',
        indoor: 'false', solid: 'true', yaw: '0', w: '2', d: '1', h: '0.9', status,
      },
    })
    assert(res.status() === 201, `${status} "${name}" is saved (${res.status()})`)
    return (await res.json()).item
  }
  const draft = await publish('Porch Glider', 'draft')
  assert(draft.status === 'draft' && draft.active === true, 'it comes back as an active draft')
  const second = await publish('Garden Settee', 'draft')

  const publicList = await (await guest.request.get('/api/maplestreet-items?drafts=1')).json()
  assert(publicList.drafts === false && !publicList.items.some(i => i.id === draft.id), 'players never see drafts, even when they ask')
  const plainAdmin = await (await admin.request.get('/api/maplestreet-items')).json()
  assert(!plainAdmin.items.some(i => i.id === draft.id), 'the game’s normal list leaves drafts out for the admin too')
  const adminList = await (await admin.request.get('/api/maplestreet-items?drafts=1')).json()
  assert(adminList.drafts === true && adminList.items.some(i => i.id === draft.id), 'the admin gets drafts with ?drafts=1')

  const live = await admin.request.patch('/api/maplestreet-items', { headers, data: { id: draft.id, status: 'published' } })
  assert(live.ok() && (await live.json()).item.status === 'published', 'publishing a draft makes it live')
  const afterPublish = await (await guest.request.get('/api/maplestreet-items')).json()
  assert(afterPublish.items.some(i => i.id === draft.id), 'players see it once published')
  const retired = await admin.request.patch('/api/maplestreet-items', { headers, data: { id: draft.id, active: false } })
  assert((await retired.json()).item.status === 'retired', 'the old retire request still works')
  const forbidden = await guest.request.patch('/api/maplestreet-items', { headers, data: { id: second.id, status: 'published' } })
  assert(forbidden.status() === 401 || forbidden.status() === 403, 'only the admin can change status')
  const vehicles = await admin.request.get('/api/maplestreet-vehicles?drafts=1')
  assert(vehicles.ok() && (await vehicles.json()).drafts === true, 'vehicles list drafts for the admin')

  // ---------------------------------------------------------------- 2. developer instance
  const dev = await admin.newPage()
  dev.on('pageerror', e => errors.push(`dev: ${e.message}`))
  await dev.addInitScript(() => { localStorage.setItem('maplestreet/body', 'female') })
  await dev.goto('/modules/maplestreet.html?dev=1&webgl&noao')
  await dev.waitForFunction(() => /Drafts loaded/.test(document.querySelector('.dev-note')?.textContent ?? ''), null, { timeout: 60000 })
  const note = await dev.locator('.dev-note').innerText()
  assert(/1 item/.test(note), `the start screen reports the draft (${note})`)
  await shot(dev, 'dev-start')
  await dev.locator('#playWorld').click({ timeout: 180000 })
  await dev.waitForFunction(() => window.maple && window.maple.account, null, { timeout: 180000 })
  const label = await dev.evaluate(() => window.maple.net?.label ?? '')
  assert(/Developer instance/.test(label), `runs on the developer solo authority (${label})`)
  const placed = await dev.evaluate(async id => {
    const g = window.maple
    const world = g.houses.world
    const lot = Object.values(world.lots).find(l => !l.owner)
    g.send({ t: 'build', seq: 9001, op: { op: 'buyLot', lotId: lot.id } })
    await new Promise(r => setTimeout(r, 800))
    const front = lot.front === '+z' ? lot.z + lot.d - 20 : lot.z + 18
    g.send({ t: 'build', seq: 9002, op: { op: 'object', lotId: lot.id, obj: { id: 'devcheck01', catalogId: `custom:${id}`, gx: lot.x + 16, gz: front, rot: 0, level: 0 } } })
    await new Promise(r => setTimeout(r, 800))
    return { lot: lot.id, owner: world.lots[lot.id].owner, placed: !!world.builds[lot.id].objects.devcheck01 }
  }, second.id)
  assert(placed.placed, `a draft item is placed on ${placed.lot} in the developer instance`)
  await dev.keyboard.press('F8')
  await dev.locator('#devPanel li', { hasText: 'Garden Settee' }).waitFor({ timeout: 20000 })
  const panel = await dev.locator('#devPanel').innerText()
  assert(/Draft/.test(panel) && /Place/.test(panel), 'F8 opens the dev panel with the draft and a Place button')
  await shot(dev, 'dev-panel')
  await dev.evaluate(() => window.maple.houses && dispatchEvent(new Event('pagehide')))
  const saves = await dev.evaluate(() => ({ dev: !!localStorage.getItem('maplestreet/dev/v1'), solo: !!localStorage.getItem('maplestreet/offline/v2') }))
  assert(saves.dev && !saves.solo, 'the developer instance keeps its own save')
  await dev.close()

  // ---------------------------------------------------------------- 3. fresh neighborhood
  const solo = await guest.newPage()
  solo.on('pageerror', e => errors.push(`solo: ${e.message}`))
  await solo.addInitScript(() => { localStorage.setItem('maplestreet/body', 'male'); localStorage.setItem('maplestreet/name', 'tester') })
  await solo.goto('/modules/maplestreet.html?solo=1&webgl&noao')
  await solo.waitForFunction(() => window.maple && window.maple.account, null, { timeout: 180000 })
  const census = await solo.evaluate(() => {
    const lots = Object.values(window.maple.houses.world.lots)
    return { neighbors: lots.filter(l => l.owner?.startsWith('npc-')).length, open: lots.filter(l => !l.owner).length, seed: window.maple.houses.world.seedVersion }
  })
  assert(census.neighbors === 28 && census.open >= 30 && census.seed === 2, `28 starter houses and ${census.open} lots for sale`)
  // Bundled vehicles (shared/BundledVehicles.ts): on the lot, buyable, and they sit on their wheels and drive.
  const bundled = ['custom:bundled-meridian-sedan', 'custom:bundled-bulwark-4x4', 'custom:bundled-ironhorn-crew-cab']
  const lot = await solo.evaluate(async ({ kinds, dealer }) => {
    const g = window.maple
    const pos = g.character.position.clone()
    pos.set(dealer.x, 0, dealer.z)
    g.character.teleport(pos)
    await new Promise(r => setTimeout(r, 1500))
    const before = g.account.money
    for (let i = 0; i < 100 && !kinds.every(k => g.account.garage.includes(k)); i++) {
      if (i % 15 === 0) for (const k of kinds) if (!g.account.garage.includes(k)) g.send({ t: 'buy', shop: dealer.id, item: k })
      await new Promise(r => setTimeout(r, 100))
    }
    const out = { owned: kinds.filter(k => g.account.garage.includes(k)), paid: before - g.account.money, cars: [] }
    // Straight through addVehicle: the garage only lets one extra vehicle out at a time.
    kinds.forEach((k, i) => { if (out.owned.includes(k)) { const at = pos.clone().set(25 + i * 11, 0, 2.5); g.placeVehicle(g.vehicles.get(k) ?? g.addVehicle(k, at, 0), at.x, at.z, 0) } })
    g.hud.closeModals()
    for (let i = 0; i < 150; i++) g.fixed(1 / 60)
    for (const k of out.owned) {
      const v = g.vehicles.get(k), t = v.body.translation(), q = v.body.rotation()
      let verts = 0
      v.root.traverse(o => { if (o.isMesh) verts = Math.max(verts, o.geometry.attributes.position?.count ?? 0) })
      const P = v.preset, ride = P.axles[0].radius - (P.wheelY - P.suspension.rest * 0.8)
      out.cars.push({ k, y: +t.y.toFixed(3), ride: +ride.toFixed(3), up: +(1 - 2 * (q.x * q.x + q.z * q.z)).toFixed(3), verts })
    }
    return out
  }, { kinds: bundled, dealer })
  assert(lot.owned.length === 3, `the three bundled vehicles are sold at Maple Motors (${lot.owned.length} owned, $${lot.paid} paid)`)
  for (const c of lot.cars) {
    assert(c.up > 0.98 && Math.abs(c.y - c.ride) < 0.2 && c.verts > 5000, `${c.k} sits upright on its wheels with its model loaded (y ${c.y} vs ride ${c.ride}, up ${c.up}, ${c.verts} vertices)`)
  }
  // New neighbors get the "Choose your plot" map, which takes the keyboard: dismiss it before screenshots and driving.
  const dismissPlot = () => solo.evaluate(() => {
    for (const b of document.querySelectorAll('button')) if (/^Explore first$/.test(b.textContent?.trim() ?? '') && b.offsetParent) b.click()
    window.maple.hud.closeModals()
  })
  // Each bundled vehicle on its own on the road: a side-on screenshot from its real pose, then a 4 s pull.
  const everyBundled = [...bundled, 'custom:bundled-maple-hauler', 'custom:bundled-lakeshore-coupe']
  for (const k of everyBundled) {
    await dismissPlot()
    const eye = await solo.evaluate(k => {
      const g = window.maple
      for (const other of [...g.vehicles.keys()].filter(x => x.startsWith('custom:bundled-'))) {
        const o = g.vehicles.get(other)
        if (o && other !== k) { o.dispose(g.engine.scene); g.vehicles.delete(other) }
      }
      const at = g.character.position.clone().set(30, 0, 2.5)
      const v = g.vehicles.get(k) ?? g.addVehicle(k, at, 0)
      g.placeVehicle(v, at.x, at.z, 0)
      for (let i = 0; i < 90; i++) g.fixed(1 / 60)
      const c = v.localToWorld(0, 0, 0), side = v.localToWorld(0, 1.2, 8), other = v.localToWorld(-2, 1.6, -8), nose = v.localToWorld(1, 0, 0)
      return { eye: [side.x, side.y, side.z], eye2: [other.x, other.y, other.z], at: [c.x, c.y, c.z], heading: [+(nose.x - c.x).toFixed(2), +(nose.z - c.z).toFixed(2)] }
    }, k)
    log(`${k} heading`, JSON.stringify(eye.heading))
    await view(solo, `bundled-${k.slice('custom:bundled-'.length)}`, eye.eye, eye.at)
    await view(solo, `bundled-${k.slice('custom:bundled-'.length)}-left`, eye.eye2, eye.at)
    await dismissPlot()
    await solo.evaluate(k => { const g = window.maple; g.enterVehicle(g.vehicles.get(k)) }, k)
    await solo.locator('canvas').first().focus().catch(() => {})
    await solo.keyboard.down('w')
    await solo.evaluate(() => { const g = window.maple; for (let i = 0; i < 240; i++) g.fixed(1 / 60) })
    await solo.keyboard.up('w')
    const mph = await solo.evaluate(k => window.maple.vehicles.get(k).speed * 2.237, k)
    assert(mph > 11, `${k} drives (${mph.toFixed(0)} mph after 4 s)`)
    await solo.evaluate(k => { const g = window.maple; const v = g.vehicles.get(k); for (let i = 0; i < 300 && Math.abs(v.speed) > 0.3; i++) g.fixed(1 / 60); g.exitVehicle?.() }, k)
  }
  await solo.evaluate(() => { document.querySelectorAll('.ui, .hud, #minimap').forEach(el => { el.style.visibility = 'hidden' }) })
  await view(solo, 'street-south', [-30, 10, 42], [-30, 3, 80])
  await view(solo, 'street-south-east', [34, 10, 42], [34, 3, 80])
  await view(solo, 'main-north', [-20, 9, 2], [-20, 3, -30])
  await view(solo, 'birch-street', [0, 10, -120], [0, 2, -160])
  await view(solo, 'avenue-sidewalk', [76, 2.2, 32], [84, 0.5, 8])
  await view(solo, 'overview', [0, 180, 150], [0, 0, 0])
  await view(solo, 'maple-commons', [290, 14, -6], [312, 0, 30])
  await view(solo, 'downtown-main', [372, 8, -2], [440, 6, -2])
  await view(solo, 'downtown-overview', [300, 200, 260], [400, 0, 0])
  await solo.close()

  // ---------------------------------------------------------------- 4. editor
  const editor = await admin.newPage()
  editor.on('pageerror', e => errors.push(`editor: ${e.message}`))
  await editor.goto('/')
  await editor.getByRole('button', { name: 'Admin', exact: true }).click()
  await editor.getByRole('tab', { name: 'Items', exact: true }).click()
  await editor.getByRole('heading', { name: 'Your items' }).waitFor()
  await editor.locator('.ms-items-list li.is-draft', { hasText: 'Garden Settee' }).waitFor()
  assert(await editor.getByRole('button', { name: 'Save as draft' }).count() === 1, 'the editor offers Save as draft')
  await editor.locator('.ms-items-list').scrollIntoViewIfNeeded()
  await shot(editor, 'editor-list')
  await editor.close()

  assert(errors.length === 0, `no page errors${errors.length ? `: ${errors.join(' | ')}` : ''}`)
  log('all checks passed')
} finally {
  await browser.close()
}
