import { Constants } from '@babylonjs/core/Engines/constants'
import { Effect } from '@babylonjs/core/Materials/effect'
import { ShaderMaterial } from '@babylonjs/core/Materials/shaderMaterial'
import { StandardMaterial } from '@babylonjs/core/Materials/standardMaterial'
import { DynamicTexture } from '@babylonjs/core/Materials/Textures/dynamicTexture'
import { Color3 } from '@babylonjs/core/Maths/math.color'
import { Matrix, Vector3 } from '@babylonjs/core/Maths/math.vector'
import type { AbstractMesh } from '@babylonjs/core/Meshes/abstractMesh'
import { VertexBuffer } from '@babylonjs/core/Buffers/buffer'
import { Mesh } from '@babylonjs/core/Meshes/mesh'
import { CreateCylinder } from '@babylonjs/core/Meshes/Builders/cylinderBuilder'
import { CreatePlane } from '@babylonjs/core/Meshes/Builders/planeBuilder'
import { CreateSphere } from '@babylonjs/core/Meshes/Builders/sphereBuilder'
import { CreateTorus } from '@babylonjs/core/Meshes/Builders/torusBuilder'
import { TransformNode } from '@babylonjs/core/Meshes/transformNode'
import type { Camera } from '@babylonjs/core/Cameras/camera'
import type { Scene } from '@babylonjs/core/scene'
import type { EngineContext } from '../core/EngineSetup'

/** Transparent effects draw after the lake surface (which uses alphaIndex 0), so rings and spray sit on top of it. */
export const FX_ALPHA_INDEX = 10

Effect.ShadersStore.rrRippleVertexShader = /* glsl */ `
precision highp float;
attribute vec3 position;
attribute vec2 uv;
attribute vec4 color;
uniform mat4 viewProjection;
varying vec2 vUv;
varying vec4 vColor;
void main() {
  vUv = uv * 2.0 - 1.0;
  vColor = color;
  gl_Position = viewProjection * vec4(position, 1.0);
}`

Effect.ShadersStore.rrRippleFragmentShader = /* glsl */ `
precision highp float;
varying vec2 vUv;
varying vec4 vColor;
void main() {
  float r = length(vUv);
  if (r > 1.0) discard;
  float w = mix(0.07, 0.15, vColor.g);
  float outer = smoothstep(w, 0.0, abs(r - 0.84));
  float inner = smoothstep(w * 0.8, 0.0, abs(r - 0.58)) * 0.5 * vColor.b;
  float a = (outer + inner) * vColor.a;
  gl_FragColor = vec4(vec3(0.9, 0.95, 0.97), a);
}`

Effect.ShadersStore.rrSprayVertexShader = /* glsl */ `
precision highp float;
attribute vec3 position;
attribute vec2 uv;
attribute vec4 color;
uniform mat4 viewProjection;
varying vec2 vUv;
varying vec4 vColor;
void main() {
  vUv = uv * 2.0 - 1.0;
  vColor = color;
  gl_Position = viewProjection * vec4(position, 1.0);
}`

Effect.ShadersStore.rrSprayFragmentShader = /* glsl */ `
precision highp float;
varying vec2 vUv;
varying vec4 vColor;
void main() {
  float r = length(vUv);
  float a = smoothstep(1.0, 0.25, r) * vColor.a;
  if (a < 0.01) discard;
  gl_FragColor = vec4(vColor.rgb, a);
}`

interface Ripple {
  x: number
  y: number
  z: number
  age: number
  life: number
  size: number
  strength: number
  wide: number
}

interface Drop {
  p: Vector3
  v: Vector3
  age: number
  life: number
  size: number
  bright: number
}

const MAX_RIPPLES = 64
const MAX_DROPS = 240

function quadMesh(name: string, count: number, scene: Scene): { mesh: Mesh; positions: Float32Array; colors: Float32Array } {
  const positions = new Float32Array(count * 12)
  const colors = new Float32Array(count * 16)
  const uvs = new Float32Array(count * 8)
  const indices = new Uint32Array(count * 6)
  for (let i = 0; i < count; i++) {
    uvs.set([0, 0, 1, 0, 1, 1, 0, 1], i * 8)
    const v = i * 4
    indices.set([v, v + 1, v + 2, v, v + 2, v + 3], i * 6)
  }
  const mesh = new Mesh(name, scene)
  mesh.setVerticesData(VertexBuffer.PositionKind, positions, true, 3)
  mesh.setVerticesData(VertexBuffer.ColorKind, colors, true, 4)
  mesh.setVerticesData(VertexBuffer.UVKind, uvs, false, 2)
  mesh.setIndices(indices)
  mesh.isPickable = false
  mesh.alwaysSelectAsActiveMesh = true
  mesh.doNotSyncBoundingInfo = true
  mesh.alphaIndex = FX_ALPHA_INDEX
  mesh.receiveShadows = false
  return { mesh, positions, colors }
}

