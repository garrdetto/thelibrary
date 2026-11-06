import { Camera } from '@babylonjs/core/Cameras/camera'
import type { AbstractEngine } from '@babylonjs/core/Engines/abstractEngine'
import { Constants } from '@babylonjs/core/Engines/constants'
import { DirectionalLight } from '@babylonjs/core/Lights/directionalLight'
import { HemisphericLight } from '@babylonjs/core/Lights/hemisphericLight'
import { ShadowGenerator } from '@babylonjs/core/Lights/Shadows/shadowGenerator'
import '@babylonjs/core/Lights/Shadows/shadowGeneratorSceneComponent'
import { ImageProcessingConfiguration } from '@babylonjs/core/Materials/imageProcessingConfiguration'
import { Material } from '@babylonjs/core/Materials/material'
import { PBRMaterial } from '@babylonjs/core/Materials/PBR/pbrMaterial'
import '@babylonjs/core/Materials/Textures/baseTexture.polynomial'
import { RenderTargetTexture } from '@babylonjs/core/Materials/Textures/renderTargetTexture'
import { Color3, Color4 } from '@babylonjs/core/Maths/math.color'
import { Frustum } from '@babylonjs/core/Maths/math.frustum'
import type { Plane } from '@babylonjs/core/Maths/math.plane'
import { Matrix, Vector3 } from '@babylonjs/core/Maths/math.vector'
import { Viewport } from '@babylonjs/core/Maths/math.viewport'
import { SphericalHarmonics, SphericalPolynomial } from '@babylonjs/core/Maths/sphericalPolynomial'
import { Mesh } from '@babylonjs/core/Meshes/mesh'
import { VertexData } from '@babylonjs/core/Meshes/mesh.vertexData'
import { DefaultRenderingPipeline } from '@babylonjs/core/PostProcesses/RenderPipeline/Pipelines/defaultRenderingPipeline'
import { ReflectionProbe } from '@babylonjs/core/Probes/reflectionProbe'
import { Scene } from '@babylonjs/core/scene'
import type * as THREE from 'three'
import { createEngine, createPhysics } from '../boot'
import type { NextStatus } from '../boot'
import { ThreeBridge } from './bridge'
import { bakeSky, directionAt, makeSkyFunction, skyDome } from './sky'
import type { SkyParams } from './sky'

/**
 * three's conventions in Babylon's terms, fitted to the classic reference screenshots (all five tracks, day and
 * night): three's ACES pre-scales exposure by 1/0.6; its lights and image-based light land at the factors below of
 * Babylon's for the same intensity; car paint reflects the night environment at `nightPaint`.
 */
const CAL = { sun: 0.432, hemi: 0.432, exposure: 1 / 0.6, env: 1.224, nightPaint: 0.6 }

const MIRROR_LAYER = 0x10000000
const SCENE_LAYER = 0x0fffffff
const WEBGPU_FIRST_FRAME_MS = 6000

/** A Babylon camera whose view comes straight from a three.js camera's world matrix. */
class ThreeCamera extends Camera {
  private readonly view = Matrix.Identity()

  copyFrom(cam: THREE.PerspectiveCamera): void {
    Matrix.FromArrayToRef(cam.matrixWorldInverse.elements, 0, this.view)
    const e = cam.matrixWorld.elements
    this.position.set(e[12], e[13], e[14])
    this.fov = (cam.fov * Math.PI) / 180
    this.minZ = cam.near
    this.maxZ = cam.far
  }

  override _getViewMatrix(): Matrix {
    return this.view
  }

  override _isSynchronizedViewMatrix(): boolean {
    return false
  }
}

export type FrameOptions = {
  exposure: number
  bloom: { enabled: boolean; strength: number; threshold: number; radius: number }
  shadows: boolean
  shadowSize: number
  night: boolean
  /** The rear-view mirror rectangle in CSS pixels from the top left, or null when it is hidden. */
  mirror: { x: number; y: number; w: number; h: number } | null
}

