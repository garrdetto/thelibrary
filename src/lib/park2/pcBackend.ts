import * as pc from 'playcanvas'
import { packMesh, BYTES, DETAIL_SIZE, DETAIL_LAYERS, mat4 } from '../park/gl'
import type { MeshBuilder, Mat4, Vec3, Lighting } from '../park/gl'
import type { RenderBackend, MeshHandle, DrawOptions, InstancedDrawOptions, BackendStats } from '../park/backend'
import { materialTable } from '../park/materials'
import { parkChunks } from './shaders'
import { fillSky, fillEnvironment, skyVector, skyDistance } from './sky'
import { runScratch } from './scratch'

type Pool = { list: pc.MeshInstance[]; used: number; params: DrawParams[] }
type PcMesh = { mesh: pc.Mesh; lines: boolean; instanced: boolean; inst: pc.VertexBuffer | null; instCapacity: number; instCount: number; pools: Map<string, Pool> }
type DrawParams = { tint: Float32Array; slots: Float32Array; highlight: Float32Array }

type Tier = { shadowRes: number; cascades: number; shadowDistance: number; frame: boolean; samples: number; bloom: number; ssao: boolean; lamps: number; skySize: number; envSize: number; grading: boolean }

/** What each quality level turns on. Level 0 renders straight to the canvas with no post chain. */
const TIERS: Tier[] = [
  { shadowRes: 1024, cascades: 1, shadowDistance: 150, frame: false, samples: 1, bloom: 0, ssao: false, lamps: 10, skySize: 256, envSize: 64, grading: false },
  { shadowRes: 2048, cascades: 2, shadowDistance: 240, frame: true, samples: 2, bloom: 0.08, ssao: false, lamps: 32, skySize: 384, envSize: 128, grading: true },
  { shadowRes: 2048, cascades: 3, shadowDistance: 360, frame: true, samples: 4, bloom: 0.1, ssao: true, lamps: 64, skySize: 384, envSize: 128, grading: true },
]

/** Park space (z-up) to PlayCanvas world space (y-up): (x, y, z) -> (x, z, -y). */
const PARK_TO_WORLD = new Float32Array([1, 0, 0, 0, 0, 0, -1, 0, 0, 1, 0, 0, 0, 0, 0, 1])
const WORLD_TO_PARK = new Float32Array([1, 0, 0, 0, 0, 0, 1, 0, 0, -1, 0, 0, 0, 0, 0, 1])
const SLOT_DEFAULT = new Float32Array(27).fill(1)
const LAMP_COLOR = new pc.Color(1, 0.9, 0.78)

/** One small triangle in the classic MeshBuilder layout, for shader warm-up. */
class MeshBuilderLike {
  lines = false
  data = [0, 0, 0, 0, 0, 1, 1, 1, 1, 0, 0, 1, 0, 1, 0, 0, 0, 0, 1, 1, 1, 1, 0, 0, 1, 0, 0, 1, 0, 0, 0, 1, 1, 1, 1, 0, 0, 1, 0]
  get count() { return 3 }
}

function setNodeMatrix(node: pc.GraphNode, m: Float32Array) {
  const n = node as unknown as { worldTransform: pc.Mat4; _dirtyLocal: boolean; _dirtyWorld: boolean; _dirtyNormal: boolean; _worldScaleSign: number; _aabbVer: number }
  n.worldTransform.data.set(m)
  n._dirtyLocal = false; n._dirtyWorld = false; n._dirtyNormal = true; n._worldScaleSign = 0; n._aabbVer++
}

/**
 * Thrill Park 2's renderer backend: the classic park renderer's draw calls
 * played into a PlayCanvas scene each frame. Meshes keep the classic packed
 * vertex format; draws reuse pooled mesh instances; PlayCanvas adds PBR
 * lighting from a procedural sky, cascaded soft sun shadows, clustered lamp
 * lights at night, MSAA, bloom, ambient occlusion and colour grading.
 */
