import { Buffer as BabylonBuffer, VertexBuffer } from '@babylonjs/core/Buffers/buffer'
import type { DataBuffer } from '@babylonjs/core/Buffers/dataBuffer'
import { FreeCamera } from '@babylonjs/core/Cameras/freeCamera'
import type { AbstractEngine } from '@babylonjs/core/Engines/abstractEngine'
import { Constants } from '@babylonjs/core/Engines/constants'
import { Engine } from '@babylonjs/core/Engines/engine'
import { ShaderStore } from '@babylonjs/core/Engines/shaderStore'
import { WebGPUEngine } from '@babylonjs/core/Engines/webgpuEngine'
import '@babylonjs/core/Engines/WebGPU/Extensions/engine.multiRender'
import { ColorCurves } from '@babylonjs/core/Materials/colorCurves'
import { ImageProcessingConfiguration } from '@babylonjs/core/Materials/imageProcessingConfiguration'
import { Material } from '@babylonjs/core/Materials/material'
import { ShaderLanguage } from '@babylonjs/core/Materials/shaderLanguage'
import { ShaderMaterial } from '@babylonjs/core/Materials/shaderMaterial'
import type { BaseTexture } from '@babylonjs/core/Materials/Textures/baseTexture'
import { RawTexture } from '@babylonjs/core/Materials/Textures/rawTexture'
import { RawTexture2DArray } from '@babylonjs/core/Materials/Textures/rawTexture2DArray'
import { RenderTargetTexture } from '@babylonjs/core/Materials/Textures/renderTargetTexture'
import { Color4 } from '@babylonjs/core/Maths/math.color'
import { Matrix, Vector3 } from '@babylonjs/core/Maths/math.vector'
import { Geometry } from '@babylonjs/core/Meshes/geometry'
import { Mesh } from '@babylonjs/core/Meshes/mesh'
import '@babylonjs/core/Meshes/thinInstanceMesh'
import { DefaultRenderingPipeline } from '@babylonjs/core/PostProcesses/RenderPipeline/Pipelines/defaultRenderingPipeline'
import { SSAO2RenderingPipeline } from '@babylonjs/core/PostProcesses/RenderPipeline/Pipelines/ssao2RenderingPipeline'
import { Scene } from '@babylonjs/core/scene'
import { packMesh, BYTES, DETAIL_SIZE, DETAIL_LAYERS } from '../park/gl'
import type { MeshBuilder, Mat4, Vec3, Lighting } from '../park/gl'
import type { RenderBackend, MeshHandle, DrawOptions, InstancedDrawOptions, BackendStats } from '../park/backend'
import { materialTable } from '../park/materials'
import { SHADERS, G_ROWS, D_ROWS, LAMP_MAX } from './babylonShaders'
import { runScratch } from './scratch'

type Draw = { mesh: Mesh; mat: ShaderMaterial; uD: Float32Array; world: Matrix; cap: number; version: number }
type Pool = { list: Draw[]; used: number }
type ParkMesh = {
  vertices: Uint8Array | null
  indices: Uint16Array | Uint32Array | null
  unique: number
  lines: boolean
  instanced: boolean
  buffer: BabylonBuffer | null
  indexBuffer: DataBuffer | null
  indexCount: number
  pools: Map<string, Pool>
  shadowPools: Map<string, Pool>
  matrices: Float32Array
  tints: Float32Array
  capacity: number
  count: number
  version: number
}

type Tier = { shadowRes: number; cascades: number; taps: number; frame: boolean; samples: number; bloom: number; ssao: boolean; lamps: number; grading: boolean; fx: number; haze: number }

const TIERS: Tier[] = [
  { shadowRes: 1024, cascades: 1, taps: 4, frame: false, samples: 1, bloom: 0, ssao: false, lamps: 10, grading: false, fx: 0, haze: 0.0007 },
  { shadowRes: 2048, cascades: 2, taps: 8, frame: true, samples: 2, bloom: 0.12, ssao: false, lamps: 20, grading: true, fx: 1, haze: 0.0012 },
  { shadowRes: 2048, cascades: 3, taps: 12, frame: true, samples: 4, bloom: 0.17, ssao: true, lamps: 32, grading: true, fx: 2, haze: 0.0017 },
]

const ZOOMS = [1, 3.2, 10]
const SHADOW_LAYER = 0x10000000
const BRIGHTNESS = 1.25
const MAIN_GROUP = 1
const SLOT_DEFAULT = 1

ShaderStore.ShadersStore.parkMainVertexShader = SHADERS.glsl.main.vertex
ShaderStore.ShadersStore.parkMainPixelShader = SHADERS.glsl.main.fragment
ShaderStore.ShadersStore.parkDepthVertexShader = SHADERS.glsl.depth.vertex
ShaderStore.ShadersStore.parkDepthPixelShader = SHADERS.glsl.depth.fragment
ShaderStore.ShadersStore.parkSkyVertexShader = SHADERS.glsl.sky.vertex
ShaderStore.ShadersStore.parkSkyPixelShader = SHADERS.glsl.sky.fragment
ShaderStore.ShadersStoreWGSL.parkMainVertexShader = SHADERS.wgsl.main.vertex
ShaderStore.ShadersStoreWGSL.parkMainPixelShader = SHADERS.wgsl.main.fragment
ShaderStore.ShadersStoreWGSL.parkDepthVertexShader = SHADERS.wgsl.depth.vertex
ShaderStore.ShadersStoreWGSL.parkDepthPixelShader = SHADERS.wgsl.depth.fragment
ShaderStore.ShadersStoreWGSL.parkSkyVertexShader = SHADERS.wgsl.sky.vertex
ShaderStore.ShadersStoreWGSL.parkSkyPixelShader = SHADERS.wgsl.sky.fragment

