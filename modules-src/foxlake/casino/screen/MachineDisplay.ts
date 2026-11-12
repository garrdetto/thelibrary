/**
 * One cabinet's video displays in scene space (so lettering reads the right
 * way round): the portrait main screen and the topper, both self-lit
 * DynamicTextures, plus coloured LED strips up the cabinet's front edges.
 * Idle, the screen runs an attract page; while someone plays, `drawPlay`
 * paints the header (title, meters), the reel window's gold frame and the
 * CREDIT / BET / WIN bar, and the reels (`ReelSet`) sit in front of it.
 */
import { StandardMaterial } from '@babylonjs/core/Materials/standardMaterial'
import { DynamicTexture } from '@babylonjs/core/Materials/Textures/dynamicTexture'
import { Color3 } from '@babylonjs/core/Maths/math.color'
import { CreatePlane } from '@babylonjs/core/Meshes/Builders/planeBuilder'
import type { Mesh } from '@babylonjs/core/Meshes/mesh'
import { TransformNode } from '@babylonjs/core/Meshes/transformNode'
import type { Scene } from '@babylonjs/core/scene'
import { CABINET } from '../CabinetModel'
import type { MachineSpot } from '../CasinoLayout'
import { CASINO } from '../CasinoLayout'
import type { MachineDef, Jackpot } from '../math/machines'
import type { MachineTheme } from '../themes'
import { townToScene, townYawToHeading } from '../../region'
import { drawSymbol, roundRect, shade } from './SymbolArt'

const SCREEN_PX = { w: 640, h: 950 }
const TOPPER_PX = { w: 800, h: 440 }

/** Where the reels sit on the screen, as a share of its size (from the top-left). */
export function reelWindow(rows: number): { x: number; y: number; w: number; h: number } {
  const w = 0.92
  const aspect = SCREEN_PX.w / SCREEN_PX.h
  const h = Math.min(0.5, (w * aspect * rows) / 5)
  return { x: (1 - w) / 2, y: rows === 4 ? 0.3 : 0.34, w, h }
}

export interface PlayInfo {
  credit: number | null
  bet: number
  win: number
  /** A line under the title (FREE GAMES 3 OF 8, RESPINS 3...). */
  status: string
  /** gold free games: heads on the 15-step meter and which animals have turned. */
  heads?: { count: number; marks: { at: number; glyph: string; done: boolean }[] }
  /** collector machines: meters (0..1). */
  meters?: { green: number; pink: number; blue: number }
  message?: string
}

export class MachineDisplay {
  readonly node: TransformNode
  /** The screen centre; reels go here (their front faces the player). */
  readonly screen: TransformNode
  private readonly screenTex: DynamicTexture
  private readonly topperTex: DynamicTexture
  private readonly meshes: Mesh[] = []
  private readonly mats: StandardMaterial[] = []
  private jackpotFlash: Jackpot | null = null
  /** The playing page's sky and title, painted once (they never change) and copied in on every redraw. */
  private playBase: HTMLCanvasElement | null = null

  constructor(private readonly scene: Scene, readonly spot: MachineSpot, readonly def: MachineDef, readonly theme: MachineTheme) {
    this.node = new TransformNode(`machine-${def.id}`, scene)
    const p = townToScene(spot.x, CASINO.floorY - 0.06, spot.z)
    this.node.position.set(p.x, p.y, p.z)
    this.node.rotation.y = townYawToHeading(spot.yaw)
    const s = CABINET.screen
    this.screen = new TransformNode(`screen-${def.id}`, scene)
    this.screen.parent = this.node
    this.screen.position.set(0, s.y, s.z + 0.003)
    this.screen.rotation.set(-s.tilt, Math.PI, 0)
    this.screenTex = this.texture(`screen-${def.id}`, SCREEN_PX.w, SCREEN_PX.h)
    this.plane(`screen-${def.id}`, s.w, s.h, this.screenTex, this.screen, 0, 0, 0)
    const t = CABINET.topper
    const topper = new TransformNode(`topper-${def.id}`, scene)
    topper.parent = this.node
    topper.position.set(0, t.y, t.z + 0.004)
    topper.rotation.y = Math.PI
    this.topperTex = this.texture(`topper-${def.id}`, TOPPER_PX.w, TOPPER_PX.h)
    this.plane(`topper-${def.id}`, t.w, t.h, this.topperTex, topper, 0, 0, 0)
    const led = new StandardMaterial(`led-${def.id}`, scene)
    led.disableLighting = true
    led.emissiveColor = Color3.FromHexString(theme.led)
    this.mats.push(led)
    for (const side of [-1, 1]) {
      const strip = CreatePlane(`led-${def.id}`, { width: 0.012, height: 2.25 }, scene)
      strip.parent = this.node
      strip.position.set(side * (CABINET.width / 2 + 0.002), 1.27, 0.0)
      strip.rotation.y = side * Math.PI / 2
      strip.material = led
      strip.isPickable = false
      this.meshes.push(strip)
      const front = CreatePlane(`led-front-${def.id}`, { width: 0.01, height: 2.25 }, scene)
      front.parent = this.node
      front.position.set(side * (CABINET.width / 2 - 0.006), 1.27, 0.32)
      front.rotation.y = Math.PI
      front.material = led
      front.isPickable = false
      this.meshes.push(front)
    }
    this.drawAttract()
    this.drawTopper(1)
  }

