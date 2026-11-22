/**
 * The sims-style builder over the player's own lot: a top-down orbit camera (middle-drag to turn, right-drag to pan, wheel to
 * zoom, Q/E to spin), a 1 m grid, three tools by definition (drag a rectangle for paving and buildings, click to place an
 * add-on, drag a straight run for fences), R to rotate, colour pickers, demolish, and a translucent green or red ghost that
 * shows whether the shared `validateItem` rule accepts it. Every placement is one `build` action, so the server stays the
 * authority; the lot is redrawn from the saved profile. The Land tab buys the next 30 m strip (`buy-land`), shading it while hovered.
 */
import type { ArcRotateCameraPointersInput } from '@babylonjs/core/Cameras/Inputs/arcRotateCameraPointersInput'
import '@babylonjs/core/Culling/ray'
import { Matrix } from '@babylonjs/core/Maths/math.vector'
import type { Scene } from '@babylonjs/core/scene'
import type { ProgressClient } from '../net/Progress'
import type { LotRenderer } from '../render/Lots'
import { BUILDING_BY_ID, landStripPrice } from '../shared/Catalog'
import type { BuildDef } from '../shared/Catalog'
import { itemCost, itemFootprint, validateItem } from '../shared/Lots'
import type { BuildItem, BuildRotation } from '../shared/Lots'
import { LAND_STRIP_M, LOT_D, MAX_LAND_STRIPS } from '../shared/WorldLayout'
import type { LotSpec } from '../shared/WorldLayout'

import { BuilderBar } from '../ui/BuilderBar'
import type { LandOffer } from '../ui/BuilderBar'
import type { CameraRig } from './Cameras'

export interface BuildModeOptions {
  scene: Scene
  canvas: HTMLCanvasElement
  cameras: CameraRig
  lots: LotRenderer
  progress: ProgressClient
  uiRoot: HTMLElement
  lot: LotSpec
  currentLot?(): LotSpec
  heightAt(x: number, z: number): number
  toast(text: string, kind?: 'info' | 'good' | 'warn' | 'bad'): void
  onExit(): void
}

let serial = 0

function newId(): string {
  serial += 1
  return `b${Date.now().toString(36)}${serial.toString(36)}`
}

export class BuildMode {
  private readonly bar: BuilderBar
  private def: BuildDef | null = null
  private rot: BuildRotation = 0
  private color = '#8d969e'
  private color2: string | undefined
  private demolish = false
  private dragStart: { x: number; z: number } | null = null
  private cursor: { x: number; z: number } | null = null
  private busy = false
  private readonly cleanup: (() => void)[] = []
  private readonly height: number
  private disposed = false

  constructor(private readonly options: BuildModeOptions) {
    const { lot, cameras, canvas } = options
    this.height = options.heightAt(lot.x + lot.w / 2, lot.z + lot.d / 2)
    cameras.setMode('build')
    cameras.focusBuild(lot.x + lot.w / 2, lot.z + lot.d / 2, Math.max(lot.w, lot.d))
    const pointers = cameras.build.inputs.attached.pointers as ArcRotateCameraPointersInput | undefined
    if (pointers) pointers.buttons = [1, 2]
    this.bar = new BuilderBar(options.uiRoot, {
      cash: options.progress.profile.cash,
      onPick: (id) => this.pick(id),
      onRotate: () => this.rotate(),
      onColor: (c1, c2) => {
        this.color = c1
        this.color2 = c2
        this.refresh()
      },
      onDemolish: (on) => {
        this.demolish = on
        this.bar.setDemolish(on)
        if (on) {
          this.def = null
          this.bar.setSelected(null)
        }
        this.bar.setHint(on ? 'Click a building, add-on, fence or paving to remove it (half its cost back)' : 'Pick something to build')
        this.refresh()
      },
      onDone: () => this.exit(),
      land: this.landOffer(),
      onBuyLand: () => void this.buyLand(),
      onPreviewLand: (on) => options.lots.previewLand(on ? this.nextStrip() : null),
    })
    this.bar.setHint('Pick something to build. Middle-drag turns the view, right-drag pans, the wheel zooms.')
    const down = (e: PointerEvent) => {
      if (e.button !== 0) return
      const p = this.groundPoint(e)
      if (!p) return
      if (this.demolish) {
        void this.remove(p)
        return
      }
      if (!this.def) return
      if (this.def.mode === 'place') void this.commit(this.itemAt(p, p))
      else this.dragStart = p
    }
    const move = (e: PointerEvent) => {
      this.cursor = this.groundPoint(e)
      this.refresh()
    }
    const up = (e: PointerEvent) => {
      if (e.button !== 0 || !this.dragStart || !this.def) return
      const end = this.groundPoint(e) ?? this.cursor
      const start = this.dragStart
      this.dragStart = null
      if (end) void this.commit(this.itemAt(start, end))
      this.refresh()
    }
    const key = (e: KeyboardEvent) => {
      if (e.code === 'KeyR') this.rotate()
      else if (e.code === 'KeyQ') cameras.build.alpha += 0.12
      else if (e.code === 'KeyE') cameras.build.alpha -= 0.12
      else if (e.code === 'Escape' || e.code === 'KeyY') this.exit()
    }
    canvas.addEventListener('pointerdown', down)
    canvas.addEventListener('pointermove', move)
    window.addEventListener('pointerup', up)
    window.addEventListener('keydown', key)
    const unsubscribe = options.progress.onChange((profile) => {
      this.bar.setCash(profile.cash)
      this.bar.setLand(this.landOffer())
      this.refresh()
    })
    this.cleanup.push(() => {
      canvas.removeEventListener('pointerdown', down)
      canvas.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', up)
      window.removeEventListener('keydown', key)
      unsubscribe()
    })
  }

