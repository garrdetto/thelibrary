/** The owner's scanned fisherman as a skinned PlayCanvas mesh: bones built from the baked rig, two-bone IK for arms and legs, fitted outfits from Outfit.ts and procedural hats and sunglasses. */
import * as pc from 'playcanvas'
import { loadMeshBin, toFloatNormals } from './MeshBin'
import type { MeshBin } from './MeshBin'
import { buildAdjacency, fitBody } from './Outfit'
import type { BodyData } from './Outfit'
import type { Look } from '../shared/Wardrobe'
import { PALETTE, HAIR_COLORS, hexToRgb } from '../shared/Wardrobe'
import { add, cross, dot, length, mul, normalize, qConj, qEuler, qFromFrames, qIdentity, qMul, qRotate, sub } from './RigMath'
import type { Q, V3 } from './RigMath'

interface BoneMeta { name: string; parent: number; head: V3; radius: number }
interface FishermanMeta { bones: BoneMeta[]; parts: string[] }

export interface LimbTarget {
  /** Target for the hand or ankle, in character space (feet at y 0, facing -Z). */
  target: V3
  /** Direction the elbow or knee should point. */
  pole: V3
  /** Optional hand or foot rotation in character space. */
  rotation?: Q
}

export interface Pose {
  hipsOffset: V3
  hipsRotation: Q
  spine: Q
  chest: Q
  neck: Q
  head: Q
  clavicleL: Q
  clavicleR: Q
  armL: LimbTarget | null
  armR: LimbTarget | null
  legL: LimbTarget | null
  legR: LimbTarget | null
}

export function restPose(): Pose {
  return { hipsOffset: [0, 0, 0], hipsRotation: qIdentity(), spine: qIdentity(), chest: qIdentity(), neck: qIdentity(), head: qIdentity(), clavicleL: qIdentity(), clavicleR: qIdentity(), armL: null, armR: null, legL: null, legR: null }
}

export interface CharacterAssets {
  full: MeshBin<FishermanMeta>
  lod: MeshBin<FishermanMeta>
}

export async function loadCharacterAssets(base: string): Promise<CharacterAssets> {
  const [full, lod] = await Promise.all([loadMeshBin<FishermanMeta>(`${base}/fisherman.bin`), loadMeshBin<FishermanMeta>(`${base}/fisherman-lod.bin`)])
  return { full, lod }
}

const FEET = 0.952
const toScan = (p: V3): [number, number, number] => [-p[0], p[1] - FEET, -p[2]]

interface Prepared {
  bin: MeshBin<FishermanMeta>
  body: BodyData
  normals: Float32Array
  indices: Uint16Array | Uint32Array
  joints: Uint8Array
  weights: Float32Array
}

const prepared = new WeakMap<MeshBin<FishermanMeta>, Prepared>()

function prepare(bin: MeshBin<FishermanMeta>): Prepared {
  const cached = prepared.get(bin)
  if (cached) return cached
  const positions = bin.streams.position.data as Float32Array
  const indices = bin.streams.index.data as Uint16Array | Uint32Array
  const count = positions.length / 3
  const joints: Record<string, [number, number, number]> = {}
  for (const b of bin.meta.bones) joints[b.name] = toScan(b.head)
  for (const s of ['L', 'R']) {
    const hand = joints['hand' + s], fore = joints['forearm' + s]
    joints['handEnd' + s] = [hand[0] + (hand[0] - fore[0]) * 0.38, hand[1] + (hand[1] - fore[1]) * 0.38, hand[2] + (hand[2] - fore[2]) * 0.38]
  }
  const rawWeights = bin.streams.weights.data as Uint8Array
  const weights = new Float32Array(rawWeights.length)
  for (let i = 0; i < weights.length; i++) weights[i] = rawWeights[i] / 255
  const result: Prepared = {
    bin,
    body: { positions, region: bin.streams.region.data as Uint8Array, ao: bin.streams.ao.data as Uint8Array, adjacency: buildAdjacency(count, indices), joints },
    normals: toFloatNormals(bin.streams.normal.data as Int16Array),
    indices,
    joints: bin.streams.joints.data as Uint8Array,
    weights,
  }
  prepared.set(bin, result)
  return result
}

