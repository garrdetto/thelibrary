import { Vector3 } from '@babylonjs/core/Maths/math.vector'
import type { Terrain } from './Terrain'

export const CABIN_FLOOR = 0.45
export const CABIN_HALF_W = 4
export const CABIN_HALF_D = 3

export type CabinSpot = 'wardrobe' | 'rack' | 'desk'

interface Seg { ax: number; az: number; bx: number; bz: number }
interface Box { x: number; z: number; hw: number; hd: number }

/**
 * Where the walls, furniture and stations are, in the building's own frame (x across, z front to back, the front door
 * at +z). The cabin is standalone Rack & Reel's; Fox Lake's Fox Outfitters is the same log building bigger, with store
 * shelving and an open garage bay on the east side where the side-by-side is parked.
 */
export interface CabinLayout {
  model: 'cabin' | 'outfitters'
  /** Half width and half depth of the main room. */
  halfW: number
  halfD: number
  /** The first five are the room's walls (they block sight lines); the rest are porch rails and the garage. */
  walls: Seg[]
  furniture: Box[]
  spots: Record<CabinSpot, { x: number; z: number; label: string }>
  /** The open garage bay (x0..x1 across, z0..z1 front to back) and its floor height. */
  garage: { x0: number; x1: number; z0: number; z1: number; floor: number } | null
  /** The sign over the garage bay, if any. */
  sign: string | null
  /** Clear of grass and trees around the building. */
  clearRadius: number
}

const SPOT_IDS: readonly CabinSpot[] = ['wardrobe', 'rack', 'desk']
/** The first walls in a layout are the building's own shell; the rest fence the porch and the garage. */
const SHELL_WALLS = 5

function layout(model: CabinLayout['model'], w: number, d: number, garageWidth: number, store: string | null): CabinLayout {
  const hw = w / 2
  const hd = d / 2
  const porch = hd + 2.05
  const walls: Seg[] = [
    { ax: -hw - 0.35, az: -hd, bx: hw + 0.35, bz: -hd },
    { ax: -hw, az: -hd - 0.35, bx: -hw, bz: hd + 0.35 },
    { ax: hw, az: -hd - 0.35, bx: hw, bz: hd + 0.35 },
    { ax: -hw - 0.35, az: hd, bx: -0.55, bz: hd },
    { ax: 0.55, az: hd, bx: hw + 0.35, bz: hd },
    { ax: -hw - 0.05, az: hd + 0.2, bx: -hw - 0.05, bz: porch },
    { ax: hw + 0.05, az: hd + 0.2, bx: hw + 0.05, bz: porch },
    { ax: -hw - 0.05, az: porch, bx: -0.85, bz: porch },
    { ax: 0.85, az: porch, bx: hw + 0.05, bz: porch },
  ]
  const furniture: Box[] = [
    { x: -hw + 0.75, z: -0.8, hw: 0.4, hd: 0.35 },
    { x: 2.6, z: -hd + 1.05, hw: 1.1, hd: 0.55 },
    { x: 0.4, z: 0.3, hw: 1.2, hd: 0.5 },
    { x: -2.6, z: -hd + 0.42, hw: 0.62, hd: 0.32 },
    { x: hw - 0.4, z: 1.2, hw: 0.42, hd: 0.78 },
    { x: -hw - 0.55, z: -0.8, hw: 0.6, hd: 0.4 },
  ]
  const g = garageWidth > 0 ? { x0: hw, x1: hw + garageWidth, z0: -hd, z1: hd, floor: 0.2 } : null
  if (g) {
    walls.push({ ax: g.x0, az: -hd, bx: g.x1 + 0.35, bz: -hd }, { ax: g.x1, az: -hd - 0.35, bx: g.x1, bz: hd + 0.1 })
    furniture.push(
      { x: (g.x0 + g.x1) / 2 - 0.6, z: -hd + 0.5, hw: 1.25, hd: 0.38 },
      { x: g.x1 - 0.55, z: -hd + 0.6, hw: 0.32, hd: 0.32 },
      { x: g.x1 - 0.32, z: 1.4, hw: 0.2, hd: 0.85 },
      { x: -3.6, z: 1.6, hw: 1.0, hd: 0.3 },
      { x: -4.8, z: -hd + 0.3, hw: 0.86, hd: 0.2 },
    )
  } else {
    furniture.push({ x: hw + 0.8, z: -1.9, hw: 0.3, hd: 0.7 }, { x: hw + 1.0, z: 0.6, hw: 0.3, hd: 0.3 })
  }
  const desk = store ? `E — ${store} counter: catalog and task board` : 'E — trading desk: catalog and task board'
  return {
    model,
    halfW: hw,
    halfD: hd,
    walls,
    furniture,
    spots: {
      wardrobe: { x: -2.6, z: -hd + 1.15, label: 'E — open the wardrobe' },
      rack: { x: 1.1, z: -hd + 0.75, label: 'E — gear rack: pick your rod, bait and rifle' },
      desk: { x: hw - 1.15, z: 1.2, label: desk },
    },
    garage: g,
    sign: store ? store.toUpperCase() : null,
    clearRadius: g ? Math.hypot(g.x1, porch) + 1.5 : 6.4,
  }
}

