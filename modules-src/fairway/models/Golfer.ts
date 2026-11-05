/** Golfer model factory: one skinned mesh (lofted body, clothes and cap in vertex colours, smooth weights across every joint) on the GolferRig skeleton, plus a club with wood, iron and putter heads. `apply` poses bones and club from a solved rig. */
import * as THREE from 'three/webgpu'
import type { ClubId } from '../tuning'
import { BONE, BONES, clubLength, qConj, qMul, type SolvedRig } from '../systems/GolferRig'
import { cross, normalize, type Vec3 } from '../systems/Vector'

export interface GolferLook {
  skin: string
  hair: string
  shirt: string
  collar: string
  pants: string
  belt: string
  sock: string
  shoe: string
  cap: string
  capBrim: string
  glove: string
  shaft: string
  grip: string
  woodHead: string
  ironHead: string
  putterHead: string
  segments: number
  roughness: number
}

export interface GolferModel {
  root: THREE.Group
  /** Places the golfer so the ball (character space) lands on `ball` (world), facing so the target lies along `aimYaw`. */
  place(ball: Vec3, ballLocal: Vec3, aimYaw: number): void
  apply(solved: SolvedRig, club: ClubId): void
  dispose(): void
}

type Weights = readonly (readonly [bone: number, weight: number])[]
type Shade = string | ((across: number, out: number) => string)

interface Ring {
  at: number
  rx: number
  rz: number
  color: Shade
  weights: Weights
}

class SkinBuilder {
  readonly positions: number[] = []
  readonly colors: number[] = []
  readonly skinIndex: number[] = []
  readonly skinWeight: number[] = []
  readonly indices: number[] = []
  private readonly color = new THREE.Color()

  constructor(private readonly segments: number) {}

  private vertex(position: Vec3, color: string, weights: Weights): number {
    const index = this.positions.length / 3
    this.positions.push(position[0], position[1], position[2])
    this.color.set(color)
    this.colors.push(this.color.r, this.color.g, this.color.b)
    const sorted = [...weights].sort((a, b) => b[1] - a[1]).slice(0, 4)
    const total = sorted.reduce((sum, entry) => sum + entry[1], 0) || 1
    for (let slot = 0; slot < 4; slot++) {
      this.skinIndex.push(sorted[slot]?.[0] ?? 0)
      this.skinWeight.push((sorted[slot]?.[1] ?? 0) / total)
    }
    return index
  }

  /**
   * A closed loft along `axis` from `origin`: each ring is an ellipse (rx along `side`, rz along axis × side), rings are
   * joined by quads, and both ends are capped with a fan so the surface is watertight.
   */
  tube(origin: Vec3, axis: Vec3, sideHint: Vec3, rings: readonly Ring[]): void {
    const direction = normalize(axis)
    const side = normalize(cross(cross(direction, sideHint), direction))
    const other = cross(direction, side)
    const segments = this.segments
    const first = this.positions.length / 3
    for (const ring of rings) {
      const center: Vec3 = [origin[0] + direction[0] * ring.at, origin[1] + direction[1] * ring.at, origin[2] + direction[2] * ring.at]
      for (let step = 0; step < segments; step++) {
        const angle = (step / segments) * Math.PI * 2
        const c = Math.cos(angle)
        const s = Math.sin(angle)
        const position: Vec3 = [
          center[0] + side[0] * c * ring.rx + other[0] * s * ring.rz,
          center[1] + side[1] * c * ring.rx + other[1] * s * ring.rz,
          center[2] + side[2] * c * ring.rx + other[2] * s * ring.rz,
        ]
        const shade = typeof ring.color === 'string' ? ring.color : ring.color(c, s)
        this.vertex(position, shade, ring.weights)
      }
    }
    for (let ring = 0; ring < rings.length - 1; ring++) {
      for (let step = 0; step < segments; step++) {
        const next = (step + 1) % segments
        const a = first + ring * segments + step
        const b = first + ring * segments + next
        const c = first + (ring + 1) * segments + step
        const d = first + (ring + 1) * segments + next
        this.indices.push(a, b, c, b, d, c)
      }
    }
    const cap = (ring: Ring, ringIndex: number, start: boolean) => {
      const center: Vec3 = [origin[0] + direction[0] * ring.at, origin[1] + direction[1] * ring.at, origin[2] + direction[2] * ring.at]
      const hub = this.vertex(center, typeof ring.color === 'string' ? ring.color : ring.color(0, 0), ring.weights)
      for (let step = 0; step < segments; step++) {
        const a = first + ringIndex * segments + step
        const b = first + ringIndex * segments + ((step + 1) % segments)
        if (start) this.indices.push(hub, b, a)
        else this.indices.push(hub, a, b)
      }
    }
    cap(rings[0], 0, true)
    cap(rings[rings.length - 1], rings.length - 1, false)
  }

