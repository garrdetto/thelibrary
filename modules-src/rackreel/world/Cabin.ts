import { Vector3 } from '@babylonjs/core/Maths/math.vector'
import type { Terrain } from './Terrain'

export const CABIN_FLOOR = 0.45
export const CABIN_HALF_W = 4
export const CABIN_HALF_D = 3

export type CabinSpot = 'wardrobe' | 'rack' | 'desk'

interface Seg { ax: number; az: number; bx: number; bz: number }
interface Box { x: number; z: number; hw: number; hd: number }

const WALLS: Seg[] = [
  { ax: -4.35, az: -3, bx: 4.35, bz: -3 },
  { ax: -4, az: -3.35, bx: -4, bz: 3.35 },
  { ax: 4, az: -3.35, bx: 4, bz: 3.35 },
  { ax: -4.35, az: 3, bx: -0.55, bz: 3 },
  { ax: 0.55, az: 3, bx: 4.35, bz: 3 },
  { ax: -4.05, az: 3.2, bx: -4.05, bz: 5.05 },
  { ax: 4.05, az: 3.2, bx: 4.05, bz: 5.05 },
  { ax: -4.05, az: 5.05, bx: -0.85, bz: 5.05 },
  { ax: 0.85, az: 5.05, bx: 4.05, bz: 5.05 },
]

const FURNITURE: Box[] = [
  { x: -3.25, z: -0.8, hw: 0.4, hd: 0.35 },
  { x: 2.6, z: -1.95, hw: 1.1, hd: 0.55 },
  { x: 0.4, z: 0.3, hw: 1.2, hd: 0.5 },
  { x: -2.6, z: -2.58, hw: 0.62, hd: 0.32 },
  { x: 3.6, z: 1.2, hw: 0.42, hd: 0.78 },
  { x: -4.55, z: -0.8, hw: 0.6, hd: 0.4 },
  { x: 4.8, z: -1.9, hw: 0.3, hd: 0.7 },
  { x: 5.0, z: 0.6, hw: 0.3, hd: 0.3 },
]

const SPOTS: Record<CabinSpot, { x: number; z: number; label: string }> = {
  wardrobe: { x: -2.6, z: -1.85, label: 'E — open the wardrobe' },
  rack: { x: 1.1, z: -2.25, label: 'E — gear rack: pick your rod, bait and rifle' },
  desk: { x: 2.85, z: 1.2, label: 'E — trading desk: catalog and task board' },
}
const SPOT_IDS = Object.keys(SPOTS) as CabinSpot[]
/** The first walls in `WALLS` are the cabin's own shell; the rest fence the porch. */
const SHELL_WALLS = 5

function insideLocal(l: Vector3): boolean {
  return Math.abs(l.x) < CABIN_HALF_W - 0.1 && Math.abs(l.z) < CABIN_HALF_D - 0.1
}

export class Cabin {
  readonly root: Vector3
  readonly heading: number
  private readonly c: number
  private readonly s: number
  private readonly probe = new Vector3()
  private readonly probeB = new Vector3()

  constructor(readonly terrain: Terrain, center: Vector3, heading: number) {
    this.heading = heading
    this.c = Math.cos(heading)
    this.s = Math.sin(heading)
    let top = -Infinity
    for (const [lx, lz] of [[-4, -3], [4, -3], [-4, 3], [4, 3], [0, 0], [0, 5]]) {
      const w = this.toWorldXZ(lx, lz, center)
      top = Math.max(top, terrain.heightAt(w.x, w.z))
    }
    this.root = new Vector3(center.x, top - 0.2, center.z)
  }

  private toWorldXZ(lx: number, lz: number, origin: Vector3 = this.root): { x: number; z: number } {
    return { x: origin.x + lx * this.c + lz * this.s, z: origin.z - lx * this.s + lz * this.c }
  }

  toWorld(local: Vector3): Vector3 {
    const w = this.toWorldXZ(local.x, local.z)
    return new Vector3(w.x, this.root.y + local.y, w.z)
  }

  toLocal(p: Vector3, out = new Vector3()): Vector3 {
    const dx = p.x - this.root.x
    const dz = p.z - this.root.z
    return out.set(dx * this.c - dz * this.s, p.y - this.root.y, dx * this.s + dz * this.c)
  }

