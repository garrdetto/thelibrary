/**
 * Draws the county's roadside detail (`shared/Roadside.ts`) per chunk, merged with the chunk's other scenery: delineator posts
 * with reflectors, speed limit signs (white boards lettered from a shared atlas), yellow chevron boards on highway bends,
 * farmsteads (the farm parts' house and barn, a mailbox, a parked pickup), round hay bales and cars parked along Millbrook's
 * streets. Parked vehicles are simple merged bodies (body, cabin, glass, wheels), not live models, so dozens cost a few draw
 * calls. `roadsideBoxes` gives the houses, barns, parked vehicles and bales to the physics world.
 */
import type { Scene } from '@babylonjs/core/scene'
import type { Mesh } from '@babylonjs/core/Meshes/mesh'
import { roadside } from '../../shared/Roadside'
import type { Spot } from '../../shared/Roadside'
import type { StaticBox } from '../../sim/SimWorld'
import type { MaterialLibrary } from '../Materials'
import { SceneryBatch } from '../lots/Batch'
import { localBox, paintKey } from '../lots/Items'
import type { LocalBox } from '../lots/Items'
import { SceneryMaterials } from '../lots/Palette'
import { SignAtlas } from '../lots/Signs'
import { barn, farmhouse } from './sites/FarmParts'
import type { ChunkContext, ChunkLayer, ChunkPart } from './WorldRenderer'

const HOUSE = { dx: -6, dz: 2, w: 12, d: 10 }
const BARN = { dx: 14, dz: -6, w: 14, d: 20 }
const CARS = [
  { length: 4.7, width: 1.8, belt: 0.92, roof: 1.44, cabin: [0.85, -1.25] },
  { length: 5.6, width: 2.0, belt: 1.12, roof: 1.86, cabin: [1.05, -0.45] },
  { length: 4.9, width: 1.9, belt: 1.04, roof: 1.78, cabin: [0.95, -2.15] },
  { length: 5.4, width: 2.0, belt: 1.05, roof: 2.05, cabin: [1.65, -2.55] },
] as const

/** A parked vehicle in the batch's current frame, nose toward local +z. */
function parkedCar(b: SceneryBatch, style: number, color: string): LocalBox {
  const c = CARS[style % CARS.length]
  const key = paintKey(color)
  const hw = c.width / 2, half = c.length / 2
  b.box(key, 0, 0.3, 0, c.width, c.belt - 0.3, c.length)
  b.box('glassTint', 0, c.belt, (c.cabin[0] + c.cabin[1]) / 2, c.width - 0.2, c.roof - c.belt - 0.07, c.cabin[0] - c.cabin[1])
  b.box(key, 0, c.roof - 0.07, (c.cabin[0] + c.cabin[1]) / 2 - 0.15, c.width - 0.22, 0.07, c.cabin[0] - c.cabin[1] - 0.4)
  for (const z of [half - 0.9, -half + 0.9]) for (const x of [-hw + 0.1, hw - 0.1]) b.cylinder('rubber', x - 0.12, 0.33, z, 0.33, 0.24, 10, 0.33, 'x')
  b.box('lampRed', -hw + 0.25, c.belt - 0.25, -half - 0.01, 0.3, 0.14, 0.03)
  b.box('lampRed', hw - 0.25, c.belt - 0.25, -half - 0.01, 0.3, 0.14, 0.03)
  return localBox(-hw, 0, -half, hw, c.roof, half)
}

/** Where `local` (in a frame at `spot` turned by its yaw) sits in the world, as a physics box. */
function toWorld(spot: { x: number; z: number; yaw: number }, local: LocalBox, ground: number): StaticBox {
  const c = Math.cos(spot.yaw), s = Math.sin(spot.yaw)
  return { x: spot.x + local.x * c + local.z * s, y: ground + local.y, z: spot.z - local.x * s + local.z * c, hx: local.hx, hy: local.hy, hz: local.hz, rotY: spot.yaw }
}

const near = (x: number, z: number, ctx: { x0: number; z0: number; size: number }) => x >= ctx.x0 && x < ctx.x0 + ctx.size && z >= ctx.z0 && z < ctx.z0 + ctx.size

/** Houses, barns, parked vehicles and bales as solid boxes. */
export function roadsideBoxes(heightAt: (x: number, z: number) => number): StaticBox[] {
  const plan = roadside()
  const out: StaticBox[] = []
  const scratch = new SceneryBatch()
  for (const home of plan.homes) {
    const ground = heightAt(home.x, home.z)
    out.push(toWorld(home, localBox(HOUSE.dx - HOUSE.w / 2, 0, HOUSE.dz - HOUSE.d / 2, HOUSE.dx + HOUSE.w / 2, 7, HOUSE.dz + HOUSE.d / 2), ground))
    out.push(toWorld(home, localBox(BARN.dx - BARN.w / 2, 0, BARN.dz - BARN.d / 2, BARN.dx + BARN.w / 2, 9, BARN.dz + BARN.d / 2), ground))
    out.push(toWorld(home.pickup, parkedCar(scratch, 1, home.pickupColor), heightAt(home.pickup.x, home.pickup.z)))
  }
  for (const car of plan.parked) out.push(toWorld(car, parkedCar(scratch, car.style, car.color), heightAt(car.x, car.z)))
  for (const bale of plan.bales) out.push(toWorld(bale, localBox(-0.8, 0, -0.75, 0.8, 1.5, 0.75), heightAt(bale.x, bale.z)))
  return out
}

