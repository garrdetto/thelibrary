/** Procedural skinned ballplayer built on the shared skeleton: lofted torso with a belly, tapered limbs that blend into their parent bones at the joints, head, cap, hands and cleats. Each vertex carries a uniform slot so one mesh wears any club's colors. */
import * as THREE from 'three/webgpu'
import { BONES, type BoneName, type Proportions, type Rig } from './Rig'

export const SLOT = { skin: 0, jersey: 1, trim: 2, pants: 3, socks: 4, cleats: 5, cap: 6, belt: 7 } as const
export type Slot = (typeof SLOT)[keyof typeof SLOT]

class Builder {
  readonly positions: number[] = []
  readonly normals: number[] = []
  readonly indices: number[] = []
  readonly skinIndex: number[] = []
  readonly skinWeight: number[] = []
  readonly slots: number[] = []
  readonly wraps: number[] = []

  /** `wrap` is (sin, height, cos) around the torso for jersey lettering, (normal x, 2 + normal y, normal z) on the head for the face; every other part gets (0, -1, 0). */
  vertex(p: THREE.Vector3, n: THREE.Vector3, bones: [number, number], weights: [number, number], slot: number, wrap: readonly [number, number, number] = [0, -1, 0]): number {
    this.positions.push(p.x, p.y, p.z)
    this.normals.push(n.x, n.y, n.z)
    this.skinIndex.push(bones[0], bones[1], 0, 0)
    this.skinWeight.push(weights[0], weights[1], 0, 0)
    this.slots.push(slot)
    this.wraps.push(wrap[0], wrap[1], wrap[2])
    return this.positions.length / 3 - 1
  }

  geometry(): THREE.BufferGeometry {
    const geometry = new THREE.BufferGeometry()
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(this.positions, 3))
    geometry.setAttribute('normal', new THREE.Float32BufferAttribute(this.normals, 3))
    geometry.setAttribute('skinIndex', new THREE.Uint16BufferAttribute(this.skinIndex, 4))
    geometry.setAttribute('skinWeight', new THREE.Float32BufferAttribute(this.skinWeight, 4))
    geometry.setAttribute('slot', new THREE.Float32BufferAttribute(this.slots, 1))
    geometry.setAttribute('wrap', new THREE.Float32BufferAttribute(this.wraps, 3))
    geometry.setIndex(this.indices)
    geometry.computeVertexNormals()
    return geometry
  }
}

const index = (name: BoneName) => BONES.indexOf(name)

/** A tube from `a` to `b` world points, radius tapering r0 → r1, skinned to `bone` with a blend into `parent` over the first `blend` of its length. */
function tube(builder: Builder, a: THREE.Vector3, b: THREE.Vector3, r0: number, r1: number, bone: BoneName, parent: BoneName | null, slotAt: (u: number) => number, rings = 7, sides = 10, blend = 0.22): void {
  const axis = b.clone().sub(a)
  const length = axis.length()
  axis.normalize()
  const helper = Math.abs(axis.y) > 0.9 ? new THREE.Vector3(1, 0, 0) : new THREE.Vector3(0, 1, 0)
  const u1 = new THREE.Vector3().crossVectors(axis, helper).normalize()
  const u2 = new THREE.Vector3().crossVectors(axis, u1).normalize()
  const start = builder.positions.length / 3
  for (let ring = 0; ring <= rings; ring++) {
    const u = ring / rings
    const radius = r0 + (r1 - r0) * u + Math.sin(u * Math.PI) * (r0 + r1) * 0.06
    const center = a.clone().addScaledVector(axis, length * u)
    const toParent = parent && u < blend ? 0.5 * (1 - u / blend) : 0
    for (let side = 0; side < sides; side++) {
      const angle = (side / sides) * Math.PI * 2
      const normal = u1.clone().multiplyScalar(Math.cos(angle)).addScaledVector(u2, Math.sin(angle))
      builder.vertex(center.clone().addScaledVector(normal, radius), normal, [index(bone), parent ? index(parent) : index(bone)], [1 - toParent, toParent], slotAt(u))
    }
  }
  for (let ring = 0; ring < rings; ring++) {
    for (let side = 0; side < sides; side++) {
      const a0 = start + ring * sides + side
      const a1 = start + ring * sides + ((side + 1) % sides)
      const b0 = a0 + sides
      const b1 = a1 + sides
      builder.indices.push(a0, a1, b0, a1, b1, b0)
    }
  }
  for (const [ring, flip] of [[0, true], [rings, false]] as const) {
    const center = a.clone().addScaledVector(axis, length * (ring / rings))
    const cap = builder.vertex(center, axis.clone().multiplyScalar(flip ? -1 : 1), [index(bone), index(bone)], [1, 0], slotAt(ring / rings))
    for (let side = 0; side < sides; side++) {
      const s0 = start + ring * sides + side
      const s1 = start + ring * sides + ((side + 1) % sides)
      if (flip) builder.indices.push(cap, s1, s0)
      else builder.indices.push(cap, s0, s1)
    }
  }
}