export type ThreeInputs = {
  scene: THREE.Scene
  camera: THREE.PerspectiveCamera
  mirrorCam: THREE.PerspectiveCamera
  sun: THREE.DirectionalLight
  hemi: THREE.HemisphereLight
  skyDay: THREE.Object3D
  sky: SkyParams
  /** The colour of the ground the classic day reflection map was rendered with (linear). */
  ground: [number, number, number]
}

/**
 * Runs the classic module's three.js scene on Babylon (`?engine=next`, Phase 2 of docs/shorttrack/PLAN.md): WebGPU
 * with a WebGL2 fallback, an HDR pipeline with ACES and bloom, a baked Preetham sky with matching image-based light,
 * the sun's shadow map, fog and the rear-view mirror. `window.__stNext` reports the backend, Havok and frames.
 */
export class Presenter {
  readonly scene: Scene
  readonly status: NextStatus
  private readonly camera: ThreeCamera
  private readonly mirrorCamera: ThreeCamera
  private readonly overlayCamera: Camera
  private readonly sun: DirectionalLight
  private readonly hemi: HemisphericLight
  private readonly pipeline: DefaultRenderingPipeline
  private readonly shadows: ShadowGenerator
  private readonly bridge: ThreeBridge
  private readonly mirror: RenderTargetTexture
  private readonly mirrorIp: ImageProcessingConfiguration
  private inputs: ThreeInputs | null = null
  private dome: Mesh | null = null
  private probe: ReflectionProbe | null = null
  private pixelRatio = 1
  private mirrorOn = false
  private envIntensity = 1
  private envScale = 1

  constructor(readonly engine: AbstractEngine, status: NextStatus) {
    this.status = status
    const scene = new Scene(engine)
    this.scene = scene
    scene.useRightHandedSystem = true
    scene.clearColor = new Color4(0, 0, 0, 1)
    scene.ambientColor = new Color3(0, 0, 0)
    this.camera = new ThreeCamera('main', Vector3.Zero(), scene)
    this.camera.layerMask = SCENE_LAYER
    this.mirrorCamera = new ThreeCamera('mirror', Vector3.Zero(), scene)
    this.mirrorCamera.layerMask = SCENE_LAYER
    this.overlayCamera = new Camera('overlay', new Vector3(0, 0, 1), scene)
    this.overlayCamera.mode = Camera.ORTHOGRAPHIC_CAMERA
    Object.assign(this.overlayCamera, { orthoLeft: -0.5, orthoRight: 0.5, orthoTop: 0.5, orthoBottom: -0.5, minZ: 0.01, maxZ: 10 })
    this.overlayCamera.layerMask = MIRROR_LAYER
    scene.activeCameras = [this.camera]

    this.sun = new DirectionalLight('sun', new Vector3(-0.5, -1, -0.3), scene)
    this.sun.autoUpdateExtends = false
    this.sun.autoCalcShadowZBounds = false
    this.hemi = new HemisphericLight('hemi', new Vector3(0, 1, 0), scene)
    this.shadows = new ShadowGenerator(2048, this.sun)
    this.shadows.usePercentageCloserFiltering = true
    this.shadows.filteringQuality = ShadowGenerator.QUALITY_MEDIUM

    this.pipeline = new DefaultRenderingPipeline('main', true, scene, [this.camera])
    this.pipeline.samples = 4
    this.pipeline.fxaaEnabled = false
    this.pipeline.imageProcessingEnabled = true
    const ip = this.pipeline.imageProcessing
    ip.toneMappingEnabled = true
    ip.toneMappingType = ImageProcessingConfiguration.TONEMAPPING_ACES
    ip.contrast = 1
    this.pipeline.bloomKernel = 64
    this.pipeline.bloomScale = 0.5

    this.bridge = new ThreeBridge(scene, () => ({ intensity: this.envIntensity, scale: this.envScale }))

    this.mirror = new RenderTargetTexture('mirror', { width: 512, height: 128 }, scene, false, true, Constants.TEXTURETYPE_HALF_FLOAT)
    this.mirror.activeCamera = this.mirrorCamera
    this.mirror.samples = 2
    this.mirror.gammaSpace = false
    const mirrorIp = new ImageProcessingConfiguration()
    this.mirrorIp = mirrorIp
    mirrorIp.toneMappingEnabled = true
    mirrorIp.toneMappingType = ImageProcessingConfiguration.TONEMAPPING_ACES
    mirrorIp.applyByPostProcess = false
    this.makeMirrorQuad()
  }

