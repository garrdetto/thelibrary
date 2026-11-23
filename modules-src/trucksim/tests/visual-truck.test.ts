import { test } from 'node:test'
import assert from 'node:assert/strict'
import { NullEngine } from '@babylonjs/core/Engines/nullEngine'
import { Scene } from '@babylonjs/core/scene'
import { TransformNode } from '@babylonjs/core/Meshes/transformNode'
import { FreeCamera } from '@babylonjs/core/Cameras/freeCamera'
import { HemisphericLight } from '@babylonjs/core/Lights/hemisphericLight'
import { Matrix, Vector3 } from '@babylonjs/core/Maths/math.vector'
import { VertexBuffer } from '@babylonjs/core/Buffers/buffer'
import type { Mesh } from '@babylonjs/core/Meshes/mesh'
import { MaterialLibrary } from '../render/Materials'
import { buildTruckVisual, type TruckVisual } from '../render/models/TruckVisual'
import { CARGOS, TRUCKS, defaultLook, type TruckLook, type TruckModel } from '../shared/Catalog'
import type { TruckPose } from '../sim/types'

function makeScene() {
  const engine = new NullEngine()
  const scene = new Scene(engine)
  scene.useRightHandedSystem = true
  const parent = new TransformNode('frame-root', scene)
  return { engine, scene, parent }
}

function restPose(model: TruckModel): TruckPose {
  const wheels = model.axles.flatMap((axle) => [1, -1].map((side) => ({
    x: (side * model.track) / 2, y: model.wheelRadius, z: axle.z, steer: 0, spin: 0, radius: model.wheelRadius, dual: axle.dual, lifted: false,
  })))
  return {
    position: { x: 0, y: 0, z: 0 }, rotation: { x: 0, y: 0, z: 0, w: 1 }, wheels,
    dumpAngle: 0, tailgate: 0, brakeLights: false, reversing: false, headlights: false, load: 0,
  }
}

function instanceData(mesh: Mesh): Float32Array {
  return (mesh as unknown as { _thinInstanceDataStorage: { matrixData: Float32Array } })._thinInstanceDataStorage.matrixData
}

function drawCalls(visual: TruckVisual): number {
  return visual.meshes.filter((mesh) => mesh.isEnabled() && mesh.isVisible && mesh.getTotalVertices() > 0).length
}

function subMeshCalls(visual: TruckVisual): number {
  return visual.meshes.filter((mesh) => mesh.isEnabled() && mesh.isVisible && mesh.getTotalVertices() > 0).reduce((sum, mesh) => sum + (mesh.subMeshes?.length ?? 1), 0)
}

const OPTIONS: Array<[keyof TruckLook | 'finish' | 'stripe', readonly unknown[]]> = [
  ['stacks', ['none', 'single', 'dual', 'dualTall']],
  ['visor', [true, false]],
  ['bumper', ['stock', 'chrome', 'heavy']],
  ['lights', ['stock', 'cabBar', 'full']],
  ['wheels', ['steel', 'polished', 'black']],
  ['mudflaps', ['plain', 'chrome']],
  ['horn', ['stock', 'air']],
  ['finish', ['gloss', 'metallic', 'matte']],
  ['stripe', ['none', 'pinstripe', 'band', 'swoosh', 'twoTone', 'chevron']],
  ['grille', ['stock', 'bars', 'slats', 'mesh', 'blackout']],
  ['roof', ['none', 'low', 'tall']],
  ['skirts', [true, false]],
]

function variant(model: TruckModel, field: string, value: unknown): TruckLook {
  const look = defaultLook(model)
  if (field === 'finish' || field === 'stripe') return { ...look, paint: { ...look.paint, [field]: value } }
  return { ...look, [field]: value } as TruckLook
}