  private get lot(): LotSpec {
    return this.options.currentLot?.() ?? this.options.lot
  }

  private landOffer(): LandOffer {
    const strips = this.options.progress.profile.land
    return { strips, max: MAX_LAND_STRIPS, stripM: LAND_STRIP_M, width: this.lot.w, depth: LOT_D, price: strips >= MAX_LAND_STRIPS ? null : landStripPrice(strips) }
  }

  private nextStrip(): { x: number; z: number; w: number; d: number } | null {
    if (this.options.progress.profile.land >= MAX_LAND_STRIPS) return null
    const lot = this.lot
    return { x: lot.side === 'west' ? lot.x - LAND_STRIP_M : lot.x + lot.w, z: lot.z, w: LAND_STRIP_M, d: lot.d }
  }

  private async buyLand(): Promise<void> {
    if (this.busy) return
    this.busy = true
    const result = await this.options.progress.act({ action: 'buy-land' })
    this.busy = false
    this.options.lots.previewLand(null)
    this.options.toast(result.message || (result.ok ? 'Land bought' : 'Could not buy land'), result.ok ? 'good' : 'warn')
    if (result.ok) {
      const lot = this.lot
      this.options.cameras.focusBuild(lot.x + lot.w / 2, lot.z + lot.d / 2, Math.max(lot.w, lot.d))
    }
  }

  private pick(id: string): void {
    const def = BUILDING_BY_ID[id] ?? null
    this.def = def
    this.demolish = false
    this.bar.setDemolish(false)
    this.bar.setSelected(def ? def.id : null)
    if (def) {
      this.color = def.defaultColor
      this.color2 = def.defaultColor2
      this.bar.setHint(def.mode === 'drag' ? `Drag out the ${def.name.toLowerCase()} on your lot` : def.mode === 'line' ? `Drag a straight run of ${def.name.toLowerCase()}` : `Click to place the ${def.name.toLowerCase()} · R rotates`)
    }
    this.refresh()
  }

  private rotate(): void {
    this.rot = ((this.rot + 1) % 4) as BuildRotation
    this.refresh()
  }

  /** Where the pointer meets the lot's level ground, in lot-local metres snapped to the 1 m grid. */
  private groundPoint(e: PointerEvent): { x: number; z: number } | null {
    const { scene, cameras } = this.options
    const lot = this.lot
    const rect = this.options.canvas.getBoundingClientRect()
    const ray = scene.createPickingRay(e.clientX - rect.left, e.clientY - rect.top, Matrix.Identity(), cameras.build, false)
    if (Math.abs(ray.direction.y) < 1e-4) return null
    const t = (this.height - ray.origin.y) / ray.direction.y
    if (t <= 0) return null
    const x = ray.origin.x + ray.direction.x * t - lot.x
    const z = ray.origin.z + ray.direction.z * t - lot.z
    if (x < -10 || z < -10 || x > lot.w + 10 || z > lot.d + 10) return null
    return { x: Math.round(x), z: Math.round(z) }
  }