const chains = {
  armL: { upper: 'upperArmL', lower: 'forearmL', end: 'handL', bindPole: [0, 0, 1] as V3 },
  armR: { upper: 'upperArmR', lower: 'forearmR', end: 'handR', bindPole: [0, 0, 1] as V3 },
  legL: { upper: 'thighL', lower: 'shinL', end: 'footL', bindPole: [0, 0, -1] as V3 },
  legR: { upper: 'thighR', lower: 'shinR', end: 'footR', bindPole: [0, 0, -1] as V3 },
}

export class Character {
  readonly entity: pc.Entity
  readonly rig: pc.GraphNode
  private readonly device: pc.GraphicsDevice
  private readonly meta: BoneMeta[]
  private readonly nodes: pc.GraphNode[]
  private readonly index: Record<string, number>
  private readonly local: Q[]
  private readonly modelRot: Q[]
  private readonly modelPos: V3[]
  private readonly bodyMesh: pc.Mesh
  private readonly data: Prepared
  private readonly accessories: pc.Entity
  private readonly material: pc.StandardMaterial
  private look: Look | null = null

  constructor(app: pc.AppBase, assets: CharacterAssets, options: { lod?: boolean; name?: string } = {}) {
    this.device = app.graphicsDevice
    this.data = prepare(options.lod ? assets.lod : assets.full)
    this.meta = this.data.bin.meta.bones
    this.entity = new pc.Entity(options.name ?? 'angler')
    this.rig = new pc.GraphNode('rig')
    this.entity.addChild(this.rig)
    this.index = Object.fromEntries(this.meta.map((b, i) => [b.name, i]))
    this.nodes = this.meta.map(b => new pc.GraphNode(b.name))
    this.meta.forEach((b, i) => {
      const parent = b.parent >= 0 ? this.nodes[b.parent] : this.rig
      parent.addChild(this.nodes[i])
      const ph = b.parent >= 0 ? this.meta[b.parent].head : [0, 0, 0]
      this.nodes[i].setLocalPosition(b.head[0] - ph[0], b.head[1] - ph[1], b.head[2] - ph[2])
    })
    this.local = this.meta.map(() => qIdentity())
    this.modelRot = this.meta.map(() => qIdentity())
    this.modelPos = this.meta.map(b => [...b.head] as V3)

    const count = this.data.body.positions.length / 3
    this.bodyMesh = new pc.Mesh(this.device)
    this.bodyMesh.setPositions(this.data.body.positions)
    this.bodyMesh.setNormals(this.data.normals)
    this.bodyMesh.setColors32(new Uint8Array(count * 4).fill(200))
    this.bodyMesh.setVertexStream(pc.SEMANTIC_BLENDINDICES, this.data.joints, 4, count, pc.TYPE_UINT8)
    this.bodyMesh.setVertexStream(pc.SEMANTIC_BLENDWEIGHT, this.data.weights, 4, count)
    this.bodyMesh.setIndices(this.data.indices)
    this.bodyMesh.update()

    this.material = new pc.StandardMaterial()
    this.material.diffuse = new pc.Color(1, 1, 1)
    this.material.diffuseVertexColor = true
    ;(this.material as pc.StandardMaterial & { vertexColorGamma: boolean }).vertexColorGamma = true
    this.material.gloss = 0.28
    this.material.metalness = 0
    this.material.useMetalness = true
    this.material.update()

    const skin = new pc.Skin(this.device, this.meta.map(b => new pc.Mat4().setTranslate(-b.head[0], -b.head[1], -b.head[2])), this.meta.map(b => b.name))
    this.bodyMesh.skin = skin
    const skinInstance = new pc.SkinInstance(skin)
    skinInstance.bones = this.nodes
    const meshInstance = new pc.MeshInstance(this.bodyMesh, this.material)
    meshInstance.skinInstance = skinInstance
    meshInstance.castShadow = true
    meshInstance.receiveShadow = true
    meshInstance.cull = false
    this.entity.addComponent('render', { meshInstances: [meshInstance], castShadows: true, receiveShadows: true })
    skinInstance.rootBone = this.rig

    this.accessories = new pc.Entity('accessories')
    this.nodes[this.index.head].addChild(this.accessories)
  }