function checkGeometry(mesh: Mesh): void {
  const positions = mesh.getVerticesData(VertexBuffer.PositionKind)
  const normals = mesh.getVerticesData(VertexBuffer.NormalKind)
  const indices = mesh.getIndices()
  assert.ok(positions && normals && indices, `${mesh.name} has geometry`)
  for (let i = 0; i < positions.length; i++) assert.ok(Number.isFinite(positions[i]), `${mesh.name} position ${i} finite`)
  for (let i = 0; i < normals.length; i += 3) {
    const length = Math.hypot(normals[i], normals[i + 1], normals[i + 2])
    assert.ok(Number.isFinite(length), `${mesh.name} normal ${i / 3} finite`)
  }
  let checked = 0
  let agree = 0
  for (let t = 0; t < indices.length; t += 3) {
    const a = indices[t] * 3
    const b = indices[t + 1] * 3
    const c = indices[t + 2] * 3
    const ux = positions[b] - positions[a]
    const uy = positions[b + 1] - positions[a + 1]
    const uz = positions[b + 2] - positions[a + 2]
    const vx = positions[c] - positions[a]
    const vy = positions[c + 1] - positions[a + 1]
    const vz = positions[c + 2] - positions[a + 2]
    const cx = uy * vz - uz * vy
    const cy = uz * vx - ux * vz
    const cz = ux * vy - uy * vx
    const area = Math.hypot(cx, cy, cz)
    if (area < 1e-9) continue
    const nx = normals[a] + normals[b] + normals[c]
    const ny = normals[a + 1] + normals[b + 1] + normals[c + 1]
    const nz = normals[a + 2] + normals[b + 2] + normals[c + 2]
    checked++
    if (cx * nx + cy * ny + cz * nz < 0) agree++
  }
  assert.ok(checked === 0 || agree / checked > 0.97, `${mesh.name}: ${agree}/${checked} triangles face their normals`)
}

test('every catalog truck builds with its default look, under the given parent', () => {
  const { engine, scene, parent } = makeScene()
  const mats = new MaterialLibrary(scene)
  for (const model of TRUCKS) {
    const visual = buildTruckVisual(scene, parent, model, defaultLook(model), mats)
    assert.equal(visual.root.parent, parent, `${model.id} root parent`)
    assert.ok(visual.meshes.length > 5, `${model.id} has meshes`)
    for (const mesh of visual.meshes) {
      assert.ok(mesh.isDescendantOf(visual.root), `${mesh.name} under the truck root`)
      assert.ok(mesh.material, `${mesh.name} has a material`)
      checkGeometry(mesh)
    }
    assert.equal(visual.bed !== null, model.dump !== undefined, `${model.id} bed`)
    const bounds = visual.root.getHierarchyBoundingVectors(true)
    assert.ok(bounds.max.z <= model.frontZ + 0.15 && bounds.max.z >= model.frontZ - 0.25, `${model.id} front ${bounds.max.z.toFixed(2)} vs ${model.frontZ}`)
    assert.ok(bounds.min.z >= model.rearZ - 0.25, `${model.id} rear ${bounds.min.z.toFixed(2)} vs ${model.rearZ}`)
    assert.ok(bounds.max.y <= model.roofHeight + 1.3 && bounds.max.y >= model.cabHeight - 0.05, `${model.id} height ${bounds.max.y.toFixed(2)}`)
    assert.ok(bounds.min.y >= -0.11, `${model.id} sits on the ground`)
    visual.dispose()
  }
  mats.dispose()
  engine.dispose()
})

test('every truck builds with every option of every look field', () => {
  const { engine, scene, parent } = makeScene()
  const mats = new MaterialLibrary(scene)
  for (const model of TRUCKS) {
    for (const [field, values] of OPTIONS) {
      for (const value of values) {
        const visual = buildTruckVisual(scene, parent, model, variant(model, field, value), mats)
        assert.ok(visual.meshes.length > 5, `${model.id} ${field}=${String(value)}`)
        visual.dispose()
      }
    }
    const visual = buildTruckVisual(scene, parent, model, defaultLook(model), mats)
    for (const [field, values] of OPTIONS) {
      for (const value of values) {
        visual.setLook(variant(model, field, value))
        for (const mesh of visual.meshes) assert.ok(!mesh.isDisposed(), `${model.id} ${field}=${String(value)} live meshes after setLook`)
      }
    }
    visual.dispose()
  }
  mats.trim(0)
  mats.dispose()
  assert.equal(scene.meshes.length, 0)
  engine.dispose()
})