/** One small triangle in the classic MeshBuilder layout, for shader warm-up. */
class MeshBuilderLike {
  lines = false
  data = [0, 0, 0, 0, 0, 1, 1, 1, 1, 0, 0, 1, 0, 1, 0, 0, 0, 0, 1, 1, 1, 1, 0, 0, 1, 0, 0, 1, 0, 0, 0, 1, 1, 1, 1, 0, 0, 1, 0]
  get count() { return 3 }
}

/** A camera whose view matrix is handed to it by the park renderer. */
class ParkCamera extends FreeCamera {
  readonly view = new Matrix()
  override _getViewMatrix(): Matrix { return this.view }
}

const dummyColor = (scene: Scene) => new RawTexture(new Uint8Array([255, 255, 255, 255]), 1, 1, Constants.TEXTUREFORMAT_RGBA, scene, false, false, Constants.TEXTURE_NEAREST_SAMPLINGMODE)

/**
 * Thrill Park 2's renderer backend on Babylon.js: WebGPU when the browser has
 * it, WebGL2 otherwise. The classic park renderer's draw calls are replayed into
 * pooled Babylon meshes each frame. The packed vertex format, the surface
 * shading (detail layers, ground, water, neon, sky light) and the thin-instance
 * layout are the classic ones, written in GLSL and WGSL, and so is the winding:
 * front faces are counter-clockwise, which every pooled mesh states because
 * Babylon defaults meshes in a right-handed scene to clockwise. Babylon adds
 * cascaded sun shadows (depth maps rendered by `RenderTargetTexture`s), lamp
 * lights, MSAA, bloom and grading through its default rendering pipeline,
 * and ambient occlusion on high through SSAO2 in geometry-buffer mode: its
 * default prepass mode reads depth and normals only prepass-capable materials
 * write, so it never saw these `ShaderMaterial`s, while the geometry buffer
 * draws every mesh again with its own shader and the standard `normal`
 * attribute, which the packed normal is bound as.
 */
export class BabylonBackend implements RenderBackend {
  readonly shadowsAvailable = true
  shadowPass = false
  shadowBias = 0.0005
  windLevel = 0
  api: 'webgpu' | 'webgl2' | 'none' = 'none'
  stats: BackendStats = { shadowDraws: 0, mainDraws: 0, shadowVerts: 0, mainVerts: 0, instanceBytes: 0 }

  private canvas: HTMLCanvasElement
  private engine: AbstractEngine | null = null
  private scene: Scene | null = null
  private camera: ParkCamera | null = null
  private ready = false
  private wgsl = false
  private scratch = runScratch()
  private matTable = materialTable()
  private globals = new Float32Array(G_ROWS * 4)
  private lampData = new Float32Array(LAMP_MAX * 4)
  private cascadeUniform = new Float32Array(16)
  private cascades: Float32Array[] = [new Float32Array(16), new Float32Array(16), new Float32Array(16)]
  private lightVp = new Float32Array(16)
  private focus = new Float32Array(3)
  private haveFocus = false
  private shadowTargets: RenderTargetTexture[] = []
  private shadowSlots: BaseTexture[] = []
  private detail: BaseTexture | null = null
  private detailLoaded = false
  private skyMaterial: ShaderMaterial | null = null
  private skyTop = new Vector3(0.3, 0.5, 0.9)
  private skyBottom = new Vector3(0.7, 0.8, 0.95)
  private invViewProj = new Matrix()
  private viewProj = new Matrix()
  private pipeline: DefaultRenderingPipeline | null = null
  private ssao: SSAO2RenderingPipeline | null = null
  private level = -1
  private wantLevel = 1
  private wantSince = 0
  private tier: Tier = TIERS[1]
  private meshes = new Set<ParkMesh>()
  private active = new Set<Pool>()
  private touched = new Set<Pool>()
  private activeShadow = new Set<Pool>()
  private touchedShadow = new Set<Pool>()
  private shadowDrawn: Draw[] = []
  private alphaCounter = 0
  private lastFrame = 0
  private slowFor = 0
  private fastFor = 0
  private scale = 1
  private capture = false
  private lampKey = ''
  private lampOrder: number[] = []
  private camPark = new Float32Array(3)
  private warm: { mesh: ParkMesh; frames: number } | null = null
  private renderErrors = 0
  private ssaoErrors = 0
  private ssaoFailed = false
  private viewInv = new Float32Array(16)

  constructor(canvas: HTMLCanvasElement) {
    this.canvas = canvas
    void this.init()
  }

  private async init() {
    try {
      let engine: AbstractEngine | null = null
      if (typeof navigator !== 'undefined' && 'gpu' in navigator && await WebGPUEngine.IsSupportedAsync) {
        try {
          const gpu = new WebGPUEngine(this.canvas, { antialias: false, adaptToDeviceRatio: false, powerPreference: 'high-performance', stencil: false, enableAllFeatures: false })
          await gpu.initAsync()
          engine = gpu
          this.api = 'webgpu'
          this.wgsl = true
        } catch (error) {
          console.warn('Thrill Park 2: WebGPU could not start, trying WebGL2.', error)
        }
      }
      if (!engine) {
        const gl = new Engine(this.canvas, false, { preserveDrawingBuffer: false, powerPreference: 'high-performance', stencil: false, alpha: false, adaptToDeviceRatio: false, disableWebGL2Support: false }, false)
        if (gl.webGLVersion < 2) throw new Error('Thrill Park 2 needs WebGL2 or WebGPU.')
        engine = gl
        this.api = 'webgl2'
      }
      this.engine = engine
      this.setup(engine)
      this.ready = true
    } catch (error) {
      console.error('Thrill Park 2 could not start its Babylon.js engine.', error)
    }
  }