export class PcBackend implements RenderBackend {
  readonly shadowsAvailable = false
  shadowPass = false
  shadowBias = 0
  windLevel = 0
  debug = { noShadow: false, noFrame: false }
  stats: BackendStats = { shadowDraws: 0, mainDraws: 0, shadowVerts: 0, mainVerts: 0, instanceBytes: 0 }

  private app: pc.Application
  private device: pc.GraphicsDevice
  private cameraEntity: pc.Entity
  private sun: pc.Entity
  private layer: pc.Layer
  private frame: pc.CameraFrame | null = null
  private format: pc.VertexFormat
  private instFormat: pc.VertexFormat
  private materials = new Map<string, pc.StandardMaterial>()
  private active = new Set<Pool>()
  private touched = new Set<Pool>()
  private world = new Float32Array(16)
  private proj = new Float32Array(16)
  private camPark = new Float32Array(3)
  private level = -1
  private wantLevel = 1
  private wantSince = 0
  private tier: Tier = TIERS[1]
  private scratch = runScratch()
  private detail: pc.Texture | null = null
  private skyTex: pc.Texture | null = null
  private envTex: pc.Texture | null = null
  private skyCube: pc.Texture | null = null
  private lighting: pc.Texture | null = null
  private atlas: pc.Texture | null = null
  private skyAt = -1e9
  private lastSky: number[] | null = null
  private lampLights: pc.Entity[] = []
  private lastFrame = 0
  private slowFor = 0
  private fastFor = 0
  private scale = 1
  private scope: { time: pc.ScopeId; neon: pc.ScopeId; fill: pc.ScopeId; cam: pc.ScopeId; detail: pc.ScopeId; detailOn: pc.ScopeId; matA: pc.ScopeId; matB: pc.ScopeId }
  private matTable = materialTable()
  private warm: { mesh: PcMesh; frames: number } | null = null
  private tmp = new pc.Mat4()
  private quat = new pc.Quat()
  private vec = new pc.Vec3()
  private toSun = new pc.Vec3()
  private viewInv = new Float32Array(16)
  private sunColor = new pc.Color()
  private lampOrder: number[] = []
  private lampKey = ''

