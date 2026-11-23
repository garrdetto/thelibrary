import { DynamicTexture } from '@babylonjs/core/Materials/Textures/dynamicTexture'
import { Texture } from '@babylonjs/core/Materials/Textures/texture'
import type { StandardMaterial } from '@babylonjs/core/Materials/standardMaterial'
import { Color3, Color4 } from '@babylonjs/core/Maths/math.color'
import { Mesh } from '@babylonjs/core/Meshes/mesh'
import { VertexData } from '@babylonjs/core/Meshes/mesh.vertexData'
import { VertexBuffer } from '@babylonjs/core/Buffers/buffer'
import { CreateBox } from '@babylonjs/core/Meshes/Builders/boxBuilder'
import { CreateCylinder } from '@babylonjs/core/Meshes/Builders/cylinderBuilder'
import { CreateDisc } from '@babylonjs/core/Meshes/Builders/discBuilder'
import { CreateGround } from '@babylonjs/core/Meshes/Builders/groundBuilder'
import { CreatePlane } from '@babylonjs/core/Meshes/Builders/planeBuilder'
import { CreateSphere } from '@babylonjs/core/Meshes/Builders/sphereBuilder'
import { CreateTorus } from '@babylonjs/core/Meshes/Builders/torusBuilder'
import { TransformNode } from '@babylonjs/core/Meshes/transformNode'
import type { Scene } from '@babylonjs/core/scene'
import type { Look } from '../looks'
import { CLIFF_EDGE, CLIFF_HEIGHT, FEET_PER_METER } from '../sim/constants'
import { seededRng } from '../sim/rng'
import type { Track, TrackElement } from '../sim/track'
import { elementStart } from '../sim/track'
import { flat, glossy, matte } from './materials'

const CHUNK = 100
const WIDTH = 170

type Chunk = { index: number; node: TransformNode; owned: StandardMaterial[]; textures: DynamicTexture[] }

type Mats = Record<'snow' | 'lane' | 'cliff' | 'cliffDark' | 'ice' | 'water' | 'rim' | 'marker' | 'flag' | 'tick' | 'seal' | 'sealBelly' | 'walrus' | 'tusk' | 'dark' | 'snowman' | 'carrot' | 'hatBlack' | 'lake' | 'rock' | 'sky' | 'sun' | 'mountain' | 'cliffTop', StandardMaterial>

export class World {
  private scene: Scene
  private track: Track
  private chunks = new Map<number, Chunk>()
  private mats: Mats
  private snowTexture: DynamicTexture
  private sky: Mesh
  private backdrop: TransformNode
  readonly bouncers = new Map<number, { node: TransformNode; squash: number }>()
  private look: Look

  constructor(scene: Scene, track: Track, look: Look) {
    this.scene = scene
    this.track = track
    this.look = look
    this.snowTexture = this.makeSnowTexture()
    this.mats = this.makeMaterials(look)
    this.sky = this.makeSky(look)
    this.backdrop = this.makeBackdrop()
    this.makeCliff()
    this.applyFog(look)
  }

  setTrack(track: Track): void {
    this.track = track
    for (const chunk of this.chunks.values()) this.disposeChunk(chunk)
    this.chunks.clear()
    this.bouncers.clear()
  }

  setLook(look: Look): void {
    this.look = look
    const set = (key: keyof Mats, hex: string) => { this.mats[key].diffuseColor = Color3.FromHexString(hex) }
    set('snow', look.snow); set('lane', look.lane); set('cliff', look.cliff); set('cliffDark', look.cliffDark); set('ice', look.ice)
    set('water', look.water); set('marker', look.marker); set('flag', look.flag); set('lake', look.ice); set('mountain', look.snowShade); set('cliffTop', look.cliffTop)
    this.mats.flag.emissiveColor = Color3.FromHexString(look.flag).scale(0.25)
    this.mats.sun.emissiveColor = Color3.FromHexString(look.sun)
    this.paintSky(look)
    this.applyFog(look)
    for (const chunk of this.chunks.values()) this.disposeChunk(chunk)
    this.chunks.clear()
    this.bouncers.clear()
  }

