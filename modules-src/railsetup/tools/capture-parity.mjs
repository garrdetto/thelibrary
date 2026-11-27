import { createServer } from 'node:http'
import { readFileSync, writeFileSync, statSync } from 'node:fs'
import { extname, join, resolve } from 'node:path'
import { chromium } from 'playwright'

const webDir = process.argv[2]
if (!webDir) {
  console.error('usage: node modules-src/railsetup/tools/capture-parity.mjs <extracted web folder> [cases]')
  process.exit(1)
}
const caseCount = Number(process.argv[3] || 24)
const out = resolve(import.meta.dirname, '../tests/fixtures/parity.json')
const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.woff2': 'font/woff2', '.glb': 'model/gltf-binary', '.txt': 'text/plain' }

const server = createServer((req, res) => {
  const path = decodeURIComponent(new URL(req.url, 'http://x').pathname)
  if (req.method === 'POST') { res.writeHead(204).end(); return }
  const file = join(webDir, path === '/' ? 'index.html' : path)
  try {
    if (!statSync(file).isFile()) throw new Error('dir')
    res.writeHead(200, { 'content-type': types[extname(file)] || 'application/octet-stream' }).end(readFileSync(file))
  } catch {
    res.writeHead(404).end()
  }
})
await new Promise(r => server.listen(0, '127.0.0.1', r))
const port = server.address().port

function rng(seed) {
  return () => {
    seed |= 0; seed = seed + 0x6D2B79F5 | 0
    let t = Math.imul(seed ^ seed >>> 15, 1 | seed)
    t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t
    return ((t ^ t >>> 14) >>> 0) / 4294967296
  }
}

const RANGES = {
  g: [0, 1.2, 0.01], gx: [-1, 0.6, 0.01], bank: [0, 16, 0.5], 'k-heave': [-1, 1, 0.05], 'k-roll': [-1.5, 1.5, 0.05],
  wt: [2600, 3600, 25], mrb: [0.5, 0.9, 0.05], arm: [8, 12, 0.125], rsb: [30, 44, 0.125], unf: [180, 300, 10], unr: [380, 560, 10], bb: [52, 70, 1], rad: [60, 240, 5],
  wwlf: [8, 12, 0.5], wwrf: [8, 12, 0.5], wwlr: [8, 12, 0.5], wwrr: [8, 12, 0.5], bslf: [3, 6, 0.25], bsrf: [3, 6, 0.25], bslr: [3, 6, 0.25], bsrr: [3, 6, 0.25], hulr: [-1, 1, 0.125], hurr: [-1, 1, 0.125],
  tclf: [80, 88, 0.125], tcrf: [80, 88, 0.125], tclr: [80, 88, 0.125], tcrr: [82, 92, 0.125], tk: [900, 2000, 25],
  lf: [450, 900, 25], rf: [450, 950, 25], lr: [125, 300, 25], rr: [150, 350, 25], bar: [1.375, 1.875, 0.0625], bid: [0.75, 1.25, 0.0625], bpre: [-0.125, 0.25, 0.03125],
  blf: [0, 3000, 50], glf: [0.5, 1.5, 0.0625], brf: [0, 3000, 50], grf: [0.5, 1.5, 0.0625], blr: [0, 2000, 50], glr: [0.5, 1.5, 0.0625], brr: [0, 2000, 50], grr: [0.5, 1.5, 0.0625],
  rbar: [0, 1, 0.0625], ctor: [2000, 12000, 250], cg: [14, 18, 0.25],
  hlf: [2.5, 4, 0.03125], hrf: [2.5, 4, 0.03125], hrr: [2.75, 4.25, 0.03125], ls: [53, 58, 0.1], rp: [46, 52, 0.1], cr: [48, 55, 0.1],
  rnlf: [-3, 3, 1], rnrf: [-3, 3, 1], rnlr: [-3, 3, 1], rnrr: [-3, 3, 1],
}
const ADJR = { ufz: [-1, 1, 0.0625], urz: [-1, 1, 0.0625], ufx: [-1, 1, 0.0625], urx: [-1, 1, 0.0625], lfz: [-1, 1, 0.0625], lrz: [-1, 1, 0.0625], lfx: [-1, 1, 0.0625], lrx: [-1, 1, 0.0625], camber: [-0.75, 0.75, 0.03125], caster: [-1.5, 1.5, 0.03125], tro: [-1.5, 1.5, 0.0625], toeIn: [-0.25, 0.25, 0.03125], ucaLen: [-0.5, 0.5, 0.0625], lcaLen: [-0.5, 0.5, 0.0625], ucaX: [-1, 1, 0.0625], tri: [-1.5, 1.5, 0.0625], umh: [-0.75, 1, 0.0625], lmh: [-1, 0.75, 0.0625] }
const RADJR = { LLa: [-2, 2, 0.125], LLc: [-2, 2, 0.125], RLa: [-2, 2, 0.125], RLc: [-2, 2, 0.125], ULa: [-2, 2, 0.125], ULc: [-2, 2, 0.125], ULlen: [-0.5, 0.5, 0.0625], ULya: [-6, 6, 0.25], ULyc: [-6, 6, 0.25], TBa: [-3, 3, 0.125], TBc: [-3, 3, 0.125] }
const SLUGS = [0, 0.25, 0.375, 0.5, 1]