  constructor(canvas: HTMLCanvasElement) {
    const app = new pc.Application(canvas, { graphicsDeviceOptions: { antialias: true, alpha: false, preserveDrawingBuffer: false, powerPreference: 'high-performance', deviceTypes: [pc.DEVICETYPE_WEBGL2] } })
    this.app = app
    this.device = app.graphicsDevice
    app.setCanvasFillMode(pc.FILLMODE_NONE)
    app.setCanvasResolution(pc.RESOLUTION_FIXED, canvas.width, canvas.height)
    app.autoRender = false
    const scene = app.scene
    scene.clusteredLightingEnabled = true
    scene.lighting.shadowsEnabled = false
    scene.lighting.cookiesEnabled = false
    scene.lighting.areaLightsEnabled = false
    scene.lighting.maxLightsPerCell = 12
    scene.lighting.cells = new pc.Vec3(14, 6, 14)
    scene.ambientLight = new pc.Color(0, 0, 0)
    scene.skyboxIntensity = 1
    scene.skyboxMip = 0
    scene.fog.type = pc.FOG_NONE

    this.layer = scene.layers.getLayerByName('World')!
    mat4.multiply(PARK_TO_WORLD, mat4.identity(), this.world)

    this.cameraEntity = new pc.Entity('camera')
    this.cameraEntity.addComponent('camera', { clearColor: new pc.Color(0.4, 0.55, 0.8), nearClip: 0.4, farClip: 2400, fov: 0.78 * 180 / Math.PI })
    this.cameraEntity.camera!.calculateProjection = (m: pc.Mat4) => { m.data.set(this.proj) }
    app.root.addChild(this.cameraEntity)

    this.sun = new pc.Entity('sun')
    this.sun.addComponent('light', { type: 'directional', castShadows: true, shadowType: pc.SHADOW_PCF5_32F, shadowBias: 0.25, normalOffsetBias: 0.06, cascadeDistribution: 0.62, shadowUpdateMode: pc.SHADOWUPDATE_REALTIME, intensity: 1, color: new pc.Color(1, 0.95, 0.85) })
    app.root.addChild(this.sun)

    this.format = new pc.VertexFormat(this.device, [
      { semantic: pc.SEMANTIC_POSITION, components: 3, type: pc.TYPE_FLOAT32 },
      { semantic: pc.SEMANTIC_NORMAL, components: 4, type: pc.TYPE_INT8, normalize: true },
      { semantic: pc.SEMANTIC_COLOR, components: 4, type: pc.TYPE_UINT8, normalize: true },
      { semantic: pc.SEMANTIC_TEXCOORD2, components: 4, type: pc.TYPE_UINT8, normalize: false },
    ])
    this.instFormat = new pc.VertexFormat(this.device, [
      { semantic: pc.SEMANTIC_TEXCOORD6, components: 4, type: pc.TYPE_FLOAT32 },
      { semantic: pc.SEMANTIC_TEXCOORD7, components: 4, type: pc.TYPE_FLOAT32 },
    ])

    const scope = this.device.scope
    this.scope = { time: scope.resolve('uParkTime'), neon: scope.resolve('uNeon'), fill: scope.resolve('uSunFill'), cam: scope.resolve('uCamPark'), detail: scope.resolve('uDetail'), detailOn: scope.resolve('uDetailOn'), matA: scope.resolve('uMatA[0]'), matB: scope.resolve('uMatB[0]') }
    this.initDetail()
    this.initSky()
    this.applyLevel(1)
  }

  private initDetail() {
    const layers = this.scratch.detail
    if (!layers) return
    this.detail = new pc.Texture(this.device, {
      name: 'park-detail', width: DETAIL_SIZE, height: DETAIL_SIZE, arrayLength: DETAIL_LAYERS, format: pc.PIXELFORMAT_RGBA8, mipmaps: true,
      minFilter: pc.FILTER_LINEAR_MIPMAP_LINEAR, magFilter: pc.FILTER_LINEAR, addressU: pc.ADDRESS_REPEAT, addressV: pc.ADDRESS_REPEAT, anisotropy: 8,
      levels: [layers],
    })
    this.scratch.detail = null
  }

  private initSky() {
    const make = (name: string, w: number, h: number) => new pc.Texture(this.device, { name, width: w, height: h, format: pc.PIXELFORMAT_RGBA16F, mipmaps: false, projection: pc.TEXTUREPROJECTION_EQUIRECT, addressU: pc.ADDRESS_REPEAT, addressV: pc.ADDRESS_CLAMP_TO_EDGE, minFilter: pc.FILTER_LINEAR, magFilter: pc.FILTER_LINEAR })
    this.skyTex?.destroy(); this.envTex?.destroy()
    this.skyTex = make('park-sky', this.tier.skySize, this.tier.skySize / 2)
    this.envTex = make('park-env', this.tier.envSize, this.tier.envSize / 2)
    this.lastSky = null
  }

  private updateSky(light: Lighting, now: number) {
    const v = skyVector(light)
    if (this.lastSky) {
      const d = skyDistance(v, this.lastSky)
      if (d < 0.02 || d < 0.15 && now - this.skyAt < 2000) return
    }
    this.lastSky = v; this.skyAt = now
    const sky = this.skyTex!, env = this.envTex!
    fillSky(sky.lock() as Uint16Array, sky.width, sky.height, light); sky.unlock()
    fillEnvironment(env.lock() as Uint16Array, env.width, env.height, light); env.unlock()
    const cube = pc.EnvLighting.generateSkyboxCubemap(sky, this.tier.skySize / 2)
    this.skyCube?.destroy(); this.skyCube = cube
    this.lighting = pc.EnvLighting.generateLightingSource(env, { target: this.lighting ?? undefined, size: 64 })
    this.atlas = pc.EnvLighting.generateAtlas(this.lighting, { target: this.atlas ?? undefined, size: 256, numReflectionSamples: 256, numAmbientSamples: 512 })
    this.app.scene.envAtlas = this.atlas
    this.app.scene.skybox = cube
  }

