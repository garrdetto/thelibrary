/**
 * Repairs the Meshy golfer's skin weights. Meshy rigged the body in an arms-down pose, so its automatic weights bleed
 * between surfaces that only touch in that pose: the hands pull patches of trouser off the thighs, the thighs hold the
 * hands back, the forearms drag the waist and each upper arm reaches across half the chest and back. Swinging the arms
 * away from the body then stretches those surfaces into sheets.
 *
 * The fix splits the welded surface into left arm, right arm and body by geodesic (along-the-surface) distance from
 * seeds inside each limb, which separates a hand from the thigh it rests against. Arm vertices lose leg, hip and
 * other-arm weights; body vertices lose forearm and hand weights and keep upper-arm weight only in a band beside the
 * arm, so the shoulder still blends. Vertices left with no weight take their neighbours' weights. Running it again on
 * repaired weights changes nothing.
 */

export type SkinInput = {
  positions: ArrayLike<number>
  indices: ArrayLike<number>
  joints: ArrayLike<number>
  weights: ArrayLike<number>
  boneNames: readonly string[]
  bonePositions: readonly (readonly [number, number, number])[]
}

export type SkinRepair = {
  joints: Uint16Array
  weights: Float32Array
  labels: Uint8Array
  changedVertices: number
  filledVertices: number
}

export const BODY = 0
export const LEFT_ARM = 1
export const RIGHT_ARM = 2

const INFLUENCES = 4
const SHOULDER_BAND = 0.06
const SEED_REACH = 0.12
const SEED_CONE = 0.9

type Influences = Map<number, number>
type Sample = { point: number[]; label: number; toward?: number[] }

const sides = [['Left', LEFT_ARM], ['Right', RIGHT_ARM]] as const

function smoothstep(edge0: number, edge1: number, value: number) {
  const share = Math.max(0, Math.min(1, (value - edge0) / (edge1 - edge0)))
  return share * share * (3 - 2 * share)
}

class MinHeap {
  private keys: number[] = []
  private items: number[] = []
  get size() { return this.items.length }
  push(item: number, key: number) {
    this.items.push(item)
    this.keys.push(key)
    let index = this.items.length - 1
    while (index > 0) {
      const parent = (index - 1) >> 1
      if (this.keys[parent] <= this.keys[index]) break
      this.swap(index, parent)
      index = parent
    }
  }
  pop() {
    const item = this.items[0]
    const key = this.keys[0]
    const lastItem = this.items.pop()!
    const lastKey = this.keys.pop()!
    if (this.items.length) {
      this.items[0] = lastItem
      this.keys[0] = lastKey
      let index = 0
      for (;;) {
        const left = index * 2 + 1
        const right = left + 1
        let smallest = index
        if (left < this.items.length && this.keys[left] < this.keys[smallest]) smallest = left
        if (right < this.items.length && this.keys[right] < this.keys[smallest]) smallest = right
        if (smallest === index) break
        this.swap(index, smallest)
        index = smallest
      }
    }
    return { item, key }
  }
  private swap(a: number, b: number) {
    ;[this.items[a], this.items[b]] = [this.items[b], this.items[a]]
    ;[this.keys[a], this.keys[b]] = [this.keys[b], this.keys[a]]
  }
}

/** Collapses vertices that share a position (UV seams) so the surface is one connected graph. */
function weld(positions: ArrayLike<number>, count: number) {
  const representative = new Int32Array(count)
  const seen = new Map<string, number>()
  for (let vertex = 0; vertex < count; vertex++) {
    const key = `${positions[vertex * 3]},${positions[vertex * 3 + 1]},${positions[vertex * 3 + 2]}`
    const first = seen.get(key)
    if (first === undefined) { seen.set(key, vertex); representative[vertex] = vertex } else representative[vertex] = first
  }
  return representative
}

function neighbours(indices: ArrayLike<number>, representative: Int32Array, count: number) {
  const sets = Array.from({ length: count }, () => new Set<number>())
  for (let corner = 0; corner + 2 < indices.length; corner += 3) {
    const triangle = [representative[indices[corner]], representative[indices[corner + 1]], representative[indices[corner + 2]]]
    for (let edge = 0; edge < 3; edge++) {
      const from = triangle[edge]
      const to = triangle[(edge + 1) % 3]
      if (from !== to) { sets[from].add(to); sets[to].add(from) }
    }
  }
  return sets.map(set => [...set])
}

function gap(positions: ArrayLike<number>, a: number, b: number) {
  return Math.hypot(positions[a * 3] - positions[b * 3], positions[a * 3 + 1] - positions[b * 3 + 1], positions[a * 3 + 2] - positions[b * 3 + 2])
}

