/**
 * Fox Lake's north: County Road F through the woods and Montello at its end, built into Fox Lake's scene and
 * Rapier world. Montello itself is Tello's own builder (tello/world/Montello.ts) with its physics shifted into Fox
 * Plains' town frame; this file adds the corridor between: its ground, the road, the woods, the heightfield under
 * them and the invisible walls that keep cars on the land.
 */
import { Color3 } from '@babylonjs/core/Maths/math.color'
import { StandardMaterial } from '@babylonjs/core/Materials/standardMaterial'
import { Mesh } from '@babylonjs/core/Meshes/mesh'
import { VertexData } from '@babylonjs/core/Meshes/mesh.vertexData'
import type { Scene } from '@babylonjs/core/scene'
import type { GameHost } from '../../rackreel/game/Game'
import { fbm } from '../../rackreel/world/Terrain'
import { detailTexture } from '../../rackreel/world/World'
import type { Mats } from '../fp/core/Tex'
import type { Physics } from '../fp/physics/Physics'
import type { TownGfx } from '../town/TownGfx'
import type { RegionCuller } from '../core/RegionCuller'
import { roadRibbon } from '../town/TownGround'
import { FOX_LAKE_WOODS_FLOOR } from '../look'
import { TOWN_OFFSET, TOWN_SQUARE, TOWN_Y, outsideHeight, sceneToTown } from '../region'
import { Montello } from '../../tello/world/Montello'
import { LINK_SEEN, LINK_WALL, type MontelloLink } from './Link'

const CELL = 4
const TREE_STEP = 8
const TREE_RADIUS = { pine: 0.4, hardwood: 0.5, birch: 0.3 } as const
const WALL_STEP = 10
const WALL_HEIGHT = 24

interface Trunk {
  x: number
  z: number
  r: number
}

export interface NorthSetup {
  host: GameHost
  physics: Physics
  mats: Mats
  gfx: TownGfx
  culler: RegionCuller
}

export class NorthWorld {
  readonly montello: Montello
  private readonly trunks = new Map<number, Trunk[]>()
  private readonly _t = { x: 0, y: 0, z: 0 }

  constructor(readonly link: MontelloLink, private readonly s: NorthSetup) {
    const land = link.land
    // Tello's town frame (map x, height, -map z) to Fox Plains' town frame: both hang from mirrored roots, so it is a move.
    const shift = { x: land.offset.x - TOWN_OFFSET.x, y: -TOWN_OFFSET.y, z: TOWN_OFFSET.z - land.offset.z }
    this.montello = new Montello(land, { host: s.host, physics: s.physics, shift, mats: s.mats, gfx: s.gfx, culler: s.culler, openLink: true })
  }

  async build(progress: (share: number, text: string) => void): Promise<void> {
    const { scene } = this.s.host.ctx
    progress(0, 'Clearing County Road F…')
    const ground = this.buildGround(scene)
    const road = roadRibbon(scene, 'county-road-f', this.link.road, (x, z) => this.s.host.terrain.heightAt(x, z) + 0.06)
    this.addHeightfield()
    this.addWalls()
    this.plantWoods()
    for (const m of [...ground, road]) {
      const b = m.getBoundingInfo().boundingBox
      this.s.culler.addGroup([m], b.centerWorld.x, b.centerWorld.z, Math.hypot(b.extendSizeWorld.x, b.extendSizeWorld.z))
    }
    await this.montello.build((share, text) => progress(0.1 + share * 0.9, text))
  }

  ready(): void {
    this.montello.ready()
  }

  update(dt: number): void {
    this.montello.update(dt)
  }

  /** Points in Fox Plains' town frame where cars are: Montello's trunks near them turn solid. */
  focus(points: readonly { x: number; z: number }[]): void {
    this.montello.solidTrees(points)
  }