function fxMaterial(name: string, shader: string, scene: Scene, additive: boolean): ShaderMaterial {
  const mat = new ShaderMaterial(name, scene, shader, {
    attributes: ['position', 'uv', 'color'],
    uniforms: ['viewProjection'],
    needAlphaBlending: true,
  })
  mat.backFaceCulling = false
  mat.disableDepthWrite = true
  mat.alphaMode = additive ? Constants.ALPHA_ADD : Constants.ALPHA_COMBINE
  return mat
}

/** Rings and spray on the lake surface. Everything is pooled into two meshes that are rewritten each frame. */
export class WaterFx {
  private readonly ripples: Ripple[] = []
  private readonly drops: Drop[] = []
  private readonly rippleMesh: Mesh
  private readonly ripplePos: Float32Array
  private readonly rippleCol: Float32Array
  private readonly sprayMesh: Mesh
  private readonly sprayPos: Float32Array
  private readonly sprayCol: Float32Array
  private readonly right = new Vector3()
  private readonly up = new Vector3()
  private readonly spareDrops: Drop[] = []
  private readonly spareRipples: Ripple[] = []
  private oldestDrop = 0
  private oldestRipple = 0
  private dirty = true

  /**
   * @param surfaceAt water height at (x, z), or null where there's no water to ring
   * @param sizeAt how much to enlarge effects at a point so they stay readable from far away (1 up close)
   */
  constructor(ctx: EngineContext, scene: Scene, private readonly surfaceAt: (x: number, z: number) => number | null, private readonly sizeAt: (x: number, y: number, z: number) => number = () => 1) {
    const r = quadMesh('fx-ripples', MAX_RIPPLES, scene)
    this.rippleMesh = r.mesh
    this.ripplePos = r.positions
    this.rippleCol = r.colors
    this.rippleMesh.material = fxMaterial('fx-ripple-mat', 'rrRipple', scene, false)
    const s = quadMesh('fx-spray', MAX_DROPS, scene)
    this.sprayMesh = s.mesh
    this.sprayPos = s.positions
    this.sprayCol = s.colors
    this.sprayMesh.material = fxMaterial('fx-spray-mat', 'rrSpray', scene, false)
    ctx.registerDynamic(this.rippleMesh)
    ctx.registerDynamic(this.sprayMesh)
  }

  /** An expanding ring on the water at (x, z): `size` is the final radius in metres. */
  ring(x: number, z: number, size: number, strength = 1, life = 1.6, wide = 0): void {
    const y = this.surfaceAt(x, z)
    if (y === null) return
    const r = this.newRipple()
    r.x = x
    r.y = y + 0.006
    r.z = z
    r.age = 0
    r.life = life
    r.size = size * this.sizeAt(x, y, z)
    r.strength = Math.min(1, strength)
    r.wide = wide
  }

  /** A ripple slot: a spare one, or (when all are showing) the oldest-placed one, reused in place. */
  private newRipple(): Ripple {
    if (this.ripples.length < MAX_RIPPLES) {
      const r = this.spareRipples.pop() ?? { x: 0, y: 0, z: 0, age: 0, life: 1, size: 1, strength: 1, wide: 0 }
      this.ripples.push(r)
      return r
    }
    this.oldestRipple = (this.oldestRipple + 1) % MAX_RIPPLES
    return this.ripples[this.oldestRipple]
  }

  private newDrop(): Drop {
    if (this.drops.length < MAX_DROPS) {
      const d = this.spareDrops.pop() ?? { p: new Vector3(), v: new Vector3(), age: 0, life: 1, size: 0.03, bright: 1 }
      this.drops.push(d)
      return d
    }
    this.oldestDrop = (this.oldestDrop + 1) % MAX_DROPS
    return this.drops[this.oldestDrop]
  }