  private makeMirrorQuad(): Mesh {
    const quad = new Mesh('mirror-quad', this.scene)
    const data = new VertexData()
    data.positions = [-0.5, -0.5, 0, 0.5, -0.5, 0, 0.5, 0.5, 0, -0.5, 0.5, 0]
    data.normals = [0, 0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1]
    data.uvs = [1, 0, 0, 0, 0, 1, 1, 1]
    data.indices = [0, 1, 2, 0, 2, 3]
    data.applyToMesh(quad)
    const mat = new PBRMaterial('mirror-quad', this.scene)
    mat.unlit = true
    mat.albedoTexture = this.mirror
    mat.albedoColor = new Color3(1, 1, 1)
    mat.imageProcessingConfiguration = this.mirrorIp
    mat.backFaceCulling = false
    mat.fogEnabled = false
    mat.sideOrientation = Material.CounterClockWiseSideOrientation
    quad.material = mat
    quad.layerMask = MIRROR_LAYER
    quad.position.z = -1
    quad.isPickable = false
    return quad
  }

  /** Hooks up the classic module's three.js objects and bakes the day sky and its lighting. */
  attach(inputs: ThreeInputs): void {
    this.inputs = inputs
    const texture = bakeSky(this.scene, inputs.sky)
    this.dome = skyDome(this.scene, texture, 1500)
    this.dome.layerMask = SCENE_LAYER
    this.probe = new ReflectionProbe('day-env', 128, this.scene, true, true)
    this.probe.renderList!.push(this.dome)
    this.probe.refreshRate = RenderTargetTexture.REFRESHRATE_RENDER_ONCE
    this.probe.cubeTexture.sphericalPolynomial = this.irradiance(inputs)
    this.scene.environmentTexture = this.probe.cubeTexture
  }

  /** Diffuse light of the day sky above the horizon and the ground below, as Babylon's spherical polynomial. */
  private irradiance(inputs: ThreeInputs): SphericalPolynomial {
    const radiance = makeSkyFunction(inputs.sky), sh = new SphericalHarmonics(), W = 64, H = 32
    let total = 0
    const dir = new Vector3(), col = new Color3()
    for (let r = 0; r < H; r++) {
      const v = (r + 0.5) / H, solid = ((Math.PI * 2) / W) * (Math.PI / H) * Math.sin(v * Math.PI)
      for (let c = 0; c < W; c++) {
        const d = directionAt((c + 0.5) / W, v)
        const L = d[1] >= 0 ? radiance(d) : inputs.ground
        dir.set(d[0], d[1], d[2])
        col.set(L[0], L[1], L[2])
        sh.addLight(dir, col, solid)
        total += solid
      }
    }
    // the sun disc is far smaller than a sample but carries much of the sky's light; add it on its own
    const sl = Math.hypot(...inputs.sky.sun), sd: [number, number, number] = [inputs.sky.sun[0] / sl, inputs.sky.sun[1] / sl, inputs.sky.sun[2] / sl]
    const disc = radiance(sd), discSolid = 2 * Math.PI * (1 - 0.9999566769464484) * 0.6
    sh.addLight(dir.set(sd[0], sd[1], sd[2]), col.set(disc[0], disc[1], disc[2]), discSolid)
    total += discSolid
    sh.scaleInPlace((4 * Math.PI) / total)
    sh.convertIncidentRadianceToIrradiance()
    sh.convertIrradianceToLambertianRadiance()
    return SphericalPolynomial.FromHarmonics(sh)
  }

