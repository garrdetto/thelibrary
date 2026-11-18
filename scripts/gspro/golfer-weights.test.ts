import { test } from 'node:test'
import assert from 'node:assert/strict'
import { fileURLToPath } from 'node:url'
import { readGolferSkin } from './golfer-skin'
import { BODY, LEFT_ARM, repairGolferWeights, type SkinInput } from './golfer-weights'

const skeleton: [string, [number, number, number]][] = [
  ['Hips', [0, 1, 0]], ['Spine02', [0, 1.12, 0]], ['Spine01', [0, 1.24, 0]], ['Spine', [0, 1.36, 0]], ['neck', [0, 1.5, 0]], ['Head', [0, 1.6, 0]], ['head_end', [0, 1.8, 0]], ['headfront', [0, 1.65, 0.1]],
  ['LeftShoulder', [0.05, 1.45, 0]], ['LeftArm', [0.18, 1.45, 0]], ['LeftForeArm', [0.22, 1.18, 0]], ['LeftHand', [0.24, 0.92, 0]],
  ['RightShoulder', [-0.05, 1.45, 0]], ['RightArm', [-0.18, 1.45, 0]], ['RightForeArm', [-0.22, 1.18, 0]], ['RightHand', [-0.24, 0.92, 0]],
  ['LeftUpLeg', [0.09, 0.95, 0]], ['LeftLeg', [0.1, 0.52, 0]], ['LeftFoot', [0.1, 0.08, 0]], ['LeftToeBase', [0.1, 0.02, 0.12]],
  ['RightUpLeg', [-0.09, 0.95, 0]], ['RightLeg', [-0.1, 0.52, 0]], ['RightFoot', [-0.1, 0.08, 0]], ['RightToeBase', [-0.1, 0.02, 0.12]],
]
const boneNames = skeleton.map(([name]) => name)
const bonePositions = skeleton.map(([, position]) => position)
const boneIndex = (name: string) => boneNames.indexOf(name)

type Patch = { columns: number; rows: number; origin: [number, number]; spacing: number; weights: (column: number, row: number) => [string, number][] }

function buildMesh(patches: Patch[]): SkinInput {
  const positions: number[] = []
  const indices: number[] = []
  const joints: number[] = []
  const weights: number[] = []
  for (const patch of patches) {
    const start = positions.length / 3
    for (let row = 0; row < patch.rows; row++) {
      for (let column = 0; column < patch.columns; column++) {
        positions.push(patch.origin[0] + column * patch.spacing, patch.origin[1] + row * patch.spacing, 0)
        const influences = patch.weights(column, row)
        for (let slot = 0; slot < 4; slot++) {
          joints.push(influences[slot] ? boneIndex(influences[slot][0]) : 0)
          weights.push(influences[slot] ? influences[slot][1] : 0)
        }
      }
    }
    for (let row = 0; row + 1 < patch.rows; row++) {
      for (let column = 0; column + 1 < patch.columns; column++) {
        const corner = start + row * patch.columns + column
        indices.push(corner, corner + 1, corner + patch.columns, corner + 1, corner + patch.columns + 1, corner + patch.columns)
      }
    }
  }
  return { positions, indices, joints, weights, boneNames, bonePositions }
}

function weightOf(result: { joints: ArrayLike<number>; weights: ArrayLike<number> }, vertex: number, name: string) {
  let total = 0
  for (let slot = 0; slot < 4; slot++) if (result.joints[vertex * 4 + slot] === boneIndex(name) && result.weights[vertex * 4 + slot] > 0) total += result.weights[vertex * 4 + slot]
  return total
}

test('a hand resting on the thigh stops dragging the trousers, and the thigh stops holding the hand back', () => {
  const hand: Patch = { columns: 3, rows: 3, origin: [0.227, 0.809], spacing: 0.02, weights: () => [['LeftHand', 0.9], ['LeftUpLeg', 0.1]] }
  const thigh: Patch = { columns: 3, rows: 3, origin: [0.135, 0.765], spacing: 0.015, weights: (column, row) => column === 1 && row === 1 ? [['LeftHand', 1]] : [['LeftHand', 0.7], ['LeftUpLeg', 0.3]] }
  const mesh = buildMesh([hand, thigh])
  const result = repairGolferWeights(mesh)
  for (let vertex = 0; vertex < 9; vertex++) {
    assert.equal(result.labels[vertex], LEFT_ARM, `hand vertex ${vertex} belongs to the left arm`)
    assert.ok(Math.abs(weightOf(result, vertex, 'LeftHand') - 1) < 1e-6, `hand vertex ${vertex} follows only the hand`)
    assert.equal(weightOf(result, vertex, 'LeftUpLeg'), 0)
  }
  for (let vertex = 9; vertex < 18; vertex++) {
    assert.equal(result.labels[vertex], BODY, `thigh vertex ${vertex} belongs to the body`)
    assert.equal(weightOf(result, vertex, 'LeftHand'), 0, `thigh vertex ${vertex} no longer follows the hand`)
    assert.ok(Math.abs(weightOf(result, vertex, 'LeftUpLeg') - 1) < 1e-6, `thigh vertex ${vertex} follows the thigh`)
  }
  assert.equal(result.filledVertices, 1)
})

