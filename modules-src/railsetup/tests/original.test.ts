import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { gunzipSync } from 'node:zlib'
import { ANCHORS, composePage, originalFile, readManifest } from '../tools/original-page'

const dir = resolve(process.cwd(), 'modules-src/railsetup')
const sha = (b: Buffer | string) => createHash('sha256').update(b).digest('hex')
const m = readManifest(dir)

test('every file of the original page is byte for byte the one inside StraightRailSetupLab.exe', () => {
  const names = Object.keys(m.files)
  assert.ok(names.includes('index.html') && names.includes('kin.js') && names.includes('lib/three.min.js'))
  for (const rel of names) {
    if (rel === 'car.glb') continue
    const data = originalFile(rel, dir, m)
    assert.equal(data.length, m.files[rel].bytes, rel)
    assert.equal(sha(data), m.files[rel].sha256, rel)
  }
})

test('three.js, GLTFLoader and OrbitControls come from the pinned three@0.128.0 package', () => {
  for (const rel of ['lib/three.min.js', 'lib/GLTFLoader.js', 'lib/OrbitControls.js']) assert.equal(m.files[rel].from, 'three-r128', rel)
  const pkg = JSON.parse(readFileSync(resolve(process.cwd(), 'node_modules/three-r128/package.json'), 'utf8')) as { version: string }
  assert.equal(pkg.version, '0.128.0')
})

test('the car.glb pieces unpack to the original 70 MB model (all 143 parts, no simplification)', () => {
  const gz = Buffer.concat(m.car.pieces.map(p => readFileSync(join(dir, 'original', 'car', p))))
  assert.equal(gz.length, m.car.gzBytes)
  assert.equal(sha(gz), m.car.gzSha256)
  for (const p of m.car.pieces) assert.ok(readFileSync(join(dir, 'original', 'car', p)).length <= 25 * 1024 * 1024, `${p} is over Cloudflare's 25 MiB file limit`)
  const glb = gunzipSync(gz)
  assert.equal(glb.length, m.car.bytes)
  assert.equal(sha(glb), m.car.sha256)
  const json = JSON.parse(glb.subarray(20, 20 + glb.readUInt32LE(12)).toString('utf8')) as { meshes: unknown[] }
  assert.equal(json.meshes.length, 143)
})

test('the served page is the original with only the base, car loader, site bundle and bridge added', () => {
  const html = originalFile('index.html', dir, m).toString('utf8')
  assert.equal(html.split(ANCHORS.head).length - 1 >= 1, true)
  const tags = '<script type="module" src="/modules/chunks/railsetup-x.js"></script>'
  const car = { path: '/modules/railsetup/car.glb', pieces: ['/modules/chunks/a.gz'], bytes: 1, gzBytes: 1 }
  const page = composePage(html, tags, car, dir)
  const pre = page.match(/<base href="\/modules\/railsetup\/"><script>[\s\S]*?<\/script>/)
  assert.ok(pre, 'base and car loader after <meta charset>')
  assert.ok(!page.includes('__RAIL_CAR__'))
  const bridge = page.match(/\n<script>window\.__rail=[\s\S]*<\/script>\n$/)
  assert.ok(bridge, 'bridge at the end')
  const restored = page.replace(pre[0], '').replace('\n' + tags, '').replace(bridge[0], '')
  assert.equal(restored, html, 'removing the additions gives the original byte for byte')
})

test('the bridge only names things the original page declares', () => {
  const html = originalFile('index.html', dir, m).toString('utf8')
  const bridge = readFileSync(join(dir, 'site', 'bridge.js'), 'utf8')
  for (const name of ['saved', 'adj', 'radj', 'HP', 'HP0', 'DEF', 'loaded', 'SETUP_EL', 'snapshot', 'fillLists', 'useHardpoints', 'writeSaved']) {
    assert.ok(bridge.includes(name), name)
    assert.ok(new RegExp(`(?:let|const|var|function)\\s+${name}\\b|[,;{(]\\s*${name}\\s*=`).test(html), `${name} is not declared in the original`)
  }
  for (const id of ['sv-name', 'sv-list', 'sv-save', 'hp-file', 'help', 'v-help', 'rad', 'mr-fixed', 'loading']) assert.ok(html.includes(`id="${id}"`), id)
  assert.ok(html.includes('Saved on this computer.'), 'site/app.ts replaces this note')
})

test('the car loader answers the launcher pings locally and fetches the pieces', () => {
  const pre = readFileSync(join(dir, 'site', 'pre.js'), 'utf8')
  for (const s of ["'/ping'", "'/bye'", 'DecompressionStream', 'CAR.path', 'sendBeacon']) assert.ok(pre.includes(s), s)
  const html = originalFile('index.html', dir, m).toString('utf8')
  assert.ok(html.includes("fetch('car.glb')") && html.includes("fetch('/ping'") && html.includes("sendBeacon('/bye')"))
})
