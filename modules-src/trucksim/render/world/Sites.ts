/**
 * The site scenery layer. For every site whose rectangle meets a chunk it draws that chunk's share of the site's original
 * buildings (dealership showroom, travel center and fuel canopies, quarry walls and crusher, construction fencing and frames,
 * refinery tanks and columns, farms, the co-op elevator, dock warehouses, steel mill halls, lumber and supply yards, and the
 * town of Millbrook), merged into one mesh per material per chunk and parented under the chunk's node. A building belongs to
 * the chunk its centre is in. Signs share one `DynamicTexture` atlas for the whole layer. `siteStaticBoxes` lists the solid
 * buildings of a site for the physics world, and `DEALER_DISPLAY_SPOTS` are the display pads' truck positions.
 */

import type { Scene } from '@babylonjs/core/scene'
import type { Mesh } from '@babylonjs/core/Meshes/mesh'
import type { Terrain } from '../../shared/Terrain'
import { getTerrain } from '../../shared/Terrain'
import { SITES } from '../../shared/WorldLayout'
import type { Site } from '../../shared/WorldLayout'
import type { StaticBox } from '../../sim/SimWorld'
import type { MaterialLibrary } from '../Materials'
import type { SeeThrough } from '../SeeThrough'
import { SceneryBatch } from '../lots/Batch'
import { SceneryMaterials } from '../lots/Palette'
import { SignAtlas } from '../lots/Signs'
import { DEALER_DISPLAY_SPOTS, layoutSite } from './sites/Layouts'
import { SitePlanner } from './sites/Plan'
import type { DrawEnv, Piece } from './sites/Plan'
import type { ChunkContext, ChunkLayer, ChunkPart } from './WorldRenderer'

export { DEALER_DISPLAY_SPOTS }

const QUARTER = Math.PI / 2
const NO_SHADOW = new Set(['glass', 'glassTint', 'chain', 'boardSign'])

const planCache = new Map<string, SitePlanner>()

/** The planned buildings of one site (computed once, pure data; the same plan feeds drawing, physics and tests). */
export function planSite(site: Site, terrain: Terrain = getTerrain()): SitePlanner {
  let plan = planCache.get(site.id)
  if (!plan) {
    plan = new SitePlanner(site, terrain)
    layoutSite(plan)
    planCache.set(site.id, plan)
  }
  return plan
}

/** Collision boxes of a site's solid buildings in world coordinates; an unknown id gives none. */
export function siteStaticBoxes(siteId: string): StaticBox[] {
  const site = SITES.find((s) => s.id === siteId)
  if (!site) return []
  return planSite(site).pieces.flatMap((piece) => piece.boxes)
}

class SiteChunk implements ChunkPart {
  private disposed = false

  constructor(private readonly meshes: Mesh[], private readonly unregister: (() => void)[] = []) {}

  dispose(): void {
    if (this.disposed) return
    this.disposed = true
    for (const fn of this.unregister) fn()
    this.unregister.length = 0
    for (const mesh of this.meshes) mesh.dispose(false, false)
    this.meshes.length = 0
  }
}

/** The layer that draws site and town buildings. */
export class SiteLayer implements ChunkLayer {
  readonly name = 'sites'
  private readonly materials: SceneryMaterials
  private readonly atlas: SignAtlas
  private readonly env: DrawEnv
  private disposed = false

  constructor(private readonly scene: Scene, mats: MaterialLibrary, private readonly terrain: Terrain, private readonly seeThrough: SeeThrough | null = null) {
    this.materials = new SceneryMaterials(scene, mats)
    this.materials.warm()
    this.atlas = new SignAtlas(scene, 'trucksim-sites', { cellWidth: 256, cellHeight: 64, columns: 4, rows: 16 })
    this.env = { sign: (text) => this.atlas.cell(text) }
  }

  /** The pieces of a site placed in a chunk's square. */
  private piecesIn(site: Site, x0: number, z0: number, size: number): Piece[] {
    return planSite(site, this.terrain).pieces.filter((piece) => piece.x >= x0 && piece.x < x0 + size && piece.z >= z0 && piece.z < z0 + size)
  }

  build(_chunkX: number, _chunkZ: number, ctx: ChunkContext): ChunkPart | null {
    if (this.disposed) return null
    const { x0, z0, size } = ctx
    const batch = new SceneryBatch()
    const overheads: { piece: Piece; batch: SceneryBatch }[] = []
    let any = false
    for (const site of SITES) {
      if (site.kind === 'lotDistrict') continue
      if (site.x + site.w / 2 < x0 || site.x - site.w / 2 > x0 + size || site.z + site.d / 2 < z0 || site.z - site.d / 2 > z0 + size) continue
      for (const piece of this.piecesIn(site, x0, z0, size)) {
        const target = piece.overhead && this.seeThrough ? new SceneryBatch() : batch
        if (target !== batch) overheads.push({ piece, batch: target })
        target.frame(piece.x - x0, piece.ground, piece.z - z0, piece.rot * QUARTER)
        piece.build(target, this.env)
        any = true
      }
    }
    if (!any) return null
    const material = (key: string) => (key === 'boardSign' ? this.atlas.material : this.materials.get(key))
    const meshes = batch.build(this.scene, `trucksim-sites-${ctx.cx}-${ctx.cz}`, ctx.root, material)
    const unregister: (() => void)[] = []
    overheads.forEach(({ piece, batch: own }, i) => {
      const built = own.build(this.scene, `trucksim-overhead-${ctx.cx}-${ctx.cz}-${i}`, ctx.root, material)
      meshes.push(...built)
      if (this.seeThrough) unregister.push(this.seeThrough.add(piece.extent, built))
    })
    for (const mesh of meshes) {
      const key = mesh.name.slice(mesh.name.lastIndexOf('-') + 1)
      if (!NO_SHADOW.has(key)) ctx.addShadowCaster(mesh)
    }
    return new SiteChunk(meshes, unregister)
  }

  /** Frees the sign atlas and the layer's materials. Chunk parts are disposed by the renderer. */
  dispose(): void {
    if (this.disposed) return
    this.disposed = true
    this.atlas.dispose()
    this.materials.dispose()
  }
}

/** Creates the site layer for the world renderer's layer list. */
export function createSiteLayer(scene: Scene, mats: MaterialLibrary, terrain: Terrain, seeThrough: SeeThrough | null = null): SiteLayer {
  return new SiteLayer(scene, mats, terrain, seeThrough)
}