  private material(blend: boolean, cull: boolean, depthWrite: boolean) {
    const key = `${this.level === 0 ? 'low' : 'std'}:${blend ? 1 : 0}${cull ? 1 : 0}${depthWrite ? 1 : 0}`
    let m = this.materials.get(key)
    if (!m) {
      m = new pc.StandardMaterial()
      m.name = `park-${key}`
      m.useMetalness = true
      m.diffuseVertexColor = true
      m.aoVertexColor = true
      m.useFog = true
      m.useSkybox = true
      m.cull = cull ? pc.CULLFACE_BACK : pc.CULLFACE_NONE
      m.twoSidedLighting = false
      m.blendType = blend ? pc.BLEND_NORMAL : pc.BLEND_NONE
      m.depthWrite = depthWrite
      const chunks = m.getShaderChunks(pc.SHADERLANGUAGE_GLSL)
      for (const [name, code] of Object.entries(parkChunks(this.level === 0))) chunks.set(name, code)
      m.shaderChunksVersion = '2.23'
      m.update()
      this.materials.set(key, m)
    }
    return m
  }

  setLevel(level: number) {
    if (level === this.wantLevel) return
    this.wantLevel = level
    this.wantSince = performance.now()
  }

  private applyLevel(level: number) {
    if (level === this.level) return
    const lowChanged = (level === 0) !== (this.level === 0)
    this.level = level
    this.tier = TIERS[Math.max(0, Math.min(2, level))]
    const t = this.tier
    const light = this.sun.light!
    light.shadowResolution = t.shadowRes
    light.numCascades = t.cascades
    light.shadowDistance = t.shadowDistance
    light.shadowType = level === 0 ? pc.SHADOW_PCF3_32F : pc.SHADOW_PCF5_32F
    if (lowChanged) {
      for (const pool of this.active) for (let i = 0; i < pool.list.length; i++) pool.list[i].visible = false
      this.active.clear(); this.touched.clear()
      for (const pool of this.allPools()) pool.used = 0
    }
    const cam = this.cameraEntity.camera!
    if (t.frame && !this.debug.noFrame) {
      if (!this.frame) this.frame = new pc.CameraFrame(this.app, cam)
      const f = this.frame
      f.rendering.toneMapping = pc.TONEMAP_ACES
      f.rendering.samples = t.samples
      f.rendering.renderTargetScale = this.scale
      f.bloom.intensity = t.bloom
      f.bloom.threshold = 1.15
      f.bloom.blurLevel = 14
      f.ssao.type = t.ssao ? pc.SSAOTYPE_LIGHTING : pc.SSAOTYPE_NONE
      f.ssao.intensity = 0.7
      f.ssao.radius = 40
      f.ssao.samples = 10
      f.ssao.scale = 0.5
      f.grading.enabled = t.grading
      f.grading.saturation = 1.16
      f.grading.contrast = 1.12
      f.vignette.intensity = t.grading ? 0.18 : 0
      f.vignette.inner = 0.55
      f.vignette.outer = 1.25
      f.update()
    } else {
      this.frame?.destroy()
      this.frame = null
      cam.toneMapping = pc.TONEMAP_ACES
      cam.gammaCorrection = pc.GAMMA_SRGB
    }
    this.setLampCount(t.lamps)
    if (this.skyTex && this.skyTex.width !== t.skySize) this.initSky()
    if (lowChanged || !this.warm) this.prepareWarmup()
  }