  bone(name: string): pc.GraphNode {
    return this.nodes[this.index[name]]
  }

  /** Character-space position of a bone's joint from the last solved pose. */
  jointPosition(name: string): V3 {
    return [...this.modelPos[this.index[name]]] as V3
  }

  jointRotation(name: string): Q {
    return [...this.modelRot[this.index[name]]] as Q
  }

  setLook(look: Look): void {
    const fitted = fitBody(this.data.body, look)
    this.bodyMesh.setPositions(fitted.positions)
    this.bodyMesh.setNormals(pc.calculateNormals(Array.from(fitted.positions), Array.from(this.data.indices)))
    this.bodyMesh.setColors32(fitted.colors)
    this.bodyMesh.update()
    this.look = look
    this.buildAccessories(look)
  }

  get currentLook(): Look | null {
    return this.look
  }

  applyPose(pose: Pose): void {
    const set = (name: string, q: Q) => { this.local[this.index[name]] = q }
    for (let i = 0; i < this.local.length; i++) this.local[i] = qIdentity()
    set('hips', pose.hipsRotation)
    set('spine', pose.spine)
    set('chest', pose.chest)
    set('neck', pose.neck)
    set('head', pose.head)
    set('clavicleL', pose.clavicleL)
    set('clavicleR', pose.clavicleR)
    this.forward(pose.hipsOffset)
    for (const key of ['legL', 'legR', 'armL', 'armR'] as const) {
      const limb = pose[key]
      if (!limb) continue
      this.solve(chains[key], limb)
      this.forward(pose.hipsOffset)
    }
    for (let i = 0; i < this.nodes.length; i++) {
      const q = this.local[i]
      this.nodes[i].setLocalRotation(q[0], q[1], q[2], q[3])
    }
    const hips = this.meta[0].head
    this.nodes[0].setLocalPosition(hips[0] + pose.hipsOffset[0], hips[1] + pose.hipsOffset[1], hips[2] + pose.hipsOffset[2])
  }

  private forward(hipsOffset: V3): void {
    for (let i = 0; i < this.meta.length; i++) {
      const p = this.meta[i].parent
      if (p < 0) {
        this.modelRot[i] = this.local[i]
        this.modelPos[i] = add(this.meta[i].head, hipsOffset)
        continue
      }
      this.modelRot[i] = qMul(this.modelRot[p], this.local[i])
      this.modelPos[i] = add(this.modelPos[p], qRotate(this.modelRot[p], sub(this.meta[i].head, this.meta[p].head)))
    }
  }

  private solve(chain: { upper: string; lower: string; end: string; bindPole: V3 }, limb: LimbTarget): void {
    const iu = this.index[chain.upper], il = this.index[chain.lower], ie = this.index[chain.end]
    const parent = this.meta[iu].parent
    const parentRot = parent >= 0 ? this.modelRot[parent] : [0, 0, 0, 1] as Q
    const A = this.modelPos[iu]
    const bindU = sub(this.meta[il].head, this.meta[iu].head)
    const bindL = sub(this.meta[ie].head, this.meta[il].head)
    const l1 = length(bindU), l2 = length(bindL)
    const toTarget = sub(limb.target, A)
    const d = Math.max(0.05, Math.min(l1 + l2 - 0.002, length(toTarget)))
    const dir = normalize(toTarget)
    let pole = sub(limb.pole, mul(dir, dot(limb.pole, dir)))
    if (length(pole) < 1e-4) pole = normalize(cross(dir, [1, 0, 0]))
    pole = normalize(pole)
    const cosA = Math.max(-1, Math.min(1, (l1 * l1 + d * d - l2 * l2) / (2 * l1 * d)))
    const sinA = Math.sqrt(1 - cosA * cosA)
    const elbow = add(A, add(mul(dir, l1 * cosA), mul(pole, l1 * sinA)))
    const end = add(A, mul(dir, d))
    const upperModel = qFromFrames(bindU, chain.bindPole, sub(elbow, A), pole)
    this.local[iu] = qMul(qConj(parentRot), upperModel)
    const lowerModel = qFromFrames(bindL, chain.bindPole, sub(end, elbow), pole)
    this.local[il] = qMul(qConj(upperModel), lowerModel)
    this.local[ie] = limb.rotation ? qMul(qConj(lowerModel), limb.rotation) : qIdentity()
  }

