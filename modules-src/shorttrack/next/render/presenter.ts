import { Camera } from '@babylonjs/core/Cameras/camera'
import type { AbstractEngine } from '@babylonjs/core/Engines/abstractEngine'
import type { AbstractMesh } from '@babylonjs/core/Meshes/abstractMesh'
import { Constants } from '@babylonjs/core/Engines/constants'
import '@babylonjs/core/Engines/Extensions/engine.multiRender'
import '@babylonjs/core/Engines/WebGPU/Extensions/engine.multiRender'
import { DirectionalLight } from '@babylonjs/core/Lights/directionalLight'
import { ClusteredLightContainer } from '@babylonjs/core/Lights/Clustered/clusteredLightContainer'
import { HemisphericLight } from '@babylonjs/core/Lights/hemisphericLight'
import { CascadedShadowGenerator } from '@babylonjs/core/Lights/Shadows/cascadedShadowGenerator'
import { SpotLight } from '@babylonjs/core/Lights/spotLight'
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
import { Matrix, Quaternion, Vector3 } from '@babylonjs/core/Maths/math.vector'
import { SphericalHarmonics, SphericalPolynomial } from '@babylonjs/core/Maths/sphericalPolynomial'
import { Mesh } from '@babylonjs/core/Meshes/mesh'
import { VertexData } from '@babylonjs/core/Meshes/mesh.vertexData'
import { MotionBlurPostProcess } from '@babylonjs/core/PostProcesses/motionBlurPostProcess'
import { DefaultRenderingPipeline } from '@babylonjs/core/PostProcesses/RenderPipeline/Pipelines/defaultRenderingPipeline'
import { SSAO2RenderingPipeline } from '@babylonjs/core/PostProcesses/RenderPipeline/Pipelines/ssao2RenderingPipeline'
import { TAARenderingPipeline } from '@babylonjs/core/PostProcesses/RenderPipeline/Pipelines/taaRenderingPipeline'
import '@babylonjs/core/PostProcesses/RenderPipeline/postProcessRenderPipelineManagerSceneComponent'
import '@babylonjs/core/Rendering/geometryBufferRendererSceneComponent'
import '@babylonjs/core/Rendering/prePassRendererSceneComponent'
import { Scene } from '@babylonjs/core/scene'
import type * as THREE from 'three'
import { createEngine, createPhysics } from '../boot'
import type { NextStatus } from '../boot'
import { ThreeBridge } from './bridge'
import { TIERS, settingsOf, tierOf, toneMapOf } from './quality'
import type { Tier, TierSettings } from './quality'
import { CrowdPlugin, SurfaceDetail, crowdPhases } from './surface'
import { Debris } from './debris'
import { bakeEnvironmentCube, bakeSky, directionAt, makeSkyFunction, skyDome } from './sky'
import { ReflectionProbe } from '@babylonjs/core/Probes/reflectionProbe'
import type { SkyParams } from './sky'

/**
 * three's conventions in Babylon's terms, fitted to the classic reference screenshots (all five tracks, day and
 * night): three's ACES pre-scales exposure by 1/0.6; its lights and image-based light land at the factors below of
 * Babylon's for the same intensity; car paint reflects the night environment at `nightPaint`.
 */
const CAL = { sun: 0.432, hemi: 0.432, exposure: 1 / 0.6, neutralExposure: 1.5, env: 1.224, nightPaint: 0.6, towerLight: 2500, paint: 0.4 }

const SCENE_LAYER = 0x0fffffff
const WEBGPU_FIRST_FRAME_MS = 6000

/**
 * Replaces a render target's list only when its contents changed: a new list marks every material dirty while the
 * pre-pass renderer (SSAO, motion blur) is on, which would rebuild shaders every frame.
 */