  /** Pushes a walker (scene point) out of the trunks of Montello and the corridor; true when it moved. */
  pushTrees(p: { x: number; z: number }, r: number): boolean {
    if (this.link.land.holdsScene(p.x, p.z)) return this.montello.pushTrees(p, r)
    if (p.z < TOWN_SQUARE.z1 - 4) return false
    let hit = false
    for (let i = -1; i <= 1; i++) {
      for (let j = -1; j <= 1; j++) {
        const list = this.trunks.get(cellKey(p.x + i * 16, p.z + j * 16))
        if (!list) continue
        for (const t of list) {
          const dx = p.x - t.x
          const dz = p.z - t.z
          const d = Math.hypot(dx, dz)
          const min = t.r + r
          if (d < min && d > 1e-4) {
            p.x = t.x + (dx / d) * min
            p.z = t.z + (dz / d) * min
            hit = true
          }
        }
      }
    }
    return hit
  }

  /** The place name north of Fox Plains' square, or on County Road F inside it; null elsewhere. */
  placeName(x: number, z: number): string | null {
    const link = this.link
    if (link.land.holdsScene(x, z)) return this.montello.placeName(x, z)
    const n = link.near(x, z)
    if (n.d - n.w / 2 < 6) return 'County Road F'
    return z > TOWN_SQUARE.z1 ? 'Fox Lake woods' : null
  }

  /** Woods floor and the road's grassy verges, north of the square up to Montello's edge, as far as the woods are drawn. */
  private buildGround(scene: Scene): Mesh[] {
    const link = this.link
    const terrain = this.s.host.terrain
    const x0 = link.box.x0
    const x1 = link.box.x1
    const z0 = TOWN_SQUARE.z1 - 4
    const z1 = link.edgeZ
    const nx = Math.ceil((x1 - x0) / CELL)
    const nz = Math.ceil((z1 - z0) / CELL)
    const vx = nx + 1
    const vz = nz + 1
    const positions = new Float32Array(vx * vz * 3)
    const colors = new Float32Array(vx * vz * 4)
    const uvs = new Float32Array(vx * vz * 2)
    const keep = new Uint8Array(vx * vz)
    const near = { d: 0, s: 0, w: 0 }
    for (let j = 0; j < vz; j++) {
      for (let i = 0; i < vx; i++) {
        const k = j * vx + i
        const x = x0 + i * CELL
        const z = Math.min(z1, z0 + j * CELL)
        const n = link.near(x, z, near)
        keep[k] = n.d < LINK_SEEN ? 1 : 0
        positions[k * 3] = x
        positions[k * 3 + 1] = terrain.heightAt(x, z) - 0.04
        positions[k * 3 + 2] = z
        uvs[k * 2] = x / 7
        uvs[k * 2 + 1] = z / 7
        const c = corridorColor(x, z, n.d - n.w / 2)
        colors[k * 4] = c[0]
        colors[k * 4 + 1] = c[1]
        colors[k * 4 + 2] = c[2]
        colors[k * 4 + 3] = 1
      }
    }
    const indices: number[] = []
    for (let j = 0; j < nz; j++) {
      for (let i = 0; i < nx; i++) {
        const a = j * vx + i
        if (!keep[a] && !keep[a + 1] && !keep[a + vx] && !keep[a + vx + 1]) continue
        indices.push(a, a + 1, a + vx, a + vx + 1, a + vx, a + 1)
      }
    }
    const normals = new Float32Array(positions.length)
    VertexData.ComputeNormals(positions, indices, normals, { useRightHandedSystem: false })
    const data = new VertexData()
    data.positions = positions
    data.indices = indices
    data.normals = normals
    data.colors = colors
    data.uvs = uvs
    const mesh = new Mesh('county-road-f-ground', scene)
    data.applyToMesh(mesh, false)
    const mat = new StandardMaterial('tello-link-ground', scene)
    mat.diffuseTexture = detailTexture(scene)
    mat.specularColor = Color3.Black()
    mat.ambientColor = new Color3(0.4, 0.4, 0.4)
    mesh.material = mat
    mesh.receiveShadows = true
    mesh.isPickable = false
    mesh.freezeWorldMatrix()
    return [mesh]
  }

