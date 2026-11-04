import { readFileSync } from 'node:fs'
import { FBXLoader } from 'three/examples/jsm/loaders/FBXLoader.js'
import { MeshoptSimplifier } from 'meshoptimizer'
import { smoothNormals } from './meshbin.mjs'

export const PARTS = ['face', 'hat', 'hair', 'beard', 'collar', 'torso', 'hood', 'upperArm', 'forearm', 'hand', 'thigh', 'shin', 'bootShaft', 'foot']
const part = Object.fromEntries(PARTS.map((name, index) => [name, index]))

const FEET = 0.952

const guess = {
  hips: [0, -0.03, 0],
  spine: [0, 0.17, 0],
  chest: [0, 0.38, 0],
  neck: [0, 0.62, 0.01],
  head: [0, 0.72, 0.03],
  headEnd: [0, 0.95, 0.03],
  clavicleL: [0.04, 0.56, 0],
  upperArmL: [0.19, 0.54, 0],
  forearmL: [0.39, 0.31, 0],
  handL: [0.555, 0.1, 0.02],
  handEndL: [0.615, -0.04, 0.03],
  thighL: [0.1, -0.07, 0],
  shinL: [0.15, -0.48, 0.03],
  footL: [0.19, -0.86, -0.02],
  toeL: [0.19, -0.93, 0.16],
}

const boneDefs = [
  { name: 'hips', parent: -1, head: 'hips', tail: 'spine', radius: 0.2 },
  { name: 'spine', parent: 0, head: 'spine', tail: 'chest', radius: 0.2 },
  { name: 'chest', parent: 1, head: 'chest', tail: 'neck', radius: 0.2 },
  { name: 'neck', parent: 2, head: 'neck', tail: 'head', radius: 0.085 },
  { name: 'head', parent: 3, head: 'head', tail: 'headEnd', radius: 0.11 },
  { name: 'clavicleL', parent: 2, head: 'clavicleL', tail: 'upperArmL', radius: 0.12 },
  { name: 'upperArmL', parent: 5, head: 'upperArmL', tail: 'forearmL', radius: 0.075 },
  { name: 'forearmL', parent: 6, head: 'forearmL', tail: 'handL', radius: 0.065 },
  { name: 'handL', parent: 7, head: 'handL', tail: 'handEndL', radius: 0.05 },
  { name: 'clavicleR', parent: 2, head: 'clavicleR', tail: 'upperArmR', radius: 0.12 },
  { name: 'upperArmR', parent: 9, head: 'upperArmR', tail: 'forearmR', radius: 0.075 },
  { name: 'forearmR', parent: 10, head: 'forearmR', tail: 'handR', radius: 0.065 },
  { name: 'handR', parent: 11, head: 'handR', tail: 'handEndR', radius: 0.05 },
  { name: 'thighL', parent: 0, head: 'thighL', tail: 'shinL', radius: 0.1 },
  { name: 'shinL', parent: 13, head: 'shinL', tail: 'footL', radius: 0.085 },
  { name: 'footL', parent: 14, head: 'footL', tail: 'toeL', radius: 0.07 },
  { name: 'thighR', parent: 0, head: 'thighR', tail: 'shinR', radius: 0.1 },
  { name: 'shinR', parent: 16, head: 'shinR', tail: 'footR', radius: 0.085 },
  { name: 'footR', parent: 17, head: 'footR', tail: 'toeR', radius: 0.07 },
]

function loadFbx(path) {
  const buf = readFileSync(path)
  const obj = new FBXLoader().parse(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength), '')
  let mesh = null
  obj.traverse(o => { if (o.isMesh && !mesh) mesh = o })
  if (!mesh) throw new Error('No mesh in fisherman FBX')
  mesh.updateMatrixWorld(true)
  const src = mesh.geometry.attributes.position.array
  const m = mesh.matrixWorld.elements
  const count = src.length / 3
  const map = new Map()
  const positions = []
  const indices = new Uint32Array(count)
  for (let i = 0; i < count; i++) {
    const x = src[i * 3], y = src[i * 3 + 1], z = src[i * 3 + 2]
    const wx = (m[0] * x + m[4] * y + m[8] * z + m[12]) / 100
    const wy = (m[1] * x + m[5] * y + m[9] * z + m[13]) / 100
    const wz = (m[2] * x + m[6] * y + m[10] * z + m[14]) / 100
    const key = `${Math.round(wx * 1e5)},${Math.round(wy * 1e5)},${Math.round(wz * 1e5)}`
    let v = map.get(key)
    if (v === undefined) { v = positions.length / 3; map.set(key, v); positions.push(wx, wy, wz) }
    indices[i] = v
  }
  return { positions: new Float32Array(positions), indices }
}