  private setup(engine: AbstractEngine) {
    const scene = new Scene(engine)
    this.scene = scene
    scene.useRightHandedSystem = true
    scene.autoClear = true
    scene.clearColor = new Color4(0.4, 0.55, 0.8, 1)
    scene.skipPointerMovePicking = true
    scene.skipFrustumClipping = true
    scene.setRenderingAutoClearDepthStencil(MAIN_GROUP, true, true, true)
    const camera = new ParkCamera('park-camera', new Vector3(0, 0, 0), scene)
    camera.minZ = 0.4
    camera.maxZ = 2400
    camera.fov = 0.78
    camera.upVector = new Vector3(0, 0, 1)
    scene.activeCamera = camera
    this.camera = camera
    this.detail = this.makeDetail(scene)
    for (let i = 0; i < 3; i++) this.shadowSlots[i] = dummyColor(scene)
    this.makeSky(scene)
    this.applyLevel(this.wantLevel)
  }

  private makeDetail(scene: Scene): BaseTexture {
    const layers = this.scratch.detail
    if (!layers) return new RawTexture2DArray(new Uint8Array(4 * DETAIL_LAYERS), 1, 1, DETAIL_LAYERS, Constants.TEXTUREFORMAT_RGBA, scene, false, false, Constants.TEXTURE_NEAREST_SAMPLINGMODE)
    const size = DETAIL_SIZE * DETAIL_SIZE * 4
    const data = new Uint8Array(size * DETAIL_LAYERS)
    for (let i = 0; i < DETAIL_LAYERS; i++) data.set(layers[i], i * size)
    this.scratch.detail = null
    this.detailLoaded = true
    const texture = new RawTexture2DArray(data, DETAIL_SIZE, DETAIL_SIZE, DETAIL_LAYERS, Constants.TEXTUREFORMAT_RGBA, scene, true, false, Constants.TEXTURE_TRILINEAR_SAMPLINGMODE)
    texture.wrapU = Constants.TEXTURE_WRAP_ADDRESSMODE
    texture.wrapV = Constants.TEXTURE_WRAP_ADDRESSMODE
    texture.anisotropicFilteringLevel = 8
    return texture
  }

  private makeSky(scene: Scene) {
    const mesh = new Mesh('park-sky', scene)
    const geometry = new Geometry(Geometry.RandomId(), scene)
    const positions = new Float32Array([-1, -1, 0, 3, -1, 0, -1, 3, 0])
    geometry.setVerticesBuffer(new VertexBuffer(this.engine!, positions, VertexBuffer.PositionKind, { stride: 3, size: 3 }), 3)
    geometry.setIndices([0, 1, 2], 3)
    geometry.applyToMesh(mesh)
    mesh.alwaysSelectAsActiveMesh = true
    mesh.doNotSyncBoundingInfo = true
    mesh.isPickable = false
    mesh.renderingGroupId = 0
    const material = new ShaderMaterial('park-sky', scene, 'parkSky', {
      attributes: ['position'], uniforms: ['uG', 'uInvViewProj', 'uTop', 'uBottom'], shaderLanguage: this.wgsl ? ShaderLanguage.WGSL : ShaderLanguage.GLSL,
    })
    material.backFaceCulling = false
    material.disableDepthWrite = true
    material.setArray4('uG', this.globals as unknown as number[])
    material.setMatrix('uInvViewProj', this.invViewProj)
    material.setVector3('uTop', this.skyTop)
    material.setVector3('uBottom', this.skyBottom)
    mesh.material = material
    this.skyMaterial = material
  }

  private applyLevel(level: number) {
    if (level === this.level || !this.scene || !this.camera) return
    const lowChanged = (level === 0) !== (this.level === 0)
    this.level = level
    this.tier = TIERS[Math.max(0, Math.min(2, level))]
    const t = this.tier
    this.buildShadowTargets()
    this.pipeline?.dispose(); this.pipeline = null
    this.ssao?.dispose(); this.ssao = null
    if (t.frame) this.buildPipeline()
    if (lowChanged) {
      for (const pool of this.active) for (const d of pool.list) d.mesh.isVisible = false
      this.active.clear(); this.touched.clear()
      for (const m of this.meshes) for (const pool of m.pools.values()) pool.used = 0
    }
    this.globals[8 * 4 + 3] = 0
    this.globals[7 * 4 + 3] = t.frame ? 0 : 1
    this.globals[9 * 4 + 2] = t.shadowRes
    this.globals[9 * 4 + 3] = t.taps
    this.globals[9 * 4 + 0] = ZOOMS[1]
    this.globals[9 * 4 + 1] = ZOOMS[2]
    this.lampKey = ''
    if (lowChanged || !this.warm) this.prepareWarmup()
  }

