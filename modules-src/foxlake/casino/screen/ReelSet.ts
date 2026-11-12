/**
 * The reels of one machine's video screen, in Babylon, driven by outcomes from
 * the math layer (`casino/math/`). Each reel is a plane showing a window of
 * its strip texture (every symbol on the strip drawn once, top to bottom); the
 * reel turns by moving the texture's vOffset, which an AnimationGroup drives:
 * a short wind-up, full-speed spin on a motion-blurred copy of the strip, and
 * a stop on the exact stop index with a little overshoot and settle, reel by
 * reel. Reels that could still complete a bonus get an anticipation stop
 * (longer, slower, with a glow). Wins pulse a frame around every cell that
 * took part. The overlay plane draws feature boards (locked coins, values,
 * upgraded symbols) over the reels.
 *
 * The node passed in is the screen centre; the reels face the viewer on its
 * local -z side (a Babylon plane's front), +x to the viewer's right.
 */
import { Animation } from '@babylonjs/core/Animations/animation'
import { AnimationGroup } from '@babylonjs/core/Animations/animationGroup'
import { AnimationEvent } from '@babylonjs/core/Animations/animationEvent'
import { BackEase, EasingFunction, SineEase } from '@babylonjs/core/Animations/easing'
import '@babylonjs/core/Animations/animatable'
import { StandardMaterial } from '@babylonjs/core/Materials/standardMaterial'
import { DynamicTexture } from '@babylonjs/core/Materials/Textures/dynamicTexture'
import { Texture } from '@babylonjs/core/Materials/Textures/texture'
import { Color3 } from '@babylonjs/core/Maths/math.color'
import { CreatePlane } from '@babylonjs/core/Meshes/Builders/planeBuilder'
import type { Mesh } from '@babylonjs/core/Meshes/mesh'
import { TransformNode } from '@babylonjs/core/Meshes/transformNode'
import type { Scene } from '@babylonjs/core/scene'
import { drawSymbol, roundRect, type SymbolStyle } from './SymbolArt'

const FPS = 60
const MAX_TEX = 8192

export interface ReelSetOptions {
  rows: number
  strips: readonly (readonly string[])[]
  styles: Readonly<Record<string, SymbolStyle>>
  /** Size of the reel window in metres. */
  width: number
  height: number
  /** Gap between reels as a share of a reel's width. */
  gap?: number
  /** Colours behind the symbols (top, bottom). */
  reelBack: [string, string]
}

interface Reel {
  mesh: Mesh
  mat: StandardMaterial
  sharp: DynamicTexture
  blur: DynamicTexture
  len: number
  /** Top symbol index the reel shows now. */
  stop: number
}

export class ReelSet {
  readonly node: TransformNode
  private readonly reels: Reel[] = []
  private readonly frames: { mesh: Mesh; mat: StandardMaterial }[] = []
  private readonly frameTex: DynamicTexture
  private readonly overlay: { mesh: Mesh; mat: StandardMaterial; tex: DynamicTexture }
  private readonly cellW: number
  private readonly cellH: number
  private group: AnimationGroup | null = null
  private pulse: AnimationGroup | null = null

  constructor(private readonly scene: Scene, parent: TransformNode, private readonly o: ReelSetOptions) {
    this.node = new TransformNode('reels', scene)
    this.node.parent = parent
    const n = o.strips.length
    const gap = o.gap ?? 0.04
    const reelW = o.width / (n + gap * (n - 1))
    this.cellW = reelW
    this.cellH = o.height / o.rows
    o.strips.forEach((strip, i) => {
      const px = Math.max(64, Math.min(192, Math.floor(MAX_TEX / strip.length)))
      const sharp = this.stripTexture(`reel-${i}`, strip, px, false)
      const blur = this.stripTexture(`reel-${i}-blur`, strip, px, true)
      const mat = new StandardMaterial(`reel-${i}-mat`, scene)
      mat.disableLighting = true
      mat.emissiveTexture = sharp
      mat.diffuseColor = Color3.Black()
      mat.specularColor = Color3.Black()
      const mesh = CreatePlane(`reel-${i}`, { width: reelW, height: o.height }, scene)
      mesh.parent = this.node
      mesh.position.x = -o.width / 2 + reelW / 2 + i * reelW * (1 + gap)
      mesh.material = mat
      mesh.isPickable = false
      for (const t of [sharp, blur]) {
        t.vScale = o.rows / strip.length
        t.wrapV = Texture.WRAP_ADDRESSMODE
      }
      const reel: Reel = { mesh, mat, sharp, blur, len: strip.length, stop: 0 }
      this.reels.push(reel)
      this.place(reel, 0)
    })
    this.frameTex = this.drawFrame()
    for (let r = 0; r < n; r++) {
      for (let row = 0; row < o.rows; row++) {
        const mat = new StandardMaterial(`win-frame-${r}-${row}`, scene)
        mat.disableLighting = true
        mat.emissiveTexture = this.frameTex
        mat.opacityTexture = this.frameTex
        mat.alpha = 0
        const mesh = CreatePlane(`win-frame-${r}-${row}`, { width: reelW * 1.04, height: this.cellH * 1.04 }, scene)
        mesh.parent = this.node
        mesh.position.set(this.reels[r].mesh.position.x, o.height / 2 - this.cellH * (row + 0.5), -0.004)
        mesh.material = mat
        mesh.isPickable = false
        this.frames.push({ mesh, mat })
      }
    }
    const tex = new DynamicTexture('reel-overlay', { width: 1024, height: Math.round((1024 * o.height) / o.width) }, scene, true)
    tex.hasAlpha = true
    const mat = new StandardMaterial('reel-overlay-mat', scene)
    mat.disableLighting = true
    mat.emissiveTexture = tex
    mat.opacityTexture = tex
    mat.useAlphaFromDiffuseTexture = false
    const mesh = CreatePlane('reel-overlay', { width: o.width, height: o.height }, scene)
    mesh.parent = this.node
    mesh.position.z = -0.002
    mesh.material = mat
    mesh.isPickable = false
    mesh.setEnabled(false)
    this.overlay = { mesh, mat, tex }
  }