function decimate(source, targetTris) {
  const [out] = MeshoptSimplifier.simplify(source.indices, source.positions, 3, targetTris * 3, 0.02, [])
  const used = new Map()
  const positions = []
  const indices = new Uint32Array(out.length)
  for (let i = 0; i < out.length; i++) {
    const v = out[i]
    let k = used.get(v)
    if (k === undefined) { k = positions.length / 3; used.set(v, k); positions.push(source.positions[v * 3], source.positions[v * 3 + 1], source.positions[v * 3 + 2]) }
    indices[i] = k
  }
  return { positions: new Float32Array(positions), indices }
}

const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]]
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2]
const len = a => Math.hypot(a[0], a[1], a[2])
const norm = a => { const l = len(a) || 1; return [a[0] / l, a[1] / l, a[2] / l] }

function refineJoint(positions, joint, axis, radius) {
  let sx = 0, sy = 0, sz = 0, n = 0
  for (let i = 0; i < positions.length; i += 3) {
    const d = [positions[i] - joint[0], positions[i + 1] - joint[1], positions[i + 2] - joint[2]]
    if (Math.abs(dot(d, axis)) > 0.012 || len(d) > radius) continue
    sx += positions[i]; sy += positions[i + 1]; sz += positions[i + 2]; n++
  }
  if (n < 12) return joint
  const centroid = [sx / n, sy / n, sz / n]
  const offset = sub(centroid, joint)
  const along = dot(offset, axis)
  return [centroid[0] - axis[0] * along, centroid[1] - axis[1] * along, centroid[2] - axis[2] * along]
}

function joints(positions) {
  const j = {}
  for (const [key, value] of Object.entries(guess)) {
    j[key] = value
    if (key.endsWith('L')) j[key.slice(0, -1) + 'R'] = [-value[0], value[1], value[2]]
  }
  for (const side of ['L', 'R']) {
    const refine = (name, from, to, radius) => { j[name + side] = refineJoint(positions, j[name + side], norm(sub(j[to + side], j[from + side])), radius) }
    refine('forearm', 'upperArm', 'hand', 0.12)
    refine('hand', 'forearm', 'handEnd', 0.1)
    refine('shin', 'thigh', 'foot', 0.14)
  }
  return j
}

function segmentDistance(p, a, b) {
  const ab = sub(b, a)
  const t = Math.max(0, Math.min(1, dot(sub(p, a), ab) / dot(ab, ab)))
  const q = [a[0] + ab[0] * t, a[1] + ab[1] * t, a[2] + ab[2] * t]
  return { d: len(sub(p, q)), t }
}

function adjacency(count, indices) {
  const sets = Array.from({ length: count }, () => new Set())
  for (let i = 0; i < indices.length; i += 3) {
    const a = indices[i], b = indices[i + 1], c = indices[i + 2]
    sets[a].add(b); sets[a].add(c); sets[b].add(a); sets[b].add(c); sets[c].add(a); sets[c].add(b)
  }
  return sets.map(s => Uint32Array.from(s))
}