  geometry(): THREE.BufferGeometry {
    const geometry = new THREE.BufferGeometry()
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(this.positions, 3))
    geometry.setAttribute('color', new THREE.Float32BufferAttribute(this.colors, 3))
    geometry.setAttribute('skinIndex', new THREE.Uint16BufferAttribute(this.skinIndex, 4))
    geometry.setAttribute('skinWeight', new THREE.Float32BufferAttribute(this.skinWeight, 4))
    geometry.setIndex(this.indices)
    geometry.computeVertexNormals()
    return geometry
  }
}

const blend = (from: number, to: number, value: number, low: number, high: number): Weights => {
  const t = Math.max(0, Math.min(1, (value - low) / (high - low)))
  return t <= 0 ? [[from, 1]] : t >= 1 ? [[to, 1]] : [[from, 1 - t], [to, t]]
}

function torsoWeights(y: number): Weights {
  if (y < 1.0) return [[BONE.hips, 1]]
  if (y < 1.12) return blend(BONE.hips, BONE.spine, y, 1.0, 1.12)
  if (y < 1.22) return [[BONE.spine, 1]]
  if (y < 1.32) return blend(BONE.spine, BONE.chest, y, 1.22, 1.32)
  if (y < 1.5) return [[BONE.chest, 1]]
  return blend(BONE.chest, BONE.neck, y, 1.5, 1.57)
}