  get reelCount(): number {
    return this.reels.length
  }

  /** The cell size in overlay pixels and the overlay's drawing context, for feature boards. */
  overlayContext(): { g: CanvasRenderingContext2D; w: number; h: number; cellW: number; cellH: number; cellX: (reel: number) => number } {
    const size = this.overlay.tex.getSize()
    const g = this.overlay.tex.getContext() as CanvasRenderingContext2D
    const k = size.width / this.o.width
    return { g, w: size.width, h: size.height, cellW: this.cellW * k, cellH: this.cellH * k, cellX: (r) => (this.reels[r].mesh.position.x + this.o.width / 2 - this.cellW / 2) * k }
  }

  /** Shows the overlay after drawing on it (or hides it). */
  showOverlay(on: boolean): void {
    if (on) this.overlay.tex.update(true)
    this.overlay.mesh.setEnabled(on)
  }

  /** Hides the turning reels (a hold-and-spin board covers them). */
  showReels(on: boolean): void {
    for (const r of this.reels) r.mesh.setEnabled(on)
  }

  private stripTexture(name: string, strip: readonly string[], px: number, blurred: boolean): DynamicTexture {
    const tex = new DynamicTexture(name, { width: px, height: px * strip.length }, this.scene, true)
    const g = tex.getContext() as CanvasRenderingContext2D
    const H = px * strip.length
    const back = g.createLinearGradient(0, 0, px, 0)
    back.addColorStop(0, this.o.reelBack[1])
    back.addColorStop(0.5, this.o.reelBack[0])
    back.addColorStop(1, this.o.reelBack[1])
    g.fillStyle = back
    g.fillRect(0, 0, px, H)
    const art = document.createElement('canvas')
    art.width = px
    art.height = H
    const a = art.getContext('2d')!
    strip.forEach((sym, i) => {
      const style = this.o.styles[sym]
      if (style) drawSymbol(a, style, 0, i * px, px, px)
    })
    if (blurred) {
      g.globalAlpha = 0.22
      for (let k = -4; k <= 4; k++) g.drawImage(art, 0, k * px * 0.09)
      g.globalAlpha = 1
    } else g.drawImage(art, 0, 0)
    tex.update(true)
    return tex
  }

  private drawFrame(): DynamicTexture {
    const S = 256
    const tex = new DynamicTexture('win-frame', { width: S, height: S }, this.scene, true)
    tex.hasAlpha = true
    const g = tex.getContext() as CanvasRenderingContext2D
    g.clearRect(0, 0, S, S)
    for (const [w, a] of [[22, 0.18], [14, 0.4], [7, 1]] as const) {
      roundRect(g, 10, 10, S - 20, S - 20, 26)
      g.lineWidth = w
      g.strokeStyle = `rgba(255,214,96,${a})`
      g.stroke()
    }
    roundRect(g, 10, 10, S - 20, S - 20, 26)
    g.lineWidth = 3
    g.strokeStyle = '#fffbe0'
    g.stroke()
    tex.update(true)
    return tex
  }

  private vOffsetFor(reel: Reel, p: number): number {
    return 1 - (p + this.o.rows) / reel.len
  }

  private place(reel: Reel, stop: number): void {
    reel.stop = ((stop % reel.len) + reel.len) % reel.len
    reel.sharp.vOffset = this.vOffsetFor(reel, reel.stop)
    reel.blur.vOffset = reel.sharp.vOffset
  }

  /** Puts every reel on these stops at once (a reload, a returning player). */
  setStops(stops: readonly number[]): void {
    stops.forEach((s, i) => this.place(this.reels[i], s))
  }

