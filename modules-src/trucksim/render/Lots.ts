/**
 * The lot builder's renderer. `setLot` rebuilds one Haulers Row lot from its build items: paving slabs, steel shops with
 * roll-up doors, pole barns, offices, every add-on and fences, merged into one mesh per material, plus the sign at the gate
 * (the owner's company name on a `DynamicTexture`, or "LOT FOR LEASE" while unowned). `preview` draws one translucent ghost
 * (green when the piece can be built, red when not) and reuses its mesh while the piece's kind and size stay the same.
 * Everything hangs under the `parent` node; every lot has its own scope, so `clear` and `dispose` return all resources.
 * `staticBoxes` lists the solid buildings and fences for the physics world, in world coordinates. Survey stakes with orange caps
 * mark the lot's edge (the grown extent, when land was bought), and `previewLand` shades the next strip of land for sale.
 */

import type { Scene } from '@babylonjs/core/scene'
import type { Mesh } from '@babylonjs/core/Meshes/mesh'
import { TransformNode } from '@babylonjs/core/Meshes/transformNode'
import { PBRMaterial } from '@babylonjs/core/Materials/PBR/pbrMaterial'
import { Color3 } from '@babylonjs/core/Maths/math.color'
import type { Terrain } from '../shared/Terrain'
import type { LotSpec } from '../shared/WorldLayout'
import { itemFootprint } from '../shared/Lots'
import type { BuildItem } from '../shared/Lots'
import { BUILDING_BY_ID } from '../shared/Catalog'
import type { BuildDef } from '../shared/Catalog'
import type { StaticBox } from '../sim/SimWorld'
import { Scope } from '../systems/Scope'
import type { MaterialLibrary } from './Materials'
import type { Footprint, SeeThrough } from './SeeThrough'
import { SceneryBatch } from './lots/Batch'
import { SceneryMaterials } from './lots/Palette'
import { SignAtlas } from './lots/Signs'
import { drawFence, drawItem, drawPaving, matteKey } from './lots/Items'
import type { LocalBox } from './lots/Items'

/** Who a lot belongs to, as the sign shows it. */
export interface LotOwner {
  name: string
  company: string
}

/** Lot pieces with a roof the truck drives under; they fade while it is beneath (see `SeeThrough`). */
const OVERHEAD_ITEMS = new Set(['fuel-island', 'wash-bay'])

interface LotState {
  scope: Scope
  root: TransformNode
  meshes: Mesh[]
  boxes: StaticBox[]
}

interface Ghost {
  key: string
  root: TransformNode
  mesh: Mesh | null
}

const QUARTER = Math.PI / 2
const LEASE_TEXT = 'Lot for lease'
const GATE_SIGN_OFFSET = 11
const STAKE_SPACING = 15
const GATE_GAP = 9

function dims(item: BuildItem): { wl: number; dl: number; cx: number; cz: number } {
  const odd = item.rot % 2 === 1
  return { wl: odd ? item.d : item.w, dl: odd ? item.w : item.d, cx: item.x + item.w / 2, cz: item.z + item.d / 2 }
}

function worldBox(local: LocalBox, rot: number, cx: number, cz: number, originX: number, originZ: number, ground: number): StaticBox {
  let x = local.x
  let z = local.z
  if (rot === 1) {
    x = local.z
    z = -local.x
  } else if (rot === 2) {
    x = -local.x
    z = -local.z
  } else if (rot === 3) {
    x = -local.z
    z = local.x
  }
  const odd = rot % 2 === 1
  return { x: originX + cx + x, y: ground + local.y, z: originZ + cz + z, hx: odd ? local.hz : local.hx, hy: local.hy, hz: odd ? local.hx : local.hz }
}

/** Draws and manages every player lot on Haulers Row. */
export class LotRenderer {
  private readonly lots = new Map<number, LotState>()
  private readonly scenery: SceneryMaterials
  private ghost: Ghost | null = null
  private ghostGood: PBRMaterial | null = null
  private ghostBad: PBRMaterial | null = null
  private landGhost: Mesh | null = null
  private disposed = false

  constructor(
    private readonly scene: Scene,
    private readonly parent: TransformNode,
    mats: MaterialLibrary,
    private readonly terrain: Terrain,
    private readonly seeThrough: SeeThrough | null = null,
  ) {
    this.scenery = new SceneryMaterials(scene, mats)
    this.scenery.warm()
  }