  private texture(name: string, w: number, h: number): DynamicTexture {
    const t = new DynamicTexture(name, { width: w, height: h }, this.scene, true)
    t.anisotropicFilteringLevel = 8
    return t
  }

  private plane(name: string, w: number, h: number, tex: DynamicTexture, parent: TransformNode, x: number, y: number, z: number): Mesh {
    const mat = new StandardMaterial(`${name}-mat`, this.scene)
    mat.disableLighting = true
    mat.emissiveTexture = tex
    mat.specularColor = Color3.Black()
    mat.diffuseColor = Color3.Black()
    const mesh = CreatePlane(name, { width: w, height: h }, this.scene)
    mesh.parent = parent
    mesh.position.set(x, y, z)
    mesh.material = mat
    mesh.isPickable = false
    this.meshes.push(mesh)
    this.mats.push(mat)
    return mesh
  }

  private sky(g: CanvasRenderingContext2D, w: number, h: number): void {
    const grad = g.createLinearGradient(0, 0, 0, h)
    grad.addColorStop(0, this.theme.sky[0])
    grad.addColorStop(1, this.theme.sky[1])
    g.fillStyle = grad
    g.fillRect(0, 0, w, h)
    g.globalAlpha = 0.18
    for (let i = 0; i < 26; i++) {
      const x = (i * 97) % w
      const y = (i * 53) % (h * 0.5)
      const r = 1 + (i % 3)
      g.fillStyle = '#ffffff'
      g.beginPath()
      g.arc(x, y, r, 0, Math.PI * 2)
      g.fill()
    }
    g.globalAlpha = 1
  }

  private title(g: CanvasRenderingContext2D, w: number, y: number, size: number): void {
    g.save()
    g.textAlign = 'center'
    g.textBaseline = 'middle'
    g.font = `900 ${size}px "Arial Black","Impact",sans-serif`
    const words = this.theme.title.toUpperCase()
    let fit = size
    while (g.measureText(words).width > w * 0.92 && fit > 20) {
      fit -= 2
      g.font = `900 ${fit}px "Arial Black","Impact",sans-serif`
    }
    g.lineJoin = 'round'
    g.lineWidth = fit * 0.22
    g.strokeStyle = '#1a0a00'
    g.strokeText(words, w / 2, y)
    const grad = g.createLinearGradient(0, y - fit / 2, 0, y + fit / 2)
    grad.addColorStop(0, '#fffbe0')
    grad.addColorStop(0.5, this.theme.titleColor)
    grad.addColorStop(0.55, shade(this.theme.accent, -0.2))
    grad.addColorStop(1, this.theme.accent)
    g.fillStyle = grad
    g.shadowColor = this.theme.accent
    g.shadowBlur = fit * 0.4
    g.fillText(words, w / 2, y)
    g.restore()
  }