  private itemAt(start: { x: number; z: number }, end: { x: number; z: number }): BuildItem {
    const def = this.def!
    const base = { id: newId(), def: def.id, rot: this.rot, color: this.color, ...(this.color2 ? { color2: this.color2 } : {}) }
    if (def.mode === 'place') {
      const turned = this.rot % 2 === 1
      const w = turned ? def.d : def.w
      const d = turned ? def.w : def.d
      return { ...base, x: Math.round(end.x - w / 2), z: Math.round(end.z - d / 2), w, d }
    }
    if (def.mode === 'line') {
      const dx = end.x - start.x
      const dz = end.z - start.z
      const alongX = Math.abs(dx) >= Math.abs(dz)
      const rot: BuildRotation = alongX ? (dx >= 0 ? 1 : 3) : dz >= 0 ? 0 : 2
      return { ...base, rot, x: start.x, z: start.z, w: Math.max(1, Math.abs(alongX ? dx : dz)), d: def.d }
    }
    const x = Math.min(start.x, end.x)
    const z = Math.min(start.z, end.z)
    return { ...base, x, z, w: Math.max(1, Math.abs(end.x - start.x)), d: Math.max(1, Math.abs(end.z - start.z)) }
  }

  private refresh(): void {
    if (this.disposed) return
    const { lots, progress } = this.options
    const lot = this.lot
    if (!this.def || this.demolish || !this.cursor) {
      lots.preview(null, null, false)
      return
    }
    const item = this.itemAt(this.dragStart ?? this.cursor, this.cursor)
    const error = validateItem(item, progress.profile.build, { w: lot.w, d: lot.d })
    const cost = itemCost(item)
    const affordable = cost <= progress.profile.cash
    lots.preview(lot, item, !error && affordable)
    this.bar.setHint(error ?? (affordable ? `${this.def.name}: $${cost.toLocaleString()}` : `Not enough cash: $${cost.toLocaleString()}`))
  }

  private async commit(item: BuildItem): Promise<void> {
    if (this.busy) return
    const { progress, toast } = this.options
    const lot = this.lot
    const error = validateItem(item, progress.profile.build, { w: lot.w, d: lot.d })
    if (error) {
      toast(error, 'warn')
      return
    }
    this.busy = true
    const result = await progress.act({ action: 'build', items: [item] })
    this.busy = false
    toast(result.message || (result.ok ? 'Built' : 'Could not build that'), result.ok ? 'good' : 'warn')
    this.refresh()
  }

  private async remove(p: { x: number; z: number }): Promise<void> {
    if (this.busy) return
    const { progress, toast } = this.options
    const build = progress.profile.build
    let target: BuildItem | null = null
    for (let i = build.length - 1; i >= 0; i--) {
      const f = itemFootprint(build[i])
      if (p.x >= f.x - 0.5 && p.x <= f.x + f.w + 0.5 && p.z >= f.z - 0.5 && p.z <= f.z + f.d + 0.5) {
        const def = BUILDING_BY_ID[build[i].def]
        if (!target || (def && def.category !== 'paving')) target = build[i]
        if (def && def.category !== 'paving') break
      }
    }
    if (!target) return
    this.busy = true
    const result = await progress.act({ action: 'demolish', ids: [target.id] })
    this.busy = false
    toast(result.message || (result.ok ? 'Removed' : 'Could not remove that'), result.ok ? 'good' : 'warn')
  }

  private exit(): void {
    if (this.disposed) return
    this.dispose()
    this.options.onExit()
  }

  dispose(): void {
    if (this.disposed) return
    this.disposed = true
    for (const fn of this.cleanup) fn()
    this.options.lots.preview(null, null, false)
    this.options.lots.previewLand(null)
    const pointers = this.options.cameras.build.inputs.attached.pointers as ArcRotateCameraPointersInput | undefined
    if (pointers) pointers.buttons = [0, 1, 2]
    this.bar.dispose()
    this.options.cameras.setMode('chase')
  }
}