  /**
   * The corridor as a Rapier heightfield (Fox Plains' town frame). Where Fox Plains' own land or Montello's heightfield
   * already lies, this one sinks out of the way beneath it.
   */
  private addHeightfield(): void {
    const link = this.link
    const land = link.land
    const x0 = link.box.x0 - 8
    const z0 = TOWN_SQUARE.z1 - 12
    const size = Math.ceil(Math.max(link.box.x1 + 8 - x0, link.edgeZ + 24 - z0) / CELL) * CELL
    const n = size / CELL
    const heights = new Float32Array((n + 1) * (n + 1))
    // Heightfield rows run along +z of the town frame, which is south in the scene.
    for (let j = 0; j <= n; j++) {
      for (let i = 0; i <= n; i++) {
        const x = x0 + i * CELL
        const z = z0 + size - j * CELL
        let h: number
        if (land.holdsScene(x, z + CELL) && land.holdsScene(x, z)) h = land.groundAt(land.toMapX(x), land.toMapZ(z)) - 3
        else if (z <= TOWN_SQUARE.z1 - CELL) h = outsideHeight(x, z) - (x >= TOWN_SQUARE.x0 && x <= TOWN_SQUARE.x1 ? 3 : 0)
        else h = link.corridorHeight(x, z)
        heights[i + j * (n + 1)] = h - TOWN_OFFSET.y
      }
    }
    const c = sceneToTown(x0 + size / 2, 0, z0 + size / 2, this._t)
    this.s.physics.addHeightfield(n, size, heights, c.x, c.z)
  }

  /** Walls either side of the road from Fox Plains' square to Montello's, and along the square's north edge beside it. */
  private addWalls(): void {
    const link = this.link
    const guide = link.road.filter((p) => p.z > TOWN_SQUARE.z1 - 2)
    const sides: { x: number; z: number }[][] = [[], []]
    for (let k = 0; k < guide.length; k++) {
      const a = guide[Math.max(0, k - 1)]
      const b = guide[Math.min(guide.length - 1, k + 1)]
      const len = Math.hypot(b.x - a.x, b.z - a.z) || 1
      const nx = (b.z - a.z) / len
      const nz = -(b.x - a.x) / len
      sides[0].push({ x: guide[k].x + nx * LINK_WALL, z: guide[k].z + nz * LINK_WALL })
      sides[1].push({ x: guide[k].x - nx * LINK_WALL, z: guide[k].z - nz * LINK_WALL })
    }
    const last = guide[guide.length - 1]
    const dir = { x: last.x - guide[guide.length - 2].x, z: last.z - guide[guide.length - 2].z }
    const dl = Math.hypot(dir.x, dir.z) || 1
    // On past the map's edge to meet Montello's own walls round County Highway F.
    const beyond = (link.edgeZ + 6 - last.z) / (dir.z / dl)
    for (const side of sides) {
      const end = side[side.length - 1]
      side.push({ x: end.x + (dir.x / dl) * beyond, z: end.z + (dir.z / dl) * beyond })
      let from = side[0]
      for (let k = 1; k < side.length; k++) {
        const to = side[k]
        if (Math.hypot(to.x - from.x, to.z - from.z) < WALL_STEP && k < side.length - 1) continue
        this.wall(from, to)
        from = to
      }
    }
    const gap = [sides[0][0].x, sides[1][0].x].sort((a, b) => a - b)
    const edge = TOWN_SQUARE.z1 - 1
    this.wall({ x: TOWN_SQUARE.x0, z: edge }, { x: gap[0], z: edge })
    this.wall({ x: gap[1], z: edge }, { x: Math.max(TOWN_SQUARE.x1, link.box.x1), z: edge })
  }