  /** A burst of spray at `at`: `power` 0..1+ sets the drop count, speed and height. */
  splash(at: Vector3, power: number, rand: () => number = Math.random): void {
    const count = Math.round(10 + power * 34)
    const k = this.sizeAt(at.x, Math.max(at.y, 0), at.z)
    const speedK = Math.sqrt(k)
    const baseY = Math.max(at.y, 0) + 0.02
    for (let i = 0; i < count; i++) {
      const a = rand() * Math.PI * 2
      const out = (0.4 + rand() * 1.4) * (0.6 + power * 0.8)
      const upV = (1.2 + rand() * 2.6) * (0.55 + power * 0.75)
      const d = this.newDrop()
      d.p.set(at.x + Math.cos(a) * 0.04, baseY, at.z + Math.sin(a) * 0.04)
      d.v.set(Math.cos(a) * out * speedK, upV * speedK, Math.sin(a) * out * speedK)
      d.age = 0
      d.life = 0.5 + rand() * 0.6
      d.size = (0.025 + rand() * 0.05) * (0.7 + power * 0.6) * k
      d.bright = 0.85 + rand() * 0.15
    }
    this.ring(at.x, at.z, 0.55 + power * 1.1, 0.9, 1.4 + power * 0.6, 1)
    if (power > 0.5) this.ring(at.x, at.z, 0.35 + power * 0.6, 0.7, 1.0, 0.5)
  }

  /** Drops shaken off something leaving the water (a fish being lifted out). */
  drip(at: Vector3, rand: () => number = Math.random): void {
    const d = this.newDrop()
    d.p.copyFrom(at)
    d.v.set((rand() - 0.5) * 0.6, -0.2 - rand() * 0.5, (rand() - 0.5) * 0.6)
    d.age = 0
    d.life = 0.9
    d.size = 0.018 + rand() * 0.02
    d.bright = 0.9
  }

  get active(): boolean {
    return this.ripples.length > 0 || this.drops.length > 0
  }

  update(dt: number, camera: Camera): void {
    const ripples = this.ripples
    for (let i = ripples.length - 1; i >= 0; i--) {
      const r = ripples[i]
      r.age += dt
      if (r.age < r.life) continue
      ripples[i] = ripples[ripples.length - 1]
      ripples.pop()
      this.spareRipples.push(r)
    }
    const drops = this.drops
    const drag = Math.max(0, 1 - dt * 0.8)
    for (let i = drops.length - 1; i >= 0; i--) {
      const d = drops[i]
      d.age += dt
      d.v.y -= 9.8 * dt
      d.v.scaleInPlace(drag)
      d.p.addInPlaceFromFloats(d.v.x * dt, d.v.y * dt, d.v.z * dt)
      if (d.age >= d.life || (d.p.y < -0.02 && d.v.y < 0)) {
        if (d.p.y < 0.02 && d.size > 0.06 && ripples.length < MAX_RIPPLES - 8) this.ring(d.p.x, d.p.z, 0.08 + d.size, 0.35, 0.7)
        drops[i] = drops[drops.length - 1]
        drops.pop()
        this.spareDrops.push(d)
      }
    }
    if (!this.active && !this.dirty) return
    this.dirty = this.active
    this.writeRipples()
    this.writeSpray(camera)
  }

  private writeRipples(): void {
    const pos = this.ripplePos
    const col = this.rippleCol
    pos.fill(0)
    col.fill(0)
    for (let i = 0; i < this.ripples.length; i++) {
      const r = this.ripples[i]
      const t = r.age / r.life
      const grow = 1 - Math.pow(1 - t, 2.2)
      const rad = Math.max(0.02, r.size * grow)
      const o = i * 12
      pos[o] = r.x - rad; pos[o + 1] = r.y; pos[o + 2] = r.z - rad
      pos[o + 3] = r.x + rad; pos[o + 4] = r.y; pos[o + 5] = r.z - rad
      pos[o + 6] = r.x + rad; pos[o + 7] = r.y; pos[o + 8] = r.z + rad
      pos[o + 9] = r.x - rad; pos[o + 10] = r.y; pos[o + 11] = r.z + rad
      const fade = r.strength * (1 - t) * Math.min(1, t * 8)
      for (let k = 0; k < 4; k++) {
        const c = i * 16 + k * 4
        col[c] = 1
        col[c + 1] = r.wide
        col[c + 2] = t < 0.6 ? 1 : 0
        col[c + 3] = fade
      }
    }
    this.rippleMesh.updateVerticesData(VertexBuffer.PositionKind, pos)
    this.rippleMesh.updateVerticesData(VertexBuffer.ColorKind, col)
  }