  private buildShadowTargets() {
    const scene = this.scene!
    const t = this.tier
    for (const rtt of this.shadowTargets) { scene.customRenderTargets = scene.customRenderTargets.filter(x => x !== rtt); rtt.dispose() }
    this.shadowTargets = []
    for (let i = 0; i < 3; i++) {
      if (i >= t.cascades) { this.shadowSlots[i] = this.shadowSlots[i] instanceof RenderTargetTexture ? dummyColor(scene) : this.shadowSlots[i]; continue }
      const rtt = new RenderTargetTexture(`park-shadow-${i}`, t.shadowRes, scene, {
        generateMipMaps: false, type: Constants.TEXTURETYPE_UNSIGNED_BYTE, format: Constants.TEXTUREFORMAT_RGBA, samplingMode: Constants.TEXTURE_NEAREST_SAMPLINGMODE,
        generateDepthBuffer: true, generateStencilBuffer: false,
      })
      rtt.clearColor = new Color4(1, 1, 1, 1)
      rtt.wrapU = Constants.TEXTURE_CLAMP_ADDRESSMODE
      rtt.wrapV = Constants.TEXTURE_CLAMP_ADDRESSMODE
      rtt.refreshRate = RenderTargetTexture.REFRESHRATE_RENDER_ONCE
      rtt.renderList = []
      rtt.onBeforeRenderObservable.add(() => this.cascadeUniform.set(this.cascades[i]))
      scene.customRenderTargets.push(rtt)
      this.shadowTargets.push(rtt)
      this.shadowSlots[i] = rtt
    }
    for (const m of this.meshes) {
      for (const pool of m.shadowPools.values()) for (const d of pool.list) { d.mesh.dispose(); d.mat.dispose() }
      m.shadowPools.clear()
      for (const pool of m.pools.values()) for (const d of pool.list) for (let i = 0; i < 3; i++) d.mat.setTexture(`uShadow${i}`, this.shadowSlots[i])
    }
    this.activeShadow.clear(); this.touchedShadow.clear()
  }

  private buildPipeline() {
    const scene = this.scene!, camera = this.camera!, t = this.tier
    const pipeline = new DefaultRenderingPipeline('park-post', true, scene, [camera])
    pipeline.samples = t.samples
    pipeline.fxaaEnabled = false
    pipeline.bloomEnabled = t.bloom > 0
    pipeline.bloomThreshold = 1.15
    pipeline.bloomWeight = t.bloom * 2.6
    pipeline.bloomKernel = 56
    pipeline.bloomScale = 0.5
    pipeline.imageProcessingEnabled = true
    const ip = pipeline.imageProcessing
    ip.toneMappingEnabled = true
    ip.toneMappingType = ImageProcessingConfiguration.TONEMAPPING_ACES
    ip.exposure = 1
    if (t.grading) {
      ip.contrast = 1.04
      const curves = new ColorCurves()
      curves.globalSaturation = 16
      ip.colorCurvesEnabled = true
      ip.colorCurves = curves
      ip.vignetteEnabled = false
      ip.vignetteWeight = 1.1
      ip.vignetteStretch = 0
      ip.vignetteColor = new Color4(0, 0, 0, 0)
      ip.vignetteBlendMode = ImageProcessingConfiguration.VIGNETTEMODE_MULTIPLY
    }
    this.pipeline = pipeline
    if (t.ssao && !this.ssaoFailed) {
      try {
        const ssao = new SSAO2RenderingPipeline('park-ssao', scene, { ssaoRatio: 0.5, blurRatio: 1 }, [camera], true)
        ssao.radius = 3
        ssao.totalStrength = 0.3
        ssao.samples = 12
        ssao.maxZ = 250
        ssao.expensiveBlur = true
        this.ssao = ssao
        this.ssaoErrors = 0
      } catch (error) {
        this.ssaoFailed = true
        console.warn('Thrill Park 2: screen-space ambient occlusion is unavailable; baked occlusion is still used.', error)
      }
    }
  }

  private prepareWarmup() {
    if (this.warm) this.free(this.warm.mesh)
    const mesh = this.upload(new MeshBuilderLike() as unknown as MeshBuilder, null, true) as ParkMesh | null
    if (!mesh) return
    this.setInstances(mesh, new Float32Array([0, 0, 0, 0, 1, 1, 1, 1]), 1)
    this.warm = { mesh, frames: 3 }
  }

  private drawWarmup() {
    const w = this.warm, cam = this.camPark
    if (!w || w.frames <= 0) return
    w.frames--
    const model = new Float32Array([0.001, 0, 0, 0, 0, 0.001, 0, 0, 0, 0, 0.001, 0, cam[0], cam[1], cam[2] + 3, 1])
    for (const variant of [{}, { noCull: true }, { alpha: 0.5 }, { alpha: 0.5, noCull: true }, { noDepthWrite: true }] as DrawOptions[]) this.draw(w.mesh, model, variant)
    this.drawInstanced(w.mesh, {}); this.drawInstanced(w.mesh, { alpha: 0.5 })
  }

  setLevel(level: number) {
    if (level === this.wantLevel) return
    this.wantLevel = level
    this.wantSince = performance.now()
  }

  probe() { return this.scratch.probeMs * 1.6 }
  rendererName() { return this.scratch.renderer }

  upload(builder: MeshBuilder, previous?: MeshHandle | null, instanced = false): MeshHandle | null {
    if (previous) this.free(previous)
    if (!builder.count) return null
    const { vertices, indices, unique } = packMesh(builder)
    const data = new Uint8Array(vertices)
    const view = new DataView(data.buffer, data.byteOffset, data.byteLength)
    for (let i = 0; i < unique; i++) {
      const o = i * BYTES
      const ao = view.getInt8(o + 15)
      data[o + 22] = Math.round(Math.max(0, ao) / 127 * 255)
      data[o + 15] = 0
    }
    const handle: ParkMesh = {
      vertices: data, indices: indices as Uint16Array | Uint32Array, unique, lines: builder.lines, instanced, buffer: null, indexBuffer: null, indexCount: 0,
      pools: new Map(), shadowPools: new Map(), matrices: new Float32Array(16), tints: new Float32Array(4), capacity: 0, count: 0, version: 0,
    }
    this.meshes.add(handle)
    return handle
  }