  private wall(a: { x: number; z: number }, b: { x: number; z: number }): void {
    const len = Math.hypot(b.x - a.x, b.z - a.z)
    if (len < 0.1) return
    const terrain = this.s.host.terrain
    const mx = (a.x + b.x) / 2
    const mz = (a.z + b.z) / 2
    const low = Math.min(terrain.heightAt(a.x, a.z), terrain.heightAt(b.x, b.z), terrain.heightAt(mx, mz))
    const c = sceneToTown(mx, low - 4 + WALL_HEIGHT / 2, mz, this._t)
    // The town frame mirrors z, so a scene direction (dx, dz) is (dx, -dz) there.
    this.s.physics.addStaticBox({ cx: c.x, cy: c.y, cz: c.z, hx: len / 2 + 0.5, hy: WALL_HEIGHT / 2, hz: 0.5, rotY: Math.atan2(b.z - a.z, b.x - a.x) })
  }

  /** Mixed woods either side of the road: solid near it (where you can walk and drive), scenery further out. */
  private plantWoods(): void {
    const link = this.link
    const terrain = this.s.host.terrain
    const spots: { x: number; y: number; z: number; kind: 'pine' | 'hardwood' | 'birch'; scale: number; yaw: number }[] = []
    const near = { d: 0, s: 0, w: 0 }
    for (let x = link.box.x0; x < link.box.x1; x += TREE_STEP) {
      for (let z = TOWN_SQUARE.z1 + 2; z < link.edgeZ - 2; z += TREE_STEP) {
        const h = hash(x, z)
        if (h < 0.22) continue
        const px = x + (hash(x + 1.7, z) - 0.5) * TREE_STEP * 0.9
        const pz = z + (hash(x, z + 2.3) - 0.5) * TREE_STEP * 0.9
        const n = link.near(px, pz, near)
        const clear = n.d - n.w / 2
        if (clear < 9 || n.d > LINK_SEEN - 4) continue
        const pick = fbm(px * 0.11, pz * 0.13, 2, 9) * 0.5 + 0.5
        const kind = pick < 0.15 ? 'birch' : pick < 0.6 ? 'pine' : 'hardwood'
        const scale = 0.8 + h * 0.55
        spots.push({ x: px, y: terrain.heightAt(px, pz), z: pz, kind, scale, yaw: pick * Math.PI * 2 })
        if (n.d > LINK_WALL + 2) continue
        const r = TREE_RADIUS[kind] * scale + 0.15
        const key = cellKey(px, pz)
        let list = this.trunks.get(key)
        if (!list) this.trunks.set(key, (list = []))
        list.push({ x: px, z: pz, r })
        const t = sceneToTown(px, terrain.heightAt(px, pz) + 2.5, pz, this._t)
        this.s.physics.addStaticCylinder(t.x, t.y, t.z, 3, r)
      }
    }
    this.s.host.foliage.plantTrees(spots)
  }
}

const { needles, moss } = FOX_LAKE_WOODS_FLOOR
const verge = [0.4, 0.46, 0.22]
const shoulder = [0.43, 0.39, 0.31]

/** The corridor's ground colour (linear 0..1): a mown verge by the road, then the woods floor. */
function corridorColor(x: number, z: number, clear: number): number[] {
  const varN = fbm(x * 0.05, z * 0.05, 3, 13) * 0.5 + 0.5
  const woods = smooth01((clear - 9) / 14)
  const floor = mix(needles, moss, varN * 0.8)
  let c = mix(verge, floor, woods)
  c = mix(shoulder, c, smooth01(clear / 2.5))
  const shade = 0.85 + varN * 0.3
  return [c[0] * shade, c[1] * shade, c[2] * shade]
}

function mix(a: readonly number[], b: readonly number[], t: number): number[] {
  const k = Math.min(1, Math.max(0, t))
  return [a[0] + (b[0] - a[0]) * k, a[1] + (b[1] - a[1]) * k, a[2] + (b[2] - a[2]) * k]
}

function smooth01(t: number): number {
  const k = Math.min(1, Math.max(0, t))
  return k * k * (3 - 2 * k)
}

function hash(x: number, z: number): number {
  const h = Math.sin(x * 12.9898 + z * 78.233) * 43758.5453
  return h - Math.floor(h)
}

function cellKey(x: number, z: number): number {
  return (Math.floor(x / 16) + 4096) * 8192 + Math.floor(z / 16) + 4096
}

export { TOWN_Y }