const r = rng(20261126)
const pick = ([lo, hi, st]) => +(Math.round((lo + (hi - lo) * r()) / st) * st).toFixed(6)
const some = (ranges, share) => Object.fromEntries(Object.entries(ranges).filter(() => r() < share).map(([k, v]) => [k, pick(v)]))
const cases = [{ name: 'defaults', inputs: {}, adj: { L: {}, R: {} }, radj: {}, mrFixed: false, steer: 0 }]
cases.push({ name: 'defaults in a 0.9 g corner', inputs: { g: 0.9 }, adj: { L: {}, R: {} }, radj: {}, mrFixed: false, steer: 0 })
cases.push({ name: 'advanced mode', inputs: { adv: 1, g: 0.8 }, adj: { L: {}, R: {} }, radj: {}, mrFixed: false, steer: 0 })
cases.push({ name: 'J-bar, reversed, braking', inputs: { g: 0.6, gx: -0.6 }, adj: { L: {}, R: {} }, radj: { TBtype: 1, TBflip: 1 }, mrFixed: false, steer: 0 })
for (let i = cases.length; i < caseCount; i++) {
  const inputs = { ...some(RANGES, 0.55), g: pick(RANGES.g) }
  if (r() < 0.25) inputs.adv = 1
  const adj = { L: some(ADJR, 0.3), R: some(ADJR, 0.3) }
  if (r() < 0.3) adj.R.lslug = SLUGS[Math.floor(r() * SLUGS.length)]
  if (r() < 0.3) adj.L.uslug = SLUGS[Math.floor(r() * SLUGS.length)]
  const radj = some(RADJR, 0.35)
  if (r() < 0.3) radj.TBtype = 1
  if (r() < 0.3) radj.TBflip = 1
  cases.push({ name: `random ${i}`, inputs, adj, radj, mrFixed: r() < 0.2, steer: r() < 0.4 ? pick([-6, 6, 0.25]) : 0 })
}

const browser = await chromium.launch({ channel: 'msedge', args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] })
const page = await browser.newPage({ viewport: { width: 1200, height: 800 } })
page.on('pageerror', e => console.error('page error:', e.message))
await page.goto(`http://127.0.0.1:${port}/index.html`)
await page.waitForFunction(() => typeof loaded !== 'undefined' && loaded === true, null, { timeout: 180000 })