  update(cameraX: number, dt: number): void {
    const first = Math.floor((cameraX - 140) / CHUNK)
    const last = Math.floor((cameraX + 420) / CHUNK)
    for (const [index, chunk] of this.chunks) if (index < first - 1 || index > last + 1) { this.disposeChunk(chunk); this.chunks.delete(index) }
    for (let index = Math.max(0, first); index <= last; index++) if (!this.chunks.has(index)) this.chunks.set(index, this.buildChunk(index))
    this.backdrop.position.x = cameraX * 0.92
    this.sky.position.x = cameraX
    for (const bouncer of this.bouncers.values()) {
      if (bouncer.squash <= 0) continue
      bouncer.squash = Math.max(0, bouncer.squash - dt * 2.4)
      const s = Math.sin(bouncer.squash * Math.PI * 3) * bouncer.squash * 0.35
      bouncer.node.scaling.set(1 + s * 0.5, 1 - s, 1 + s * 0.5)
    }
  }

  hitBouncer(id: number): void {
    const bouncer = this.bouncers.get(id)
    if (bouncer) bouncer.squash = 1
  }

  private applyFog(look: Look): void {
    this.scene.fogMode = 2
    this.scene.fogDensity = 0.0042
    this.scene.fogColor = Color3.FromHexString(look.fog)
    this.scene.clearColor = Color4.FromColor3(Color3.FromHexString(look.skyHorizon), 1)
  }

  private makeSnowTexture(): DynamicTexture {
    const size = 256
    const texture = new DynamicTexture('snow-tex', { width: size, height: size }, this.scene, true)
    const ctx = texture.getContext() as CanvasRenderingContext2D
    const rng = seededRng(11)
    ctx.fillStyle = '#ffffff'
    ctx.fillRect(0, 0, size, size)
    for (let i = 0; i < 2600; i++) {
      const shade = 225 + Math.floor(rng() * 30)
      ctx.fillStyle = `rgba(${shade - 12},${shade - 4},${shade},${0.25 + rng() * 0.35})`
      const r = 1 + rng() * 3.5
      ctx.beginPath()
      ctx.arc(rng() * size, rng() * size, r, 0, Math.PI * 2)
      ctx.fill()
    }
    texture.update()
    texture.wrapU = Texture.WRAP_ADDRESSMODE
    texture.wrapV = Texture.WRAP_ADDRESSMODE
    return texture
  }

  private makeMaterials(look: Look): Mats {
    const s = this.scene
    const snow = matte(s, 'snow', look.snow)
    snow.diffuseTexture = this.snowTexture
    ;(snow.diffuseTexture as Texture).uScale = 18
    ;(snow.diffuseTexture as Texture).vScale = 30
    const lane = matte(s, 'lane', look.lane)
    lane.diffuseTexture = this.snowTexture
    const ice = glossy(s, 'ice', look.ice, 0.35)
    ice.alpha = 0.92
    const lake = glossy(s, 'lake', look.ice, 0.25)
    const flag = matte(s, 'flag', look.flag, 0.25)
    flag.backFaceCulling = false
    const sky = matte(s, 'sky', '#ffffff')
    sky.disableLighting = true
    sky.emissiveColor = Color3.White()
    sky.backFaceCulling = false
    sky.fogEnabled = false
    const sun = flat(s, 'sun', look.sun)
    sun.fogEnabled = false
    const mountain = matte(s, 'mountain', look.snowShade)
    const cliffTop = matte(s, 'cliff-top', look.cliffTop)
    cliffTop.diffuseTexture = this.snowTexture
    ;(cliffTop.diffuseTexture as Texture).uScale = 12
    return {
      snow, lane, ice, lake, flag, sky, sun, mountain, cliffTop,
      cliff: glossy(s, 'cliff', look.cliff, 0.18),
      cliffDark: matte(s, 'cliff-dark', look.cliffDark),
      water: glossy(s, 'water', look.water, 0.5),
      rim: matte(s, 'rim', '#e9f3fb'),
      marker: matte(s, 'marker', look.marker),
      tick: matte(s, 'tick', '#9fb7cc'),
      seal: matte(s, 'seal', '#7c8790'),
      sealBelly: matte(s, 'seal-belly', '#b9c2c9'),
      walrus: matte(s, 'walrus', '#9a6f55'),
      tusk: matte(s, 'tusk', '#f4ecd6'),
      dark: matte(s, 'dark', '#141418'),
      snowman: matte(s, 'snowman', '#fbfdff'),
      carrot: matte(s, 'carrot', '#f08a2b'),
      hatBlack: matte(s, 'hat-black', '#25262c'),
      rock: matte(s, 'rock', '#dfe8f0'),
    }
  }