function setRenderList(target: RenderTargetTexture, list: AbstractMesh[]): void {
  const old = target.renderList
  if (old && old.length === list.length && old.every((m, i) => m === list[i])) return
  target.renderList = list
}

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
  /** The module's Graphics quality setting (low/med/high); `?quality=` overrides it. */
  quality: string
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
  /** The night light tower glows: Phase 3 hangs a spot light at each one. */
  towers: THREE.Object3D[]
}

type CrowdUniforms = { uTime: { value: number }; uLift: { value: number } }

/**
 * Runs the classic module's three.js scene on Babylon (`?engine=next`, Phase 2 of docs/shorttrack/PLAN.md): WebGPU
 * with a WebGL2 fallback, an HDR pipeline with ACES and bloom, a baked Preetham sky with matching image-based light,
 * the sun's shadow map, fog and the rear-view mirror. `window.__stNext` reports the backend, Havok and frames.
 */
export class Presenter {
  readonly scene: Scene
  /** Havok body debris for hard hits; set once Havok is running. */
  debris: Debris | null = null
  readonly status: NextStatus
  private readonly camera: ThreeCamera
  private readonly mirrorCamera: ThreeCamera
  private readonly sun: DirectionalLight
  private readonly hemi: HemisphericLight
  private readonly pipeline: DefaultRenderingPipeline
  private shadows: ShadowGenerator | CascadedShadowGenerator | null = null
  private tier: Tier | null = null
  private settings: TierSettings = TIERS.medium
  private ssao: SSAO2RenderingPipeline | null = null
  private taa: TAARenderingPipeline | null = null
  private motionBlur: MotionBlurPostProcess | null = null
  private towerLights: SpotLight[] = []
  private towerCluster: ClusteredLightContainer | null = null
  private readonly surface: SurfaceDetail
  private readonly materialIp: ImageProcessingConfiguration
  private readonly crowd: { plugin: CrowdPlugin; u: CrowdUniforms }[] = []
  private readonly bridge: ThreeBridge
  private readonly mirror: RenderTargetTexture
  private readonly mirrorQuad: Mesh
  private inputs: ThreeInputs | null = null
  private dome: Mesh | null = null
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
    scene.activeCameras = [this.camera]

    this.sun = new DirectionalLight('sun', new Vector3(-0.5, -1, -0.3), scene)
    this.sun.autoUpdateExtends = false
    this.sun.autoCalcShadowZBounds = false
    this.hemi = new HemisphericLight('hemi', new Vector3(0, 1, 0), scene)

    this.pipeline = new DefaultRenderingPipeline('main', true, scene, [this.camera])
    this.pipeline.samples = 4
    this.pipeline.fxaaEnabled = false
    this.pipeline.imageProcessingEnabled = true
    const ip = this.pipeline.imageProcessing
    ip.toneMappingEnabled = true
    ip.toneMappingType = toneMapOf(location.search) === 'aces' ? ImageProcessingConfiguration.TONEMAPPING_ACES : ImageProcessingConfiguration.TONEMAPPING_KHR_PBR_NEUTRAL
    ip.contrast = 1
    this.pipeline.bloomKernel = 64
    this.pipeline.bloomScale = 0.5

    this.surface = new SurfaceDetail(scene)
    const materialIp = new ImageProcessingConfiguration()
    materialIp.applyByPostProcess = true
    this.materialIp = materialIp
    this.bridge = new ThreeBridge(scene, () => ({ intensity: this.envIntensity, scale: this.envScale }), {
      imageProcessing: materialIp,
      material: (mat, m) => this.surface.apply(mat, m, this.settings.surfaceDetail),
      instanced: (mesh, o, mats) => {
        const material = (Array.isArray(o.material) ? o.material[0] : o.material) as THREE.Material
        const u = material.userData?.crowd as CrowdUniforms | undefined
        if (!u) return
        mesh.thinInstanceSetBuffer('crowdPhase', crowdPhases(o.instanceMatrix.count), 1, true)
        for (const mat of mats) {
          const plugin = new CrowdPlugin(mat)
          plugin.isEnabled = this.settings.crowdMotion
          this.crowd.push({ plugin, u })
        }
      },
    })

