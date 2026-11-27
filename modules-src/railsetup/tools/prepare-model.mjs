import { NodeIO } from '@gltf-transform/core'
import { simplify, weld, dedup, prune } from '@gltf-transform/functions'
import { MeshoptSimplifier } from 'meshoptimizer'
import { mkdirSync } from 'node:fs'
import { dirname, resolve } from 'node:path'

const src = process.argv[2]
if (!src) {
  console.error('usage: node modules-src/railsetup/tools/prepare-model.mjs <car.glb from the original app> [ratio] [error]')
  process.exit(1)
}
const ratio = Number(process.argv[3] || 0.04)
const error = Number(process.argv[4] || 0.001)
const out = resolve(import.meta.dirname, '../../../assets-src/models/railsetup/chassis.glb')

const RENAME = [[/straight winters/i, 'rear housing']]

const tris = doc => doc.getRoot().listMeshes().reduce((n, m) => n + m.listPrimitives().reduce((k, p) => k + (p.getIndices()?.getCount() ?? p.getAttribute('POSITION').getCount()) / 3, 0), 0)

await MeshoptSimplifier.ready
const io = new NodeIO()
const doc = await io.read(src)
const before = tris(doc)
for (const node of doc.getRoot().listNodes()) {
  let name = node.getName()
  for (const [re, to] of RENAME) name = name.replace(re, to)
  node.setName(name)
  node.setExtras({})
  const mesh = node.getMesh()
  if (mesh) mesh.setName(name).setExtras({})
}
for (const m of doc.getRoot().listMeshes()) { m.setExtras({}); for (const p of m.listPrimitives()) p.setExtras({}) }
doc.getRoot().setExtras({})
await doc.transform(dedup(), weld(), simplify({ simplifier: MeshoptSimplifier, ratio, error, lockBorder: false }), prune({ keepLeaves: true }))
mkdirSync(dirname(out), { recursive: true })
await io.write(out, doc)
console.log(`triangles ${before} -> ${tris(doc)}; wrote ${out}`)
