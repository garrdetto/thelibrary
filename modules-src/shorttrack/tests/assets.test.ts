import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { test } from 'node:test'
import { NodeIO, type Document, type Node } from '@gltf-transform/core'
import { ALL_EXTENSIONS } from '@gltf-transform/extensions'
import { MeshoptDecoder } from 'meshoptimizer'

const root = process.cwd()
const CAR_BUDGETS = [60000, 18000, 4000]
const WHEEL_BUDGETS = [6000, 2000, 400]

async function load(file: string): Promise<Document> {
  await MeshoptDecoder.ready
  const io = new NodeIO().registerExtensions(ALL_EXTENSIONS).registerDependencies({ 'meshopt.decoder': MeshoptDecoder })
  return io.read(join(root, 'public/models/shorttrack', file))
}

function triangles(doc: Document): number {
  let n = 0
  for (const mesh of doc.getRoot().listMeshes()) for (const prim of mesh.listPrimitives()) {
    const idx = prim.getIndices()
    n += (idx ? idx.getCount() : prim.getAttribute('POSITION')!.getCount()) / 3
  }
  return n
}

const byName = (doc: Document, name: string): Node | undefined => doc.getRoot().listNodes().find((node) => node.getName() === name)

function classicCar() {
  const buf = readFileSync(join(root, 'public/modules/shorttrack-car.bin'))
  const len = buf.readUInt32LE(4)
  return JSON.parse(buf.subarray(8, 8 + len).toString('utf8')) as { regions: unknown[]; parts: { name: string; center: number[] | null }[] }
}

for (let level = 0; level < 3; level += 1) {
  test(`stock car LOD${level}: budget, wheel pivots and livery regions`, async () => {
    const doc = await load(`car_slm_lod${level}.glb`)
    const tris = triangles(doc)
    assert.ok(tris <= CAR_BUDGETS[level], `${tris} triangles over ${CAR_BUDGETS[level]}`)
    if (level === 0) assert.ok(tris > 30000, 'LOD0 keeps the full body')
    const meta = classicCar()
    const car = byName(doc, 'StockCar')
    assert.ok(car, 'StockCar root')
    const extras = car.getExtras() as { regions: string; materials: string }
    assert.deepEqual(JSON.parse(extras.regions), meta.regions)
    assert.deepEqual(JSON.parse(extras.materials), ['slm_paint', 'slm_interior', 'slm_glass', 'slm_tire', 'slm_rim', 'slm_tail'])
    assert.ok(doc.getRoot().listMeshes().some((mesh) => mesh.getName() === 'Body'), 'Body mesh')
    const tags: Record<string, number[]> = {}
    for (const part of meta.parts) if (part.center) {
      const [x, , z] = part.center
      tags[`${x > 0 ? 'F' : 'R'}${z > 0 ? 'L' : 'R'}`] = part.center
    }
    for (const [tag, center] of Object.entries(tags)) {
      const pivot = byName(doc, `Wheel_${tag}`)
      assert.ok(pivot, `Wheel_${tag}`)
      pivot.getTranslation().forEach((v, i) => assert.ok(Math.abs(v - center[i]) < 1e-4, `Wheel_${tag} hub ${i}: ${v} vs ${center[i]}`))
      assert.ok(pivot.listChildren().some((child) => child.getName() === `Tire_${tag}`), `Tire_${tag} under its pivot`)
    }
  })
}

for (let level = 0; level < 3; level += 1) {
  test(`race wheel LOD${level}: budget, hub at origin, stock size`, async () => {
    const doc = await load(`wheel_race_lod${level}.glb`)
    assert.ok(triangles(doc) <= WHEEL_BUDGETS[level])
    const pivot = byName(doc, 'Wheel_Shared')
    assert.ok(pivot)
    assert.deepEqual(pivot.getTranslation(), [0, 0, 0])
    let maxR = 0, minZ = Infinity, maxZ = -Infinity
    for (const child of pivot.listChildren()) {
      const pos = child.getMesh()?.listPrimitives()[0]?.getAttribute('POSITION')
      if (!pos) continue
      const scale = child.getScale(), t = child.getTranslation()
      const el: number[] = []
      for (let i = 0; i < pos.getCount(); i += 1) {
        pos.getElement(i, el)
        const x = el[0] * scale[0] + t[0], y = el[1] * scale[1] + t[1], z = el[2] * scale[2] + t[2]
        maxR = Math.max(maxR, Math.hypot(x, y))
        minZ = Math.min(minZ, z)
        maxZ = Math.max(maxZ, z)
      }
    }
    assert.ok(Math.abs(maxR - 0.352) < 0.01, `tyre radius ${maxR}`)
    assert.ok(maxZ - minZ > 0.44 && maxZ - minZ < 0.5, `width ${maxZ - minZ}`)
  })
}