  /**
   * Draws a hidden triangle once with every material variant the renderer
   * uses, instanced and not, so PlayCanvas compiles those shaders while the
   * park is loading rather than the first time a ghost preview or a ride
   * part needs one.
   */
  private prepareWarmup() {
    if (this.warm) this.free(this.warm.mesh)
    const builder = new MeshBuilderLike()
    const mesh = this.upload(builder as unknown as MeshBuilder, null, true) as PcMesh
    this.setInstances(mesh, new Float32Array([0, 0, 0, 0, 1, 1, 1, 1]), 1)
    this.warm = { mesh, frames: 3 }
  }

  private drawWarmup() {
    const w = this.warm
    if (!w || w.frames <= 0) return
    w.frames--
    const ahead = new Float32Array(16)
    const eye = this.cameraEntity.getPosition(), fwd = this.cameraEntity.forward
    ahead.set([0.001, 0, 0, 0, 0, 0.001, 0, 0, 0, 0, 0.001, 0, eye.x + fwd.x * 2, eye.y + fwd.y * 2, eye.z + fwd.z * 2, 1])
    const toPark = mat4.multiply(WORLD_TO_PARK, ahead)
    for (const variant of [{}, { noCull: true }, { alpha: 0.5 }, { alpha: 0.5, noCull: true }, { noDepthWrite: true }] as DrawOptions[]) this.draw(w.mesh, toPark, variant)
    this.drawInstanced(w.mesh, {}); this.drawInstanced(w.mesh, { alpha: 0.5 })
  }

  private *allPools() {
    for (const m of this.meshes) for (const pool of m.pools.values()) yield pool
  }

  private meshes = new Set<PcMesh>()

  private setLampCount(n: number) {
    while (this.lampLights.length > n) this.lampLights.pop()!.destroy()
    while (this.lampLights.length < n) {
      const e = new pc.Entity('lamp')
      e.addComponent('light', { type: 'omni', castShadows: false, range: 10, intensity: 1.3, color: LAMP_COLOR, falloffMode: pc.LIGHTFALLOFF_INVERSESQUARED })
      e.enabled = false
      this.app.root.addChild(e)
      this.lampLights.push(e)
    }
  }

  probe() { return this.scratch.probeMs * 1.6 }
  rendererName() { return this.scratch.renderer }

  upload(builder: MeshBuilder, previous?: MeshHandle | null, instanced = false): MeshHandle | null {
    if (previous) this.free(previous)
    if (!builder.count) return null
    const { vertices, indices, unique } = packMesh(builder)
    const data = new Uint8Array(vertices)
    let x0 = Infinity, y0 = Infinity, z0 = Infinity, x1 = -Infinity, y1 = -Infinity, z1 = -Infinity
    const view = new DataView(data.buffer, data.byteOffset, data.byteLength)
    for (let i = 0; i < unique; i++) {
      const o = i * BYTES
      const ao = view.getInt8(o + 15)
      data[o + 22] = Math.round(Math.max(0, ao) / 127 * 255)
      data[o + 15] = 0
      const x = view.getFloat32(o, true), y = view.getFloat32(o + 4, true), z = view.getFloat32(o + 8, true)
      if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y; if (z < z0) z0 = z; if (z > z1) z1 = z
    }
    const device = this.device
    const vb = new pc.VertexBuffer(device, this.format, unique, { usage: pc.BUFFER_STATIC, data })
    const ib = new pc.IndexBuffer(device, indices instanceof Uint32Array ? pc.INDEXFORMAT_UINT32 : pc.INDEXFORMAT_UINT16, indices.length, pc.BUFFER_STATIC, indices)
    const mesh = new pc.Mesh(device)
    mesh.vertexBuffer = vb
    mesh.indexBuffer[0] = ib
    mesh.primitive[0] = { type: builder.lines ? pc.PRIMITIVE_LINES : pc.PRIMITIVE_TRIANGLES, base: 0, baseVertex: 0, count: indices.length, indexed: true }
    const aabb = new pc.BoundingBox()
    aabb.setMinMax(new pc.Vec3(x0, y0, z0), new pc.Vec3(x1, y1, z1))
    mesh.aabb = aabb
    const handle: PcMesh = { mesh, lines: builder.lines, instanced, inst: null, instCapacity: 0, instCount: 0, pools: new Map() }
    this.meshes.add(handle)
    return handle
  }