  setPixelRatio(ratio: number): void {
    this.pixelRatio = ratio
    this.engine.setHardwareScalingLevel((window.devicePixelRatio || 1) / ratio)
  }

  getPixelRatio(): number {
    return this.pixelRatio
  }

  resize(): void {
    this.engine.resize()
  }

  /** Draws one frame of the three.js scene. */
  frame(o: FrameOptions): void {
    const t = this.inputs
    if (!t) return
    t.scene.updateMatrixWorld()
    t.camera.updateMatrixWorld()
    t.mirrorCam.updateMatrixWorld()
    this.envIntensity = o.night ? 0 : (t.scene.environmentIntensity ?? 1) * CAL.env
    this.envScale = (o.night ? CAL.nightPaint : 1) * CAL.env
    this.bridge.sync(t.scene)
    this.camera.copyFrom(t.camera)
    this.syncLights(t, o)
    this.syncFog(t)
    if (this.dome) this.dome.isVisible = t.skyDay.visible
    const ip = this.pipeline.imageProcessing
    ip.exposure = o.exposure * CAL.exposure
    this.pipeline.bloomEnabled = o.bloom.enabled
    this.pipeline.bloomThreshold = o.bloom.threshold
    this.pipeline.bloomWeight = o.bloom.strength
    this.syncMirror(t, o)
    this.engine.beginFrame()
    this.scene.render()
    this.engine.endFrame()
    this.status.frames += 1
    if (this.status.frames % 30 === 0) this.status.fps = Math.round(this.engine.getFps())
  }

  private syncLights(t: ThreeInputs, o: FrameOptions): void {
    const s = t.sun, p = s.position, q = s.target.position
    this.sun.position.set(p.x, p.y, p.z)
    this.sun.direction.set(q.x - p.x, q.y - p.y, q.z - p.z).normalize()
    this.sun.diffuse.set(s.color.r, s.color.g, s.color.b)
    this.sun.specular.copyFrom(this.sun.diffuse)
    this.sun.intensity = s.intensity * CAL.sun
    const sc = s.shadow.camera
    this.sun.orthoLeft = sc.left
    this.sun.orthoRight = sc.right
    this.sun.orthoTop = sc.top
    this.sun.orthoBottom = sc.bottom
    this.sun.shadowMinZ = sc.near
    this.sun.shadowMaxZ = sc.far
    this.sun.shadowEnabled = o.shadows && s.castShadow
    const map = this.shadows.getShadowMap()!
    if (map.getSize().width !== o.shadowSize) map.resize(o.shadowSize)
    this.shadows.bias = Math.abs(s.shadow.bias) * 2
    this.shadows.normalBias = s.shadow.normalBias
    map.renderList = this.sun.shadowEnabled ? this.inShadowBox(sc) : []
    const h = t.hemi
    this.hemi.diffuse.set(h.color.r, h.color.g, h.color.b)
    this.hemi.groundColor.set(h.groundColor.r, h.groundColor.g, h.groundColor.b)
    this.hemi.specular.set(0, 0, 0)
    this.hemi.intensity = h.intensity * CAL.hemi
  }

  private readonly lightView = Matrix.Identity()
  private readonly lightTarget = new Vector3()
  private readonly local = new Vector3()

  /** Casters inside the sun's shadow box, as three culls its shadow camera; the rest would only cost draws. */
  private inShadowBox(sc: THREE.OrthographicCamera): Mesh[] {
    this.lightTarget.copyFrom(this.sun.position).addInPlace(this.sun.direction)
    Matrix.LookAtRHToRef(this.sun.position, this.lightTarget, Vector3.Up(), this.lightView)
    const out: Mesh[] = []
    for (const mesh of this.bridge.casters) {
      if (mesh.alwaysSelectAsActiveMesh) {
        out.push(mesh)
        continue
      }
      const sphere = mesh.getBoundingInfo().boundingSphere, r = sphere.radiusWorld
      Vector3.TransformCoordinatesToRef(sphere.centerWorld, this.lightView, this.local)
      const depth = -this.local.z
      if (this.local.x + r < sc.left || this.local.x - r > sc.right || this.local.y + r < sc.bottom || this.local.y - r > sc.top || depth + r < sc.near || depth - r > sc.far) continue
      out.push(mesh)
    }
    return out
  }