  /** The idle page: title, a fan of the theme's symbols, PLAY ME. */
  drawAttract(): void {
    this.playBase = null
    const g = this.screenTex.getContext() as CanvasRenderingContext2D
    const { w, h } = SCREEN_PX
    this.sky(g, w, h)
    this.title(g, w, h * 0.12, 64)
    g.textAlign = 'center'
    g.fillStyle = '#fff6d8'
    g.font = '700 30px "Arial",sans-serif'
    g.fillText(this.theme.tagline, w / 2, h * 0.2)
    const picks = Object.entries(this.theme.symbols).filter(([, s]) => s.kind !== 'rank').slice(0, 6)
    picks.forEach(([, s], i) => {
      const col = i % 3
      const row = Math.floor(i / 3)
      drawSymbol(g, s, 40 + col * 190, h * 0.28 + row * 200, 180, 180, s.kind === 'coin' ? '50' : undefined)
    })
    g.font = '900 54px "Arial Black",sans-serif'
    g.fillStyle = this.theme.accent
    g.shadowColor = this.theme.accent
    g.shadowBlur = 24
    g.fillText('PLAY ME', w / 2, h * 0.82)
    g.shadowBlur = 0
    g.font = '600 26px Arial,sans-serif'
    g.fillStyle = '#e8e0c8'
    g.fillText(`${this.def.family === 'gold' || this.def.family === 'goldwheel' ? '1,024 WAYS' : this.def.family === 'house' ? '243 WAYS' : `${this.def.family === 'collect' ? 20 : 25} LINES`} · ${this.def.credits} CREDITS`, w / 2, h * 0.9)
    this.screenTex.update(true)
  }

  /** The playing page behind the reels. */
  drawPlay(info: PlayInfo): void {
    const g = this.screenTex.getContext() as CanvasRenderingContext2D
    const { w, h } = SCREEN_PX
    if (!this.playBase) {
      this.playBase = document.createElement('canvas')
      this.playBase.width = w
      this.playBase.height = h
      const b = this.playBase.getContext('2d')!
      this.sky(b, w, h)
      this.title(b, w, h * 0.065, 46)
    }
    g.drawImage(this.playBase, 0, 0)
    g.textAlign = 'center'
    g.textBaseline = 'middle'
    if (info.heads) this.drawHeads(g, w, h, info.heads)
    else if (info.meters) this.drawMeters(g, w, h, info.meters)
    g.font = '900 30px "Arial Black",sans-serif'
    g.fillStyle = '#ffffff'
    g.shadowColor = this.theme.accent
    g.shadowBlur = 14
    g.fillText(info.status, w / 2, h * 0.255)
    g.shadowBlur = 0
    const win = reelWindow(this.def.rows)
    const x = win.x * w
    const y = win.y * h
    const ww = win.w * w
    const wh = win.h * h
    roundRect(g, x - 12, y - 12, ww + 24, wh + 24, 18)
    const frame = g.createLinearGradient(x, y, x + ww, y + wh)
    frame.addColorStop(0, '#fff3c4')
    frame.addColorStop(0.35, '#c9932c')
    frame.addColorStop(0.65, '#6a4410')
    frame.addColorStop(1, '#f2d27a')
    g.fillStyle = frame
    g.fill()
    g.fillStyle = '#05080e'
    g.fillRect(x, y, ww, wh)
    if (info.message) {
      g.font = '900 34px "Arial Black",sans-serif'
      g.fillStyle = '#fff3a0'
      g.shadowColor = '#ff9a00'
      g.shadowBlur = 20
      g.fillText(info.message, w / 2, y + wh + 46)
      g.shadowBlur = 0
    }
    const by = h * 0.86
    roundRect(g, 18, by, w - 36, h * 0.12, 16)
    g.fillStyle = 'rgba(0,0,0,0.55)'
    g.fill()
    const cell = (label: string, value: string, cx: number, color: string) => {
      g.font = '700 22px Arial,sans-serif'
      g.fillStyle = '#d8d0b8'
      g.fillText(label, cx, by + 30)
      g.font = '900 34px "Arial Black",sans-serif'
      g.fillStyle = color
      g.fillText(value, cx, by + 74)
    }
    cell('CREDIT', info.credit === null ? '—' : money(info.credit), w * 0.2, '#ffffff')
    cell('BET', money(info.bet), w * 0.5, '#ffe080')
    cell('WIN', money(info.win), w * 0.8, info.win > 0 ? '#80ff90' : '#ffffff')
    this.screenTex.update(true)
  }

  private drawHeads(g: CanvasRenderingContext2D, w: number, h: number, heads: NonNullable<PlayInfo['heads']>): void {
    const y = h * 0.16
    const step = (w - 80) / 15
    for (let i = 0; i < 15; i++) {
      const cx = 40 + step * (i + 0.5)
      const lit = i < heads.count
      g.beginPath()
      g.arc(cx, y, step * 0.42, 0, Math.PI * 2)
      g.fillStyle = lit ? '#e8b020' : 'rgba(0,0,0,0.45)'
      g.fill()
      g.lineWidth = 3
      g.strokeStyle = lit ? '#fff2b0' : '#8a7040'
      g.stroke()
      const mark = heads.marks.find((m) => m.at === i + 1)
      if (mark) {
        g.font = `${Math.round(step * 0.55)}px "Segoe UI Emoji","Apple Color Emoji",sans-serif`
        g.globalAlpha = mark.done ? 1 : 0.55
        g.fillText(mark.glyph, cx, y + 1)
        g.globalAlpha = 1
      }
    }
  }