    this.mirror = new RenderTargetTexture('mirror', { width: 512, height: 128 }, scene, false, true, Constants.TEXTURETYPE_HALF_FLOAT)
    this.mirror.activeCamera = this.mirrorCamera
    this.mirror.samples = 2
    this.mirror.gammaSpace = false
    this.mirrorQuad = this.makeMirrorQuad()
  }

  /**
   * The rear-view mirror is a quad in the main view, just inside the near plane and sized to the mirror frame, so its
   * linear HDR image goes through the same pipeline (tone mapping, TAA) as the rest of the frame.
   */
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
    mat.imageProcessingConfiguration = this.materialIp
    mat.backFaceCulling = false
    mat.fogEnabled = false
    mat.disableDepthWrite = true
    mat.depthFunction = Constants.ALWAYS
    mat.sideOrientation = Material.CounterClockWiseSideOrientation
    quad.material = mat
    quad.layerMask = SCENE_LAYER
    quad.renderingGroupId = 3
    quad.rotationQuaternion = new Quaternion()
    quad.alwaysSelectAsActiveMesh = true
    quad.isPickable = false
    quad.isVisible = false
    return quad
  }

  /** Hooks up the classic module's three.js objects and bakes the day sky and its lighting. */
  attach(inputs: ThreeInputs): void {
    this.inputs = inputs
    const texture = bakeSky(this.scene, inputs.sky)
    this.dome = skyDome(this.scene, texture, 1500)
    ;(this.dome.material as PBRMaterial).imageProcessingConfiguration = this.materialIp
    this.dome.layerMask = SCENE_LAYER
    // Babylon renders the day environment from the dome itself (so cube faces follow its own convention). While it
    // does, the dome draws with a copy of its material whose reflection slot holds a tiny dummy cube, so WebGPU
    // never samples the cube it is writing.
    const probe = new ReflectionProbe('day-env', 128, this.scene, true, true, true)
    probe.renderList!.push(this.dome)
    probe.refreshRate = RenderTargetTexture.REFRESHRATE_RENDER_ONCE
    const probeMat = (this.dome.material as PBRMaterial).clone('sky-day-probe')
    probeMat.reflectionTexture = bakeEnvironmentCube(this.scene, inputs.sky, inputs.ground, 4)
    // the sun disc carries radiance in the tens of thousands; an unfiltered cube would smear it over whole mip
    // texels and every glossy surface would reflect a blown-out sky, so the reflection copy leaves it out
    probeMat.albedoTexture = bakeSky(this.scene, inputs.sky, 12)
    probe.cubeTexture.setMaterialForRendering(this.dome, probeMat)
    probe.cubeTexture.sphericalPolynomial = this.irradiance(inputs)
    this.scene.environmentTexture = probe.cubeTexture
    this.makeTowerLights(inputs.towers)
  }

  /** Spot lights at the light towers, aimed at the track; clustered so all ten light every material. */
  private makeTowerLights(towers: THREE.Object3D[]): void {
    const cluster = new ClusteredLightContainer('towers', [], this.scene)
    if (!cluster.isSupported) {
      cluster.dispose()
      return
    }
    this.towerCluster = cluster
    for (const [i, t] of towers.entries()) {
      const p = t.position, from = new Vector3(p.x, p.y, p.z)
      const at = new Vector3(-p.x, 0, -p.z).normalize().scaleInPlace(45).addInPlace(new Vector3(p.x, 0, p.z))
      const light = new SpotLight(`tower${i}`, from, at.subtract(from).normalize(), 1.3, 2, this.scene)
      light.diffuse = new Color3(1, 0.95, 0.86)
      light.specular = light.diffuse.clone()
      light.intensity = 0
      light.range = 220
      cluster.addLight(light)
      this.towerLights.push(light)
    }
    cluster.setEnabled(false)
  }

  /** Turns the quality tier's features on and off. */
  private applyTier(tier: Tier): void {
    if (tier === this.tier) return
    this.tier = tier
    const s = settingsOf(tier, location.search)
    // SSAO and motion blur add per-pixel position and velocity outputs; below 24 inter-stage variables (the WebGPU
    // default is 16) the PBR shaders with cascaded shadows no longer fit, so those two step aside
    const limits = (this.engine as AbstractEngine & { currentLimits?: { maxInterStageShaderVariables?: number } }).currentLimits
    if (limits && (limits.maxInterStageShaderVariables ?? 16) < 24) s.ssao = s.motionBlur = false
    this.settings = s
    ;(this.status as NextStatus & { tier?: Tier }).tier = tier
    this.pipeline.samples = s.msaa
    this.pipeline.fxaaEnabled = s.fxaa
    this.shadows?.dispose()
    this.shadows = null
    if (s.shadows === 'single') {
      const g = new ShadowGenerator(s.shadowSize, this.sun)
      g.usePercentageCloserFiltering = true
      g.filteringQuality = ShadowGenerator.QUALITY_MEDIUM
      this.shadows = g
    } else if (s.shadows === 'cascaded') {
      const g = new CascadedShadowGenerator(s.shadowSize, this.sun)
      g.numCascades = 4
      g.lambda = 0.85
      g.shadowMaxZ = 180
      g.stabilizeCascades = true
      g.useContactHardeningShadow = true
      g.contactHardeningLightSizeUVRatio = 0.03
      g.filteringQuality = ShadowGenerator.QUALITY_HIGH
      g.bias = 0.002
      g.normalBias = 0.02
      this.shadows = g
    }
    this.ssao?.dispose()
    this.ssao = null
    if (s.ssao) {
      const ssao = new SSAO2RenderingPipeline('ssao', this.scene, { ssaoRatio: 0.5, blurRatio: 1 }, [this.camera], true)
      ssao.radius = 1.6
      ssao.totalStrength = 1.1
      ssao.samples = this.tier === 'ultra' ? 16 : 8
      ssao.expensiveBlur = this.tier === 'ultra'
      ssao.maxZ = 250
      this.ssao = ssao
    }
    this.taa?.dispose()
    this.taa = null
    if (s.taa) {
      this.taa = new TAARenderingPipeline('taa', this.scene, [this.camera])
      this.taa.samples = 8
    }
    this.motionBlur?.dispose(this.camera)
    this.motionBlur = null
    if (s.motionBlur) {
      this.motionBlur = new MotionBlurPostProcess('motion', this.scene, 1, this.camera)
      this.motionBlur.motionStrength = 0.35
      this.motionBlur.motionBlurSamples = this.tier === 'ultra' ? 16 : 8
      // camera motion from depth: no per-object velocity pass (object-based blur on ultra)
      this.motionBlur.isObjectBased = this.tier === 'ultra'
    }
    for (const c of this.crowd) c.plugin.isEnabled = s.crowdMotion
    this.bridge.refreshMaterials()
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
    this.applyTier(tierOf(location.search, o.quality))
    t.scene.updateMatrixWorld()
    t.camera.updateMatrixWorld()
    t.mirrorCam.updateMatrixWorld()
    this.envIntensity = o.night ? 0 : (t.scene.environmentIntensity ?? 1) * CAL.env
    this.envScale = (o.night ? CAL.nightPaint : CAL.paint) * CAL.env
    this.bridge.sync(t.scene)
    this.debris?.update()
    this.camera.copyFrom(t.camera)
    this.syncLights(t, o)
    this.syncFog(t)
    if (this.dome) this.dome.isVisible = t.skyDay.visible
    const ip = this.pipeline.imageProcessing
    ip.exposure = o.exposure * (ip.toneMappingType === ImageProcessingConfiguration.TONEMAPPING_ACES ? CAL.exposure : CAL.neutralExposure)
    const towersOn = o.night && this.settings.nightLights && !!this.towerCluster
    if (this.towerCluster && this.towerCluster.isEnabled() !== towersOn) this.towerCluster.setEnabled(towersOn)
    if (towersOn) for (const l of this.towerLights) l.intensity = CAL.towerLight
    for (const c of this.crowd) {
      c.plugin.time = c.u.uTime.value
      c.plugin.lift = c.u.uLift.value
    }
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
    this.sun.shadowEnabled = !!this.shadows && o.shadows && s.castShadow
    const map = this.shadows?.getShadowMap()
    if (map && this.shadows instanceof CascadedShadowGenerator) setRenderList(map, this.sun.shadowEnabled ? this.nearCamera(this.shadows.shadowMaxZ) : [])
    else if (map && this.shadows) {
      const size = Math.max(o.shadowSize, this.settings.shadowSize)
      if (map.getSize().width !== size) map.resize(size)
      this.shadows.bias = Math.abs(s.shadow.bias) * 2
      this.shadows.normalBias = s.shadow.normalBias
      setRenderList(map, this.sun.shadowEnabled ? this.inShadowBox(sc) : [])
    }
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

  /** Casters within `range` of the camera: the cascades only reach that far, so anything beyond is wasted draws. */
  private nearCamera(range: number): Mesh[] {
    const out: Mesh[] = [], c = this.camera.position
    for (const mesh of this.bridge.casters) {
      const sphere = mesh.getBoundingInfo().boundingSphere
      if (mesh.alwaysSelectAsActiveMesh || Vector3.Distance(sphere.centerWorld, c) - sphere.radiusWorld < range) out.push(mesh)
    }
    return out
  }

  private mirrorPlanes: Plane[] = []

  /** Visible meshes inside the mirror camera's view (a render list is drawn without the scene's culling). */
  private inMirrorView(): Mesh[] {
    this.mirrorPlanes = Frustum.GetPlanes(this.mirrorCamera.getTransformationMatrix())
    const out: Mesh[] = []
    for (const m of this.scene.meshes) {
      if (!(m.layerMask & SCENE_LAYER) || !m.isVisible || !m.isEnabled() || m === this.mirrorQuad) continue
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
      this.mirrorQuad.isVisible = on
    }
    if (!o.mirror) return
    this.mirrorCamera.copyFrom(t.mirrorCam)
    setRenderList(this.mirror, this.inMirrorView())
    const canvas = this.engine.getRenderingCanvas()!, cw = canvas.clientWidth || 1, ch = canvas.clientHeight || 1
    const r = o.mirror, cam = t.camera, e = cam.matrixWorld.elements, d = cam.near * 2
    const hh = d * Math.tan((cam.fov * Math.PI) / 360), hw = hh * (cw / ch)
    const nx = ((r.x + r.w / 2) / cw) * 2 - 1, ny = 1 - ((r.y + r.h / 2) / ch) * 2
    const q = this.mirrorQuad
    q.position.set(e[12] - e[8] * d + e[0] * nx * hw + e[4] * ny * hh, e[13] - e[9] * d + e[1] * nx * hw + e[5] * ny * hh, e[14] - e[10] * d + e[2] * nx * hw + e[6] * ny * hh)
    q.rotationQuaternion!.set(cam.quaternion.x, cam.quaternion.y, cam.quaternion.z, cam.quaternion.w)
    q.scaling.set((r.w / cw) * 2 * hw, (r.h / ch) * 2 * hh, 1)
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
    void createPhysics(presenter.scene).then(() => { status.physics = 'havok'; presenter.debris = new Debris(presenter.scene) }, (error: unknown) => { console.warn('Havok did not start', error) })
    return presenter
  } catch (error) {
    status.error = error instanceof Error ? error.message : String(error)
    throw error
  }
}
