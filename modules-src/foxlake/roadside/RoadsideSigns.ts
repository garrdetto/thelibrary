/**
 * Lettering for the county road's places, in scene space (the town's node is
 * mirrored, so text built under it would read backwards): painted boards on
 * the facades, double-sided pylon signs facing the traffic, neon OPEN, BEER
 * and VACANCY signs, and a routed name board at each cabin's driveway. Neon
 * is self-lit; boards are lit by the sun with a faint glow so they read at
 * dusk.
 */
import { DynamicTexture } from '@babylonjs/core/Materials/Textures/dynamicTexture'
import { StandardMaterial } from '@babylonjs/core/Materials/standardMaterial'
import { Color3 } from '@babylonjs/core/Maths/math.color'
import { CreatePlane } from '@babylonjs/core/Meshes/Builders/planeBuilder'
import { TransformNode } from '@babylonjs/core/Meshes/transformNode'
import type { Scene } from '@babylonjs/core/scene'
import { townToScene, townYawToHeading } from '../region'
import { ROADSIDE, placeFrame, placeToTown, type RoadsidePlace } from './RoadsideLayout'

export interface SignStyle {
  kind: 'board' | 'neon'
  bg?: string
  fg: string
  border?: string
  font?: string
  sub?: string
}

export class RoadsideSigns {
  private readonly disposables: { dispose(): void }[] = []
  readonly root: TransformNode

  constructor(private readonly scene: Scene) {
    this.root = new TransformNode('roadside-signs', scene)
    for (const p of ROADSIDE) this.place(p)
    this.root.getChildMeshes(false).forEach((m) => {
      m.computeWorldMatrix(true)
      m.freezeWorldMatrix()
    })
  }

  private place(p: RoadsidePlace): void {
    const hw = p.w / 2
    const hd = p.d / 2
    const front = { x: 0, z: 1 }
    if (p.kind === 'gas') {
      this.local(p, p.name.toUpperCase(), { kind: 'board', bg: '#f4f2ec', fg: '#b8301f', border: '#b8301f' }, 0, 4.58, hd + 0.21, front, 9.5, 0.62)
      this.local(p, 'BAIT · ICE · FOOD MART', { kind: 'neon', fg: '#ff5a3c' }, hw - 2.4, 3.2, hd + 0.1, front, 3.4, 0.34)
      this.local(p, 'OPEN', { kind: 'neon', fg: '#ff3a3a' }, -hw + 2.4, 2.45, hd + 0.06, front, 1.1, 0.4)
      this.local(p, 'ICE', { kind: 'board', bg: '#e8f4ff', fg: '#1b5fa8' }, hw - 2.2, 0.75, hd + 1.12, front, 1.6, 0.42)
      const px = -hw - 4
      const pz = p.setback - 9
      for (const dir of [1, -1] as const) {
        this.local(p, 'BEAR PAW', { kind: 'board', bg: '#f4f2ec', fg: '#b8301f', sub: 'FUEL & BAIT' }, px + dir * 0.27, 7.3, pz, { x: dir, z: 0 }, 3.0, 2.0)
        this.local(p, 'REG 3.19  ·  DSL 3.89', { kind: 'neon', fg: '#ffb43c' }, px + dir * 0.22, 4.8, pz, { x: dir, z: 0 }, 2.6, 0.9)
      }
      this.local(p, 'FUEL', { kind: 'board', bg: '#b8301f', fg: '#ffffff' }, 0, 5.4, hd + 11 + 6.12, front, 4.0, 0.62)
    } else if (p.kind === 'motel') {
      this.local(p, 'OFFICE', { kind: 'neon', fg: '#5ad7ff' }, -hw + 2.5, 2.62, hd + 0.08, front, 1.6, 0.4)
      const px = hw + 3
      const pz = p.setback - 9
      for (const dir of [1, -1] as const) {
        this.local(p, 'PINE CONE', { kind: 'board', bg: '#2f4a32', fg: '#f3e6c4', border: '#f3e6c4', sub: 'MOTEL' }, px + dir * 0.32, 6.85, pz, { x: dir, z: 0 }, 4.0, 2.3)
        this.local(p, 'VACANCY', { kind: 'neon', fg: '#ff3b5c' }, px + dir * 0.24, 4.75, pz, { x: dir, z: 0 }, 2.6, 0.9)
      }
      this.local(p, 'PINE CONE MOTEL', { kind: 'board', bg: '#2f4a32', fg: '#f3e6c4', border: '#f3e6c4' }, 0, 3.6, p.d / 2 + 0.45, front, 7, 0.7)
    } else if (p.kind === 'bar') {
      this.local(p, 'THE RUSTY LURE', { kind: 'board', bg: '#2a1a10', fg: '#f0c87a', border: '#c98a3a', sub: 'TAVERN' }, 0, 4.7, hd + 0.08, front, 6.4, 1.6)
      this.local(p, 'OPEN', { kind: 'neon', fg: '#ff4040' }, -hw + 2.6, 1.75, hd + 0.08, front, 1.1, 0.42)
      this.local(p, 'COLD BEER', { kind: 'neon', fg: '#4fd0ff' }, hw - 2.6, 1.75, hd + 0.08, front, 1.8, 0.42)
      this.local(p, 'LIVE BAIT · POOL', { kind: 'neon', fg: '#7dff6a' }, -hw / 2 - 1.2, 1.75, hd + 0.08, front, 1.5, 0.36)
      this.local(p, 'BURGERS', { kind: 'neon', fg: '#ffb43c' }, hw / 2 + 1.2, 1.75, hd + 0.08, front, 1.4, 0.4)
      const px = hw + 2
      const pz = p.setback - 9
      for (const dir of [1, -1] as const) this.local(p, 'RUSTY LURE', { kind: 'board', bg: '#2a1a10', fg: '#f0c87a', border: '#c98a3a', sub: 'TAVERN · EST 1962' }, px + dir * 0.14, 3.75, pz, { x: dir, z: 0 }, 3.6, 1.35)
    } else {
      const dz = p.setback - 7
      const lx = -p.lotHalf + 2
      this.local(p, p.name.replace(' Cabin', ''), { kind: 'board', bg: '#5a3a20', fg: '#f2dcb0', border: '#2a1a0c', sub: 'CABIN', font: 'Georgia,"Times New Roman",serif' }, lx, 1.35, dz, front, 1.6, 0.6)
    }
  }