  /**
   * One geometry per pooled mesh, over the buffers uploaded once per park mesh: Babylon keeps thin-instance buffers on a
   * mesh's geometry and disposes a geometry with its last mesh, so a shared one died with the shadow casters on a level change.
   */
  private geometryFor(m: ParkMesh): Geometry | null {
    if (!this.scene || !this.engine) return null
    const engine = this.engine
    if (!m.buffer || !m.indexBuffer) {
      if (!m.vertices || !m.indices) return null
      m.buffer = new BabylonBuffer(engine, m.vertices, false, BYTES, false, false, true)
      m.indexBuffer = engine.createIndexBuffer(m.indices)
      m.indexCount = m.indices.length
      m.vertices = null; m.indices = null
    }
    const buffer = m.buffer, geometry = new Geometry(Geometry.RandomId(), this.scene)
    const attribute = (kind: string, offset: number, size: number, type: number, normalized: boolean) =>
      new VertexBuffer(engine, buffer, kind, { offset, size, stride: BYTES, type, normalized, useBytes: true })
    geometry.setVerticesBuffer(attribute(VertexBuffer.PositionKind, 0, 3, VertexBuffer.FLOAT, false), m.unique)
    geometry.setVerticesBuffer(attribute(VertexBuffer.NormalKind, 12, 4, VertexBuffer.BYTE, true), m.unique)
    geometry.setVerticesBuffer(attribute(VertexBuffer.ColorKind, 16, 4, VertexBuffer.UNSIGNED_BYTE, true), m.unique)
    geometry.setVerticesBuffer(attribute('misc', 20, 4, VertexBuffer.UNSIGNED_BYTE, true), m.unique)
    m.indexBuffer.references++
    geometry.setIndexBuffer(m.indexBuffer, m.unique, m.indexCount, m.indexBuffer.is32Bits)
    return geometry
  }

  setInstances(handle: MeshHandle | null, data: Float32Array, count: number) {
    const m = handle as ParkMesh | null
    if (!m?.instanced) return
    if (count > m.capacity) {
      m.capacity = Math.max(count, Math.ceil(m.capacity * 1.5), 64)
      m.matrices = new Float32Array(m.capacity * 16)
      m.tints = new Float32Array(m.capacity * 4)
    }
    const mat = m.matrices, tint = m.tints
    for (let i = 0; i < count; i++) {
      const o = i * 8, p = i * 16, q = i * 4
      const k = data[o + 7], c = Math.cos(data[o + 3]) * k, s = Math.sin(data[o + 3]) * k
      mat[p] = c; mat[p + 1] = s; mat[p + 2] = 0; mat[p + 3] = 0
      mat[p + 4] = -s; mat[p + 5] = c; mat[p + 6] = 0; mat[p + 7] = 0
      mat[p + 8] = 0; mat[p + 9] = 0; mat[p + 10] = k; mat[p + 11] = 0
      mat[p + 12] = data[o]; mat[p + 13] = data[o + 1]; mat[p + 14] = data[o + 2]; mat[p + 15] = 1
      tint[q] = data[o + 4]; tint[q + 1] = data[o + 5]; tint[q + 2] = data[o + 6]; tint[q + 3] = 1
    }
    m.count = count
    m.version++
    this.stats.instanceBytes += count * 80
  }

  free(handle: MeshHandle) {
    const m = handle as ParkMesh
    for (const map of [m.pools, m.shadowPools]) {
      for (const pool of map.values()) {
        for (const d of pool.list) { d.mesh.dispose(false, false); d.mat.dispose() }
        this.active.delete(pool); this.touched.delete(pool); this.activeShadow.delete(pool); this.touchedShadow.delete(pool)
      }
      map.clear()
    }
    m.buffer?.dispose()
    if (m.indexBuffer) this.engine?._releaseBuffer(m.indexBuffer)
    m.buffer = null; m.indexBuffer = null
    this.meshes.delete(m)
    if (this.warm?.mesh === m) this.warm = null
  }

  private materialFor(depth: boolean, low: boolean, blend: boolean, cull: boolean, depthWrite: boolean, lines: boolean, d: { uD: Float32Array }) {
    const scene = this.scene!
    const mat = new ShaderMaterial(depth ? 'park-depth' : 'park', scene, depth ? 'parkDepth' : 'parkMain', {
      attributes: ['position', 'normal', 'color', 'misc'],
      uniforms: ['world', 'viewProjection', 'uG', 'uD', 'uMatA', 'uMatB', 'uL', 'uC'],
      samplers: depth ? [] : ['uDetail', 'uShadow0', 'uShadow1', 'uShadow2'],
      defines: low ? ['PARK_LOW'] : [],
      shaderLanguage: this.wgsl ? ShaderLanguage.WGSL : ShaderLanguage.GLSL,
      needAlphaBlending: blend,
    })
    mat.setArray4('uG', this.globals as unknown as number[])
    mat.setArray4('uD', d.uD as unknown as number[])
    if (depth) {
      mat.setArray4('uC', this.cascadeUniform as unknown as number[])
      mat.backFaceCulling = false
    } else {
      mat.setArray4('uMatA', this.matTable.a as unknown as number[])
      mat.setArray4('uMatB', this.matTable.b as unknown as number[])
      mat.setArray4('uL', this.lampData as unknown as number[])
      mat.setTexture('uDetail', this.detail!)
      for (let i = 0; i < 3; i++) mat.setTexture(`uShadow${i}`, this.shadowSlots[i])
      mat.backFaceCulling = cull
      mat.disableDepthWrite = !depthWrite
      if (blend) mat.alphaMode = Constants.ALPHA_COMBINE
      if (lines) mat.fillMode = Material.LineListDrawMode
    }
    return mat
  }