  private writeSpray(camera: Camera): void {
    const view = camera.getViewMatrix()
    const m = view.m
    this.right.set(m[0], m[4], m[8])
    this.up.set(m[1], m[5], m[9])
    const pos = this.sprayPos
    const col = this.sprayCol
    pos.fill(0)
    col.fill(0)
    for (let i = 0; i < this.drops.length; i++) {
      const d = this.drops[i]
      const t = d.age / d.life
      const s = d.size * (1 - t * 0.4)
      const rx = this.right.x * s, ry = this.right.y * s, rz = this.right.z * s
      const ux = this.up.x * s, uy = this.up.y * s, uz = this.up.z * s
      const o = i * 12
      pos[o] = d.p.x - rx - ux; pos[o + 1] = d.p.y - ry - uy; pos[o + 2] = d.p.z - rz - uz
      pos[o + 3] = d.p.x + rx - ux; pos[o + 4] = d.p.y + ry - uy; pos[o + 5] = d.p.z + rz - uz
      pos[o + 6] = d.p.x + rx + ux; pos[o + 7] = d.p.y + ry + uy; pos[o + 8] = d.p.z + rz + uz
      pos[o + 9] = d.p.x - rx + ux; pos[o + 10] = d.p.y - ry + uy; pos[o + 11] = d.p.z - rz + uz
      const a = (1 - t) * 0.9
      for (let k = 0; k < 4; k++) {
        const c = i * 16 + k * 4
        col[c] = 0.86 * d.bright
        col[c + 1] = 0.92 * d.bright
        col[c + 2] = 0.95 * d.bright
        col[c + 3] = a
      }
    }
    this.sprayMesh.updateVerticesData(VertexBuffer.PositionKind, pos)
    this.sprayMesh.updateVerticesData(VertexBuffer.ColorKind, col)
  }
}

function solid(name: string, scene: Scene, diffuse: Color3, emissive: Color3, specular = 0.35): StandardMaterial {
  const mat = new StandardMaterial(name, scene)
  mat.diffuseColor = diffuse
  mat.emissiveColor = emissive
  mat.specularColor = new Color3(specular, specular, specular)
  mat.specularPower = 64
  return mat
}

/**
 * A classic red-and-white float with an antenna and a bright tip. The root sits at the waterline; the float scales up
 * with distance (see `bobberScale`) so it stays a readable size on screen.
 */
export class Bobber {
  readonly root: TransformNode
  readonly meshes: AbstractMesh[] = []

  constructor(ctx: EngineContext, scene: Scene) {
    this.root = new TransformNode('bobber', scene)
    const red = solid('bobber-red', scene, new Color3(0.92, 0.07, 0.04), new Color3(0.42, 0.03, 0.02))
    const white = solid('bobber-white', scene, new Color3(0.96, 0.96, 0.93), new Color3(0.3, 0.3, 0.29))
    const band = solid('bobber-band', scene, new Color3(0.06, 0.06, 0.07), new Color3(0, 0, 0), 0.6)
    const tip = solid('bobber-tip', scene, new Color3(1, 0.86, 0.12), new Color3(0.95, 0.7, 0.08), 0)
    tip.disableLighting = true
    const add = (mesh: Mesh, mat: StandardMaterial, y: number) => {
      mesh.material = mat
      mesh.parent = this.root
      mesh.position.y = y
      mesh.isPickable = false
      mesh.receiveShadows = false
      mesh.alwaysSelectAsActiveMesh = true
      ctx.registerDynamic(mesh)
      this.meshes.push(mesh)
      return mesh
    }
    add(CreateSphere('bobber-top', { diameter: 0.064, segments: 14, slice: 0.5 }, scene), red, 0.016)
    const bottom = add(CreateSphere('bobber-bottom', { diameter: 0.064, segments: 14, slice: 0.5 }, scene), white, 0.016)
    bottom.rotation.x = Math.PI
    add(CreateTorus('bobber-band', { diameter: 0.064, thickness: 0.006, tessellation: 20 }, scene), band, 0.016)
    add(CreateCylinder('bobber-stem', { diameterTop: 0.008, diameterBottom: 0.012, height: 0.056, tessellation: 8 }, scene), red, 0.074)
    add(CreateSphere('bobber-tipball', { diameter: 0.02, segments: 10 }, scene), tip, 0.104)
    add(CreateCylinder('bobber-peg', { diameterTop: 0.007, diameterBottom: 0.004, height: 0.03, tessellation: 8 }, scene), white, -0.03)
    this.root.setEnabled(false)
  }

  setEnabled(on: boolean): void {
    this.root.setEnabled(on)
  }

  isEnabled(): boolean {
    return this.root.isEnabled()
  }