  /** Rebuilds one lot: removes what it had and draws `items`, with the gate sign for `owner` (null shows the lease sign). */
  setLot(lot: LotSpec, owner: LotOwner | null, items: readonly BuildItem[]): void {
    if (this.disposed) return
    this.clear(lot.index)
    const scope = new Scope(`lot-${lot.index}`)
    const root = new TransformNode(`lot-${lot.index}`, this.scene)
    root.parent = this.parent
    scope.track(root)
    const text = owner && owner.company.trim().length > 0 ? owner.company.trim() : owner ? owner.name : LEASE_TEXT
    const atlas = scope.track(new SignAtlas(this.scene, `lot-${lot.index}`, { cellWidth: 512, cellHeight: 128, columns: 1, rows: 1 }))
    const uv = atlas.cell(text)
    const ground = this.terrain.heightAt(lot.x + lot.w / 2, lot.z + lot.d / 2)
    const batch = new SceneryBatch()
    const boxes: StaticBox[] = []
    const overheads: { batch: SceneryBatch; rect: Footprint }[] = []
    let seq = 0
    for (const item of items) {
      const def = BUILDING_BY_ID[item.def]
      if (def?.category !== 'paving') continue
      batch.frame(lot.x, ground, lot.z, 0)
      drawPaving(batch, def, item, seq++)
    }
    for (const item of items) {
      const def = BUILDING_BY_ID[item.def]
      if (!def || def.category === 'paving') continue
      if (def.mode === 'line') {
        batch.frame(lot.x + item.x, ground, lot.z + item.z, item.rot * QUARTER)
        const local = drawFence(batch, def, item.w, item.d, matteKey(item.color))
        for (const box of local) boxes.push(worldBox(box, item.rot, 0, 0, lot.x + item.x, lot.z + item.z, ground))
        continue
      }
      const { wl, dl, cx, cz } = dims(item)
      const target = OVERHEAD_ITEMS.has(def.id) && this.seeThrough ? new SceneryBatch() : batch
      if (target !== batch) {
        const f = itemFootprint(item)
        overheads.push({ batch: target, rect: { x0: lot.x + f.x, z0: lot.z + f.z, x1: lot.x + f.x + f.w, z1: lot.z + f.z + f.d } })
      }
      target.frame(lot.x + cx, ground, lot.z + cz, item.rot * QUARTER)
      const local = drawItem(target, def, item, wl, dl, uv)
      if (def.solid) for (const box of local) boxes.push(worldBox(box, item.rot, 0, 0, lot.x + cx, lot.z + cz, ground))
    }
    this.drawStakes(batch, lot, ground)
    this.drawGateSign(batch, lot, ground, uv)
    const material = (key: string) => (key === 'boardSign' ? atlas.material : this.scenery.get(key))
    const meshes = batch.build(this.scene, `lot-${lot.index}`, root, material)
    overheads.forEach(({ batch: own, rect }, i) => {
      const built = own.build(this.scene, `lot-${lot.index}-overhead-${i}`, root, material)
      meshes.push(...built)
      if (this.seeThrough) scope.defer(this.seeThrough.add(rect, built))
    })
    for (const mesh of meshes) scope.defer(() => mesh.dispose(false, false))
    this.lots.set(lot.index, { scope, root, meshes, boxes })
  }

  private drawStakes(batch: SceneryBatch, lot: LotSpec, ground: number): void {
    batch.frame(lot.x, ground, lot.z, 0)
    const stake = (x: number, z: number, corner: boolean): void => {
      const high = corner ? 1.3 : 0.8
      const size = corner ? 0.16 : 0.08
      batch.box('woodDark', x, 0, z, size, high, size)
      batch.box('safetyOrange', x, high, z, size * 1.3, corner ? 0.22 : 0.14, size * 1.3)
    }
    const gateX = lot.gate.x - lot.x
    const gateZ = lot.gate.z - lot.z
    const edges: [number, number, number, number][] = [[0, 0, lot.w, 0], [lot.w, 0, lot.w, lot.d], [lot.w, lot.d, 0, lot.d], [0, lot.d, 0, 0]]
    for (const [x0, z0, x1, z1] of edges) {
      const length = Math.hypot(x1 - x0, z1 - z0)
      const count = Math.max(1, Math.round(length / STAKE_SPACING))
      for (let i = 0; i < count; i++) {
        const t = i / count
        const x = x0 + (x1 - x0) * t
        const z = z0 + (z1 - z0) * t
        if (i > 0 && Math.abs(x - gateX) < 0.5 && Math.abs(z - gateZ) < GATE_GAP) continue
        stake(x, z, i === 0)
      }
    }
  }

  /** Shades the strip of land `strip` (world rectangle) as for sale, or hides the shading when null. */
  previewLand(strip: { x: number; z: number; w: number; d: number } | null): void {
    if (this.disposed) return
    if (!strip) {
      this.landGhost?.setEnabled(false)
      return
    }
    this.ensureGhostMaterials()
    if (!this.landGhost) {
      const batch = new SceneryBatch()
      batch.frame(0, 0, 0, 0)
      batch.box('ghost', 0, 0, 0, 1, 1, 1)
      this.landGhost = batch.buildSingle(this.scene, 'lot-land-ghost', this.parent, this.ghostGood as PBRMaterial)
    }
    const mesh = this.landGhost
    if (!mesh) return
    const ground = this.terrain.heightAt(strip.x + strip.w / 2, strip.z + strip.d / 2)
    mesh.position.set(strip.x + strip.w / 2, ground - 0.2, strip.z + strip.d / 2)
    mesh.scaling.set(strip.w, 0.5, strip.d)
    mesh.setEnabled(true)
  }

