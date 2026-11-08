/** Architecture placed around a house: canopies over doors and windows, porch roofs on posts, pergolas with string lights, fences and gates, and chimneys. */
import * as THREE from 'three/webgpu'
import { outsideSide } from '../../shared/Build'
import { featureEdges, type LotGrid } from '../../shared/Lot'
import { PAINTS, type Feature, type HouseStyle } from '../../shared/Style'
import { material } from './Kit'
import { surface } from './Surfaces'

const paint = (index: number) => PAINTS[index]?.color ?? PAINTS[0].color
const WALL_TOP = 2.75
const CANOPY_WIDTHS = [1.4, 2.2, 3.2]

const box = new THREE.BoxGeometry(1, 1, 1)
const cylinder = new THREE.CylinderGeometry(0.5, 0.5, 1, 14)
const taper = new THREE.CylinderGeometry(0.32, 0.5, 1, 14)
const ball = new THREE.SphereGeometry(0.5, 10, 8)
for (const g of [box, cylinder, taper, ball]) g.userData.shared = true

/** Collects transformed pieces per geometry and material and turns each set into one instanced mesh. */
class Parts {
  private readonly sets = new Map<string, { geometry: THREE.BufferGeometry; material: THREE.Material; matrices: THREE.Matrix4[]; featureIds: number[]; shadows: boolean }>()
  private readonly e = new THREE.Euler()
  private readonly q = new THREE.Quaternion()

  add(geometry: THREE.BufferGeometry, mat: THREE.Material, frame: THREE.Matrix4, x: number, y: number, z: number, sx: number, sy: number, sz: number, featureId: number, rx = 0, ry = 0, rz = 0, shadows = true): void {
    const key = `${geometry.uuid}|${mat.uuid}`
    let set = this.sets.get(key)
    if (!set) {
      set = { geometry, material: mat, matrices: [], featureIds: [], shadows }
      this.sets.set(key, set)
    }
    this.q.setFromEuler(this.e.set(rx, ry, rz))
    const local = new THREE.Matrix4().compose(new THREE.Vector3(x, y, z), this.q, new THREE.Vector3(sx, sy, sz))
    set.matrices.push(frame.clone().multiply(local))
    set.featureIds.push(featureId)
  }

  build(group: THREE.Group): void {
    for (const set of this.sets.values()) {
      const mesh = new THREE.InstancedMesh(set.geometry, set.material, set.matrices.length)
      set.matrices.forEach((m, i) => mesh.setMatrixAt(i, m))
      mesh.instanceMatrix.needsUpdate = true
      mesh.castShadow = set.shadows
      mesh.receiveShadow = true
      mesh.userData.featureIds = set.featureIds
      group.add(mesh)
    }
  }
}

function frameAt(x: number, z: number, yaw: number): THREE.Matrix4 {
  return new THREE.Matrix4().makeRotationY(yaw).setPosition(x, 0, z)
}

export interface FeatureSet {
  group: THREE.Group
  setRoof(visible: boolean): void
  setNight(amount: number): void
}