function buildBody(look: GolferLook): THREE.BufferGeometry {
  const body = new SkinBuilder(look.segments)
  const torso: [number, number, number, string][] = [
    [0.84, 0.05, 0.04, look.pants],
    [0.87, 0.13, 0.1, look.pants],
    [0.92, 0.165, 0.118, look.pants],
    [1.0, 0.162, 0.114, look.pants],
    [1.03, 0.157, 0.11, look.belt],
    [1.064, 0.154, 0.108, look.belt],
    [1.066, 0.155, 0.109, look.shirt],
    [1.15, 0.151, 0.106, look.shirt],
    [1.26, 0.168, 0.113, look.shirt],
    [1.36, 0.182, 0.116, look.shirt],
    [1.43, 0.178, 0.106, look.shirt],
    [1.48, 0.14, 0.086, look.shirt],
    [1.51, 0.078, 0.068, look.collar],
    [1.53, 0.066, 0.06, look.collar],
    [1.535, 0.055, 0.052, look.skin],
    [1.6, 0.052, 0.05, look.skin],
    [1.635, 0.03, 0.03, look.skin],
  ]
  body.tube([0, 0, 0], [0, 1, 0], [1, 0, 0], torso.map(([at, rx, rz, color]) => ({ at, rx, rz, color, weights: torsoWeights(at) })))

  const head: Weights = [[BONE.head, 1]]
  const hairBack = (skin: string) => (_across: number, out: number) => (out > 0.25 ? look.hair : skin)
  const headRings: [number, number, number, Shade][] = [
    [1.585, 0.02, 0.02, look.skin],
    [1.6, 0.055, 0.062, look.skin],
    [1.63, 0.074, 0.088, look.skin],
    [1.67, 0.084, 0.098, look.skin],
    [1.705, 0.089, 0.102, hairBack(look.skin)],
    [1.74, 0.09, 0.102, hairBack(look.skin)],
    [1.762, 0.088, 0.1, look.hair],
    [1.764, 0.095, 0.107, look.cap],
    [1.8, 0.087, 0.098, look.cap],
    [1.83, 0.064, 0.074, look.cap],
    [1.848, 0.025, 0.03, look.cap],
  ]
  body.tube([0, 0, 0.012], [0, 1, 0], [1, 0, 0], headRings.map(([at, rx, rz, color]) => ({ at, rx, rz, color, weights: head })))
  body.tube([0, 1.766, 0.085], [0, -0.12, 1], [1, 0, 0], [
    { at: 0, rx: 0.08, rz: 0.006, color: look.capBrim, weights: head },
    { at: 0.06, rx: 0.075, rz: 0.006, color: look.capBrim, weights: head },
    { at: 0.1, rx: 0.05, rz: 0.005, color: look.capBrim, weights: head },
  ])
  body.tube([0, 1.705, 0.098], [0, -0.35, 1], [1, 0, 0], [
    { at: 0, rx: 0.012, rz: 0.014, color: look.skin, weights: head },
    { at: 0.022, rx: 0.011, rz: 0.012, color: look.skin, weights: head },
    { at: 0.03, rx: 0.004, rz: 0.004, color: look.skin, weights: head },
  ])
  for (const side of [1, -1]) {
    body.tube([side * 0.082, 1.7, 0.005], [side, 0, 0], [0, 1, 0], [
      { at: 0, rx: 0.026, rz: 0.012, color: look.skin, weights: head },
      { at: 0.014, rx: 0.024, rz: 0.01, color: look.skin, weights: head },
      { at: 0.018, rx: 0.01, rz: 0.004, color: look.skin, weights: head },
    ])
  }

  for (const side of [1, -1] as const) {
    const lead = side === 1
    const upper = lead ? BONE.upperArmL : BONE.upperArmR
    const fore = lead ? BONE.foreArmL : BONE.foreArmR
    const hand = lead ? BONE.handL : BONE.handR
    const handColor = lead ? look.glove : look.skin
    const shoulder = BONES[upper].rest
    const arm: [number, number, number, string, Weights][] = [
      [-0.05, 0.02, 0.02, look.shirt, [[BONE.chest, 1]]],
      [-0.035, 0.056, 0.056, look.shirt, [[BONE.chest, 0.6], [upper, 0.4]]],
      [0, 0.064, 0.062, look.shirt, [[BONE.chest, 0.35], [upper, 0.65]]],
      [0.06, 0.06, 0.058, look.shirt, [[upper, 1]]],
      [0.14, 0.055, 0.053, look.shirt, [[upper, 1]]],
      [0.142, 0.05, 0.048, look.skin, [[upper, 1]]],
      [0.22, 0.045, 0.044, look.skin, [[upper, 1]]],
      [0.3, 0.04, 0.04, look.skin, [[upper, 0.5], [fore, 0.5]]],
      [0.34, 0.042, 0.04, look.skin, [[fore, 1]]],
      [0.46, 0.036, 0.032, look.skin, [[fore, 1]]],
      [0.555, 0.028, 0.024, lead ? look.skin : look.skin, [[fore, 0.7], [hand, 0.3]]],
      [0.575, 0.03, 0.022, handColor, [[hand, 1]]],
      [0.62, 0.044, 0.024, handColor, [[hand, 1]]],
      [0.67, 0.04, 0.022, handColor, [[hand, 1]]],
      [0.69, 0.02, 0.012, handColor, [[hand, 1]]],
    ]
    body.tube(shoulder, [0, -1, 0], [1, 0, 0], arm.map(([at, rx, rz, color, weights]) => ({ at, rx, rz, color, weights })))

    const thigh = lead ? BONE.thighL : BONE.thighR
    const shin = lead ? BONE.shinL : BONE.shinR
    const foot = lead ? BONE.footL : BONE.footR
    const hip = BONES[thigh].rest
    const leg: [number, number, number, string, Weights][] = [
      [-0.06, 0.06, 0.06, look.pants, [[BONE.hips, 1]]],
      [0, 0.09, 0.092, look.pants, [[BONE.hips, 0.5], [thigh, 0.5]]],
      [0.08, 0.086, 0.09, look.pants, [[thigh, 1]]],
      [0.25, 0.073, 0.076, look.pants, [[thigh, 1]]],
      [0.42, 0.059, 0.063, look.pants, [[thigh, 0.5], [shin, 0.5]]],
      [0.48, 0.058, 0.062, look.pants, [[shin, 1]]],
      [0.6, 0.056, 0.06, look.pants, [[shin, 1]]],
      [0.8, 0.047, 0.05, look.pants, [[shin, 1]]],
      [0.82, 0.048, 0.05, look.pants, [[shin, 1]]],
      [0.822, 0.039, 0.039, look.sock, [[shin, 1]]],
      [0.86, 0.036, 0.036, look.sock, [[shin, 0.5], [foot, 0.5]]],
      [0.88, 0.03, 0.03, look.sock, [[foot, 1]]],
    ]
    body.tube(hip, [0, -1, 0], [1, 0, 0], leg.map(([at, rx, rz, color, weights]) => ({ at, rx, rz, color, weights })))
    const ankle = BONES[foot].rest
    const shoe: Weights = [[foot, 1]]
    body.tube([ankle[0], 0.055, -0.075], [0, 0, 1], [1, 0, 0], [
      { at: 0, rx: 0.02, rz: 0.02, color: look.shoe, weights: shoe },
      { at: 0.015, rx: 0.044, rz: 0.044, color: look.shoe, weights: shoe },
      { at: 0.06, rx: 0.05, rz: 0.05, color: look.shoe, weights: shoe },
      { at: 0.15, rx: 0.05, rz: 0.04, color: look.shoe, weights: shoe },
      { at: 0.21, rx: 0.04, rz: 0.028, color: look.shoe, weights: shoe },
      { at: 0.235, rx: 0.015, rz: 0.012, color: look.shoe, weights: shoe },
    ])
  }
  return body.geometry()
}

