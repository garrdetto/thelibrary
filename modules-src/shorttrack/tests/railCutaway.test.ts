import assert from 'node:assert/strict'
import { test } from 'node:test'
import * as THREE from 'three'
import { Lab } from '../../railsetup/sim/lab'
import { railVehicle } from '../../railsetup/sim/vehicle'
import type { RailState } from '../next/sim/railDynamics'
import { createCutaway } from '../rail-cutaway'
import type { CutawayModel } from '../rail-cutaway'
import { runRail } from './railRun'

const SC = 1.6
const TM_S = 0.98 / SC
const REST: [number, number, number][] = [[1.35, 0.33, -0.8], [1.35, 0.33, 0.8], [-1.4, 0.33, -0.78], [-1.4, 0.33, 0.78]]
const CORNER = [0, 1, 2, 3]

function model() {
  const root = new THREE.Group(), body = new THREE.Group(), tmg = new THREE.Group()
  root.scale.setScalar(SC)
  root.add(body)
  tmg.rotation.y = -Math.PI / 2
  tmg.scale.setScalar(TM_S)
  body.add(tmg)
  const paint = new THREE.MeshStandardMaterial()
  const shell = new THREE.Mesh(new THREE.BoxGeometry(4, 1, 2), [paint, paint])
  shell.castShadow = true
  tmg.add(shell)
  const wheels = REST.map((p, i) => {
    const pivot = new THREE.Group()
    pivot.position.fromArray(p)
    pivot.add(new THREE.Mesh(new THREE.CylinderGeometry(0.33, 0.33, 0.3), paint))
    tmg.add(pivot)
    return { pivot, front: i < 2 }
  })
  return { m: { root, body, tmg, wheels } as CutawayModel, shell, paint }
}

function pose(m: CutawayModel, st: RailState) {
  m.wheels.forEach((w, i) => w.pivot.position.set(REST[i][0], REST[i][1] + st.travel[i] / (TM_S * SC), REST[i][2]))
}

test('Show chassis: see-through body, suspension following live travel, off restores the car', () => {
  const veh = railVehicle(new Lab(), 'base')
  const { m, shell, paint } = model()
  const cut = createCutaway(SC)
  let checked = 0
  runRail(veh, undefined, 2, undefined, (_w, c) => {
    const st = c.rail
    if (!st) return
    pose(m, st)
    cut.update(m, st, CORNER, true)
    if (Math.abs(st.ay) > 6 && Math.abs(st.travel[1] - st.travel[0]) > 0.003) {
      const frame = m.body.children.find((o) => o instanceof THREE.Group && o !== m.tmg) as THREE.Group
      assert.ok(frame?.visible, 'chassis frame shown')
      const coils = frame.children.filter((o) => (o as THREE.Mesh).geometry instanceof THREE.TubeGeometry)
      assert.equal(coils.length, 4)
      for (const k of coils) assert.ok(Number.isFinite(k.scale.y) && k.scale.y > 0.1 && k.scale.y < 0.6, `coil length ${k.scale.y}`)
      assert.ok((coils[1].scale.y - coils[0].scale.y) * (st.travel[1] - st.travel[0]) < 0, 'the front spring with more bump travel is the shorter one')
      checked++
    }
  })
  assert.ok(checked > 20, `cornering samples checked (${checked})`)
  const mats = shell.material as THREE.Material[]
  assert.ok(mats[0] !== paint && mats[0].transparent && mats[0].opacity < 0.2, 'body is see-through')
  assert.equal(shell.castShadow, false)
  const wheelMesh = m.wheels[0].pivot.children[0] as THREE.Mesh
  assert.equal(wheelMesh.material, paint, 'wheels stay solid')
  cut.hide()
  assert.equal((shell.material as THREE.Material[])[0], paint, 'body material restored')
  assert.equal(shell.castShadow, true)
})