/** Multi-source Dijkstra over the welded surface: each vertex's nearest source label and its distance. */
function geodesic(positions: ArrayLike<number>, graph: number[][], sources: [number, number][], count: number) {
  const distances = new Float64Array(count).fill(Infinity)
  const labels = new Int16Array(count).fill(-1)
  const heap = new MinHeap()
  for (const [vertex, label] of sources) {
    if (distances[vertex] === 0) continue
    distances[vertex] = 0
    labels[vertex] = label
    heap.push(vertex, 0)
  }
  while (heap.size) {
    const { item, key } = heap.pop()
    if (key > distances[item]) continue
    for (const next of graph[item]) {
      const through = key + gap(positions, item, next)
      if (through < distances[next]) {
        distances[next] = through
        labels[next] = labels[item]
        heap.push(next, through)
      }
    }
  }
  return { distances, labels }
}

function influencesOf(joints: ArrayLike<number>, weights: ArrayLike<number>, vertex: number) {
  const map: Influences = new Map()
  let total = 0
  for (let slot = 0; slot < INFLUENCES; slot++) {
    const weight = weights[vertex * INFLUENCES + slot]
    if (weight <= 0) continue
    const joint = joints[vertex * INFLUENCES + slot]
    map.set(joint, (map.get(joint) ?? 0) + weight)
    total += weight
  }
  if (total > 0) for (const [joint, weight] of map) map.set(joint, weight / total)
  return map
}