  private buildAccessories(look: Look): void {
    for (const child of [...this.accessories.children]) child.destroy()
    const head = this.meta[this.index.head].head
    const hair = hexToRgb(HAIR_COLORS[look.hair])
    const hatColor = hexToRgb(PALETTE[look.hatColor])
    const mat = (rgb: [number, number, number], gloss = 0.25) => {
      const m = new pc.StandardMaterial()
      m.diffuse = new pc.Color(rgb[0], rgb[1], rgb[2])
      m.gloss = gloss
      m.useMetalness = true
      m.metalness = 0
      m.update()
      return m
    }
    const add = (mesh: pc.Mesh, material: pc.Material, pos: V3, name: string) => {
      const e = new pc.Entity(name)
      e.addComponent('render', { meshInstances: [new pc.MeshInstance(mesh, material)], castShadows: true })
      e.setLocalPosition(pos[0] - head[0], pos[1] - head[1], pos[2] - head[2])
      this.accessories.addChild(e)
      return e
    }
    void hair
    if (look.hat === 'cap') {
      add(dome(this.device, 0.103, 0.088, 0.112, 0.15), mat(hatColor, 0.2), [0, 1.792, 0.012], 'cap')
      const brim = add(brimMesh(this.device, 0.085, 0.095, 0.075, 0.012), mat(hatColor.map(c => c * 0.85) as [number, number, number], 0.2), [0, 1.8, -0.1], 'brim')
      brim.setLocalEulerAngles(-8, 0, 0)
    } else if (look.hat === 'bucket') {
      add(dome(this.device, 0.106, 0.09, 0.114, 0.0), mat(hatColor, 0.12), [0, 1.785, 0.005], 'bucket')
      add(ringBrim(this.device, 0.105, 0.17, -0.035), mat(hatColor.map(c => c * 0.9) as [number, number, number], 0.12), [0, 1.792, 0.005], 'bucket-brim')
    }
    if (look.sunglasses) {
      const frame = mat([0.05, 0.05, 0.06], 0.6)
      const lens = new pc.StandardMaterial()
      lens.diffuse = new pc.Color(0.02, 0.03, 0.04)
      lens.gloss = 0.95
      lens.useMetalness = true
      lens.metalness = 0.6
      lens.update()
      for (const s of [-1, 1]) {
        const e = add(pc.Mesh.fromGeometry(this.device, new pc.SphereGeometry({ radius: 0.022, latitudeBands: 8, longitudeBands: 12 })), lens, [s * 0.034, 1.752, -0.128], 'lens')
        e.setLocalScale(1.15, 0.8, 0.3)
        const arm = add(pc.Mesh.fromGeometry(this.device, new pc.BoxGeometry({ halfExtents: new pc.Vec3(0.0025, 0.003, 0.06) })), frame, [s * 0.068, 1.758, -0.075], 'arm')
        arm.setLocalEulerAngles(0, s * -6, 0)
      }
      add(pc.Mesh.fromGeometry(this.device, new pc.BoxGeometry({ halfExtents: new pc.Vec3(0.058, 0.0035, 0.004) })), frame, [0, 1.768, -0.134], 'bridge')
    }
  }