class RoadsideChunk implements ChunkPart {
  constructor(private readonly meshes: Mesh[]) {}

  dispose(): void {
    for (const mesh of this.meshes) mesh.dispose(false, false)
    this.meshes.length = 0
  }
}

export class RoadsideLayer implements ChunkLayer {
  readonly name = 'roadside'
  private readonly materials: SceneryMaterials
  private readonly atlas: SignAtlas

  constructor(private readonly scene: Scene, mats: MaterialLibrary) {
    this.materials = new SceneryMaterials(scene, mats)
    this.atlas = new SignAtlas(scene, 'trucksim-roadside', { cellWidth: 128, cellHeight: 128, columns: 4, rows: 2 })
  }

  build(_cx: number, _cz: number, ctx: ChunkContext): ChunkPart | null {
    const plan = roadside()
    const b = new SceneryBatch()
    const terrain = ctx.terrain
    const frame = (spot: Spot) => b.frame(spot.x - ctx.x0, terrain.heightAt(spot.x, spot.z), spot.z - ctx.z0, spot.yaw)
    let any = false
    for (const post of plan.posts) {
      if (!near(post.x, post.z, ctx)) continue
      any = true
      frame(post)
      b.box('metalWhite', 0, 0, 0, 0.1, 1.15, 0.1)
      b.box('lampAmber', 0, 0.95, 0.055, 0.07, 0.14, 0.01)
      b.box('lampWhite', 0, 0.95, -0.055, 0.07, 0.14, 0.01)
    }
    for (const sign of plan.signs) {
      if (!near(sign.x, sign.z, ctx)) continue
      any = true
      frame(sign)
      b.box('metalDark', 0, 0, 0, 0.09, 2.1, 0.09)
      b.box('metalWhite', 0, 1.6, 0.06, 0.62, 0.78, 0.03)
      const uv = this.atlas.cell(`LIMIT ${sign.text}`)
      if (uv) b.placard('boardSign', '+z', 0.08, 0, 1.99, 0.56, uv, false, 1)
    }
    for (const chevron of plan.chevrons) {
      if (!near(chevron.x, chevron.z, ctx)) continue
      any = true
      frame(chevron)
      b.box('metalDark', 0, 0, 0, 0.08, 1.6, 0.08)
      b.box('metalYellow', 0, 1.25, 0.05, 0.6, 0.75, 0.03)
      b.quad('boardDark', [-0.22, 1.35, 0.07], [0.12, 1.62, 0.07], [0.12, 1.82, 0.07], [-0.22, 1.55, 0.07])
      b.quad('boardDark', [-0.22, 1.55, 0.071], [0.12, 1.28, 0.071], [0.12, 1.48, 0.071], [-0.22, 1.75, 0.071])
    }
    for (const home of plan.homes) {
      if (near(home.mailbox.x, home.mailbox.z, ctx)) {
        any = true
        frame(home.mailbox)
        b.box('woodDark', 0, 0, 0, 0.1, 1.05, 0.1)
        b.box('metalDark', 0, 1.05, 0, 0.24, 0.24, 0.48)
      }
      if (!near(home.x, home.z, ctx)) continue
      any = true
      frame(home)
      b.box('gravel', 0, 0, 0, 30, 0.04, 26)
      b.frame(home.x - ctx.x0 + Math.cos(home.yaw) * HOUSE.dx + Math.sin(home.yaw) * HOUSE.dz, terrain.heightAt(home.x, home.z), home.z - ctx.z0 - Math.sin(home.yaw) * HOUSE.dx + Math.cos(home.yaw) * HOUSE.dz, home.yaw)
      farmhouse(b, HOUSE.w, HOUSE.d, paintKey(home.siding))
      b.frame(home.x - ctx.x0 + Math.cos(home.yaw) * BARN.dx + Math.sin(home.yaw) * BARN.dz, terrain.heightAt(home.x, home.z), home.z - ctx.z0 - Math.sin(home.yaw) * BARN.dx + Math.cos(home.yaw) * BARN.dz, home.yaw)
      barn(b, BARN.w, BARN.d)
      frame(home.pickup)
      parkedCar(b, 1, home.pickupColor)
    }
    for (const car of plan.parked) {
      if (!near(car.x, car.z, ctx)) continue
      any = true
      frame(car)
      parkedCar(b, car.style, car.color)
    }
    for (const bale of plan.bales) {
      if (!near(bale.x, bale.z, ctx)) continue
      any = true
      frame(bale)
      b.cylinder('grain', -0.75, 0.75, 0, 0.75, 1.5, 14, 0.75, 'x')
    }
    if (!any) return null
    const meshes = b.build(this.scene, `trucksim-roadside-${ctx.cx}-${ctx.cz}`, ctx.root, (key) => (key === 'boardSign' ? this.atlas.material : this.materials.get(key)))
    for (const mesh of meshes) ctx.addShadowCaster(mesh)
    return new RoadsideChunk(meshes)
  }

  dispose(): void {
    this.atlas.dispose()
    this.materials.dispose()
  }
}