test('update places the root, moves and steers wheels, raises the bed and switches lamps', () => {
  const { engine, scene, parent } = makeScene()
  const mats = new MaterialLibrary(scene)
  for (const model of TRUCKS) {
    const visual = buildTruckVisual(scene, parent, model, defaultLook(model), mats)
    const pose = restPose(model)
    visual.update(pose)
    const tire = visual.wheels.meshes[0]
    const before = Float32Array.from(instanceData(tire))
    pose.position = { x: 10, y: 2, z: -5 }
    pose.rotation = { x: 0, y: Math.sin(0.25), z: 0, w: Math.cos(0.25) }
    for (const wheel of pose.wheels) {
      wheel.y = model.wheelRadius - 0.05
      wheel.spin = 1.3
      if (Math.abs(wheel.z) < 1e-6) wheel.steer = 0.3
      wheel.lifted = true
    }
    pose.dumpAngle = 0.6
    pose.tailgate = 1
    pose.brakeLights = true
    pose.reversing = true
    pose.headlights = true
    visual.update(pose)
    assert.equal(visual.root.position.x, 10)
    assert.ok(Math.abs(visual.root.rotationQuaternion!.y - Math.sin(0.25)) < 1e-9)
    for (const slot of visual.wheels.slots) {
      const expectedY = slot.lift ? model.wheelRadius + 0.24 : model.wheelRadius - 0.05
      assert.ok(Math.abs(slot.knuckle.position.y - expectedY) < 1e-6, `${model.id} wheel ${slot.axle} y ${slot.knuckle.position.y}`)
      const steer = slot.steer ? 0.3 : 0
      const yaw = steer + (slot.side < 0 ? Math.PI : 0)
      assert.ok(Math.abs(slot.knuckle.rotation.y - yaw) < 1e-6, `${model.id} steer`)
      assert.ok(Math.abs(Math.abs(slot.hub.rotation.x) - 1.3) < 1e-6, `${model.id} spin`)
    }
    const after = instanceData(tire)
    let moved = false
    for (let k = 0; k < after.length; k++) if (Math.abs(after[k] - before[k]) > 1e-4) moved = true
    assert.ok(moved, `${model.id} tyre instances moved`)
    const steerSlot = visual.wheels.slots.find((slot) => slot.steer && slot.side > 0)!
    const instance = Matrix.FromArray(after, visual.wheels.slots.indexOf(steerSlot) * 16)
    const forward = Vector3.TransformNormal(new Vector3(0, 0, 1), instance)
    assert.ok(Math.abs(Math.atan2(forward.x, forward.z) - 0.3) < 1e-4, `${model.id} steer turns the tyre left (+X)`)
    if (model.dump) {
      assert.ok(visual.bed && Math.abs(visual.bed.rotation.x + 0.6) < 1e-9, `${model.id} bed angle`)
      assert.ok(visual.tailgate && visual.tailgate.rotation.x > 1, `${model.id} tailgate`)
      visual.root.computeWorldMatrix(true)
      const bedMeshes = visual.meshes.filter((mesh) => mesh.isDescendantOf(visual.bed!))
      const top = Math.max(...bedMeshes.map((mesh) => {
        mesh.computeWorldMatrix(true)
        return mesh.getBoundingInfo().boundingBox.maximumWorld.y
      }))
      assert.ok(top > 2 + model.dump.bedFloorY + model.dump.sideHeight + 1, `${model.id} bed front rises (${top.toFixed(2)})`)
      const rod = scene.getTransformNodeByName(`truck-${model.id}-hoist-rod`)!
      assert.ok(rod.scaling.y > 1, `${model.id} hoist extends (${rod.scaling.y.toFixed(2)})`)
      visual.setLoad(0.8, CARGOS[0].color)
      assert.ok(visual.heap!.isEnabled() && visual.heap!.scaling.y > 0.5)
      visual.setLoad(0, null)
      assert.ok(!visual.heap!.isEnabled())
    }
    const lit = visual.meshes.filter((mesh) => mesh.name.endsWith('-body-tail') || mesh.name.endsWith('-body-reverse') || mesh.name.endsWith('-body-head'))
    assert.ok(lit.length >= 3, `${model.id} lamp meshes`)
    for (const mesh of lit) assert.ok((mesh.material as unknown as { emissiveIntensity: number }).emissiveIntensity > 2, `${mesh.name} lit`)
    pose.brakeLights = false
    pose.reversing = false
    pose.headlights = false
    visual.update(pose)
    for (const mesh of lit) assert.ok((mesh.material as unknown as { emissiveIntensity: number }).emissiveIntensity < 0.5, `${mesh.name} off`)
    visual.dispose()
  }
  mats.dispose()
  engine.dispose()
})

test('each truck stays within the draw-call budget', () => {
  const { engine, scene, parent } = makeScene()
  const mats = new MaterialLibrary(scene)
  const report: string[] = []
  for (const model of TRUCKS) {
    const heavy: TruckLook = { ...defaultLook(model), stacks: 'dualTall', visor: true, lights: 'full', horn: 'air', mudflaps: 'chrome', paint: { ...model.defaultPaint, stripe: 'swoosh' } }
    for (const look of [defaultLook(model), heavy]) {
      const visual = buildTruckVisual(scene, parent, model, look, mats)
      if (model.dump) visual.setLoad(1, CARGOS[0].color)
      const calls = drawCalls(visual)
      const subs = subMeshCalls(visual)
      assert.ok(calls <= 60, `${model.id}: ${calls} draw calls`)
      assert.equal(subs, calls, `${model.id}: one sub-mesh per mesh`)
      if (look !== heavy) report.push(`${model.id} ${calls}`)
      else report[report.length - 1] += `/${calls}`
      visual.dispose()
    }
  }
  console.log(`draw calls (default/loaded-out): ${report.join(', ')}`)
  mats.dispose()
  engine.dispose()
})