  setInstances(handle: MeshHandle | null, data: Float32Array, count: number) {
    const m = handle as PcMesh | null
    if (!m?.instanced) return
    if (count > m.instCapacity) {
      m.inst?.destroy()
      m.instCapacity = Math.max(count, Math.ceil(m.instCapacity * 1.5), 64)
      m.inst = new pc.VertexBuffer(this.device, this.instFormat, m.instCapacity, { usage: pc.BUFFER_DYNAMIC })
      for (const pool of m.pools.values()) for (const mi of pool.list) mi.setInstancing(m.inst)
    }
    if (count > 0 && m.inst) {
      const target = new Float32Array(m.inst.lock() as ArrayBuffer)
      target.set(data.subarray(0, count * 8))
      m.inst.unlock()
      this.stats.instanceBytes += count * 32
    }
    m.instCount = count
  }

  free(handle: MeshHandle) {
    const m = handle as PcMesh
    for (const pool of m.pools.values()) {
      for (const mi of pool.list) { this.layer.removeMeshInstances([mi]); mi.destroy() }
      this.active.delete(pool); this.touched.delete(pool)
    }
    m.pools.clear()
    m.inst?.destroy()
    m.mesh.destroy()
    this.meshes.delete(m)
  }

  beginShadow() { return false }
  endShadow() {}
  beginPost() { return false }
  freePost() {}

  begin(width: number, height: number, view: Mat4, proj: Mat4, cam: Vec3, light: Lighting, time: number, shadowStrength = 0) {
    const now = performance.now()
    if (this.wantLevel !== this.level && now - this.wantSince > 800) this.applyLevel(this.wantLevel)
    this.adapt(now)
    if (this.device.width !== width || this.device.height !== height) this.device.resizeCanvas(width, height)
    this.proj.set(proj)
    const inv = mat4.invert(view, this.viewInv)
    if (inv) {
      const camWorld = mat4.multiply(PARK_TO_WORLD, inv, this.tmp.data)
      this.vec.set(camWorld[12], camWorld[13], camWorld[14])
      this.cameraEntity.setPosition(this.vec)
      this.quat.setFromMat4(this.tmp)
      this.cameraEntity.setRotation(this.quat)
    }
    this.camPark[0] = cam[0]; this.camPark[1] = cam[1]; this.camPark[2] = cam[2]
    this.updateSky(light, now)
    const s = light.sunDir
    this.toSun.set(s[0], s[2], -s[1]).normalize()
    this.sun.setRotation(this.quat.setFromDirections(pc.Vec3.UP, this.toSun))
    const peak = Math.max(light.sunColor[0], light.sunColor[1], light.sunColor[2], 1e-3)
    const sl = this.sun.light!
    this.sunColor.set(light.sunColor[0] / peak, light.sunColor[1] / peak, light.sunColor[2] / peak)
    sl.color = this.sunColor
    sl.intensity = peak
    sl.castShadows = !this.debug.noShadow && (shadowStrength > 0.05 || (light.shadow ?? 0) > 0.05)
    sl.shadowIntensity = Math.min(1, light.shadow ?? 0) * 0.8
    this.app.scene.exposure = light.exposure
    const skyLevel = Math.max(light.sky[0], light.sky[1], light.sky[2])
    this.app.scene.skyboxIntensity = 1.55 + Math.max(0, Math.min(1, (0.45 - skyLevel) / 0.25)) * 0.9
    this.windLevel = light.wind
    this.scope.time.setValue(time)
    this.scope.neon.setValue(light.neon ?? 0.6)
    this.scope.fill.setValue(Math.max(light.sky[0], light.sky[1], light.sky[2]) * 2)
    this.scope.cam.setValue(this.camPark)
    this.scope.detailOn.setValue(this.detail ? 1 : 0)
    if (this.detail) this.scope.detail.setValue(this.detail)
    this.scope.matA.setValue(this.matTable.a)
    this.scope.matB.setValue(this.matTable.b)
    this.stats.mainDraws = 0; this.stats.mainVerts = 0
  }

