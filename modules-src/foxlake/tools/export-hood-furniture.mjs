/**
 * Exports The Hood's whole buy catalog for Fox Lake's home builder: every item built by The Hood's own furniture
 * code in a headless browser (`hood-furniture/page.ts`, with The Hood's textured surfaces swapped for plain
 * materials that remember their texture), written to `assets-src/models/foxlake/hood-furniture.glb`: one root node
 * per catalog id, one primitive per material. A material's name is The Hood's texture (`grain`, `fabric`, `stone`,
 * …) or `plain`; Fox Lake lays its own texture of that kind over it. Then run `node scripts/assets.mjs`.
 *
 *   node modules-src/foxlake/tools/export-hood-furniture.mjs
 */
import { build } from 'esbuild'
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { chromium } from 'playwright'
import { Document, NodeIO } from '@gltf-transform/core'
import { KHRMaterialsEmissiveStrength } from '@gltf-transform/extensions'
import { dedup, weld } from '@gltf-transform/functions'

const here = dirname(fileURLToPath(import.meta.url))
const root = resolve(here, '../../..')
const stub = join(here, 'hood-furniture/surfaces-stub.ts')
const out = join(root, 'assets-src/models/foxlake/hood-furniture.glb')

const bundle = await build({
  entryPoints: [join(here, 'hood-furniture/page.ts')],
  bundle: true,
  write: false,
  format: 'esm',
  platform: 'browser',
  logLevel: 'warning',
  nodePaths: [join(root, 'node_modules')],
  plugins: [{
    name: 'hood-surfaces',
    setup(b) {
      b.onResolve({ filter: /\/Surfaces$/ }, (args) => (args.resolveDir.replace(/\\/g, '/').endsWith('hood/src/models') ? { path: stub } : undefined))
    },
  }],
})
const script = bundle.outputFiles[0].text

const browser = await chromium.launch({ channel: process.env.PW_CHANNEL ?? 'chrome' })
try {
  const page = await browser.newPage()
  page.on('console', (m) => { if (m.type() === 'error' || m.type() === 'warning') console.log('[page]', m.text()) })
  await page.route('http://hood.export/**', async (route) => {
    const url = new URL(route.request().url())
    if (url.pathname === '/') return route.fulfill({ contentType: 'text/html', body: '<!doctype html><meta charset="utf-8"><title>export</title>' })
    if (url.pathname === '/app.js') return route.fulfill({ contentType: 'text/javascript', body: script })
    if (url.pathname.startsWith('/models/hood/')) return route.fulfill({ contentType: 'model/gltf-binary', body: readFileSync(join(root, 'public', url.pathname)) })
    return route.fulfill({ status: 404, body: '' })
  })
  await page.goto('http://hood.export/')
  await page.addScriptTag({ url: '/app.js', type: 'module' })
  await page.waitForFunction(() => typeof window.exportHood === 'function')
  const items = await page.evaluate(() => window.exportHood())

  const doc = new Document()
  const buffer = doc.createBuffer()
  const scene = doc.createScene('hood-furniture')
  const strength = doc.createExtension(KHRMaterialsEmissiveStrength)
  const materials = new Map()
  const materialFor = (m) => {
    let mat = materials.get(m.key)
    if (mat) return mat
    mat = doc.createMaterial(m.surface ?? 'plain')
      .setBaseColorFactor([m.color[0], m.color[1], m.color[2], m.opacity])
      .setRoughnessFactor(m.roughness)
      .setMetallicFactor(m.metalness)
      .setDoubleSided(m.doubleSided)
      .setAlphaMode(m.opacity < 1 ? 'BLEND' : 'OPAQUE')
    if (m.emissiveIntensity > 0 && Math.max(...m.emissive) > 0) {
      mat.setEmissiveFactor(m.emissive)
      if (m.emissiveIntensity > 1) mat.setExtension('KHR_materials_emissive_strength', strength.createEmissiveStrength().setEmissiveStrength(m.emissiveIntensity))
    }
    materials.set(m.key, mat)
    return mat
  }
  let tris = 0
  for (const item of items) {
    const mesh = doc.createMesh(item.id)
    for (const part of item.parts) {
      if (!part.positions.length) continue
      const prim = doc.createPrimitive()
        .setAttribute('POSITION', doc.createAccessor().setType('VEC3').setArray(new Float32Array(part.positions)).setBuffer(buffer))
        .setAttribute('NORMAL', doc.createAccessor().setType('VEC3').setArray(new Float32Array(part.normals)).setBuffer(buffer))
        .setAttribute('TEXCOORD_0', doc.createAccessor().setType('VEC2').setArray(new Float32Array(part.uvs)).setBuffer(buffer))
        .setMaterial(materialFor(part.material))
      mesh.addPrimitive(prim)
      tris += part.positions.length / 9
    }
    scene.addChild(doc.createNode(item.id).setMesh(mesh))
  }
  await doc.transform(dedup(), weld())
  mkdirSync(dirname(out), { recursive: true })
  writeFileSync(out, await new NodeIO().registerExtensions([KHRMaterialsEmissiveStrength]).writeBinary(doc))
  console.log(`${items.length} items, ${materials.size} materials, ${tris} triangles → ${out}`)
} finally {
  await browser.close()
}