  private makeSky(look: Look): Mesh {
    const sky = CreateSphere('sky', { diameter: 2400, segments: 24, sideOrientation: Mesh.BACKSIDE }, this.scene)
    sky.material = this.mats.sky
    sky.isPickable = false
    sky.infiniteDistance = true
    this.paintSkyMesh(sky, look)
    const sun = CreateDisc('sun', { radius: 40, tessellation: 32 }, this.scene)
    sun.material = this.mats.sun
    sun.position.set(300, 420, 1000)
    sun.billboardMode = Mesh.BILLBOARDMODE_ALL
    sun.infiniteDistance = true
    return sky
  }

  private paintSky(look: Look): void {
    this.paintSkyMesh(this.sky, look)
  }

  private paintSkyMesh(sky: Mesh, look: Look): void {
    const positions = sky.getVerticesData(VertexBuffer.PositionKind)
    if (!positions) return
    const top = Color3.FromHexString(look.skyTop)
    const horizon = Color3.FromHexString(look.skyHorizon)
    const colors: number[] = []
    for (let i = 0; i < positions.length; i += 3) {
      const h = Math.max(0, positions[i + 1] / 1200)
      const k = Math.pow(h, 0.55)
      const c = Color3.Lerp(horizon, top, k)
      colors.push(c.r, c.g, c.b, 1)
    }
    sky.setVerticesData(VertexBuffer.ColorKind, colors)
  }

  private makeBackdrop(): TransformNode {
    const node = new TransformNode('backdrop', this.scene)
    const rng = seededRng(5)
    for (let i = 0; i < 18; i++) {
      const height = 60 + rng() * 120
      const peak = CreateCylinder('mountain', { height, diameterTop: 0, diameterBottom: height * (1.6 + rng()), tessellation: 7 }, this.scene)
      peak.position.set(-500 + i * 70 + rng() * 40, height / 2 - 4, 560 + rng() * 160)
      peak.rotation.y = rng() * Math.PI
      peak.material = this.mats.mountain
      peak.parent = node
      peak.isPickable = false
    }
    return node
  }