export function buildFeatures(features: Feature[], grid: LotGrid, style: HouseStyle, roofTop: number, eave: { y: number; out: number }): FeatureSet {
  const group = new THREE.Group()
  group.name = 'features'
  const above = new THREE.Group()
  group.add(above)
  const parts = new Parts()
  const roofParts = new Parts()
  const trim = material(paint(style.trimColor), { roughness: 0.55 })
  const roofSurface = (color: number) => surface(style.roofMaterial === 'metal' ? 'metal' : style.roofMaterial === 'clay' ? 'clay' : style.roofMaterial === 'slate' ? 'slate' : 'shingles', 'roof', { size: 1.4, color: paint(color), roughness: 0.8, side: THREE.DoubleSide })
  const bulbMat = new THREE.MeshStandardMaterial({ color: '#fff4d6', emissive: new THREE.Color('#ffd27a'), emissiveIntensity: 0.1, roughness: 0.3 })
  group.userData.ownMaterial = bulbMat

  const porches = features.filter(f => f.kind === 'porch').map(f => [Math.min(f.x, f.x2 ?? f.x), Math.min(f.z, f.z2 ?? f.z), Math.max(f.x, f.x2 ?? f.x), Math.max(f.z, f.z2 ?? f.z)] as const)
  for (const f of features) {
    const color = paint(f.color)
    if (f.kind === 'canopy' && f.v !== undefined) {
      const side = outsideSide(grid, [f.x, f.z, f.v])
      if (!side) continue
      const front: [number, number] = f.v === 0 ? [f.x, side > 0 ? f.z : f.z - 1] : [side > 0 ? f.x : f.x - 1, f.z]
      if (porches.some(([a, b, c, d]) => front[0] >= a && front[0] <= c && front[1] >= b && front[1] <= d)) continue
      const cx = f.v === 0 ? f.x + 0.5 : f.x, cz = f.v === 0 ? f.z : f.z + 0.5
      const yaw = f.v === 0 ? (side > 0 ? 0 : Math.PI) : side * Math.PI / 2
      const frame = frameAt(cx, cz, yaw)
      const width = CANOPY_WIDTHS[(f.width ?? 1) - 1] ?? 1.4
      const isDoor = grid.isDoor(f.x, f.z, f.v)
      const base = isDoor ? 2.38 : 2.22
      const depth = f.style === 'awning' ? 1.0 : 0.95
      const t = 0.04
      const bracket = (along: number) => {
        parts.add(box, trim, frame, along, base - 0.28, 0.12, 0.06, 0.06, 0.22, f.id)
        parts.add(box, trim, frame, along, base - 0.18, depth * 0.42, 0.05, 0.05, depth * 0.95, f.id, Math.atan2(0.45, depth * 0.9), 0, 0)
      }
      switch (f.style) {
        case 'shed': {
          const slope = 0.32
          const mat = roofSurface(f.color)
          parts.add(box, mat, frame, 0, base + 0.16, depth / 2 + 0.05, width, t * 2, depth + 0.1, f.id, slope, 0, 0)
          parts.add(box, trim, frame, 0, base + 0.16 - Math.sin(slope) * (depth / 2 + 0.05) - 0.06, depth + 0.07, width + 0.02, 0.14, 0.04, f.id)
          bracket(-width / 2 + 0.1)
          bracket(width / 2 - 0.1)
          break
        }
        case 'gable': {
          const pitch = 0.6
          const half = width / 2
          const mat = roofSurface(f.color)
          const run = half / Math.cos(pitch)
          for (const s of [-1, 1]) parts.add(box, mat, frame, s * half / 2, base + 0.22 + Math.tan(pitch) * half / 2, depth / 2 + 0.06, run + 0.06, t * 2, depth + 0.12, f.id, 0, 0, -s * pitch)
          const tri = new THREE.Shape()
          tri.moveTo(-half + 0.05, 0)
          tri.lineTo(half - 0.05, 0)
          tri.lineTo(0, Math.tan(pitch) * (half - 0.05))
          tri.closePath()
          const gableGeometry = new THREE.ExtrudeGeometry(tri, { depth: 0.04, bevelEnabled: false })
          parts.add(gableGeometry, trim, frame, 0, base + 0.2, depth + 0.02, 1, 1, 1, f.id)
          parts.add(box, trim, frame, 0, base + 0.16, depth / 2 + 0.06, width - 0.05, 0.1, depth + 0.06, f.id)
          bracket(-half + 0.1)
          bracket(half - 0.1)
          break
        }
        case 'arch': {
          const geometry = new THREE.CylinderGeometry(width / 2, width / 2, depth + 0.1, 20, 1, true, -Math.PI / 2, Math.PI)
          parts.add(geometry, roofSurface(f.color), frame, 0, base + 0.1, depth / 2 + 0.05, 1, 1, 1, f.id, Math.PI / 2, 0, Math.PI / 2)
          parts.add(box, trim, frame, 0, base + 0.08, depth + 0.08, width + 0.04, 0.08, 0.06, f.id)
          bracket(-width / 2 + 0.1)
          bracket(width / 2 - 0.1)
          break
        }
        case 'flat': {
          const metal = material(color, { roughness: 0.35, metalness: 0.5 })
          parts.add(box, metal, frame, 0, base + 0.12, depth / 2 + 0.04, width, 0.09, depth + 0.08, f.id)
          for (const s of [-1, 1]) parts.add(cylinder, material('#1f2124', { metalness: 0.7, roughness: 0.3 }), frame, s * (width / 2 - 0.12), base + 0.45, depth * 0.48, 0.022, Math.hypot(depth, 0.7), 0.022, f.id, -Math.atan2(depth, 0.7), 0, 0)
          break
        }
        case 'awning': {
          const slope = 0.55
          const fabric = surface('stripes', 'tri', { size: 0.9, color, roughness: 0.95, side: THREE.DoubleSide })
          parts.add(box, fabric, frame, 0, base + 0.1, depth / 2, width, 0.02, depth / Math.cos(slope) + 0.02, f.id, slope, 0, 0)
          const front = base + 0.1 - Math.tan(slope) * depth / 2
          parts.add(box, fabric, frame, 0, front - 0.11, depth + 0.01, width, 0.22, 0.015, f.id)
          for (const s of [-1, 1]) parts.add(cylinder, material('#2a2c30', { metalness: 0.6 }), frame, s * (width / 2 - 0.03), front + 0.05, depth / 2, 0.015, depth * 1.1, 0.015, f.id, Math.PI / 2 - slope, 0, 0)
          break
        }
      }
    } else if (f.kind === 'porch' || f.kind === 'pergola') {
      const x0 = Math.min(f.x, f.x2 ?? f.x), x1 = Math.max(f.x, f.x2 ?? f.x) + 1
      const z0 = Math.min(f.z, f.z2 ?? f.z), z1 = Math.max(f.z, f.z2 ?? f.z) + 1
      const frame = new THREE.Matrix4()
      const wood = f.kind === 'pergola' ? surface('grain', 'tri', { size: 0.9, color, roughness: 0.7 }) : material(color, { roughness: 0.5 })
      const count = (from: number, to: number) => Math.max(1, to - from)
      const sides = {
        south: [...Array(x1 - x0)].filter((_, i) => grid.isWall(x0 + i, z0, 0)).length / count(x0, x1),
        north: [...Array(x1 - x0)].filter((_, i) => grid.isWall(x0 + i, z1, 0)).length / count(x0, x1),
        west: [...Array(z1 - z0)].filter((_, i) => grid.isWall(x0, z0 + i, 1)).length / count(z0, z1),
        east: [...Array(z1 - z0)].filter((_, i) => grid.isWall(x1, z0 + i, 1)).length / count(z0, z1),
      }
      const house = f.kind === 'porch' ? (Object.entries(sides).sort((a, b) => b[1] - a[1])[0][1] > 0 ? Object.entries(sides).sort((a, b) => b[1] - a[1])[0][0] : null) : null
      const posts: [number, number][] = []
      const along = (a: number, b: number) => {
        const n = Math.max(1, Math.ceil((b - a) / 3))
        return Array.from({ length: n + 1 }, (_, i) => a + 0.12 + (i / n) * (b - a - 0.24))
      }
      for (const x of along(x0, x1)) {
        if (house !== 'south') posts.push([x, z0 + 0.12])
        if (house !== 'north') posts.push([x, z1 - 0.12])
      }
      for (const z of along(z0, z1)) {
        if (house !== 'west') posts.push([x0 + 0.12, z])
        if (house !== 'east') posts.push([x1 - 0.12, z])
      }
      const unique = [...new Map(posts.map(p => [`${p[0].toFixed(2)},${p[1].toFixed(2)}`, p])).values()]
      const porchHigh = Math.min(WALL_TOP - 0.05, eave.y - 0.04)
      const porchLow = Math.max(2.28, porchHigh - 0.4)
      const postH = f.kind === 'pergola' ? 2.45 : porchLow - 0.2
      for (const [px, pz] of unique) {
        if (f.kind === 'porch' && f.style === 'round') parts.add(cylinder, wood, frame, px, postH / 2, pz, 0.18, postH, 0.18, f.id)
        else if (f.kind === 'porch' && f.style === 'tapered') {
          parts.add(box, surface('stone', 'wall', { size: 1.2, color: '#c9c2b6' }), frame, px, 0.45, pz, 0.32, 0.9, 0.32, f.id)
          parts.add(taper, wood, frame, px, 0.9 + (postH - 0.9) / 2, pz, 0.24, postH - 0.9, 0.24, f.id)
        } else parts.add(box, wood, frame, px, postH / 2, pz, 0.16, postH, 0.16, f.id)
      }
      if (f.kind === 'porch') {
        const over = 0.28
        const tuck = Math.max(0, eave.out - 0.08)
        const ex0 = x0 + (house === 'west' ? tuck : -over), ex1 = x1 + (house === 'east' ? -tuck : over)
        const ez0 = z0 + (house === 'south' ? tuck : -over), ez1 = z1 + (house === 'north' ? -tuck : over)
        const w = ex1 - ex0, d = ez1 - ez0
        const high = porchHigh, low = porchLow
        const run = house === 'south' || house === 'north' ? d : house ? w : 0
        const slope = run ? Math.atan2(high - low, run) : 0
        const mid = (high + low) / 2 + 0.05
        let rx = 0, rz = 0
        if (house === 'south') rx = slope
        if (house === 'north') rx = -slope
        if (house === 'west') rz = -slope
        if (house === 'east') rz = slope
        const slabW = house === 'west' || house === 'east' ? Math.hypot(w, high - low) : w
        const slabD = house === 'south' || house === 'north' ? Math.hypot(d, high - low) : d
        parts.add(box, roofSurface(style.roofColor), frame, (ex0 + ex1) / 2, mid, (ez0 + ez1) / 2, slabW, 0.08, slabD, f.id, rx, 0, rz)
        parts.add(box, material('#e9e4d8', { roughness: 0.9 }), frame, (ex0 + ex1) / 2, mid - 0.09, (ez0 + ez1) / 2, slabW - 0.05, 0.02, slabD - 0.05, f.id, rx, 0, rz, false)
        for (const [bx, bz, bw, bd] of [[(x0 + x1) / 2, z0 + 0.12, x1 - x0, 0.14], [(x0 + x1) / 2, z1 - 0.12, x1 - x0, 0.14], [x0 + 0.12, (z0 + z1) / 2, 0.14, z1 - z0], [x1 - 0.12, (z0 + z1) / 2, 0.14, z1 - z0]] as const) {
          parts.add(box, trim, frame, bx, postH + 0.08, bz, bw, 0.18, bd, f.id)
        }
      } else {
        const alongX = x1 - x0 >= z1 - z0
        for (const s of [0, 1]) {
          if (alongX) parts.add(box, wood, frame, (x0 + x1) / 2, postH + 0.1, s ? z1 - 0.12 : z0 + 0.12, x1 - x0 + 0.5, 0.2, 0.1, f.id)
          else parts.add(box, wood, frame, s ? x1 - 0.12 : x0 + 0.12, postH + 0.1, (z0 + z1) / 2, 0.1, 0.2, z1 - z0 + 0.5, f.id)
        }
        const span = alongX ? x1 - x0 : z1 - z0
        for (let k = 0; k <= span / 0.4; k++) {
          const at = (alongX ? x0 : z0) + 0.05 + k * 0.4
          if (alongX) parts.add(box, wood, frame, at, postH + 0.26, (z0 + z1) / 2, 0.06, 0.14, z1 - z0 + 0.4, f.id)
          else parts.add(box, wood, frame, (x0 + x1) / 2, postH + 0.26, at, x1 - x0 + 0.4, 0.14, 0.06, f.id)
        }
        const strands = alongX ? [z0 + 0.12, z1 - 0.12] : [x0 + 0.12, x1 - 0.12]
        for (const line of strands) for (let k = 0; k <= span * 3; k++) {
          const at = (alongX ? x0 : z0) + k / 3
          const sag = Math.sin((k / (span * 3)) * Math.PI) * 0.18
          if (alongX) parts.add(ball, bulbMat, frame, at, postH - 0.05 - sag, line, 0.06, 0.06, 0.06, f.id, 0, 0, 0, false)
          else parts.add(ball, bulbMat, frame, line, postH - 0.05 - sag, at, 0.06, 0.06, 0.06, f.id, 0, 0, 0, false)
        }
      }
    } else if (f.kind === 'fence') {
      const mat = material(color, { roughness: f.style === 'iron' ? 0.35 : 0.75, metalness: f.style === 'iron' ? 0.5 : 0 })
      const boards = surface('boards', 'wall', { size: 1.6, color, roughness: 0.85 })
      for (const [ex, ez, v] of featureEdges(f)) {
        const frame = frameAt(v === 0 ? ex + 0.5 : ex, v === 0 ? ez : ez + 0.5, v === 0 ? 0 : Math.PI / 2)
        const post = (h: number, size: number) => { for (const s of [-0.5, 0.5]) parts.add(box, mat, frame, s, h / 2, 0, size, h, size, f.id) }
        switch (f.style) {
          case 'picket':
          case 'gate': {
            post(1.1, 0.1)
            for (const y of [0.3, 0.8]) parts.add(box, mat, frame, 0, y, 0.04, 1, 0.07, 0.03, f.id)
            const span = f.style === 'gate' ? 0.82 : 0.9
            for (let k = 0; k < 7; k++) parts.add(box, mat, frame, -span / 2 + 0.06 + k * (span - 0.12) / 6, 0.5, 0.06, 0.07, 0.95 + (f.style === 'picket' ? 0 : Math.sin((k / 6) * Math.PI) * 0.15), 0.02, f.id)
            if (f.style === 'gate') parts.add(box, mat, frame, 0, 0.55, 0.075, 0.9, 0.06, 0.02, f.id, 0, 0, Math.atan2(0.5, 0.82))
            break
          }
          case 'privacy':
            post(1.9, 0.12)
            parts.add(box, boards, frame, 0, 0.95, 0, 0.98, 1.8, 0.04, f.id)
            parts.add(box, mat, frame, 0, 1.88, 0, 1.04, 0.06, 0.1, f.id)
            break
          case 'iron':
            post(1.3, 0.07)
            for (const y of [0.12, 1.15]) parts.add(box, mat, frame, 0, y, 0, 1, 0.035, 0.025, f.id)
            for (let k = 0; k < 8; k++) {
              const x = -0.44 + k * 0.125
              parts.add(box, mat, frame, x, 0.62, 0, 0.018, 1.2, 0.018, f.id)
              parts.add(ball, mat, frame, x, 1.25, 0, 0.045, 0.07, 0.045, f.id)
            }
            break
          case 'rail':
            post(1.0, 0.13)
            for (const y of [0.45, 0.85]) parts.add(cylinder, mat, frame, 0, y, 0, 0.07, 1.0, 0.07, f.id, 0, 0, Math.PI / 2)
            break
        }
      }
    } else if (f.kind === 'chimney') {
      const frame = new THREE.Matrix4()
      const brick = surface('brick', 'wall', { size: 1, color, roughness: 0.9 })
      const from = WALL_TOP - 0.3
      const to = roofTop + 0.95
      roofParts.add(box, brick, frame, f.x + 0.5, (from + to) / 2, f.z + 0.5, 0.9, to - from, 0.9, f.id)
      roofParts.add(box, surface('concrete', 'wall', { size: 1, color: '#bdb8ae' }), frame, f.x + 0.5, to + 0.06, f.z + 0.5, 1.04, 0.12, 1.04, f.id)
      for (const s of [-0.2, 0.2]) roofParts.add(cylinder, material('#8a5a44', { roughness: 0.8 }), frame, f.x + 0.5 + s, to + 0.25, f.z + 0.5, 0.16, 0.3, 0.16, f.id)
    }
  }
  parts.build(group)
  roofParts.build(above)
  return {
    group,
    setRoof(visible) {
      above.visible = visible
    },
    setNight(amount) {
      bulbMat.emissiveIntensity = 0.1 + amount * 3.2
    },
  }
}