const endLinks = await page.evaluate(() => ({ L: { up: ENDL.L.up, lo: ENDL.L.lo }, R: { up: ENDL.R.up, lo: ENDL.R.lo } }))
const results = []
for (const c of cases) {
  const res = await page.evaluate((c) => {
    const R = x => typeof x === 'number' ? (isFinite(x) ? +x.toPrecision(11) : null) : Array.isArray(x) ? x.map(R) : x && typeof x === 'object' ? Object.fromEntries(Object.entries(x).map(([k, v]) => [k, R(v)])) : x
    const pickRows = (rows, keys, every = 1) => rows.filter((_, i) => i % every === 0).map(o => keys.map(k => o[k]))
    stopDrive()
    setBaseline(null)
    setSetup(DEF)
    setSetup(c.inputs)
    adj.L = { ...ADJ0, ...c.adj.L }; adj.R = { ...ADJ0, ...c.adj.R }
    Object.assign(radj, RADJ0, c.radj); rearSet()
    $('mr-fixed').checked = c.mrFixed
    $('k-steer').value = c.steer
    WKEY = 'force'
    recompute()
    const m = model
    const AK = ['camber', 'caster', 'toe', 'kpi', 'scrub', 'trail', 'ad', 'dy', 'wx']
    const live = s => { const a = KIN.angles(kc[s], m.P[s]); return [a.camber, a.caster, a.kpi, a.toe, a.scrub, a.trail] }
    const adv = $('adv').value === '1' ? advSolve() : null
    return R({
      steerRack: STEER,
      inputsAfter: { hlf: +$('hlf').value, hrf: +$('hrf').value, hrr: +$('hrr').value, cr: +$('cr').value },
      model: {
        phi: m.phi, phiF: m.phiF, phiR: m.phiR, lltd: m.lltd, hf: m.hf, hr: m.hr, loads: m.loads, dzF: m.dzF, dzR: m.dzR, pitch: m.pitch, bal: m.bal, stg: m.stg,
        cross: m.cross, fjtot: m.fj.tot, jkFz: m.jk.Fz, fjL: m.fjL, rjL: m.rjL, Kfront: m.Kfront, Krear: m.Krear, Kb: m.Kb, dStatic: m.dStatic, hNow: m.rest.hNow,
        bump: m.bump.map(b => b.s), mrL: m.mrL, mrR: m.mrR, ad: m.ad, asq: m.asq, pose0phi: m.pose0.phi, rsLr: m.rs.lr, nz: m.nz, ay: m.ay,
      },
      adv: adv && { hts: adv.hts, loads: adv.loads, cross: adv.cross, len: adv.len },
      lengths: { L: kc.L.L, R: kc.R.L },
      caster: { L: casterNow('L'), R: casterNow('R') },
      curves: { L: pickRows(curves.L, AK), R: pickRows(curves.R, AK) },
      mrt: { L: MRT.L && MRT.L.mr.filter((_, i) => i % 2 === 0), R: MRT.R && MRT.R.mr.filter((_, i) => i % 2 === 0), RL: MRTR.L.mr.filter((_, i) => i % 2 === 0), RR: MRTR.R.mr.filter((_, i) => i % 2 === 0) },
      roll: pickRows(frontRollAll(kc.L, kc.R), ['rc', 'y', 'camL', 'camR', 'jT', 'twist'], 2),
      steer: pickRows(steerAll(kc.L, kc.R), ['x', 'lf', 'rf', 'lL', 'lR'], 4),
      rearRoll: pickRows(rearRollAll(RG), ['rc', 'jack', 'shift', 'steer', 'lead', 'tb'], 2),
      rearHeave: pickRows(rearHeaveAll(RG, MRTR), ['as', 'pin', 'steer', 'rc', 'mrL', 'mrR', 'ula'], 2),
      third: pickRows(thirdAll(RG), ['u', 'side', 'dLR'], 4),
      live: { L: live('L'), R: live('R') },
      rear: { jack: jacking(m.rp, m), third: thirdLink(m.rp, m) },
      summary: outSummary(),
    })
  }, c)
  results.push({ ...c, out: res })
  process.stdout.write('.')
}
await browser.close()
server.close()
writeFileSync(out, JSON.stringify({ source: 'StraightRailSetupLab web app v1 (version.txt 1)', endLinks, cases: results }))
console.log(`\nwrote ${results.length} cases to ${out}`)