  destroy(): void {
    this.entity.destroy()
  }
}

function dome(device: pc.GraphicsDevice, rx: number, ry: number, rz: number, tilt: number): pc.Mesh {
  const positions: number[] = [], normals: number[] = [], indices: number[] = []
  const rings = 10, segs = 28
  for (let r = 0; r <= rings; r++) {
    const phi = (r / rings) * (Math.PI / 2)
    for (let s = 0; s <= segs; s++) {
      const th = (s / segs) * Math.PI * 2
      const nx = Math.cos(phi) * Math.sin(th), ny = Math.sin(phi), nz = Math.cos(phi) * Math.cos(th)
      const lift = tilt * Math.max(0, -nz) * (1 - ny)
      positions.push(nx * rx, ny * ry - 0.012 + lift * 0.1, nz * rz)
      normals.push(nx / rx, ny / ry, nz / rz)
    }
  }
  for (let r = 0; r < rings; r++) for (let s = 0; s < segs; s++) {
    const a = r * (segs + 1) + s, b = a + segs + 1
    indices.push(a, a + 1, b, b, a + 1, b + 1)
  }
  for (let i = 0; i < normals.length; i += 3) {
    const l = Math.hypot(normals[i], normals[i + 1], normals[i + 2])
    normals[i] /= l; normals[i + 1] /= l; normals[i + 2] /= l
  }
  return meshFrom(device, positions, normals, indices)
}

function brimMesh(device: pc.GraphicsDevice, halfWidth: number, depth: number, curve: number, thickness: number): pc.Mesh {
  const positions: number[] = [], normals: number[] = [], indices: number[] = []
  const cols = 14, rows = 5
  for (const side of [1, -1]) {
    const base = positions.length / 3
    for (let r = 0; r <= rows; r++) for (let c = 0; c <= cols; c++) {
      const u = c / cols - 0.5, w = r / rows
      const x = u * 2 * halfWidth * (1 - 0.35 * w)
      const z = -w * depth * (1 - Math.abs(u) * 0.7)
      const y = -curve * u * u * 0.6 + (side < 0 ? -thickness / 2 : thickness / 2)
      positions.push(x, y, z)
      normals.push(0, side, 0)
    }
    for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) {
      const a = base + r * (cols + 1) + c, b = a + cols + 1
      if (side > 0) indices.push(a, b, a + 1, a + 1, b, b + 1)
      else indices.push(a, a + 1, b, a + 1, b + 1, b)
    }
  }
  return meshFrom(device, positions, normals, indices)
}

function ringBrim(device: pc.GraphicsDevice, inner: number, outer: number, droop: number): pc.Mesh {
  const positions: number[] = [], normals: number[] = [], indices: number[] = []
  const segs = 32
  for (const side of [1, -1]) {
    const base = positions.length / 3
    for (let s = 0; s <= segs; s++) {
      const th = (s / segs) * Math.PI * 2
      const cx = Math.sin(th), cz = Math.cos(th)
      positions.push(cx * inner, side * 0.003, cz * inner * 1.08, cx * outer, droop + side * 0.003, cz * outer * 1.05)
      normals.push(0, side, 0, cx * 0.3 * side, side, cz * 0.3 * side)
    }
    for (let s = 0; s < segs; s++) {
      const a = base + s * 2
      if (side > 0) indices.push(a, a + 1, a + 2, a + 2, a + 1, a + 3)
      else indices.push(a, a + 2, a + 1, a + 2, a + 3, a + 1)
    }
  }
  return meshFrom(device, positions, normals, indices)
}

function meshFrom(device: pc.GraphicsDevice, positions: number[], normals: number[], indices: number[]): pc.Mesh {
  const mesh = new pc.Mesh(device)
  mesh.setPositions(positions)
  mesh.setNormals(normals)
  mesh.setIndices(indices)
  mesh.update()
  return mesh
}

export const poseHelpers = { qEuler }