  /** Lowers the render scale while frames run slow and raises it back when they recover. */
  private adapt(now: number) {
    const dt = this.lastFrame ? now - this.lastFrame : 16
    this.lastFrame = now
    if (!this.frame || dt > 250) return
    if (dt > 21) { this.slowFor += dt; this.fastFor = 0 } else if (dt < 15) { this.fastFor += dt; this.slowFor = Math.max(0, this.slowFor - dt) }
    let next = this.scale
    if (this.slowFor > 1500 && this.scale > 0.6) { next = Math.max(0.6, this.scale - 0.1); this.slowFor = 0 }
    if (this.fastFor > 5000 && this.scale < 1) { next = Math.min(1, this.scale + 0.05); this.fastFor = 0 }
    if (next !== this.scale) { this.scale = next; this.frame.rendering.renderTargetScale = next; this.frame.update() }
  }

  private pool(m: PcMesh, blend: boolean, cull: boolean, depthWrite: boolean) {
    const key = `${this.level === 0 ? 'l' : 's'}${blend ? 1 : 0}${cull ? 1 : 0}${depthWrite ? 1 : 0}`
    let pool = m.pools.get(key)
    if (!pool) { pool = { list: [], used: 0, params: [] }; m.pools.set(key, pool) }
    if (pool.used === pool.list.length) {
      const mi = new pc.MeshInstance(m.mesh, this.material(blend, cull, depthWrite), new pc.GraphNode())
      mi.castShadow = !blend && !m.lines
      mi.receiveShadow = true
      if (m.instanced) {
        if (m.inst) mi.setInstancing(m.inst)
        const box = new pc.BoundingBox(new pc.Vec3(0, 0, 0), new pc.Vec3(4000, 4000, 4000))
        mi.setCustomAabb(box)
      }
      const params: DrawParams = { tint: new Float32Array(3), slots: new Float32Array(27), highlight: new Float32Array(4) }
      mi.setParameter('uTint', params.tint)
      mi.setParameter('uSlots[0]', params.slots)
      mi.setParameter('uHighlight', params.highlight)
      this.layer.addMeshInstances([mi])
      pool.list.push(mi); pool.params.push(params)
    }
    const i = pool.used++
    this.touched.add(pool)
    return { mi: pool.list[i], params: pool.params[i] }
  }

  draw(handle: MeshHandle | null, model?: Mat4, opts: DrawOptions = {}) {
    const m = handle as PcMesh | null
    if (!m) return
    const blend = opts.alpha !== undefined && opts.alpha < 1
    const { mi, params } = this.pool(m, blend, !opts.noCull, !blend && !opts.noDepthWrite)
    setNodeMatrix(mi.node, model ? mat4.multiply(PARK_TO_WORLD, model, this.world) : PARK_TO_WORLD)
    const tint = opts.tint ?? (opts.slots?.[0]) ?? null
    params.tint[0] = tint ? tint[0] : 1; params.tint[1] = tint ? tint[1] : 1; params.tint[2] = tint ? tint[2] : 1
    if (opts.slots) { for (let i = 0; i < 9; i++) { const c = opts.slots[i + 1]; params.slots[i * 3] = c ? c[0] : 1; params.slots[i * 3 + 1] = c ? c[1] : 1; params.slots[i * 3 + 2] = c ? c[2] : 1 } }
    else params.slots.set(SLOT_DEFAULT)
    const h = opts.highlight
    params.highlight[0] = h ? h[0] : 0; params.highlight[1] = h ? h[1] : 0; params.highlight[2] = h ? h[2] : 0; params.highlight[3] = h ? h[3] : 0
    mi.setParameter('uAlpha', blend ? opts.alpha! : 1)
    mi.setParameter('uEmissive', opts.emissive ?? 0)
    mi.setParameter('uUnlit', opts.unlit ? 1 : 0)
    mi.setParameter('uWave', opts.wave ?? 0)
    mi.setParameter('uWind', 0)
    mi.setParameter('uGround', opts.ground ?? 0)
    mi.setParameter('uSpecular', opts.specular ?? 1)
    mi.castShadow = !blend && !opts.unlit && !m.lines && (!opts.ground || this.level === 2)
    mi.visible = true
    this.stats.mainDraws++
  }