type HeadKind = 'wood' | 'iron' | 'putter'

const headKind = (club: ClubId): HeadKind => (club === 'putter' ? 'putter' : club === 'driver' || club === 'wood3' || club === 'hybrid5' ? 'wood' : 'iron')

function buildClub(look: GolferLook): { group: THREE.Group; shaft: THREE.Mesh; heads: Record<HeadKind, THREE.Mesh>; dispose(): void } {
  const group = new THREE.Group()
  group.name = 'club'
  const metal = new THREE.MeshStandardMaterial({ color: new THREE.Color(look.shaft), metalness: 0.85, roughness: 0.3 })
  const rubber = new THREE.MeshStandardMaterial({ color: new THREE.Color(look.grip), roughness: 0.85 })
  const shaftGeometry = new THREE.CylinderGeometry(0.0055, 0.0045, 1, 8)
  shaftGeometry.translate(0, -0.5, 0)
  const shaft = new THREE.Mesh(shaftGeometry, metal)
  const gripGeometry = new THREE.CylinderGeometry(0.0115, 0.009, 0.27, 10)
  gripGeometry.translate(0, -0.135, 0)
  const grip = new THREE.Mesh(gripGeometry, rubber)
  const woodGeometry = new THREE.SphereGeometry(1, 16, 10)
  woodGeometry.scale(0.05, 0.028, 0.058)
  woodGeometry.translate(-0.035, 0.02, 0.045)
  const ironGeometry = new THREE.BoxGeometry(0.018, 0.05, 0.075)
  ironGeometry.translate(0, 0.02, 0.04)
  const putterGeometry = new THREE.BoxGeometry(0.045, 0.024, 0.105)
  putterGeometry.translate(-0.01, 0.012, 0.045)
  const woodMaterial = new THREE.MeshStandardMaterial({ color: new THREE.Color(look.woodHead), metalness: 0.4, roughness: 0.25 })
  const ironMaterial = new THREE.MeshStandardMaterial({ color: new THREE.Color(look.ironHead), metalness: 0.9, roughness: 0.22 })
  const putterMaterial = new THREE.MeshStandardMaterial({ color: new THREE.Color(look.putterHead), metalness: 0.7, roughness: 0.3 })
  const heads: Record<HeadKind, THREE.Mesh> = {
    wood: new THREE.Mesh(woodGeometry, woodMaterial),
    iron: new THREE.Mesh(ironGeometry, ironMaterial),
    putter: new THREE.Mesh(putterGeometry, putterMaterial),
  }
  group.add(shaft, grip, heads.wood, heads.iron, heads.putter)
  for (const mesh of [shaft, grip, heads.wood, heads.iron, heads.putter]) mesh.castShadow = true
  return {
    group,
    shaft,
    heads,
    dispose() {
      for (const geometry of [shaftGeometry, gripGeometry, woodGeometry, ironGeometry, putterGeometry]) geometry.dispose()
      for (const material of [metal, rubber, woodMaterial, ironMaterial, putterMaterial]) material.dispose()
    },
  }
}