export function repairGolferWeights(input: SkinInput): SkinRepair {
  const { positions, indices, joints, weights, boneNames, bonePositions } = input
  const count = positions.length / 3
  const bone = (name: string) => {
    const index = boneNames.indexOf(name)
    if (index < 0) throw new Error(`The golfer has no ${name} bone.`)
    return index
  }
  const at = (name: string) => bonePositions[bone(name)]
  const lerp = (from: readonly number[], to: readonly number[], share: number) => [0, 1, 2].map(axis => from[axis] + (to[axis] - from[axis]) * share)
  const height = at('head_end')[1] - Math.min(...sides.map(([side]) => at(`${side}ToeBase`)[1]))

  const representative = weld(positions, count)
  const graph = neighbours(indices, representative, count)
  const welded = [...new Set(representative)]

  const armSideOf = new Map<number, number>()
  const handBones = new Set<number>()
  const upperArmSide = new Map<number, number>()
  const lowerBody = new Set<number>([bone('Hips')])
  for (const [side, label] of sides) {
    for (const part of ['Arm', 'ForeArm', 'Hand']) armSideOf.set(bone(`${side}${part}`), label)
    handBones.add(bone(`${side}ForeArm`))
    handBones.add(bone(`${side}Hand`))
    upperArmSide.set(bone(`${side}Arm`), label)
    for (const part of ['UpLeg', 'Leg', 'Foot', 'ToeBase']) lowerBody.add(bone(`${side}${part}`))
  }

  const samples: Sample[] = []
  const chain = (names: string[], label: number, shares: number[]) => {
    for (let link = 0; link + 1 < names.length; link++) for (const share of shares) samples.push({ point: lerp(at(names[link]), at(names[link + 1]), share), label })
  }
  const centre = at('Hips')
  const outward = (point: number[]) => {
    const x = point[0] - centre[0]
    const z = point[2] - centre[2]
    const length = Math.hypot(x, z) || 1
    return [x / length, 0, z / length]
  }
  for (const [side, label] of sides) {
    for (const share of [0.7, 0.9]) {
      const point = lerp(at(`${side}Arm`), at(`${side}ForeArm`), share)
      samples.push({ point, label, toward: outward(point) })
    }
    chain([`${side}ForeArm`, `${side}Hand`], label, [0.25, 0.5, 0.75])
    samples.push({ point: lerp(at(`${side}ForeArm`), at(`${side}Hand`), 1.35), label })
    chain([`${side}UpLeg`, `${side}Leg`, `${side}Foot`, `${side}ToeBase`], BODY, [0.25, 0.5, 0.75])
  }
  chain(['Hips', 'Spine02', 'Spine01', 'Spine', 'neck', 'Head', 'head_end'], BODY, [0.25, 0.5, 0.75])
  const armpit = Math.min(...sides.map(([side]) => lerp(at(`${side}Arm`), at(`${side}ForeArm`), 0.5)[1]))
  const torso = ['Hips', 'Spine02', 'Spine01', 'Spine']
  for (let link = 0; link + 1 < torso.length; link++) {
    for (const share of [0.25, 0.5, 0.75]) {
      const point = lerp(at(torso[link]), at(torso[link + 1]), share)
      if (point[1] >= armpit) continue
      for (let step = 0; step < 8; step++) samples.push({ point, label: BODY, toward: [Math.cos((step * Math.PI) / 4), 0, Math.sin((step * Math.PI) / 4)] })
    }
  }

  const sources: [number, number][] = []
  for (const { point, label, toward } of samples) {
    let nearest = -1
    let best = SEED_REACH * height
    for (const vertex of welded) {
      const dx = positions[vertex * 3] - point[0]
      const dy = positions[vertex * 3 + 1] - point[1]
      const dz = positions[vertex * 3 + 2] - point[2]
      const distance = Math.hypot(dx, dy, dz)
      if (distance >= best) continue
      if (toward && dx * toward[0] + dy * toward[1] + dz * toward[2] < distance * SEED_CONE) continue
      best = distance
      nearest = vertex
    }
    if (nearest >= 0) sources.push([nearest, label])
  }

  const regions = geodesic(positions, graph, sources, count)
  const fromArm = new Map<number, Float64Array>(sides.map(([, label]) => [label, geodesic(positions, graph, welded.filter(vertex => regions.labels[vertex] === label).map(vertex => [vertex, label] as [number, number]), count).distances]))
  const labelOf = (vertex: number) => Math.max(BODY, regions.labels[vertex])

  const repaired = new Map<number, Influences>()
  const empty: number[] = []
  let changedVertices = 0
  for (const vertex of welded) {
    const label = labelOf(vertex)
    const original = influencesOf(joints, weights, vertex)
    const arms: Influences = new Map()
    const others: Influences = new Map()
    for (const [joint, weight] of original) {
      const armSide = armSideOf.get(joint)
      if (label === BODY) {
        if (handBones.has(joint)) continue
        const side = upperArmSide.get(joint)
        if (side !== undefined) {
          const cap = 1 - smoothstep(0, SHOULDER_BAND * height, fromArm.get(side)![vertex])
          if (Math.min(weight, cap) > 1e-4) arms.set(joint, Math.min(weight, cap))
          continue
        }
      } else if (lowerBody.has(joint) || (armSide !== undefined && armSide !== label)) continue
      others.set(joint, weight)
    }
    const armTotal = [...arms.values()].reduce((sum, weight) => sum + weight, 0)
    const otherTotal = [...others.values()].reduce((sum, weight) => sum + weight, 0)
    const kept: Influences = new Map(arms)
    if (otherTotal > 1e-4) for (const [joint, weight] of others) kept.set(joint, (weight * (1 - armTotal)) / otherTotal)
    else if (armTotal < 1 - 1e-4) { empty.push(vertex); changedVertices++; continue }
    if ([...original].some(([joint, weight]) => Math.abs((kept.get(joint) ?? 0) - weight) > 1e-4)) changedVertices++
    repaired.set(vertex, kept)
  }

  let filledVertices = 0
  let frontier = empty
  while (frontier.length) {
    const waiting: number[] = []
    const filled: [number, Influences][] = []
    for (const vertex of frontier) {
      const blend: Influences = new Map()
      let donors = 0
      for (const other of graph[vertex]) {
        const source = repaired.get(other)
        if (!source) continue
        donors++
        for (const [joint, weight] of source) blend.set(joint, (blend.get(joint) ?? 0) + weight)
      }
      if (!donors) { waiting.push(vertex); continue }
      for (const [joint, weight] of blend) blend.set(joint, weight / donors)
      filled.push([vertex, blend])
    }
    if (!filled.length) break
    for (const [vertex, blend] of filled) { repaired.set(vertex, blend); filledVertices++ }
    frontier = waiting
  }

  const outJoints = new Uint16Array(count * INFLUENCES)
  const outWeights = new Float32Array(count * INFLUENCES)
  const labels = new Uint8Array(count)
  for (let vertex = 0; vertex < count; vertex++) {
    const source = representative[vertex]
    labels[vertex] = labelOf(source)
    const influences = repaired.get(source) ?? influencesOf(joints, weights, source)
    const top = [...influences].sort((a, b) => b[1] - a[1] || a[0] - b[0]).slice(0, INFLUENCES)
    const total = top.reduce((sum, [, weight]) => sum + weight, 0) || 1
    top.forEach(([joint, weight], slot) => {
      outJoints[vertex * INFLUENCES + slot] = joint
      outWeights[vertex * INFLUENCES + slot] = weight / total
    })
  }
  return { joints: outJoints, weights: outWeights, labels, changedVertices, filledVertices }
}