  private pool(m: ParkMesh, shadow: boolean, blend: boolean, cull: boolean, depthWrite: boolean): Draw | null {
    const low = this.level === 0
    const key = `${low ? 'l' : 's'}${blend ? 1 : 0}${cull ? 1 : 0}${depthWrite ? 1 : 0}`
    const map = shadow ? m.shadowPools : m.pools
    let pool = map.get(key)
    if (!pool) { pool = { list: [], used: 0 }; map.set(key, pool) }
    if (pool.used === pool.list.length) {
      const geometry = this.geometryFor(m)
      if (!geometry) return null
      const mesh = new Mesh(shadow ? 'park-caster' : 'park-draw', this.scene!)
      geometry.applyToMesh(mesh)
      mesh.sideOrientation = Material.CounterClockWiseSideOrientation
      mesh.alwaysSelectAsActiveMesh = true
      mesh.doNotSyncBoundingInfo = true
      mesh.isPickable = false
      mesh.renderingGroupId = MAIN_GROUP
      mesh.isVisible = shadow
      const world = Matrix.Identity()
      mesh.freezeWorldMatrix(world)
      if (shadow) mesh.layerMask = SHADOW_LAYER
      const draw: Draw = { mesh, mat: null as unknown as ShaderMaterial, uD: new Float32Array(D_ROWS * 4), world, cap: -1, version: -1 }
      draw.mat = this.materialFor(shadow, low, blend, cull, depthWrite, m.lines, draw)
      mesh.material = draw.mat
      pool.list.push(draw)
    }
    const draw = pool.list[pool.used++]
    ;(shadow ? this.touchedShadow : this.touched).add(pool)
    return draw
  }

  private syncInstances(m: ParkMesh, d: Draw) {
    const mesh = d.mesh
    if (d.cap !== m.capacity) {
      mesh.thinInstanceSetBuffer('matrix', m.matrices, 16, false)
      mesh.thinInstanceSetBuffer('instanceColor', m.tints, 4, false)
      d.cap = m.capacity; d.version = m.version
    } else if (d.version !== m.version) {
      mesh.thinInstanceBufferUpdated('matrix')
      mesh.thinInstanceBufferUpdated('instanceColor')
      d.version = m.version
    }
    mesh.thinInstanceCount = m.count
  }

  beginShadow(lightViewProj: Mat4, texelWorld: number): boolean {
    if (!this.ready || !this.scene) return false
    this.shadowPass = true
    this.shadowDrawn.length = 0
    this.lightVp.set(lightViewProj)
    const count = this.tier.cascades, res = this.tier.shadowRes
    const l = this.lightVp
    const fx = this.haveFocus ? l[0] * this.focus[0] + l[4] * this.focus[1] + l[8] * this.focus[2] + l[12] : 0
    const fy = this.haveFocus ? l[1] * this.focus[0] + l[5] * this.focus[1] + l[9] * this.focus[2] + l[13] : 0
    for (let c = 0; c < count; c++) {
      const out = this.cascades[c]
      out.set(l)
      if (c === 0) continue
      const zoom = ZOOMS[c], step = 2 / (res * zoom)
      const cx = Math.round(Math.max(-1, Math.min(1, fx)) / step) * step, cy = Math.round(Math.max(-1, Math.min(1, fy)) / step) * step
      for (let col = 0; col < 4; col++) {
        out[col * 4] = l[col * 4] * zoom
        out[col * 4 + 1] = l[col * 4 + 1] * zoom
      }
      out[12] = (l[12] - cx) * zoom
      out[13] = (l[13] - cy) * zoom
    }
    for (let c = 0; c < 3; c++) this.globals.set(this.cascades[c], (10 + c * 4) * 4)
    this.globals[8 * 4 + 0] = this.shadowBias
    this.globals[8 * 4 + 1] = texelWorld
    this.globals[8 * 4 + 2] = count
    return true
  }

  endShadow() {
    this.shadowPass = false
    for (const rtt of this.shadowTargets) {
      rtt.renderList = this.shadowDrawn.map(d => d.mesh)
      rtt.resetRefreshCounter()
    }
  }

  beginPost() { this.capture = true; return false }
  freePost() {}