  get frontDoor(): Vector3 {
    return this.toWorld(new Vector3(0, CABIN_FLOOR, 6.4))
  }

  inside(p: Vector3): boolean {
    return insideLocal(this.toLocal(p, this.probe))
  }

  near(p: Vector3, r: number): boolean {
    const l = this.toLocal(p, this.probe)
    return Math.abs(l.x) < CABIN_HALF_W + r && l.z > -CABIN_HALF_D - r && l.z < 6 + r
  }

  floorAt(p: Vector3): number | null {
    const l = this.toLocal(p, this.probe)
    if (Math.abs(l.x) <= 4.15 && l.z >= -3.1 && l.z <= 5.25) return this.root.y + CABIN_FLOOR
    if (Math.abs(l.x) <= 0.85 && l.z > 5.25 && l.z < 6.0) return this.root.y + CABIN_FLOOR * (1 - (l.z - 5.25) / 0.75)
    return null
  }

  collide(p: Vector3, radius: number): void {
    if (!this.near(p, 2)) return
    const l = this.toLocal(p, this.probe)
    for (const w of WALLS) {
      const ex = w.bx - w.ax
      const ez = w.bz - w.az
      const t = Math.max(0, Math.min(1, ((l.x - w.ax) * ex + (l.z - w.az) * ez) / (ex * ex + ez * ez)))
      const cx = w.ax + ex * t
      const cz = w.az + ez * t
      const dx = l.x - cx
      const dz = l.z - cz
      const d = Math.hypot(dx, dz)
      const min = radius + 0.17
      if (d < min && d > 1e-5) {
        l.x = cx + (dx / d) * min
        l.z = cz + (dz / d) * min
      }
    }
    for (const b of FURNITURE) {
      const dx = l.x - b.x
      const dz = l.z - b.z
      const px = b.hw + radius - Math.abs(dx)
      const pz = b.hd + radius - Math.abs(dz)
      if (px > 0 && pz > 0) {
        if (px < pz) l.x += Math.sign(dx || 1) * px
        else l.z += Math.sign(dz || 1) * pz
      }
    }
    const lx = l.x
    const lz = l.z
    p.x = this.root.x + lx * this.c + lz * this.s
    p.z = this.root.z - lx * this.s + lz * this.c
  }

  segmentBlocked(a: Vector3, b: Vector3): boolean {
    const la = this.toLocal(a, this.probe)
    const lb = this.toLocal(b, this.probeB)
    for (let i = 0; i < SHELL_WALLS; i++) {
      const w = WALLS[i]
      if (segmentsCross(la.x, la.z, lb.x, lb.z, w.ax, w.az, w.bx, w.bz)) return true
    }
    return Math.max(la.y, lb.y) > CABIN_FLOOR + 2.6 && insideLocal(la) !== insideLocal(lb)
  }

  spotNear(p: Vector3, range = 1.3): CabinSpot | null {
    const l = this.toLocal(p, this.probe)
    let best: CabinSpot | null = null
    let bestD = range
    for (let i = 0; i < SPOT_IDS.length; i++) {
      const s = SPOTS[SPOT_IDS[i]]
      const d = Math.hypot(l.x - s.x, l.z - s.z)
      if (d < bestD) {
        bestD = d
        best = SPOT_IDS[i]
      }
    }
    return best
  }

  spotLabel(spot: CabinSpot): string {
    return SPOTS[spot].label
  }

  parking(index: number): { position: Vector3; heading: number } {
    return { position: this.toWorld(new Vector3(-7.5 - index * 3, 0, 1.5)), heading: this.heading + Math.PI / 2 }
  }
}

function segmentsCross(ax: number, az: number, bx: number, bz: number, cx: number, cz: number, dx: number, dz: number): boolean {
  const d1 = (dx - cx) * (az - cz) - (dz - cz) * (ax - cx)
  const d2 = (dx - cx) * (bz - cz) - (dz - cz) * (bx - cx)
  const d3 = (bx - ax) * (cz - az) - (bz - az) * (cx - ax)
  const d4 = (bx - ax) * (dz - az) - (bz - az) * (dx - ax)
  return d1 * d2 < 0 && d3 * d4 < 0
}