  private drawGateSign(batch: SceneryBatch, lot: LotSpec, ground: number, uv: { u0: number; u1: number; v0: number; v1: number } | null): void {
    const inward = lot.side === 'west' ? -1 : 1
    batch.frame(lot.gate.x + inward * 2.4, ground, lot.gate.z + GATE_SIGN_OFFSET, 0)
    for (const z of [-2.6, 2.6]) batch.box('metalDark', 0, 0, z, 0.25, 3.4, 0.25)
    batch.box('boardDark', 0, 1.7, 0, 0.25, 1.7, 6.2)
    batch.box('metalDark', 0, 3.4, 0, 0.32, 0.12, 6.3)
    if (uv) {
      batch.face('boardSign', '+x', 0.14, -3.0, 3.0, 1.8, 3.3, uv)
      batch.face('boardSign', '-x', -0.14, -3.0, 3.0, 1.8, 3.3, uv)
    }
  }

  /** Removes one lot's meshes, materials and textures. */
  clear(index: number): void {
    const state = this.lots.get(index)
    if (!state) return
    this.lots.delete(index)
    state.scope.dispose()
  }

  /** Collision boxes of a lot's solid buildings and fences (world coordinates). */
  staticBoxes(index: number): readonly StaticBox[] {
    return this.lots.get(index)?.boxes ?? []
  }

  /** The meshes of a lot (for shadow casters). */
  meshes(index: number): readonly Mesh[] {
    return this.lots.get(index)?.meshes ?? []
  }

  /** The ghost's mesh, or null when none is built (for reuse checks). */
  get previewMesh(): Mesh | null {
    return this.ghost?.mesh ?? null
  }

  /** Shows one translucent piece at its place on a lot, or hides the ghost when `lot` or `item` is null. */
  preview(lot: LotSpec | null, item: BuildItem | null, valid: boolean): void {
    if (this.disposed) return
    const def = item ? BUILDING_BY_ID[item.def] : undefined
    if (!lot || !item || !def) {
      this.ghost?.root.setEnabled(false)
      return
    }
    this.ensureGhostMaterials()
    const line = def.mode === 'line'
    const { wl, dl, cx, cz } = dims(item)
    const key = line ? `${def.id}|${item.w}|${item.d}` : `${def.id}|${wl}|${dl}`
    const ground = this.terrain.heightAt(lot.x + lot.w / 2, lot.z + lot.d / 2)
    if (!this.ghost) {
      const root = new TransformNode('lot-ghost', this.scene)
      root.parent = this.parent
      this.ghost = { key: '', root, mesh: null }
    }
    const ghost = this.ghost
    if (ghost.key !== key || !ghost.mesh) {
      ghost.mesh?.dispose(false, false)
      ghost.mesh = this.buildGhost(ghost.root, def, item, wl, dl)
      ghost.key = key
    }
    ghost.root.setEnabled(true)
    if (line) ghost.root.position.set(lot.x + item.x, ground, lot.z + item.z)
    else ghost.root.position.set(lot.x + cx, ground, lot.z + cz)
    ghost.root.rotation.y = item.rot * QUARTER
    if (ghost.mesh) ghost.mesh.material = valid ? this.ghostGood : this.ghostBad
  }

  private buildGhost(root: TransformNode, def: BuildDef, item: BuildItem, wl: number, dl: number): Mesh | null {
    const batch = new SceneryBatch()
    batch.frame(0, 0, 0, 0)
    if (def.category === 'paving') drawPaving(batch, def, { ...item, x: -item.w / 2, z: -item.d / 2 }, 0)
    else if (def.mode === 'line') drawFence(batch, def, item.w, item.d, 'ghost')
    else drawItem(batch, def, item, wl, dl, null)
    return batch.buildSingle(this.scene, 'lot-ghost', root, this.ghostGood as PBRMaterial)
  }

  private ensureGhostMaterials(): void {
    if (this.ghostGood && this.ghostBad) return
    this.ghostGood = this.ghostMaterial('lot-ghost-valid', new Color3(0.2, 0.85, 0.3))
    this.ghostBad = this.ghostMaterial('lot-ghost-invalid', new Color3(0.9, 0.18, 0.15))
  }

  private ghostMaterial(name: string, color: Color3): PBRMaterial {
    const material = new PBRMaterial(name, this.scene)
    material.albedoColor = color.toLinearSpace()
    material.emissiveColor = color.scale(0.3).toLinearSpace()
    material.metallic = 0
    material.roughness = 0.95
    material.metallicF0Factor = 0
    material.alpha = 0.45
    material.backFaceCulling = false
    return material
  }

  /** Disposes every lot, the ghost and the shared scenery materials. */
  dispose(): void {
    if (this.disposed) return
    this.disposed = true
    for (const index of [...this.lots.keys()]) this.clear(index)
    if (this.ghost) {
      this.ghost.mesh?.dispose(false, false)
      this.ghost.root.dispose()
      this.ghost = null
    }
    this.landGhost?.dispose(false, false)
    this.landGhost = null
    this.ghostGood?.dispose(false, false)
    this.ghostBad?.dispose(false, false)
    this.ghostGood = null
    this.ghostBad = null
    this.scenery.dispose()
  }
}