  begin(width: number, height: number, view: Mat4, proj: Mat4, cam: Vec3, light: Lighting, time: number, shadowStrength = 0) {
    this.touched.clear()
    if (!this.ready || !this.scene || !this.engine || !this.camera) { this.stats.mainDraws = 0; this.stats.mainVerts = 0; return }
    const now = performance.now()
    if (this.wantLevel !== this.level && now - this.wantSince > 800) this.applyLevel(this.wantLevel)
    this.adapt(now)
    const scale = this.pipeline && !this.capture ? this.scale : 1
    const tw = Math.max(1, Math.round(width * scale)), th = Math.max(1, Math.round(height * scale))
    if (this.canvas.width !== tw || this.canvas.height !== th) this.engine.setSize(tw, th)
    const camera = this.camera
    const tan = 1 / proj[5]
    camera.fov = 2 * Math.atan(tan)
    camera.minZ = proj[14] / (proj[10] - 1)
    camera.maxZ = proj[14] / (proj[10] + 1)
    Matrix.FromArrayToRef(view, 0, camera.view)
    camera.position.set(cam[0], cam[1], cam[2])
    this.camPark[0] = cam[0]; this.camPark[1] = cam[1]; this.camPark[2] = cam[2]
    const inv = this.invertView(view)
    if (inv) {
      const fx = -inv[8], fy = -inv[9], fz = -inv[10]
      let t = fz < -0.02 ? -cam[2] / fz : 40
      t = Math.max(8, Math.min(420, t))
      this.focus[0] = cam[0] + fx * t; this.focus[1] = cam[1] + fy * t; this.focus[2] = cam[2] + fz * t
      this.haveFocus = true
    }
    camera.getViewMatrix(true)
    const projection = camera.getProjectionMatrix(true)
    camera.view.multiplyToRef(projection, this.viewProj)
    this.viewProj.invertToRef(this.invViewProj)
    this.invViewProj.markAsUpdated()
    this.writeLight(light, time, shadowStrength)
    this.stats.mainDraws = 0; this.stats.mainVerts = 0
    this.alphaCounter = 0
  }

  private invertView(view: Mat4) {
    const m = view, o = this.viewInv
    const a00 = m[0], a01 = m[1], a02 = m[2], a10 = m[4], a11 = m[5], a12 = m[6], a20 = m[8], a21 = m[9], a22 = m[10]
    o.fill(0)
    o[0] = a00; o[1] = a10; o[2] = a20
    o[4] = a01; o[5] = a11; o[6] = a21
    o[8] = a02; o[9] = a12; o[10] = a22
    o[12] = -(m[12] * a00 + m[13] * a01 + m[14] * a02)
    o[13] = -(m[12] * a10 + m[13] * a11 + m[14] * a12)
    o[14] = -(m[12] * a20 + m[13] * a21 + m[14] * a22)
    o[15] = 1
    return o
  }

  private writeLight(light: Lighting, time: number, shadowStrength: number) {
    const g = this.globals, s = light.sunDir
    const set = (row: number, v: ArrayLike<number>, w: number) => { g[row * 4] = v[0]; g[row * 4 + 1] = v[1]; g[row * 4 + 2] = v[2]; g[row * 4 + 3] = w }
    set(0, s, shadowStrength)
    set(1, light.sunColor, light.neon ?? 0.6)
    set(2, light.sky, light.exposure * BRIGHTNESS)
    set(3, light.ground, time)
    set(4, light.horizon, light.fogDensity > 0 ? light.fogDensity : this.tier.haze * (light.wind > 0.1 ? 1.8 : 1))
    set(5, light.fog, light.fogFalloff)
    set(6, light.sunScatter, this.detailLoaded ? 1 : 0)
    set(7, this.camPark, this.tier.frame ? 0 : 1)
    g[22 * 4] = Math.max(0, this.tier.fx - (this.scale < 0.75 ? 1 : 0))
    this.windLevel = light.wind
    if (this.skyMaterial) {
      this.skyTop.set(light.skyTop[0], light.skyTop[1], light.skyTop[2])
      this.skyBottom.set(light.skyBottom[0], light.skyBottom[1], light.skyBottom[2])
    }
    if (this.scene) this.scene.clearColor = new Color4(light.fog[0], light.fog[1], light.fog[2], 1)
    if (this.pipeline) this.pipeline.imageProcessing.exposure = light.exposure * BRIGHTNESS
  }

  /** Lowers the render scale while frames run slow and raises it back when they recover. */
  private adapt(now: number) {
    const dt = this.lastFrame ? now - this.lastFrame : 16
    this.lastFrame = now
    if (!this.pipeline || dt > 250) return
    if (dt > 21) { this.slowFor += dt; this.fastFor = 0 } else if (dt < 15) { this.fastFor += dt; this.slowFor = Math.max(0, this.slowFor - dt) }
    if (this.slowFor > 1500 && this.scale > 0.6) { this.scale = Math.max(0.6, this.scale - 0.1); this.slowFor = 0 }
    if (this.fastFor > 5000 && this.scale < 1) { this.scale = Math.min(1, this.scale + 0.05); this.fastFor = 0 }
  }

  draw(handle: MeshHandle | null, model?: Mat4, opts: DrawOptions = {}) {
    const m = handle as ParkMesh | null
    if (!m || !this.ready) return
    const blend = opts.alpha !== undefined && opts.alpha < 1
    if (this.shadowPass) {
      if (blend || opts.unlit || m.lines || (opts.ground && this.level !== 2)) return
      const d = this.pool(m, true, false, false, true)
      if (!d) return
      this.writeDraw(d, model, opts, blend)
      this.shadowDrawn.push(d)
      this.stats.shadowDraws++
      return
    }
    const d = this.pool(m, false, blend, !opts.noCull, !blend && !opts.noDepthWrite)
    if (!d) return
    this.writeDraw(d, model, opts, blend)
    d.mesh.alphaIndex = this.alphaCounter++
    d.mesh.isVisible = true
    this.stats.mainDraws++
  }

