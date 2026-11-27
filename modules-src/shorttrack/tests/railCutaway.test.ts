import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { test } from 'node:test'
import * as THREE from 'three'
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js'
import { MeshoptDecoder } from 'three/addons/libs/meshopt_decoder.module.js'
import { CAD } from '../../railsetup/sim/hardpoints'
import { Lab } from '../../railsetup/sim/lab'
import { railVehicle } from '../../railsetup/sim/vehicle'
import { nk } from '../../railsetup/ui/parts'
import type { RailState } from '../next/sim/railDynamics'
import { createCutaway, hingeAngle } from '../rail-cutaway'
import type { CutawayModel } from '../rail-cutaway'
import { runRail } from './railRun'

const SC = 1.6
const TM_S = 0.98 / SC
const REST: [number, number, number][] = [[1.35, 0.33, -0.8], [1.35, 0.33, 0.8], [-1.4, 0.33, -0.78], [-1.4, 0.33, 0.78]]
const CORNER = [0, 1, 2, 3]

function loadGlb(): Promise<THREE.Object3D> {
  const buf = readFileSync(join(process.cwd(), 'public/models/railsetup/chassis.glb'))
  const data = buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength)
  const loader = new GLTFLoader()
  loader.setMeshoptDecoder(MeshoptDecoder)
  return new Promise((resolve, reject) => loader.parse(data, '', (g) => resolve(g.scene), reject))
}

function model() {
  const root = new THREE.Group(), body = new THREE.Group(), tmg = new THREE.Group()
  root.scale.setScalar(SC)
  root.add(body)
  tmg.rotation.y = -Math.PI / 2
  tmg.scale.setScalar(TM_S)
  body.add(tmg)
  const paint = new THREE.MeshStandardMaterial()
  const shell = new THREE.Mesh(new THREE.BoxGeometry(4, 1, 2), paint)
  const glass = new THREE.Mesh(new THREE.BoxGeometry(1, 0.5, 1.6), paint)
  tmg.add(shell, glass)
  const wheels = REST.map((p, i) => {
    const pivot = new THREE.Group()
    pivot.position.fromArray(p)
    pivot.add(new THREE.Mesh(new THREE.CylinderGeometry(0.33, 0.33, 0.3), paint))
    tmg.add(pivot)
    return { pivot, front: i < 2 }
  })
  return { m: { root, body, tmg, wheels } as CutawayModel, shell, glass }
}

function pose(m: CutawayModel, st: RailState) {
  m.wheels.forEach((w, i) => w.pivot.position.set(REST[i][0], REST[i][1] + st.travel[i] / (TM_S * SC), REST[i][2]))
}

const named = (frame: THREE.Object3D, name: string) => {
  let hit: THREE.Mesh | undefined
  const key = nk(name)
  frame.traverse((o) => { if (nk(o.name) === key) hit = o as THREE.Mesh })
  assert.ok(hit, `part ${name}`)
  return hit as THREE.Mesh
}

test('hinge angle lifts the ball joint by the asked travel', () => {
  const h = CAD.L
  for (const dz of [-2, -0.5, 0.7, 2.5]) {
    const t = hingeAngle(h.LIF, h.LIR, h.LBJ, dz)
    const axis = new THREE.Vector3().fromArray(h.LIR).sub(new THREE.Vector3().fromArray(h.LIF)).normalize()
    const p = new THREE.Vector3().fromArray(h.LBJ).sub(new THREE.Vector3().fromArray(h.LIF)).applyAxisAngle(axis, t).add(new THREE.Vector3().fromArray(h.LIF))
    assert.ok(Math.abs(p.z - (h.LBJ[2] + dz)) < 1e-6, `dz ${dz}`)
  }
})

test("Show chassis: the Lab's chassis model replaces the body and follows live travel, off restores the car", async () => {
  const veh = railVehicle(new Lab(), 'base')
  const { m, shell, glass } = model()
  const cut = createCutaway(SC, loadGlb)
  const states: RailState[] = []
  runRail(veh, undefined, 2, undefined, (_w, c) => {
    if (c.rail && Math.abs(c.rail.ay) > 6 && Math.abs(c.rail.travel[1] - c.rail.travel[0]) > 0.003) states.push(structuredClone(c.rail))
  })
  assert.ok(states.length > 20, `cornering samples (${states.length})`)
  const first = states[0]
  pose(m, first)
  cut.update(m, first, CORNER, true)
  await cut.ready()
  let frame: THREE.Group | undefined
  let checked = 0
  for (const st of states) {
    pose(m, st)
    cut.update(m, st, CORNER, true)
    frame = m.body.children.find((o) => o instanceof THREE.Group && o !== m.tmg) as THREE.Group
    assert.ok(frame?.visible, 'chassis shown')
    const lower = { L: named(frame, 'LS Lower Control Arm-1'), R: named(frame, 'RS Lower Control Arm-1') }
    const zL = new THREE.Vector3().fromArray(CAD.L.LBJ).applyMatrix4(lower.L.matrix).z - CAD.L.LBJ[2]
    const zR = new THREE.Vector3().fromArray(CAD.R.LBJ).applyMatrix4(lower.R.matrix).z - CAD.R.LBJ[2]
    const dt = st.travel[0] - st.travel[1]
    assert.ok((zL - zR) * dt > 0, 'the front wheel with more bump lifts its lower ball joint more')
    assert.ok(Math.abs((zL - zR) * 0.0254 - dt) < 0.25 * Math.abs(dt) + 0.002, `ball joint travel ${(zL - zR) * 0.0254} vs ${dt}`)
    const housing = named(frame, 'rear housing-1')
    const e = new THREE.Euler().setFromRotationMatrix(housing.matrix)
    if (Math.abs(st.travel[2] - st.travel[3]) > 0.003) assert.ok(e.x * (st.travel[2] - st.travel[3]) > 0, 'the rear housing rolls with the rear wheels')
    checked++
  }
  assert.ok(checked > 20)
  assert.ok(frame)
  let parts = 0, rims = 0
  frame.traverse((o) => {
    if (!(o as THREE.Mesh).isMesh || o.parent === frame) return
    parts++
    if (/wheels/i.test(o.name)) { rims++; assert.equal(o.visible, false, 'chassis rims hidden, the car tires carry it') }
    const mat = (o as THREE.Mesh).material as THREE.MeshStandardMaterial
    assert.ok(mat.roughness >= 0.8, 'matte parts')
  })
  assert.ok(parts >= 140, `CAD parts shown (${parts})`)
  assert.equal(rims, 4)
  const fit = named(frame, 'Front Hub Straight Rail-1')
  const hub = fit.geometry.boundingBox!.getCenter(new THREE.Vector3()).applyMatrix4(fit.matrix).applyMatrix4(fit.parent!.matrix)
  const carHub = m.wheels[0].pivot.position.clone().applyMatrix4(m.tmg!.matrix).multiplyScalar(SC)
  assert.ok(Math.abs(hub.z - carHub.z) < 0.08 && Math.abs(hub.y - carHub.y) < 0.08, `chassis LF hub on the car's LF wheel (${hub.toArray()} vs ${carHub.toArray()})`)
  assert.equal(shell.visible, false, 'body hidden')
  assert.equal(glass.visible, false, 'glass hidden')
  assert.ok(m.wheels.every((w) => w.pivot.children[0].visible), 'car wheels and tires stay')
  cut.hide()
  assert.equal(frame.visible, false)
  assert.equal(shell.visible, true, 'body restored')
  assert.equal(glass.visible, true)
})