  private drawMeters(g: CanvasRenderingContext2D, w: number, h: number, m: NonNullable<PlayInfo['meters']>): void {
    const bars: [string, number, string][] = [['JACKPOT', m.blue, '#3a7aff'], ['CASH', m.green, '#30d060'], ['FREE', m.pink, '#ff4ab0']]
    const bw = (w - 80) / 3
    bars.forEach(([label, v, color], i) => {
      const x = 30 + i * (bw + 10)
      const y = h * 0.135
      roundRect(g, x, y, bw, 44, 12)
      g.fillStyle = 'rgba(0,0,0,0.5)'
      g.fill()
      roundRect(g, x + 4, y + 4, (bw - 8) * Math.max(0.02, Math.min(1, v)), 36, 10)
      g.fillStyle = color
      g.fill()
      g.font = '900 22px "Arial Black",sans-serif'
      g.fillStyle = '#ffffff'
      g.fillText(label, x + bw / 2, y + 23)
    })
  }

  /** Jackpot plaques valued at `bet` (or the title on machines without jackpots). */
  drawTopper(bet: number, flash: Jackpot | null = this.jackpotFlash): void {
    this.jackpotFlash = flash
    const g = this.topperTex.getContext() as CanvasRenderingContext2D
    const { w, h } = TOPPER_PX
    this.sky(g, w, h)
    const js = (['GRAND', 'MAJOR', 'MAXI', 'MINOR', 'MINI'] as Jackpot[]).filter((j) => this.def.jackpots[j])
    if (!js.length) {
      this.title(g, w, h * 0.42, 84)
      g.textAlign = 'center'
      g.font = '700 34px Arial,sans-serif'
      g.fillStyle = '#fff2c8'
      g.fillText(this.theme.tagline, w / 2, h * 0.75)
      this.topperTex.update(true)
      return
    }
    this.title(g, w, h * 0.13, 52)
    const colors: Record<Jackpot, string> = { GRAND: '#e0202a', MAJOR: '#7a2ad0', MAXI: '#e08a10', MINOR: '#1a7ad0', MINI: '#20a040' }
    const rows = js.length > 3 ? [js.slice(0, 1), js.slice(1)] : [js]
    rows.forEach((row, ri) => {
      const ph = ri === 0 && rows.length > 1 ? 120 : 104
      const y = rows.length > 1 ? h * 0.27 + ri * 150 : h * 0.4
      const pw = (w - 40 - (row.length - 1) * 14) / row.length
      row.forEach((j, i) => {
        const x = 20 + i * (pw + 14)
        roundRect(g, x, y, pw, ph, 18)
        const grad = g.createLinearGradient(0, y, 0, y + ph)
        grad.addColorStop(0, shade(colors[j], 0.35))
        grad.addColorStop(1, shade(colors[j], -0.35))
        g.fillStyle = grad
        g.fill()
        g.lineWidth = j === flash ? 8 : 4
        g.strokeStyle = j === flash ? '#ffffff' : '#ffe08a'
        g.stroke()
        g.textAlign = 'center'
        g.textBaseline = 'middle'
        g.font = `900 ${ri === 0 && rows.length > 1 ? 34 : 26}px "Arial Black",sans-serif`
        g.fillStyle = '#ffffff'
        g.fillText(j, x + pw / 2, y + ph * 0.3)
        g.font = `900 ${ri === 0 && rows.length > 1 ? 44 : 32}px "Arial Black",sans-serif`
        g.fillStyle = '#fff6c0'
        g.fillText(money((this.def.jackpots[j] ?? 0) * bet * this.def.scale), x + pw / 2, y + ph * 0.7)
      })
    })
    this.topperTex.update(true)
  }

  /** The cabinet's screen and topper planes (fixed in place). */
  staticMeshes(): readonly Mesh[] {
    return this.meshes
  }

  dispose(): void {
    for (const m of this.meshes) m.dispose()
    for (const m of this.mats) m.dispose()
    this.screenTex.dispose()
    this.topperTex.dispose()
    this.node.dispose()
  }
}

export function money(n: number): string {
  return `$${n.toLocaleString(undefined, { minimumFractionDigits: n % 1 ? 2 : 0, maximumFractionDigits: 2 })}`
}