/** Ellipsoid around `center`, skinned to one bone. `upper` limits it to the top half (cap crowns). */
function blob(builder: Builder, center: THREE.Vector3, radii: THREE.Vector3, bone: BoneName, slot: (normal: THREE.Vector3) => number, upper = false, rows = 8, sides = 12, wrap?: (normal: THREE.Vector3) => readonly [number, number, number]): void {
  const start = builder.positions.length / 3
  const rowEnd = upper ? rows / 2 : rows
  for (let row = 0; row <= rowEnd; row++) {
    const phi = (row / rows) * Math.PI
    for (let side = 0; side <= sides; side++) {
      const theta = (side / sides) * Math.PI * 2
      const normal = new THREE.Vector3(Math.sin(phi) * Math.cos(theta), Math.cos(phi), Math.sin(phi) * Math.sin(theta))
      const point = center.clone().add(normal.clone().multiply(radii))
      builder.vertex(point, normal, [index(bone), index(bone)], [1, 0], slot(normal), wrap?.(normal))
    }
  }
  for (let row = 0; row < rowEnd; row++) {
    for (let side = 0; side < sides; side++) {
      const a = start + row * (sides + 1) + side
      const b = a + sides + 1
      builder.indices.push(a, a + 1, b, a + 1, b + 1, b)
    }
  }
}

function box(builder: Builder, center: THREE.Vector3, size: THREE.Vector3, bones: [BoneName, BoneName], weightOf: (point: THREE.Vector3) => number, slot: number): void {
  const geometry = new THREE.BoxGeometry(size.x, size.y, size.z)
  const start = builder.positions.length / 3
  const position = geometry.getAttribute('position')
  const normal = geometry.getAttribute('normal')
  const point = new THREE.Vector3()
  const n = new THREE.Vector3()
  for (let i = 0; i < position.count; i++) {
    point.fromBufferAttribute(position, i).add(center)
    n.fromBufferAttribute(normal, i)
    const w = weightOf(point)
    builder.vertex(point.clone(), n.clone(), [index(bones[0]), index(bones[1])], [1 - w, w], slot)
  }
  const indices = geometry.getIndex()!
  for (let i = 0; i < indices.count; i++) builder.indices.push(start + indices.getX(i))
  geometry.dispose()
}