  get position(): Vector3 {
    return this.root.position
  }
}

/** A "!" that pops above the float while a fish has the bait. */
export class BiteMarker {
  private readonly plane: Mesh
  get mesh(): Mesh {
    return this.plane
  }
  private age = 0
  private shown = false

  constructor(ctx: EngineContext, scene: Scene) {
    const tex = new DynamicTexture('bite-marker-tex', { width: 128, height: 128 }, scene, true)
    const g = tex.getContext() as CanvasRenderingContext2D
    g.clearRect(0, 0, 128, 128)
    g.beginPath()
    g.arc(64, 64, 54, 0, Math.PI * 2)
    g.fillStyle = 'rgba(255, 196, 40, 0.96)'
    g.fill()
    g.lineWidth = 8
    g.strokeStyle = 'rgba(70, 30, 0, 0.9)'
    g.stroke()
    g.fillStyle = '#3a1600'
    g.beginPath()
    g.moveTo(53, 24)
    g.lineTo(75, 24)
    g.lineTo(70, 80)
    g.lineTo(58, 80)
    g.closePath()
    g.fill()
    g.beginPath()
    g.arc(64, 97, 9, 0, Math.PI * 2)
    g.fill()
    tex.hasAlpha = true
    tex.update()
    const mat = new StandardMaterial('bite-marker-mat', scene)
    mat.diffuseTexture = tex
    mat.emissiveTexture = tex
    mat.useAlphaFromDiffuseTexture = true
    mat.disableLighting = true
    mat.backFaceCulling = false
    mat.disableDepthWrite = true
    this.plane = CreatePlane('bite-marker', { size: 1 }, scene)
    this.plane.material = mat
    this.plane.billboardMode = Mesh.BILLBOARDMODE_ALL
    this.plane.isPickable = false
    this.plane.applyFog = false
    this.plane.alwaysSelectAsActiveMesh = true
    this.plane.alphaIndex = FX_ALPHA_INDEX + 1
    this.plane.setEnabled(false)
    ctx.registerDynamic(this.plane)
  }

  show(on: boolean): void {
    if (on && !this.shown) this.age = 0
    this.shown = on
    this.plane.setEnabled(on)
  }

  update(dt: number, anchor: Vector3, camera: Camera): void {
    if (!this.shown) return
    this.age += dt
    const dist = Vector3.Distance(camera.globalPosition, anchor)
    const screen = 2 * Math.tan(camera.fov / 2) * dist
    const pop = this.age < 0.25 ? 0.4 + 0.9 * Math.sin((this.age / 0.25) * Math.PI * 0.5) * 1.35 : 1 + Math.sin(this.age * 10) * 0.08
    const size = Math.max(0.18, screen * 0.045) * Math.min(1.35, pop)
    this.plane.scaling.setAll(size)
    this.plane.position.set(anchor.x, Math.max(anchor.y, 0) + size * 0.9 + screen * 0.012 + Math.abs(Math.sin(this.age * 5)) * size * 0.15, anchor.z)
  }
}

const ROD_BASE_Z = 0.25
const ROD_TIP_Z = 1.8
const ROD_MAX_DEFLECT = 0.62

/**
 * Bends the rod blank toward the line and spins the reel. The rod is one shared template mesh (only one angler
 * holds it), so the bend is written straight into its vertex buffer and the line's anchor follows the bent tip.
 */
export class RodFx {
  private readonly base: Float32Array
  private readonly work: Float32Array
  private readonly inverse = new Matrix()
  private readonly dir = new Vector3(0, -1, 0)
  private readonly appliedDir = new Vector3(0, -1, 0)
  private bendNow = 0
  private applied = -1
  private crankAngle = 0
  private readonly crank: TransformNode
  private readonly rotor: TransformNode