  /**
   * Spins to `stops`. `anticipation[i]` stretches reel i's stop (a bonus is one
   * symbol away). `turbo` shortens everything. Resolves when the last reel settles.
   */
  spin(stops: readonly number[], anticipation: readonly boolean[] = [], turbo = false): Promise<void> {
    this.stopPulse()
    this.group?.dispose()
    const group = new AnimationGroup('reel-spin', this.scene)
    const ease = new SineEase()
    ease.setEasingMode(EasingFunction.EASINGMODE_EASEIN)
    let extra = 0
    this.reels.forEach((reel, i) => {
      if (anticipation[i]) extra += turbo ? 0.6 : 1.4
      const seconds = (turbo ? 0.45 : 0.85) + i * (turbo ? 0.1 : 0.22) + extra
      const speed = (turbo ? 26 : 20) * (anticipation[i] ? 0.55 : 1)
      const target = stops[i]
      const startP = reel.stop
      let laps = Math.max(1, Math.floor((seconds * speed) / reel.len))
      let endP = target - laps * reel.len
      while (startP - endP < seconds * speed * 0.7) {
        laps++
        endP = target - laps * reel.len
      }
      const frames = Math.round(seconds * FPS)
      const v0 = this.vOffsetFor(reel, startP)
      const vWind = this.vOffsetFor(reel, startP + 0.18)
      const vEnd = this.vOffsetFor(reel, endP)
      const vOver = this.vOffsetFor(reel, endP - 0.22)
      const anim = new Animation(`reel-${i}-v`, 'vOffset', FPS, Animation.ANIMATIONTYPE_FLOAT, Animation.ANIMATIONLOOPMODE_CONSTANT)
      const windF = Math.round(0.12 * FPS)
      anim.setKeys([
        { frame: 0, value: v0 },
        { frame: windF, value: vWind },
        { frame: frames - Math.round(0.14 * FPS), value: vOver },
        { frame: frames, value: vEnd },
      ])
      const settle = new BackEase(0.6)
      settle.setEasingMode(EasingFunction.EASINGMODE_EASEOUT)
      const blurOn = new AnimationEvent(windF + 2, () => { reel.mat.emissiveTexture = reel.blur; if (anticipation[i]) reel.mat.emissiveColor = new Color3(0.25, 0.18, 0) }, true)
      const blurOff = new AnimationEvent(frames - Math.round(0.16 * FPS), () => { reel.mat.emissiveTexture = reel.sharp; reel.mat.emissiveColor = Color3.Black() }, true)
      anim.addEvent(blurOn)
      anim.addEvent(blurOff)
      const mirror = anim.clone()
      group.addTargetedAnimation(anim, reel.sharp)
      group.addTargetedAnimation(mirror, reel.blur)
      reel.stop = ((target % reel.len) + reel.len) % reel.len
    })
    this.group = group
    return new Promise((resolve) => {
      group.onAnimationGroupEndObservable.addOnce(() => {
        this.reels.forEach((r) => {
          r.mat.emissiveTexture = r.sharp
          r.mat.emissiveColor = Color3.Black()
          this.place(r, r.stop)
        })
        resolve()
      })
      group.play(false)
    })
  }

  /** Pulses a glowing frame around these cells (a win), for `seconds`. */
  highlight(cells: readonly [number, number][], seconds = 1.6): Promise<void> {
    this.stopPulse()
    if (!cells.length) return Promise.resolve()
    const group = new AnimationGroup('win-pulse', this.scene)
    const frames = Math.round(0.5 * FPS)
    for (const [r, row] of cells) {
      const f = this.frames[r * this.o.rows + row]
      if (!f) continue
      const a = new Animation('pulse-a', 'alpha', FPS, Animation.ANIMATIONTYPE_FLOAT, Animation.ANIMATIONLOOPMODE_CYCLE)
      a.setKeys([{ frame: 0, value: 0.35 }, { frame: frames / 2, value: 1 }, { frame: frames, value: 0.35 }])
      const s = new Animation('pulse-s', 'scaling', FPS, Animation.ANIMATIONTYPE_VECTOR3, Animation.ANIMATIONLOOPMODE_CYCLE)
      s.setKeys([{ frame: 0, value: f.mesh.scaling.clone().setAll(1) }, { frame: frames / 2, value: f.mesh.scaling.clone().setAll(1.07) }, { frame: frames, value: f.mesh.scaling.clone().setAll(1) }])
      group.addTargetedAnimation(a, f.mat)
      group.addTargetedAnimation(s, f.mesh)
    }
    this.pulse = group
    group.play(true)
    return new Promise((resolve) => setTimeout(resolve, seconds * 1000))
  }

  stopPulse(): void {
    this.pulse?.stop()
    this.pulse?.dispose()
    this.pulse = null
    for (const f of this.frames) {
      f.mat.alpha = 0
      f.mesh.scaling.setAll(1)
    }
  }

  dispose(): void {
    this.group?.dispose()
    this.stopPulse()
    for (const r of this.reels) {
      r.sharp.dispose()
      r.blur.dispose()
      r.mat.dispose()
      r.mesh.dispose()
    }
    for (const f of this.frames) {
      f.mat.dispose()
      f.mesh.dispose()
    }
    this.frameTex.dispose()
    this.overlay.tex.dispose()
    this.overlay.mat.dispose()
    this.overlay.mesh.dispose()
    this.node.dispose()
  }
}