  private makeCliff(): void {
    const s = this.scene
    const node = new TransformNode('cliff', s)
    const top = CreateBox('cliff-block', { width: 60, height: CLIFF_HEIGHT + 20, depth: 90 }, s)
    top.position.set(CLIFF_EDGE - 30, (CLIFF_HEIGHT - 20) / 2, 0)
    top.material = this.mats.cliff
    top.parent = node
    const cap = CreateBox('cliff-snow', { width: 60, height: 0.3, depth: 90 }, s)
    cap.position.set(CLIFF_EDGE - 30.15, CLIFF_HEIGHT - 0.1, 0)
    cap.material = this.mats.cliffTop
    cap.parent = node
    const rng = seededRng(3)
    for (let i = 0; i < 26; i++) {
      const h = 2 + rng() * 5
      const shard = CreateCylinder('shard', { height: h, diameterTop: 0, diameterBottom: 1 + rng() * 1.6, tessellation: 5 }, s)
      shard.position.set(CLIFF_EDGE + 0.15 + rng() * 0.3, h / 2 - 0.3, -40 + i * 3.2 + rng())
      shard.rotation.set((rng() - 0.5) * 0.2, rng() * 3, -0.08 - rng() * 0.12)
      shard.material = rng() < 0.5 ? this.mats.cliff : this.mats.cliffDark
      shard.parent = node
    }
    for (let i = 0; i < 14; i++) {
      const z = 2.5 + rng() * 30
      const side = rng() < 0.5 ? -1 : 1
      if (side < 0 && z < 9) continue
      const h = 1 + rng() * 2.6
      const shard = CreateCylinder('crystal', { height: h, diameterTop: 0, diameterBottom: 0.6 + rng(), tessellation: 5 }, s)
      shard.position.set(-2 - rng() * 22, CLIFF_HEIGHT + h / 2 - 0.2, side * z)
      shard.rotation.set(rng() * 0.3, rng() * 3, rng() * 0.3)
      shard.material = this.mats.cliff
      shard.parent = node
    }
    for (let z = -40; z <= 40; z += 1.1) {
      const h = 0.5 + rng() * 1.4
      const icicle = CreateCylinder('icicle', { height: h, diameterTop: 0.28 + rng() * 0.2, diameterBottom: 0, tessellation: 5 }, s)
      icicle.position.set(CLIFF_EDGE + 0.05, CLIFF_HEIGHT - h / 2, z + rng() * 0.5)
      icicle.material = this.mats.cliffDark
      icicle.parent = node
    }
    const lip = CreateBox('cliff-lip', { width: 0.5, height: 0.35, depth: 90 }, s)
    lip.position.set(CLIFF_EDGE - 0.1, CLIFF_HEIGHT + 0.05, 0)
    lip.material = this.mats.snow
    lip.parent = node
    const hole = CreateDisc('fishing-hole', { radius: 0.55, tessellation: 24 }, s)
    hole.rotation.x = Math.PI / 2
    hole.position.set(-1.2, CLIFF_HEIGHT + 0.07, -0.9)
    hole.material = this.mats.water
    hole.parent = node
    const rim = CreateTorus('fishing-rim', { diameter: 1.15, thickness: 0.16, tessellation: 24 }, s)
    rim.position.set(-1.2, CLIFF_HEIGHT + 0.07, -0.9)
    rim.material = this.mats.rim
    rim.parent = node
    const bucket = CreateCylinder('bucket', { height: 0.45, diameterTop: 0.5, diameterBottom: 0.4, tessellation: 16 }, s)
    bucket.position.set(-2.1, CLIFF_HEIGHT + 0.22, 0.6)
    bucket.material = this.mats.flag
    bucket.parent = node
  }

