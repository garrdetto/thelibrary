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

const TRUCK_BUDGETS = [50000, 15000, 4000]
const PACE_BUDGETS = [40000, 12000, 3000]
const PROP_BUDGET = 1500

function materialNames(doc: Document): Set<string> {
  return new Set(doc.getRoot().listMaterials().map((material) => material.getName()))
}

function checkPivots(doc: Document, axles: { front: number; rear: number }, tireMaterial: string) {
  for (const tag of ['FL', 'FR', 'RL', 'RR']) {
    const pivot = byName(doc, `Wheel_${tag}`)
    assert.ok(pivot, `Wheel_${tag}`)
    const [x, y, z] = pivot.getTranslation()
    assert.ok(Math.abs(x - (tag[0] === 'F' ? axles.front : axles.rear)) < 0.02, `Wheel_${tag} axle ${x}`)
    assert.ok(y > 0.25 && y < 0.5, `Wheel_${tag} hub height ${y}`)
    assert.ok(tag[1] === 'L' ? z < -0.6 : z > 0.6, `Wheel_${tag} side ${z} (z is the right side)`)
    const tire = pivot.listChildren().find((child) => child.getName() === `Tire_${tag}`)
    assert.ok(tire, `Tire_${tag} under its pivot`)
    const used = tire.getMesh()?.listPrimitives().map((prim) => prim.getMaterial()?.getName())
    assert.ok(used?.includes(tireMaterial), `Tire_${tag} keeps its tyre (${used})`)
  }
}

for (let level = 0; level < 3; level += 1) {
  test(`race truck LOD${level}: budget, wheel pivots on the truck's axles, named materials`, async () => {
    const { TM } = (await import('../truck-model.js')) as { TM: { DIM: { FA: number; RA: number } } }
    const doc = await load(`truck_race_lod${level}.glb`)
    const tris = triangles(doc)
    assert.ok(tris <= TRUCK_BUDGETS[level], `${tris} triangles over ${TRUCK_BUDGETS[level]}`)
    if (level === 0) assert.ok(tris > 40000, 'LOD0 keeps the full body')
    assert.ok(byName(doc, 'RaceTruck'), 'RaceTruck root')
    checkPivots(doc, { front: TM.DIM.FA, rear: TM.DIM.RA }, 'truck_tire')
    const names = materialNames(doc)
    for (const name of ['truck_paint', 'truck_glass', 'truck_tire', 'truck_taillight']) assert.ok(names.has(name), name)
  })

  test(`pace car LOD${level}: budget, wheel pivots, paint and light bar`, async () => {
    const doc = await load(`pace_car_lod${level}.glb`)
    const tris = triangles(doc)
    assert.ok(tris <= PACE_BUDGETS[level], `${tris} triangles over ${PACE_BUDGETS[level]}`)
    assert.ok(byName(doc, 'PaceCar'), 'PaceCar root')
    checkPivots(doc, { front: 1.4, rear: -1.38 }, 'pace_tire')
    const names = materialNames(doc)
    for (const name of ['pace_paint', 'pace_glass', 'pace_light_red', 'pace_light_blue', 'pace_tire']) assert.ok(names.has(name), name)
  })
}

test('track prop kit: six separate props on their origins, each within budget', async () => {
  const doc = await load('props_kit.glb')
  const props = doc.getRoot().listNodes().filter((node) => node.getName().startsWith('Prop_'))
  assert.deepEqual(props.map((node) => node.getName()).sort(), ['Prop_barrier', 'Prop_cone', 'Prop_hay_bale', 'Prop_light_tower', 'Prop_pit_board', 'Prop_tyre_stack'])
  for (const node of props) {
    let n = 0
    for (const prim of node.getMesh()!.listPrimitives()) n += prim.getIndices()!.getCount() / 3
    assert.ok(n <= PROP_BUDGET, `${node.getName()}: ${n} triangles`)
    const [x, , z] = node.getTranslation()
    assert.ok(Math.abs(x) < 0.05 && Math.abs(z) < 0.05, `${node.getName()} stands on its origin`)
  }
})