function skin(positions, indices, j) {
  const count = positions.length / 3
  const bones = boneDefs.map(b => ({ ...b, a: j[b.head], b: j[b.tail] }))
  const children = bones.map((_, i) => bones.map((b, k) => (b.parent === i ? k : -1)).filter(k => k >= 0))
  const weights = new Float32Array(count * bones.length)
  const dominant = new Uint8Array(count)
  const tParam = new Float32Array(count)
  for (let v = 0; v < count; v++) {
    const p = [positions[v * 3], positions[v * 3 + 1], positions[v * 3 + 2]]
    const dist = bones.map(b => segmentDistance(p, b.a, b.b))
    const scaled = dist.map((d, i) => d.d / bones[i].radius)
    const headZone = p[1] > 0.69 && Math.hypot(p[0] / 0.135, (p[2] - 0.02) / (p[1] > 0.735 ? 0.16 : 0.135)) < 1
    if (headZone) for (let i = 0; i < bones.length; i++) if (bones[i].name !== 'head' && bones[i].name !== 'neck') scaled[i] += 10
    if (p[1] < -0.12) {
      const wrongSide = p[0] > 0 ? ['thighR', 'shinR', 'footR'] : ['thighL', 'shinL', 'footL']
      for (const name of wrongSide) scaled[bones.findIndex(b => b.name === name)] += 10
    }
    let best = 0
    for (let i = 1; i < bones.length; i++) if (scaled[i] < scaled[best]) best = i
    dominant[v] = best
    tParam[v] = dist[best].t
    const candidates = [best, bones[best].parent, ...children[best]].filter(i => i >= 0)
    for (const i of candidates) weights[v * bones.length + i] = Math.exp(-(scaled[i] - scaled[best]) / 0.18)
  }
  const adj = adjacency(count, indices)
  let current = weights
  for (let pass = 0; pass < 4; pass++) {
    const next = new Float32Array(current.length)
    for (let v = 0; v < count; v++) {
      const row = v * bones.length
      const ns = adj[v]
      for (let i = 0; i < bones.length; i++) {
        let sum = current[row + i] * 2
        for (const n of ns) sum += current[n * bones.length + i]
        next[row + i] = sum / (ns.length + 2)
      }
    }
    current = next
  }
  const joints4 = new Uint8Array(count * 4)
  const weights4 = new Uint8Array(count * 4)
  for (let v = 0; v < count; v++) {
    const row = Array.from(current.subarray(v * bones.length, (v + 1) * bones.length)).map((w, i) => [w, i]).sort((a, b) => b[0] - a[0]).slice(0, 4)
    const total = row.reduce((s, [w]) => s + w, 0) || 1
    let assigned = 0
    row.forEach(([w, i], k) => {
      joints4[v * 4 + k] = i
      const q = k === 3 ? 255 - assigned : Math.round((w / total) * 255)
      weights4[v * 4 + k] = Math.max(0, Math.min(255 - assigned, q))
      assigned += weights4[v * 4 + k]
    })
    if (assigned < 255) weights4[v * 4] += 255 - assigned
  }
  return { bones, joints4, weights4, dominant, tParam, adj }
}

function classify(positions, j, rig) {
  const count = positions.length / 3
  const region = new Uint8Array(count * 4)
  const name = i => rig.bones[i].name
  const angle = (dx, dz) => Math.round(((Math.atan2(dx, dz) / (2 * Math.PI)) + 1) % 1 * 255)
  for (let v = 0; v < count; v++) {
    const x = positions[v * 3], y = positions[v * 3 + 1], z = positions[v * 3 + 2]
    const bone = name(rig.dominant[v])
    const side = bone.endsWith('R') || (bone === 'hips' && x < 0) ? 1 : 0
    let p = part.torso, a = 0, b = 0
    const inHead = y > 0.66 && Math.hypot(x / 0.135, (z - 0.02) / (y > 0.735 ? 0.16 : 0.135)) < 1 && !(y < 0.79 && z < -0.06)
    if (inHead && y < 0.705 && z > -0.04) {
      p = part.collar
      a = Math.round(Math.max(0, Math.min(1, (y + 0.06) / 0.7)) * 255)
      b = angle(x, z)
    } else if (inHead || bone === 'head') {
      const back = Math.max(0, Math.min(1, (0.04 - z) / 0.1))
      const front = z > 0.075
      a = Math.round(Math.max(0, Math.min(1, (y - 0.68) / 0.28)) * 255)
      b = angle(x, z - 0.03)
      if (y > 0.842 - 0.055 * back) p = part.hat
      else if (front && y < 0.778 && y > 0.66 && Math.abs(x) < 0.08) p = part.beard
      else if (!front && (z < 0.035 || Math.abs(x) > 0.07)) p = part.hair
      else p = part.face
    } else if (bone === 'neck' || bone === 'chest' || bone === 'clavicleL' || bone === 'clavicleR' || bone === 'spine' || bone === 'hips') {
      const hood = y > 0.52 && (z < -0.045 || (Math.abs(x) > 0.085 && y > 0.6)) && Math.hypot(x, z) > 0.09
      if (bone === 'neck' && !hood) p = part.collar
      else if (hood) p = part.hood
      else p = part.torso
      a = Math.round(Math.max(0, Math.min(1, (y + 0.06) / 0.7)) * 255)
      b = angle(x, z)
    } else if (bone.startsWith('upperArm') || bone.startsWith('forearm') || bone.startsWith('hand') || bone.startsWith('clavicle')) {
      const s = bone.endsWith('R') ? 'R' : 'L'
      const sh = j['upperArm' + s], wr = j['hand' + s]
      const axis = sub(wr, sh)
      const t = Math.max(0, Math.min(1.2, dot(sub([x, y, z], sh), axis) / dot(axis, axis)))
      p = bone.startsWith('hand') ? part.hand : t < 0.5 ? part.upperArm : part.forearm
      a = Math.round(Math.min(1, t / 1.2) * 255)
      const up = norm([0, 1, 0])
      const fwd = norm([0, 0, 1])
      const rel = sub([x, y, z], sh)
      b = angle(dot(rel, up), dot(rel, fwd))
    } else {
      const s = bone.endsWith('R') ? 'R' : 'L'
      const hip = j['thigh' + s], ankle = j['foot' + s]
      const t = Math.max(0, Math.min(1, (hip[1] - y) / (hip[1] - ankle[1])))
      if (bone.startsWith('foot') || y < -0.84) p = part.foot
      else if (y < -0.6) p = part.bootShaft
      else p = t < 0.48 ? part.thigh : part.shin
      a = Math.round(t * 255)
      const c = bone.startsWith('thigh') ? hip : j['shin' + s]
      b = angle(side ? -(x - c[0]) : x - c[0], z - c[2])
    }
    region[v * 4] = p
    region[v * 4 + 1] = side
    region[v * 4 + 2] = a
    region[v * 4 + 3] = b
  }
  return region
}