test('30 build/dispose cycles over all trucks return every count to the baseline', () => {
  const { engine, scene, parent } = makeScene()
  const mats = new MaterialLibrary(scene)
  const palette = ['#d8a21c', '#c8321f', '#2b5fa8', '#1f5d46', '#e8e6df', '#141518', '#7a3fa0']
  const cycle = (round: number) => {
    TRUCKS.forEach((model, index) => {
      const look = defaultLook(model)
      look.paint = { ...look.paint, primary: palette[(round + index) % palette.length], stripe: (['none', 'pinstripe', 'band', 'swoosh'] as const)[(round + index) % 4] }
      const visual = buildTruckVisual(scene, parent, model, look, mats)
      const pose = restPose(model)
      pose.dumpAngle = 0.3
      pose.brakeLights = round % 2 === 0
      visual.update(pose)
      visual.setLoad(0.7, CARGOS[(round + index) % 5].color)
      visual.setLook({ ...look, stacks: 'dual', lights: 'cabBar', paint: { ...look.paint, secondary: palette[(round + index + 3) % palette.length], finish: 'metallic' } })
      visual.update(pose)
      visual.dispose()
    })
  }
  cycle(0)
  mats.trim(0)
  const baseline = { meshes: scene.meshes.length, materials: scene.materials.length, geometries: scene.geometries.length, textures: scene.textures.length, nodes: scene.transformNodes.length }
  for (let round = 1; round <= 30; round++) cycle(round)
  mats.trim(0)
  const now = { meshes: scene.meshes.length, materials: scene.materials.length, geometries: scene.geometries.length, textures: scene.textures.length, nodes: scene.transformNodes.length }
  assert.deepEqual(now, baseline)
  assert.equal(mats.cachedCount, 0)
  mats.dispose()
  assert.equal(scene.materials.length, 0, 'MaterialLibrary.dispose leaves zero materials')
  engine.dispose()
})

test('MaterialLibrary shares named materials, counts paint references and trims the unused', () => {
  const { engine, scene } = makeScene()
  const mats = new MaterialLibrary(scene)
  assert.equal(mats.get('chrome'), mats.get('chrome'))
  const a = mats.paint('#AABBCC', 'gloss')
  const b = mats.paint('#aabbcc', 'gloss')
  assert.equal(a, b)
  assert.equal(mats.refsOf(a), 2)
  assert.notEqual(mats.paint('#aabbcc', 'matte'), a)
  assert.ok(a.roughness >= 0.5 && a.roughness <= 0.6, 'gloss paint keeps about 15 % of normal gloss')
  assert.ok(mats.get('rubber').roughness >= 0.85 && mats.get('rubber').metallicF0Factor === 0, 'rubber has no gloss')
  assert.ok(mats.get('darkSteel').roughness >= 0.85 && mats.get('deck').roughness >= 0.85)
  assert.equal(mats.get('chrome').metallic, 1)
  mats.release(a)
  mats.trim(0)
  assert.ok(!a.isFrozen && scene.materials.includes(a), 'held paint survives trim')
  mats.release(b)
  const cargo = mats.get('cargo:#8d877d')
  mats.trim(0)
  assert.ok(!scene.materials.includes(a), 'released paint trimmed')
  assert.ok(scene.materials.includes(cargo), 'pinned cargo kept')
  const lamp = mats.lampInstance('red', 'test')
  lamp.dispose()
  mats.dispose()
  assert.equal(scene.materials.length, 0)
  engine.dispose()
})

test('a scene with trucks renders a frame on the NullEngine', () => {
  const { engine, scene, parent } = makeScene()
  const camera = new FreeCamera('camera', new Vector3(8, 4, 12), scene)
  camera.setTarget(Vector3.Zero())
  new HemisphericLight('light', new Vector3(0, 1, 0), scene)
  const mats = new MaterialLibrary(scene)
  parent.scaling.set(1, 1, -1)
  const visuals = TRUCKS.map((model, index) => {
    const visual = buildTruckVisual(scene, parent, model, defaultLook(model), mats)
    const pose = restPose(model)
    pose.position = { x: index * 4, y: 0, z: 0 }
    visual.update(pose)
    return visual
  })
  scene.render()
  for (const visual of visuals) visual.dispose()
  mats.dispose()
  engine.dispose()
})