  private buildChunk(index: number): Chunk {
    const s = this.scene
    const x0 = index * CHUNK
    const node = new TransformNode(`chunk-${index}`, s)
    const owned: StandardMaterial[] = []
    const textures: DynamicTexture[] = []
    const ground = CreateGround(`ground-${index}`, { width: CHUNK, height: WIDTH, subdivisionsX: 40, subdivisionsY: 48, updatable: true }, s)
    ground.position.set(x0 + CHUNK / 2, 0, 15)
    const positions = ground.getVerticesData(VertexBuffer.PositionKind)
    if (positions) {
      for (let i = 0; i < positions.length; i += 3) {
        const wx = positions[i] + ground.position.x
        const wz = positions[i + 2] + ground.position.z
        positions[i + 1] = drift(wx, wz)
      }
      ground.updateVerticesData(VertexBuffer.PositionKind, positions)
      const indices = ground.getIndices()
      const normals: number[] = []
      if (indices) {
        VertexData.ComputeNormals(positions, indices, normals)
        ground.updateVerticesData(VertexBuffer.NormalKind, normals)
      }
    }
    if (x0 < CLIFF_EDGE) {
      ground.dispose()
      const rest = CreateGround(`ground-${index}`, { width: CHUNK - CLIFF_EDGE, height: WIDTH, subdivisionsX: 2, subdivisionsY: 2 }, s)
      rest.position.set(CLIFF_EDGE + (CHUNK - CLIFF_EDGE) / 2, 0, 15)
      rest.material = this.mats.snow
      rest.parent = node
    } else {
      ground.material = this.mats.snow
      ground.parent = node
    }
    const laneStart = Math.max(x0, CLIFF_EDGE)
    const lane = CreateGround(`lane-${index}`, { width: x0 + CHUNK - laneStart, height: 3.4 }, s)
    lane.position.set((laneStart + x0 + CHUNK) / 2, 0.012, 0)
    lane.material = this.mats.lane
    lane.parent = node
    for (let x = Math.ceil(laneStart / 10) * 10; x < x0 + CHUNK; x += 10) {
      if (x <= 0) continue
      const tick = CreateBox('tick', { width: 0.14, height: 0.02, depth: 3.4 }, s)
      tick.position.set(x, 0.02, 0)
      tick.material = this.mats.tick
      tick.parent = node
      if (x % 50 === 0) this.addMarker(node, x, owned, textures)
    }
    const rng = seededRng(index * 977 + 13)
    for (let i = 0; i < 3; i++) {
      if (rng() < 0.35) continue
      const lake = CreateDisc('lake', { radius: 6 + rng() * 14, tessellation: 28 }, s)
      lake.rotation.x = Math.PI / 2
      const side = rng() < 0.7 ? 1 : -1
      const z = side * (14 + rng() * 40)
      const lx = x0 + rng() * CHUNK
      lake.position.set(lx, drift(lx, z) + 0.05, z)
      lake.scaling.y = 0.55 + rng() * 0.4
      lake.material = this.mats.lake
      lake.parent = node
    }
    for (let i = 0; i < 7; i++) {
      const rock = CreateSphere('rock', { diameter: 1, segments: 6 }, s)
      const z = (rng() < 0.75 ? 1 : -1) * (6 + rng() * 50)
      const rx = x0 + rng() * CHUNK
      const size = 0.6 + rng() * 2.4
      rock.scaling.set(size * (1 + rng()), size * 0.6, size)
      rock.position.set(rx, drift(rx, z), z)
      rock.rotation.y = rng() * 3
      rock.material = this.mats.rock
      rock.parent = node
    }
    for (const element of this.track.inRange(x0, x0 + CHUNK)) {
      const start = elementStart(element)
      if (start < x0 || start >= x0 + CHUNK) continue
      this.addElement(node, element)
    }
    return { index, node, owned, textures }
  }

  private addMarker(node: TransformNode, x: number, owned: StandardMaterial[], textures: DynamicTexture[]): void {
    const s = this.scene
    const post = CreateCylinder('marker-post', { height: 3.2, diameter: 0.14, tessellation: 8 }, s)
    post.position.set(x, 1.6, 2.6)
    post.material = this.mats.marker
    post.parent = node
    const texture = new DynamicTexture(`marker-${x}`, { width: 256, height: 128 }, s, true)
    const ctx = texture.getContext() as CanvasRenderingContext2D
    ctx.fillStyle = this.look.marker
    ctx.fillRect(0, 0, 256, 128)
    ctx.fillStyle = '#ffffff'
    ctx.fillRect(6, 6, 244, 116)
    ctx.fillStyle = this.look.marker
    ctx.textAlign = 'center'
    ctx.font = "800 64px 'Baloo 2', system-ui, sans-serif"
    ctx.fillText(`${x} m`, 128, 70)
    ctx.font = "700 26px 'Nunito', system-ui, sans-serif"
    ctx.fillText(`${Math.round(x * FEET_PER_METER)} ft`, 128, 108)
    texture.update()
    const material = matte(s, `marker-mat-${x}`, '#ffffff', 0.45)
    material.diffuseTexture = texture
    material.emissiveTexture = texture
    material.backFaceCulling = false
    const sign = CreatePlane('marker-sign', { width: 2.2, height: 1.1 }, s)
    sign.position.set(x, 3.0, 2.58)
    sign.material = material
    sign.parent = node
    owned.push(material)
    textures.push(texture)
    const pennant = CreateDisc('marker-flag', { radius: 0.4, tessellation: 3 }, s)
    pennant.position.set(x + 0.36, 3.8, 2.6)
    pennant.material = this.mats.flag
    pennant.parent = node
    const far = CreateCylinder('marker-far', { height: 1.6, diameter: 0.1, tessellation: 6 }, s)
    far.position.set(x, 0.8, -2.4)
    far.material = this.mats.flag
    far.parent = node
  }