  private writeDraw(d: Draw, model: Mat4 | undefined, opts: DrawOptions, blend: boolean) {
    if (model) Matrix.FromArrayToRef(model, 0, d.world)
    else Matrix.IdentityToRef(d.world)
    const u = d.uD
    const tint = opts.tint ?? opts.slots?.[0] ?? null
    u[0] = tint ? tint[0] : 1; u[1] = tint ? tint[1] : 1; u[2] = tint ? tint[2] : 1; u[3] = blend ? opts.alpha! : 1
    u[4] = opts.emissive ?? 0; u[5] = opts.unlit ? 1 : 0; u[6] = opts.wave ?? 0; u[7] = 0
    u[8] = opts.ground ?? 0; u[9] = opts.specular ?? 1; u[10] = 0; u[11] = 0
    const h = opts.highlight
    u[12] = h ? h[0] : 0; u[13] = h ? h[1] : 0; u[14] = h ? h[2] : 0; u[15] = h ? h[3] : 0
    for (let i = 0; i < 9; i++) {
      const c = opts.slots?.[i + 1], o = 16 + i * 4
      u[o] = c ? c[0] : SLOT_DEFAULT; u[o + 1] = c ? c[1] : SLOT_DEFAULT; u[o + 2] = c ? c[2] : SLOT_DEFAULT; u[o + 3] = 0
    }
  }

  drawInstanced(handle: MeshHandle | null, opts: InstancedDrawOptions = {}) {
    const m = handle as ParkMesh | null
    if (!m || !m.instanced || !m.count || !this.ready) return
    const blend = opts.alpha !== undefined && opts.alpha < 1
    if (this.shadowPass && (blend || opts.emissive)) return
    const d = this.pool(m, this.shadowPass, blend, true, !blend)
    if (!d) return
    Matrix.IdentityToRef(d.world)
    const u = d.uD
    u[0] = 1; u[1] = 1; u[2] = 1; u[3] = blend ? opts.alpha! : 1
    u[4] = opts.emissive ?? 0; u[5] = 0; u[6] = 0; u[7] = opts.wind ? opts.wind * this.windLevel : 0
    u[8] = 0; u[9] = opts.specular ?? 1; u[10] = 0; u[11] = 0
    u[12] = 0; u[13] = 0; u[14] = 0; u[15] = 0
    for (let i = 16; i < D_ROWS * 4; i++) u[i] = SLOT_DEFAULT
    this.syncInstances(m, d)
    if (this.shadowPass) { this.shadowDrawn.push(d); this.stats.shadowDraws++; return }
    d.mesh.alphaIndex = this.alphaCounter++
    d.mesh.isVisible = true
    this.stats.mainDraws++
  }

  /** Lights the lamp posts nearest the camera at night; re-picks them only when the camera or the lamps move. */
  lamps(data: Float32Array, count: number, night: boolean) {
    const limit = Math.min(this.tier.lamps, LAMP_MAX)
    if (!night || !count) { this.globals[8 * 4 + 3] = 0; this.lampKey = ''; return }
    const cx = this.camPark[0], cy = this.camPark[1]
    const key = `${count}:${Math.round(cx / 8)}:${Math.round(cy / 8)}:${data[0]}:${data[(count - 1) * 8]}:${limit}`
    if (key === this.lampKey) { this.globals[8 * 4 + 3] = Math.min(count, limit); return }
    this.lampKey = key
    const order = this.lampOrder
    order.length = count
    for (let i = 0; i < count; i++) order[i] = i
    if (count > limit) {
      const d2 = (i: number) => { const dx = data[i * 8] - cx, dy = data[i * 8 + 1] - cy; return dx * dx + dy * dy }
      order.sort((a, b) => d2(a) - d2(b))
    }
    const n = Math.min(count, limit)
    for (let k = 0; k < n; k++) {
      const i = order[k] * 8
      this.lampData[k * 4] = data[i] - 1.5; this.lampData[k * 4 + 1] = data[i + 1] - 1.5; this.lampData[k * 4 + 2] = data[i + 2] + 3.5; this.lampData[k * 4 + 3] = 0
    }
    this.globals[8 * 4 + 3] = n
  }

  endPost() {
    this.capture = false
    if (!this.ready || !this.scene || !this.engine) return
    this.drawWarmup()
    for (const pool of this.active) if (!this.touched.has(pool)) for (const d of pool.list) d.mesh.isVisible = false
    for (const pool of this.touched) { for (let i = pool.used; i < pool.list.length; i++) pool.list[i].mesh.isVisible = false; pool.used = 0 }
    const swap = this.active; this.active = this.touched; this.touched = swap; this.touched.clear()
    for (const pool of this.touchedShadow) pool.used = 0
    this.touchedShadow.clear()
    this.render()
  }

  private render() {
    const engine = this.engine!, scene = this.scene!
    try {
      engine.beginFrame()
      scene.render()
      engine.endFrame()
      this.renderErrors = 0
      this.ssaoErrors = 0
    } catch (error) {
      this.renderErrors++
      if (this.ssao && ++this.ssaoErrors > 5) {
        console.warn('Thrill Park 2: ambient occlusion kept failing and was turned off.', error)
        this.ssaoFailed = true
        this.ssao.dispose(); this.ssao = null
      } else if (!this.ssao && (this.renderErrors === 1 || this.renderErrors === 120)) {
        console.error('Thrill Park 2 could not draw a frame.', error)
      }
    }
  }

  dispose() {
    for (const m of [...this.meshes]) this.free(m)
    this.pipeline?.dispose()
    this.ssao?.dispose()
    this.scene?.dispose()
    this.engine?.dispose()
    this.ready = false
  }
}