/** Builds the bind-pose body for a rig. The rig's bones must already be posed at rest. */
export function buildBody(rig: Rig, proportions: Proportions): THREE.BufferGeometry {
  rig.root.updateMatrixWorld(true)
  const world = (name: BoneName) => new THREE.Vector3().setFromMatrixPosition(rig.bones[name].matrixWorld)
  const s = proportions.scale
  const g = proportions.girth
  const builder = new Builder()

  const hips = world('hips')
  const neck = world('neck')
  const torsoRings = 9
  const torsoSides = 14
  const start = builder.positions.length / 3
  const bottom = hips.y - 0.13 * s
  const bands = [0.3, 0.36, 0.93]
  const slotOf = (u: number) => (u < 0.3 ? SLOT.pants : u < 0.36 ? SLOT.belt : u > 0.93 ? SLOT.trim : SLOT.jersey)
  const rings: { u: number; slot: number; joined: boolean }[] = []
  const heights = [...new Set([...Array.from({ length: torsoRings + 1 }, (_, ring) => ring / torsoRings), ...bands])].sort((a, b) => a - b)
  for (const u of heights) {
    if (bands.includes(u)) {
      rings.push({ u, slot: slotOf(u - 1e-4), joined: false }, { u, slot: slotOf(u + 1e-4), joined: true })
    } else rings.push({ u, slot: slotOf(u), joined: true })
  }
  for (const { u, slot } of rings) {
    const y = bottom + (neck.y - bottom) * u
    const width = (0.15 + 0.035 * Math.sin(u * Math.PI * 0.95) + (u > 0.7 ? 0.03 * proportions.shoulders : 0)) * s * g
    const depth = (0.105 + 0.02 * Math.sin(u * Math.PI)) * s * g
    const belly = proportions.belly * Math.max(0, Math.sin(((u - 0.1) / 0.55) * Math.PI)) * (u > 0.1 && u < 0.65 ? 1 : 0)
    const lower = u < 0.42 ? 'hips' : u < 0.72 ? 'spine' : 'chest'
    const upper = u < 0.42 ? 'spine' : u < 0.72 ? 'chest' : 'neck'
    const mix = u < 0.42 ? u / 0.42 * 0.35 : u < 0.72 ? ((u - 0.42) / 0.3) * 0.4 : ((u - 0.72) / 0.28) * 0.3
    for (let side = 0; side < torsoSides; side++) {
      const angle = (side / torsoSides) * Math.PI * 2
      const cx = Math.sin(angle)
      const cz = Math.cos(angle)
      const forward = Math.max(0, cz)
      const point = new THREE.Vector3(hips.x + cx * width, y, hips.z + cz * (depth + belly * forward * forward))
      builder.vertex(point, new THREE.Vector3(cx, 0, cz), [index(lower), index(upper)], [1 - mix, mix], slot, [cx, u, cz])
    }
  }
  for (let ring = 0; ring < rings.length - 1; ring++) {
    if (!rings[ring].joined) continue
    for (let side = 0; side < torsoSides; side++) {
      const a0 = start + ring * torsoSides + side
      const a1 = start + ring * torsoSides + ((side + 1) % torsoSides)
      builder.indices.push(a0, a1, a0 + torsoSides, a1, a1 + torsoSides, a0 + torsoSides)
    }
  }

  tube(builder, neck, world('head'), 0.055 * s, 0.05 * s, 'neck', 'chest', () => SLOT.skin, 3, 10)
  const head = world('head').add(new THREE.Vector3(0, 0.1 * s, 0.01 * s))
  blob(builder, head, new THREE.Vector3(0.095, 0.115, 0.105).multiplyScalar(s), 'head', () => SLOT.skin, false, 14, 18, (n) => [n.x, 2 + n.y, n.z])
  blob(builder, head.clone().add(new THREE.Vector3(0, 0.025 * s, -0.005 * s)), new THREE.Vector3(0.102, 0.1, 0.11).multiplyScalar(s), 'head', () => SLOT.cap, true)
  box(builder, head.clone().add(new THREE.Vector3(0, 0.03 * s, 0.13 * s)), new THREE.Vector3(0.17, 0.015, 0.09).multiplyScalar(s), ['head', 'head'], () => 0, SLOT.cap)
  box(builder, head.clone().add(new THREE.Vector3(0, -0.01 * s, 0.1 * s)), new THREE.Vector3(0.03, 0.04, 0.04).multiplyScalar(s), ['head', 'head'], () => 0, SLOT.skin)

  for (const side of ['L', 'R'] as const) {
    const shoulder = world(`shoulder.${side}`)
    const arm = world(`arm.${side}`)
    const forearm = world(`forearm.${side}`)
    const hand = world(`hand.${side}`)
    tube(builder, shoulder, arm, 0.07 * s * g, 0.065 * s * g, `shoulder.${side}`, 'chest', () => SLOT.jersey, 3, 10)
    tube(builder, arm, forearm, 0.062 * s * g, 0.048 * s * g, `arm.${side}`, `shoulder.${side}`, (u) => (u < 0.45 ? SLOT.jersey : SLOT.skin))
    tube(builder, forearm, hand, 0.046 * s * g, 0.036 * s * g, `forearm.${side}`, `arm.${side}`, () => SLOT.skin)
    blob(builder, hand.clone().add(new THREE.Vector3((side === 'L' ? 0.045 : -0.045) * s, 0, 0)), new THREE.Vector3(0.055, 0.03, 0.045).multiplyScalar(s), `hand.${side}`, () => SLOT.skin, false, 6, 8)

    const thigh = world(`thigh.${side}`)
    const shin = world(`shin.${side}`)
    const foot = world(`foot.${side}`)
    const toe = world(`toe.${side}`)
    tube(builder, thigh, shin, 0.092 * s * g, 0.068 * s * g, `thigh.${side}`, 'hips', () => SLOT.pants)
    tube(builder, shin, foot, 0.066 * s * g, 0.045 * s * g, `shin.${side}`, `thigh.${side}`, (u) => (u < 0.42 ? SLOT.pants : SLOT.socks))
    const shoeCenter = foot.clone().lerp(toe, 0.45).add(new THREE.Vector3(0, -0.005 * s, 0))
    box(builder, shoeCenter, new THREE.Vector3(0.1 * s, 0.075 * s, 0.27 * s), [`foot.${side}`, `toe.${side}`], (point) => Math.max(0, Math.min(0.6, (point.z - foot.z) / (0.2 * s))), SLOT.cleats)
  }
  return builder.geometry()
}