  private addElement(node: TransformNode, e: TrackElement): void {
    const s = this.scene
    if (e.kind === 'slick') {
      const patch = CreateGround('slick', { width: e.x1 - e.x0, height: 5.2 }, s)
      patch.position.set((e.x0 + e.x1) / 2, 0.025, 0)
      patch.material = this.mats.ice
      patch.parent = node
      for (let i = 0; i < 3; i++) {
        const streak = CreateBox('slick-streak', { width: (e.x1 - e.x0) * (0.3 + i * 0.15), height: 0.01, depth: 0.06 }, s)
        streak.position.set((e.x0 + e.x1) / 2 + (i - 1) * 2, 0.035, -1.6 + i * 1.4)
        streak.material = this.mats.rim
        streak.parent = node
      }
      return
    }
    if (e.kind === 'hole') {
      const water = CreateDisc('ice-hole', { radius: e.radius, tessellation: 28 }, s)
      water.rotation.x = Math.PI / 2
      water.position.set(e.x, 0.03, 0)
      water.material = this.mats.water
      water.parent = node
      const rim = CreateTorus('ice-hole-rim', { diameter: e.radius * 2 + 0.2, thickness: 0.3, tessellation: 28 }, s)
      rim.position.set(e.x, 0.05, 0)
      rim.material = this.mats.rim
      rim.parent = node
      return
    }
    if (e.kind === 'bank') {
      const mound = CreateSphere('snowbank', { diameter: 1, segments: 14 }, s)
      mound.scaling.set(e.x1 - e.x0 + 0.6, e.height * 2, 5.5)
      mound.position.set((e.x0 + e.x1) / 2, 0, 0)
      mound.material = this.mats.snow
      mound.parent = node
      const crest = CreateSphere('snowbank-crest', { diameter: 1, segments: 10 }, s)
      crest.scaling.set((e.x1 - e.x0) * 0.6, e.height * 0.9, 3.2)
      crest.position.set((e.x0 + e.x1) / 2 - 0.3, e.height * 0.65, 0.4)
      crest.material = this.mats.snow
      crest.parent = node
      return
    }
    const holder = new TransformNode(`bouncer-${e.id}`, s)
    holder.parent = node
    holder.position.set(e.x, 0, 0.15)
    this.bouncers.set(e.id, { node: holder, squash: 0 })
    const add = (mesh: Mesh, material: StandardMaterial, x: number, y: number, z: number, sx = 1, sy = 1, sz = 1) => {
      mesh.parent = holder
      mesh.position.set(x, y, z)
      mesh.scaling.set(sx, sy, sz)
      mesh.material = material
      return mesh
    }
    if (e.type === 'snowman') {
      add(CreateSphere('sm-base', { diameter: 1.2, segments: 14 }, s), this.mats.snowman, 0, 0.5, 0)
      add(CreateSphere('sm-mid', { diameter: 0.85, segments: 14 }, s), this.mats.snowman, 0, 1.2, 0)
      add(CreateSphere('sm-head', { diameter: 0.6, segments: 12 }, s), this.mats.snowman, 0, 1.72, 0)
      const nose = add(CreateCylinder('sm-nose', { height: 0.32, diameterTop: 0, diameterBottom: 0.09, tessellation: 8 }, s), this.mats.carrot, 0, 1.72, -0.42)
      nose.rotation.x = -Math.PI / 2
      for (const side of [-1, 1]) add(CreateSphere('sm-eye', { diameter: 0.07, segments: 6 }, s), this.mats.dark, side * 0.11, 1.82, -0.26)
      for (let i = 0; i < 3; i++) add(CreateSphere('sm-coal', { diameter: 0.08, segments: 6 }, s), this.mats.dark, 0, 1.0 + i * 0.18, -0.41)
      add(CreateCylinder('sm-brim', { height: 0.04, diameter: 0.62, tessellation: 16 }, s), this.mats.hatBlack, 0, 1.97, 0)
      add(CreateCylinder('sm-hat', { height: 0.38, diameter: 0.4, tessellation: 16 }, s), this.mats.hatBlack, 0, 2.17, 0)
      add(CreateTorus('sm-spring', { diameter: 0.9, thickness: 0.08, tessellation: 18 }, s), this.mats.flag, 0, 0.06, 0)
      return
    }
    const walrus = e.type === 'walrus'
    const skin = walrus ? this.mats.walrus : this.mats.seal
    const size = walrus ? 1.35 : 1
    add(CreateSphere('pup-body', { diameter: 1, segments: 14 }, s), skin, 0, 0.42 * size, 0, 1.8 * size, 0.85 * size, 0.95 * size)
    add(CreateSphere('pup-belly', { diameter: 1, segments: 12 }, s), walrus ? skin : this.mats.sealBelly, 0.1, 0.32 * size, -0.12, 1.4 * size, 0.6 * size, 0.8 * size)
    add(CreateSphere('pup-head', { diameter: 0.62 * size, segments: 12 }, s), skin, -0.75 * size, 0.85 * size, 0)
    for (const side of [-1, 1]) {
      add(CreateSphere('pup-eye', { diameter: 0.08 * size, segments: 6 }, s), this.mats.dark, -0.92 * size, 0.95 * size, side * 0.14 * size)
      add(CreateSphere('pup-flipper', { diameter: 0.4 * size, segments: 8 }, s), skin, -0.2 * size, 0.12 * size, side * 0.48 * size, 1.2, 0.3, 0.7)
      if (walrus) {
        const tusk = add(CreateCylinder('tusk', { height: 0.5, diameterTop: 0, diameterBottom: 0.09, tessellation: 8 }, s), this.mats.tusk, -1.08, 0.62, side * 0.1)
        tusk.rotation.z = 0.15
      }
    }
    add(CreateSphere('pup-nose', { diameter: 0.12 * size, segments: 6 }, s), this.mats.dark, -1.06 * size, 0.85 * size, 0)
    if (walrus) add(CreateSphere('whiskers', { diameter: 0.34, segments: 8 }, s), this.mats.tusk, -1.0, 0.75, 0, 1, 0.6, 1.3)
    add(CreateDisc('pup-tail', { radius: 0.3 * size, tessellation: 3, sideOrientation: Mesh.DOUBLESIDE }, s), skin, 0.98 * size, 0.2 * size, 0, 1, 0.5, 1)
  }

  private disposeChunk(chunk: Chunk): void {
    chunk.node.dispose(false, false)
    for (const material of chunk.owned) material.dispose()
    for (const texture of chunk.textures) texture.dispose()
    for (const [id, bouncer] of this.bouncers) if (bouncer.node.isDisposed()) this.bouncers.delete(id)
  }
}

export function drift(x: number, z: number): number {
  const away = Math.max(0, Math.min(1, (Math.abs(z) - 5) / 22))
  if (away <= 0) return 0
  const n = Math.sin(x * 0.071 + z * 0.033) * 0.7 + Math.sin(x * 0.19 - z * 0.12) * 0.35 + Math.sin(z * 0.045 + x * 0.013) * 1.1 + 1.2
  return Math.max(0, n) * away * 1.6
}