  constructor(ctx: EngineContext, scene: Scene, private readonly rodMesh: Mesh, private readonly rodRoot: TransformNode, private readonly rodTip: TransformNode, rodInstances: AbstractMesh[]) {
    const positions = rodMesh.getVerticesData(VertexBuffer.PositionKind)
    this.base = positions ? Float32Array.from(positions) : new Float32Array(0)
    this.work = Float32Array.from(this.base)
    rodMesh.setVerticesData(VertexBuffer.PositionKind, this.work, true, 3)
    for (const m of rodInstances) m.alwaysSelectAsActiveMesh = true

    const metal = solid('reel-metal', scene, new Color3(0.62, 0.64, 0.68), new Color3(0.04, 0.04, 0.05), 0.7)
    const dark = solid('reel-dark', scene, new Color3(0.08, 0.08, 0.09), new Color3(0, 0, 0), 0.5)
    const knobMat = solid('reel-knob', scene, new Color3(0.85, 0.4, 0.08), new Color3(0.12, 0.05, 0.01), 0.4)
    const part = (mesh: Mesh, mat: StandardMaterial, parent: TransformNode) => {
      mesh.material = mat
      mesh.parent = parent
      mesh.isPickable = false
      mesh.receiveShadows = false
      ctx.registerDynamic(mesh)
      return mesh
    }
    const hub = new TransformNode('reel-hub', scene)
    hub.parent = rodRoot
    hub.position.set(-0.05, -0.065, 0.06)
    this.crank = new TransformNode('reel-crank', scene)
    this.crank.parent = hub
    const axle = part(CreateCylinder('reel-axle', { diameter: 0.012, height: 0.02, tessellation: 10 }, scene), metal, hub)
    axle.rotation.z = Math.PI / 2
    const arm = part(CreateCylinder('reel-arm', { diameter: 0.007, height: 0.055, tessellation: 6 }, scene), metal, this.crank)
    arm.position.set(-0.01, -0.0275, 0)
    const knob = part(CreateCylinder('reel-knob', { diameter: 0.014, height: 0.022, tessellation: 10 }, scene), knobMat, this.crank)
    knob.rotation.z = Math.PI / 2
    knob.position.set(-0.024, -0.055, 0)
    this.rotor = new TransformNode('reel-rotor', scene)
    this.rotor.parent = rodRoot
    this.rotor.position.set(0, -0.065, 0.06)
    const bail = part(CreateTorus('reel-bail', { diameter: 0.1, thickness: 0.004, tessellation: 20 }, scene), metal, this.rotor)
    bail.rotation.x = Math.PI / 2
    bail.scaling.set(1, 1, 0.55)
    const roller = part(CreateSphere('reel-roller', { diameter: 0.012, segments: 6 }, scene), dark, this.rotor)
    roller.position.set(0.05, 0, 0)
  }

  /** Bend the blank by `amount` (0..1) toward world point `toward` (or let it sag if `taut` is false). */
  update(dt: number, amount: number, toward: Vector3 | null, taut: boolean, crankSpeed: number): void {
    this.bendNow += (amount - this.bendNow) * Math.min(1, dt * (amount > this.bendNow ? 22 : 9))
    this.crankAngle += crankSpeed * dt
    this.crank.rotation.x = this.crankAngle
    this.rotor.rotation.z = this.crankAngle * 1.4

    this.rodRoot.computeWorldMatrix(true)
    this.rodRoot.getWorldMatrix().invertToRef(this.inverse)
    let dx = 0
    let dy = -1
    if (taut && toward) {
      const local = Vector3.TransformCoordinates(toward, this.inverse)
      dx = local.x
      dy = local.y - Math.max(0, local.z - ROD_TIP_Z) * 0.12
    } else {
      const down = Vector3.TransformNormal(new Vector3(0, -1, 0), this.inverse)
      dx = down.x
      dy = down.y
    }
    const len = Math.hypot(dx, dy) || 1
    this.dir.set(dx / len, dy / len, 0)

    const bend = this.bendNow
    this.rodTip.position.set(this.dir.x * bend * ROD_MAX_DEFLECT, this.dir.y * bend * ROD_MAX_DEFLECT, ROD_TIP_Z - bend * bend * 0.16)
    const turned = Math.abs(this.dir.x - this.appliedDir.x) + Math.abs(this.dir.y - this.appliedDir.y)
    if (Math.abs(bend - this.applied) < 0.0005 && (bend < 0.005 || turned < 0.01)) return
    this.applied = bend
    this.appliedDir.copyFrom(this.dir)
    const b = this.base
    const w = this.work
    for (let i = 0; i < b.length; i += 3) {
      const z = b[i + 2]
      const s = Math.max(0, Math.min(1, (z - ROD_BASE_Z) / (ROD_TIP_Z - ROD_BASE_Z)))
      const k = Math.pow(s, 2.1) * bend * ROD_MAX_DEFLECT
      w[i] = b[i] + this.dir.x * k
      w[i + 1] = b[i + 1] + this.dir.y * k
      w[i + 2] = z - s * s * s * bend * bend * 0.16
    }
    this.rodMesh.updateVerticesData(VertexBuffer.PositionKind, w)
  }

  get crankPhase(): number {
    return this.crankAngle
  }
}