export function createGolfer(look: GolferLook): GolferModel {
  const root = new THREE.Group()
  root.name = 'golfer'
  const geometry = buildBody(look)
  const material = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: look.roughness, metalness: 0 })
  const mesh = new THREE.SkinnedMesh(geometry, material)
  mesh.castShadow = true
  mesh.frustumCulled = false
  const bones = BONES.map((spec) => {
    const bone = new THREE.Bone()
    bone.name = spec.name
    return bone
  })
  BONES.forEach((spec, index) => {
    const bone = bones[index]
    if (spec.parent < 0) {
      bone.position.set(spec.rest[0], spec.rest[1], spec.rest[2])
      mesh.add(bone)
    } else {
      const parent = BONES[spec.parent].rest
      bone.position.set(spec.rest[0] - parent[0], spec.rest[1] - parent[1], spec.rest[2] - parent[2])
      bones[spec.parent].add(bone)
    }
  })
  mesh.updateMatrixWorld(true)
  mesh.bind(new THREE.Skeleton(bones))
  root.add(mesh)

  const club = buildClub(look)
  root.add(club.group)
  let shownHead: HeadKind | null = null
  let shownLength = -1

  return {
    root,
    place(ball, ballLocal, aimYaw) {
      const yaw = aimYaw - Math.PI / 2
      root.rotation.set(0, yaw, 0)
      const c = Math.cos(yaw)
      const s = Math.sin(yaw)
      const worldX = ballLocal[0] * c + ballLocal[2] * s
      const worldZ = -ballLocal[0] * s + ballLocal[2] * c
      root.position.set(ball[0] - worldX, ball[1] - ballLocal[1], ball[2] - worldZ)
    },
    apply(solved, clubId) {
      solved.bones.forEach((entry, index) => {
        const spec = BONES[index]
        const local = spec.parent < 0 ? entry.quaternion : qMul(qConj(solved.bones[spec.parent].quaternion), entry.quaternion)
        bones[index].quaternion.set(local[0], local[1], local[2], local[3])
        if (spec.parent < 0) bones[index].position.set(entry.position[0], entry.position[1], entry.position[2])
      })
      const kind = headKind(clubId)
      if (kind !== shownHead) {
        for (const [name, head] of Object.entries(club.heads)) head.visible = name === kind
        shownHead = kind
      }
      const length = clubLength(clubId)
      if (length !== shownLength) {
        club.shaft.scale.set(1, length, 1)
        for (const head of Object.values(club.heads)) head.position.set(0, -length, 0)
        shownLength = length
      }
      club.group.position.set(solved.clubButt[0], solved.clubButt[1], solved.clubButt[2])
      const q = solved.clubQuaternion
      club.group.quaternion.set(q[0], q[1], q[2], q[3])
    },
    dispose() {
      root.removeFromParent()
      geometry.dispose()
      material.dispose()
      mesh.skeleton.dispose()
      club.dispose()
    },
  }
}