  /** A sign in the place's frame: `face` is the local direction its lettering faces. */
  private local(p: RoadsidePlace, text: string, style: SignStyle, lx: number, y: number, lz: number, face: { x: number; z: number }, w: number, h: number): void {
    const f = placeFrame(p)
    const c = Math.cos(f.yaw)
    const s = Math.sin(f.yaw)
    const at = placeToTown(p, lx, lz)
    const dx = face.x * c + face.z * s
    const dz = -face.x * s + face.z * c
    this.sign(text, style, at.x, y, at.z, Math.atan2(dx, dz), w, h)
  }

  /** A sign at town (x, y, z) whose lettering faces town yaw `yaw`, w x h metres. */
  private sign(text: string, style: SignStyle, x: number, y: number, z: number, yaw: number, w: number, h: number): void {
    this.disposables.push(...buildSign(this.scene, this.root, text, style, x, y, z, yaw, w, h))
  }

  dispose(): void {
    for (const d of this.disposables) d.dispose()
    this.root.dispose()
  }
}

/** A sign at town (x, y, z) whose lettering faces town yaw `yaw`, w x h metres. */
export function buildSign(scene: Scene, parent: TransformNode, text: string, style: SignStyle, x: number, y: number, z: number, yaw: number, w: number, h: number): { dispose(): void }[] {
  const node = new TransformNode(`roadside-sign-${text}`, scene)
  node.parent = parent
  const p = townToScene(x, y, z)
  node.position.set(p.x, p.y, p.z)
  node.rotation.y = townYawToHeading(yaw) + Math.PI
  const width = 1024
  const height = Math.max(64, Math.round((width * h) / w))
  const tex = new DynamicTexture(`roadside-sign-${text}`, { width, height }, scene, true)
  tex.hasAlpha = true
  const g = tex.getContext() as CanvasRenderingContext2D
  g.clearRect(0, 0, width, height)
  const font = style.font ?? '"Arial Black","Impact",sans-serif'
  const mainH = style.sub ? height * 0.58 : height
  if (style.kind === 'board') {
    g.fillStyle = style.bg ?? '#ffffff'
    g.fillRect(0, 0, width, height)
    if (style.border) {
      g.strokeStyle = style.border
      g.lineWidth = Math.max(6, height * 0.05)
      g.strokeRect(g.lineWidth, g.lineWidth, width - g.lineWidth * 2, height - g.lineWidth * 2)
    }
  }
  g.textAlign = 'center'
  g.textBaseline = 'middle'
  const fit = (t: string, max: number, room: number) => {
    let size = Math.round(max)
    g.font = `900 ${size}px ${font}`
    while (g.measureText(t).width > room && size > 12) {
      size -= 2
      g.font = `900 ${size}px ${font}`
    }
  }
  const room = width * 0.88
  if (style.kind === 'neon') {
    fit(text, mainH * 0.7, room)
    for (const [blur, alpha] of [[36, 0.6], [16, 0.9], [4, 1]] as const) {
      g.shadowColor = style.fg
      g.shadowBlur = blur
      g.globalAlpha = alpha
      g.fillStyle = blur > 4 ? style.fg : '#ffffff'
      g.fillText(text, width / 2, mainH / 2)
    }
    g.globalAlpha = 1
    g.shadowBlur = 0
  } else {
    fit(text, mainH * 0.62, room)
    g.fillStyle = style.fg
    g.fillText(text, width / 2, mainH / 2 + (style.sub ? height * 0.04 : 0))
    if (style.sub) {
      fit(style.sub, height * 0.26, room)
      g.fillText(style.sub, width / 2, height * 0.76)
    }
  }
  tex.update(true)
  const mat = new StandardMaterial(`roadside-sign-${text}`, scene)
  if (style.kind === 'neon') {
    mat.disableLighting = true
    mat.emissiveTexture = tex
    mat.opacityTexture = tex
  } else {
    mat.diffuseTexture = tex
    mat.emissiveColor = new Color3(0.18, 0.17, 0.15)
    mat.specularColor = new Color3(0.05, 0.05, 0.05)
  }
  const plane = CreatePlane(`roadside-sign-${text}`, { width: w, height: h }, scene)
  plane.parent = node
  plane.material = mat
  plane.isPickable = false
  return [plane, mat, tex, node]
}