  private mirrorPlanes: Plane[] = []

  /** Visible meshes inside the mirror camera's view (a render list is drawn without the scene's culling). */
  private inMirrorView(): Mesh[] {
    this.mirrorPlanes = Frustum.GetPlanes(this.mirrorCamera.getTransformationMatrix())
    const out: Mesh[] = []
    for (const m of this.scene.meshes) {
      if (!(m.layerMask & SCENE_LAYER) || !m.isVisible || !m.isEnabled()) continue
      if (m.alwaysSelectAsActiveMesh || m.infiniteDistance || m.isInFrustum(this.mirrorPlanes)) out.push(m as Mesh)
    }
    return out
  }

  private syncFog(t: ThreeInputs): void {
    const fog = t.scene.fog as THREE.Fog | null
    if (!fog) {
      this.scene.fogMode = Scene.FOGMODE_NONE
      return
    }
    this.scene.fogMode = Scene.FOGMODE_LINEAR
    this.scene.fogStart = fog.near
    this.scene.fogEnd = fog.far
    this.scene.fogColor.set(fog.color.r, fog.color.g, fog.color.b)
  }

  private syncMirror(t: ThreeInputs, o: FrameOptions): void {
    const on = !!o.mirror
    if (on !== this.mirrorOn) {
      this.mirrorOn = on
      const list = this.scene.customRenderTargets
      if (on) list.push(this.mirror)
      else list.splice(list.indexOf(this.mirror), 1)
      this.scene.activeCameras = on ? [this.camera, this.overlayCamera] : [this.camera]
    }
    if (!o.mirror) return
    this.mirrorCamera.copyFrom(t.mirrorCam)
    this.mirror.renderList = this.inMirrorView()
    const canvas = this.engine.getRenderingCanvas()!, cw = canvas.clientWidth || 1, ch = canvas.clientHeight || 1
    const r = o.mirror
    this.overlayCamera.viewport = new Viewport(r.x / cw, 1 - (r.y + r.h) / ch, r.w / cw, r.h / ch)
    this.mirrorIp.exposure = o.exposure * CAL.exposure
  }

  /** Which three.js meshes the bridge could not draw (custom shaders), for the console. */
  skipped(): string[] {
    return [...this.bridge.skipped]
  }
}

/** Starts Babylon on the classic module's canvas; resolves once the engine (and Havok) are ready. */
export async function createPresenter(canvas: HTMLCanvasElement): Promise<Presenter> {
  const params = new URLSearchParams(location.search)
  const status: NextStatus = { backend: null, physics: null, frames: 0, fps: 0, error: null, fellBack: params.get('fallback') === '1' }
  window.__stNext = status
  try {
    const { engine, backend } = await createEngine(canvas, params.get('gpu'))
    status.backend = backend
    const presenter = new Presenter(engine, status)
    const toWebGl = (reason: string) => {
      if (backend !== 'webgpu') return
      console.warn(`${reason}, reloading on WebGL2`)
      const q = new URLSearchParams(location.search)
      q.set('gpu', 'webgl')
      q.set('fallback', '1')
      location.replace(`${location.pathname}?${q}`)
    }
    engine.onContextLostObservable.add(() => toWebGl('WebGPU device lost'))
    if (backend === 'webgpu') setTimeout(() => { if (status.frames === 0) toWebGl('WebGPU drew no frames') }, WEBGPU_FIRST_FRAME_MS)
    void createPhysics(presenter.scene).then(() => { status.physics = 'havok' }, (error: unknown) => { console.warn('Havok did not start', error) })
    return presenter
  } catch (error) {
    status.error = error instanceof Error ? error.message : String(error)
    throw error
  }
}