  drawInstanced(handle: MeshHandle | null, opts: InstancedDrawOptions = {}) {
    const m = handle as PcMesh | null
    if (!m || !m.instCount || !m.inst) return
    const blend = opts.alpha !== undefined && opts.alpha < 1
    const { mi, params } = this.pool(m, blend, true, !blend)
    setNodeMatrix(mi.node, PARK_TO_WORLD)
    mi.instancingCount = m.instCount
    params.tint.fill(1); params.slots.set(SLOT_DEFAULT); params.highlight.fill(0)
    mi.setParameter('uAlpha', blend ? opts.alpha! : 1)
    mi.setParameter('uEmissive', opts.emissive ?? 0)
    mi.setParameter('uUnlit', 0)
    mi.setParameter('uWave', 0)
    mi.setParameter('uWind', opts.wind ? opts.wind * this.windLevel : 0)
    mi.setParameter('uGround', 0)
    mi.setParameter('uSpecular', opts.specular ?? 1)
    mi.castShadow = !blend && !opts.emissive
    mi.visible = true
    this.stats.mainDraws++
  }

  /** Lights the lamp posts nearest the camera at night; re-picks them only when the camera or the lamps move. */
  lamps(data: Float32Array, count: number, night: boolean) {
    const lights = this.lampLights
    if (!night || !count || !lights.length) { for (const l of lights) if (l.enabled) l.enabled = false; this.lampKey = ''; return }
    const cx = this.camPark[0], cy = this.camPark[1]
    const key = `${count}:${Math.round(cx / 8)}:${Math.round(cy / 8)}:${data[0]}:${data[(count - 1) * 8]}`
    if (key === this.lampKey) return
    this.lampKey = key
    const order = this.lampOrder
    order.length = count
    for (let i = 0; i < count; i++) order[i] = i
    if (count > lights.length) {
      const d2 = (i: number) => { const dx = data[i * 8] - cx, dy = data[i * 8 + 1] - cy; return dx * dx + dy * dy }
      order.sort((a, b) => d2(a) - d2(b))
    }
    for (let k = 0; k < lights.length; k++) {
      const l = lights[k]
      if (k >= count) { if (l.enabled) l.enabled = false; continue }
      const i = order[k] * 8
      l.setPosition(data[i] - 1.5, data[i + 2] + 3.5, -(data[i + 1] - 1.5))
      if (!l.enabled) l.enabled = true
    }
  }

  endPost() {
    this.drawWarmup()
    for (const pool of this.active) if (!this.touched.has(pool)) { for (let i = 0; i < pool.list.length; i++) pool.list[i].visible = false }
    for (const pool of this.touched) { for (let i = pool.used; i < pool.list.length; i++) pool.list[i].visible = false; pool.used = 0 }
    const swap = this.active; this.active = this.touched; this.touched = swap; this.touched.clear()
    this.app.render()
  }

  dispose() {
    this.frame?.destroy()
    this.app.destroy()
  }
}