function cavity(positions, normals, adj) {
  const count = positions.length / 3
  const out = new Float32Array(count)
  for (let v = 0; v < count; v++) {
    let sum = 0
    const ns = adj[v]
    for (const n of ns) {
      const d = [positions[n * 3] - positions[v * 3], positions[n * 3 + 1] - positions[v * 3 + 1], positions[n * 3 + 2] - positions[v * 3 + 2]]
      const l = len(d) || 1
      sum += (d[0] * normals[v * 3] + d[1] * normals[v * 3 + 1] + d[2] * normals[v * 3 + 2]) / l
    }
    out[v] = ns.length ? sum / ns.length : 0
  }
  const smoothed = new Float32Array(count)
  for (let v = 0; v < count; v++) {
    let s = out[v] * 2
    for (const n of adj[v]) s += out[n]
    smoothed[v] = s / (adj[v].length + 2)
  }
  const ao = new Uint8Array(count)
  for (let v = 0; v < count; v++) ao[v] = Math.round(Math.max(0.45, Math.min(1, 1 - smoothed[v] * 2.4)) * 255)
  return ao
}

function toGame(points) {
  const out = new Float32Array(points.length)
  for (let i = 0; i < points.length; i += 3) {
    out[i] = -points[i]
    out[i + 1] = points[i + 1] + FEET
    out[i + 2] = -points[i + 2]
  }
  return out
}

export async function buildFisherman(sourcePath, targets) {
  await MeshoptSimplifier.ready
  const source = loadFbx(sourcePath)
  const results = []
  for (const target of targets) {
    const mesh = decimate(source, target)
    const j = joints(mesh.positions)
    const rig = skin(mesh.positions, mesh.indices, j)
    const region = classify(mesh.positions, j, rig)
    const modelNormals = smoothNormals(mesh.positions, mesh.indices)
    const ao = cavity(mesh.positions, modelNormals, rig.adj)
    const positions = toGame(mesh.positions)
    const normals = smoothNormals(positions, mesh.indices)
    const bones = rig.bones.map(b => {
      const head = toGame(Float32Array.from(b.a))
      return { name: b.name, parent: b.parent, head: Array.from(head, v => +v.toFixed(5)), radius: b.radius }
    })
    results.push({ target, positions, normals, indices: mesh.indices, joints: rig.joints4, weights: rig.weights4, region, ao, bones })
  }
  return results
}