test('upper-arm weight fades out across the chest but stays at the shoulder, and a second pass changes nothing', () => {
  const strip: Patch = { columns: 16, rows: 2, origin: [0, 1.25], spacing: 0.02, weights: () => [['LeftArm', 0.5], ['Spine01', 0.5]] }
  const mesh = buildMesh([strip])
  const result = repairGolferWeights(mesh)
  const outer = 15
  const middle = [...Array(16).keys()].reverse().find(column => result.labels[column] === BODY)!
  assert.equal(result.labels[outer], LEFT_ARM)
  assert.ok(middle > 0 && middle < outer, 'the arm meets the body part-way across')
  assert.ok(Math.abs(weightOf(result, outer, 'LeftArm') - 0.5) < 1e-6, 'arm vertices keep their weights')
  assert.ok(Math.abs(weightOf(result, middle, 'LeftArm') - 0.5) < 1e-6, 'the body beside the arm still blends with it')
  assert.equal(weightOf(result, 0, 'LeftArm'), 0, 'the far side of the chest no longer follows the arm')
  assert.ok(Math.abs(weightOf(result, 0, 'Spine01') - 1) < 1e-6)
  const again = repairGolferWeights({ ...mesh, joints: result.joints, weights: result.weights })
  assert.equal(again.changedVertices, 0)
  for (let index = 0; index < result.weights.length; index++) assert.ok(Math.abs(again.weights[index] - result.weights[index]) < 1e-6)
})

const golfer = await readGolferSkin(fileURLToPath(new URL('../../assets-src/models/gspro/golfer.glb', import.meta.url)))

test('the committed Meshy golfer has repaired skin weights', () => {
  for (const primitive of golfer.primitives) {
    const result = repairGolferWeights({ ...primitive, boneNames: golfer.boneNames, bonePositions: golfer.bonePositions })
    assert.equal(result.changedVertices, 0, 'run `pnpm exec tsx scripts/gspro/fix-golfer-weights.ts` after replacing the golfer')
  }
})

test('raising both arms of the committed golfer stretches no surface into a sheet', () => {
  const rotate = (point: number[], pivot: readonly number[], angle: number) => {
    const y = point[1] - pivot[1]
    const z = point[2] - pivot[2]
    return [point[0], pivot[1] + y * Math.cos(angle) - z * Math.sin(angle), pivot[2] + y * Math.sin(angle) + z * Math.cos(angle)]
  }
  const armOf = new Map<number, readonly number[]>()
  for (const side of ['Left', 'Right']) for (const part of ['Arm', 'ForeArm', 'Hand']) armOf.set(golfer.boneNames.indexOf(`${side}${part}`), golfer.bonePositions[golfer.boneNames.indexOf(`${side}Arm`)])
  for (const primitive of golfer.primitives) {
    const count = primitive.positions.length / 3
    const posed = new Float64Array(count * 3)
    for (let vertex = 0; vertex < count; vertex++) {
      const rest = [primitive.positions[vertex * 3], primitive.positions[vertex * 3 + 1], primitive.positions[vertex * 3 + 2]]
      const out = [0, 0, 0]
      let total = 0
      for (let slot = 0; slot < 4; slot++) {
        const weight = primitive.weights[vertex * 4 + slot]
        if (weight <= 0) continue
        const pivot = armOf.get(primitive.joints[vertex * 4 + slot])
        const moved = pivot ? rotate(rest, pivot, -Math.PI / 2) : rest
        for (let axis = 0; axis < 3; axis++) out[axis] += moved[axis] * weight
        total += weight
      }
      for (let axis = 0; axis < 3; axis++) posed[vertex * 3 + axis] = out[axis] / total
    }
    const edge = (source: ArrayLike<number>, a: number, b: number) => Math.hypot(source[a * 3] - source[b * 3], source[a * 3 + 1] - source[b * 3 + 1], source[a * 3 + 2] - source[b * 3 + 2])
    let sheets = 0
    for (let corner = 0; corner < primitive.indices.length; corner += 3) {
      const [a, b, c] = [primitive.indices[corner], primitive.indices[corner + 1], primitive.indices[corner + 2]]
      const before = Math.max(edge(primitive.positions, a, b), edge(primitive.positions, b, c), edge(primitive.positions, c, a))
      const after = Math.max(edge(posed, a, b), edge(posed, b, c), edge(posed, c, a))
      if (after > before * 4) sheets++
    }
    assert.ok(sheets <= 5, `${sheets} triangles stretch more than four times their length`)
  }
})