export const CABIN = layout('cabin', 8, 6, 0, null)
export const FOX_OUTFITTERS = layout('outfitters', 12, 8, 6, 'Fox Outfitters')

export class Cabin {
  readonly root: Vector3
  readonly heading: number
  private readonly c: number
  private readonly s: number
  private readonly probe = new Vector3()
  private readonly probeB = new Vector3()

  constructor(readonly terrain: Terrain, center: Vector3, heading: number, readonly layout: CabinLayout = CABIN) {
    this.heading = heading
    this.c = Math.cos(heading)
    this.s = Math.sin(heading)
    let top = -Infinity
    const { halfW: hw, halfD: hd, garage } = layout
    const samples = [[-hw, -hd], [hw, -hd], [-hw, hd], [hw, hd], [0, 0], [0, hd + 2]]
    if (garage) samples.push([garage.x1, garage.z0], [garage.x1, garage.z1], [(garage.x0 + garage.x1) / 2, 0])
    for (const [lx, lz] of samples) {
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
    return this.toWorld(new Vector3(0, CABIN_FLOOR, this.layout.halfD + 3.4))
  }

  inside(p: Vector3): boolean {
    return this.insideLocal(this.toLocal(p, this.probe))
  }

  private insideLocal(l: Vector3): boolean {
    return Math.abs(l.x) < this.layout.halfW - 0.1 && Math.abs(l.z) < this.layout.halfD - 0.1
  }

  near(p: Vector3, r: number): boolean {
    const l = this.toLocal(p, this.probe)
    const east = this.layout.garage?.x1 ?? this.layout.halfW
    return l.x > -this.layout.halfW - r && l.x < east + r && l.z > -this.layout.halfD - r && l.z < this.layout.halfD + 3 + r
  }

  floorAt(p: Vector3): number | null {
    const l = this.toLocal(p, this.probe)
    const { halfW: hw, halfD: hd } = this.layout
    const porch = hd + 2.25
    if (Math.abs(l.x) <= hw + 0.15 && l.z >= -hd - 0.1 && l.z <= porch) return this.root.y + CABIN_FLOOR
    if (Math.abs(l.x) <= 0.85 && l.z > porch && l.z < porch + 0.75) return this.root.y + CABIN_FLOOR * (1 - (l.z - porch) / 0.75)
    return this.garageFloor(l.x, l.z)
  }

  /** The garage's concrete floor under local (x, z), or null outside the bay. */
  private garageFloor(lx: number, lz: number): number | null {
    const g = this.layout.garage
    if (!g || lx < g.x0 || lx > g.x1 || lz < g.z0 || lz > g.z1 + 0.6) return null
    return this.root.y + g.floor
  }

  /** The garage floor under world (x, z), for wheels; null outside the bay. */
  garageFloorAt(x: number, z: number): number | null {
    if (!this.layout.garage) return null
    const dx = x - this.root.x
    const dz = z - this.root.z
    return this.garageFloor(dx * this.c - dz * this.s, dx * this.s + dz * this.c)
  }

  /** Where the side-by-side is parked in the garage bay, nose out. */
  garageSpot(): { position: Vector3; heading: number } | null {
    const g = this.layout.garage
    if (!g) return null
    const position = this.toWorld(new Vector3((g.x0 + g.x1) / 2, g.floor, 0.4))
    return { position, heading: this.heading }
  }

  collide(p: Vector3, radius: number): void {
    if (!this.near(p, 2)) return
    const l = this.toLocal(p, this.probe)
    for (const w of this.layout.walls) {
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
    for (const b of this.layout.furniture) {
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
      const w = this.layout.walls[i]
      if (segmentsCross(la.x, la.z, lb.x, lb.z, w.ax, w.az, w.bx, w.bz)) return true
    }
    return Math.max(la.y, lb.y) > CABIN_FLOOR + 2.6 && this.insideLocal(la) !== this.insideLocal(lb)
  }

  spotNear(p: Vector3, range = 1.3): CabinSpot | null {
    const l = this.toLocal(p, this.probe)
    let best: CabinSpot | null = null
    let bestD = range
    for (let i = 0; i < SPOT_IDS.length; i++) {
      const s = this.layout.spots[SPOT_IDS[i]]
      const d = Math.hypot(l.x - s.x, l.z - s.z)
      if (d < bestD) {
        bestD = d
        best = SPOT_IDS[i]
      }
    }
    return best
  }

  spotLabel(spot: CabinSpot): string {
    return this.layout.spots[spot].label
  }

  parking(index: number): { position: Vector3; heading: number } {
    return { position: this.toWorld(new Vector3(-this.layout.halfW - 3.5 - index * 3, 0, 1.5)), heading: this.heading + Math.PI / 2 }
  }
}

function segmentsCross(ax: number, az: number, bx: number, bz: number, cx: number, cz: number, dx: number, dz: number): boolean {
  const d1 = (dx - cx) * (az - cz) - (dz - cz) * (ax - cx)
  const d2 = (dx - cx) * (bz - cz) - (dz - cz) * (bx - cx)
  const d3 = (bx - ax) * (cz - az) - (bz - az) * (cx - ax)
  const d4 = (bx - ax) * (dz - az) - (bz - az) * (dx - ax)
  return d1 * d2 < 0 && d3 * d4 < 0
}
