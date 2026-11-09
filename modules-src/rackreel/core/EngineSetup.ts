import { UniversalCamera } from '@babylonjs/core/Cameras/universalCamera'
import { Engine } from '@babylonjs/core/Engines/engine'
import '@babylonjs/core/Engines/Extensions/engine.query'
import { DirectionalLight } from '@babylonjs/core/Lights/directionalLight'
import { HemisphericLight } from '@babylonjs/core/Lights/hemisphericLight'
import { ShadowGenerator } from '@babylonjs/core/Lights/Shadows/shadowGenerator'
import '@babylonjs/core/Lights/Shadows/shadowGeneratorSceneComponent'
import { RenderTargetTexture } from '@babylonjs/core/Materials/Textures/renderTargetTexture'
import { ImageProcessingConfiguration } from '@babylonjs/core/Materials/imageProcessingConfiguration'
import { Color3, Color4 } from '@babylonjs/core/Maths/math.color'
import { Vector3 } from '@babylonjs/core/Maths/math.vector'
import { Ray } from '@babylonjs/core/Culling/ray'
import { Octree } from '@babylonjs/core/Culling/Octrees/octree'
import type { OctreeBlock } from '@babylonjs/core/Culling/Octrees/octreeBlock'
import '@babylonjs/core/Culling/Octrees/octreeSceneComponent'
import type { AbstractMesh } from '@babylonjs/core/Meshes/abstractMesh'
import type { Mesh } from '@babylonjs/core/Meshes/mesh'
import '@babylonjs/core/Rendering/boundingBoxRenderer'
import { DefaultRenderingPipeline } from '@babylonjs/core/PostProcesses/RenderPipeline/Pipelines/defaultRenderingPipeline'
import '@babylonjs/core/PostProcesses/RenderPipeline/postProcessRenderPipelineManagerSceneComponent'
import { Scene } from '@babylonjs/core/scene'

export const SHADOW_MAP_SIZE = 2048
export const SHADOW_EXTENT = 95
export const SUN_ELEVATION = 0.5
export const SUN_AZIMUTH = -2.35
export const FOG_COLOR = new Color3(0.66, 0.72, 0.74)
export const FOG_DENSITY = 0.0024
export const EYE_HEIGHT = 1.65

export interface TrunkCollider {
  x: number
  z: number
  r: number
  min: Vector3
  max: Vector3
}

export interface EngineContext {
  engine: Engine
  scene: Scene
  camera: UniversalCamera
  sun: DirectionalLight
  sky: HemisphericLight
  sunDirection: Vector3
  shadows: ShadowGenerator
  pipeline: DefaultRenderingPipeline
  collisionOctree: Octree<TrunkCollider> | null
  registerDynamic(mesh: AbstractMesh): void
  unregisterDynamic(mesh: AbstractMesh): void
  setShadowFocus(target: Vector3): void
  buildCollisionOctree(colliders: TrunkCollider[]): Octree<TrunkCollider>
  queryTrunks(x: number, z: number, radius: number): TrunkCollider[]
  enableTerrainOctree(ground: Mesh): void
  buildSelectionOctree(): void
  groundRay(ground: Mesh, x: number, z: number): { y: number; normal: Vector3 } | null
  setAds(amount: number): void
}

export function createEngineSetup(canvas: HTMLCanvasElement): EngineContext {
  const engine = new Engine(canvas, true, { stencil: false, preserveDrawingBuffer: false, powerPreference: 'high-performance', antialias: false, adaptToDeviceRatio: false }, false)
  engine.setHardwareScalingLevel(1 / Math.min(1.5, window.devicePixelRatio || 1))
  engine.enableOfflineSupport = false

  const scene = new Scene(engine)
  scene.autoClear = false
  scene.autoClearDepthAndStencil = true
  scene.blockfreeActiveMeshesAndRenderingGroups = true
  scene.skipPointerMovePicking = true
  scene.skipPointerDownPicking = true
  scene.skipPointerUpPicking = true
  scene.constantlyUpdateMeshUnderPointer = false
  scene.clearColor = new Color4(FOG_COLOR.r, FOG_COLOR.g, FOG_COLOR.b, 1)
  scene.ambientColor = new Color3(0.18, 0.2, 0.2)
  scene.fogMode = Scene.FOGMODE_EXP2
  scene.fogDensity = FOG_DENSITY
  scene.fogColor = FOG_COLOR.clone()
  scene.setRenderingAutoClearDepthStencil(1, true, true, false)

  const camera = new UniversalCamera('eye', new Vector3(0, 10, 0), scene)
  camera.minZ = 0.05
  camera.maxZ = 2600
  camera.fov = 0.9
  camera.inertia = 0.45
  camera.angularSensibility = 2200
  camera.speed = 0.32
  camera.keysUp = [87]
  camera.keysDown = [83]
  camera.keysLeft = [65]
  camera.keysRight = [68]
  camera.keysUpward = []
  camera.keysDownward = []
  camera.keysRotateLeft = []
  camera.keysRotateRight = []
  camera.applyGravity = false
  camera.checkCollisions = false
  camera.attachControl(true)

  const sunDirection = new Vector3(
    Math.cos(SUN_AZIMUTH) * Math.cos(SUN_ELEVATION),
    -Math.sin(SUN_ELEVATION),
    Math.sin(SUN_AZIMUTH) * Math.cos(SUN_ELEVATION),
  ).normalize()
  const sun = new DirectionalLight('sun', sunDirection.clone(), scene)
  sun.intensity = 2.35
  sun.diffuse = new Color3(1.0, 0.9, 0.76)
  sun.specular = new Color3(0.35, 0.32, 0.28)
  sun.autoUpdateExtends = false
  sun.autoCalcShadowZBounds = false
  sun.orthoLeft = -SHADOW_EXTENT
  sun.orthoRight = SHADOW_EXTENT
  sun.orthoTop = SHADOW_EXTENT
  sun.orthoBottom = -SHADOW_EXTENT
  sun.shadowMinZ = 1
  sun.shadowMaxZ = 700

  const sky = new HemisphericLight('sky', new Vector3(0.1, 1, 0.2), scene)
  sky.intensity = 0.85
  sky.diffuse = new Color3(0.62, 0.72, 0.86)
  sky.groundColor = new Color3(0.2, 0.19, 0.13)
  sky.specular = Color3.Black()

  const shadows = new ShadowGenerator(SHADOW_MAP_SIZE, sun, true)
  shadows.useBlurCloseExponentialShadowMap = true
  shadows.blurKernel = 8
  shadows.blurScale = 2
  shadows.depthScale = 60
  shadows.bias = 0.0006
  shadows.normalBias = 0.012
  shadows.setDarkness(0.42)
  shadows.forceBackFacesOnly = false
  shadows.frustumEdgeFalloff = 0.25
  const shadowMap = shadows.getShadowMap()!
  shadowMap.refreshRate = RenderTargetTexture.REFRESHRATE_RENDER_ONCE
  let shadowSnapshot = new Float32Array(0)
  let shadowList: AbstractMesh[] | null = null
  const shadowSun = new Vector3(Number.NaN, 0, 0)
  scene.onBeforeRenderTargetsRenderObservable.add(() => {
    const list = shadowMap.renderList
    if (!list) return
    let dirty = list !== shadowList || !sun.position.equals(shadowSun)
    const size = list.length * 17
    if (shadowSnapshot.length !== size) {
      shadowSnapshot = new Float32Array(size)
      dirty = true
    }
    let at = 0
    for (let i = 0; i < list.length; i++) {
      const mesh = list[i]
      const shown = mesh.isEnabled() && mesh.isVisible ? 1 : 0
      if (shadowSnapshot[at] !== shown) {
        shadowSnapshot[at] = shown
        dirty = true
      }
      at++
      const m = mesh.computeWorldMatrix().m
      for (let k = 0; k < 16; k++, at++) {
        if (shadowSnapshot[at] !== m[k]) {
          shadowSnapshot[at] = m[k]
          dirty = true
        }
      }
    }
    shadowList = list
    shadowSun.copyFrom(sun.position)
    if (dirty) shadowMap.resetRefreshCounter()
  })

  const pipeline = new DefaultRenderingPipeline('grade', true, scene, [camera])
  pipeline.samples = 1
  pipeline.fxaaEnabled = true
  pipeline.bloomEnabled = true
  pipeline.bloomThreshold = 0.92
  pipeline.bloomWeight = 0.18
  pipeline.bloomKernel = 32
  pipeline.bloomScale = 0.5
  pipeline.imageProcessingEnabled = true
  pipeline.imageProcessing.toneMappingEnabled = true
  pipeline.imageProcessing.toneMappingType = ImageProcessingConfiguration.TONEMAPPING_ACES
  pipeline.imageProcessing.exposure = 1.08
  pipeline.imageProcessing.contrast = 1.12
  pipeline.imageProcessing.vignetteEnabled = true
  pipeline.imageProcessing.vignetteWeight = 1.4
  pipeline.imageProcessing.vignetteColor = new Color4(0.05, 0.06, 0.05, 0)

  const dynamic = new Set<AbstractMesh>()
  let collisionOctree: Octree<TrunkCollider> | null = null
  const texel = (SHADOW_EXTENT * 2) / SHADOW_MAP_SIZE
  const right = Vector3.Cross(Vector3.Up(), sunDirection).normalize()
  const up = Vector3.Cross(sunDirection, right).normalize()
  const ray = new Ray(Vector3.Zero(), new Vector3(0, -1, 0), 600)
  const focusScratch = new Vector3()
  const axisScratch = new Vector3()

  const ctx: EngineContext = {
    engine,
    scene,
    camera,
    sun,
    sky,
    sunDirection,
    shadows,
    pipeline,
    collisionOctree,
    registerDynamic(mesh) {
      dynamic.add(mesh)
      const oct = scene.selectionOctree
      if (oct && !oct.dynamicContent.includes(mesh)) oct.dynamicContent.push(mesh)
    },
    unregisterDynamic(mesh) {
      dynamic.delete(mesh)
      const oct = scene.selectionOctree
      if (oct) {
        const i = oct.dynamicContent.indexOf(mesh)
        if (i >= 0) oct.dynamicContent.splice(i, 1)
      }
    },
    setShadowFocus(target) {
      const a = Math.round(Vector3.Dot(target, right) / texel) * texel
      const b = Math.round(Vector3.Dot(target, up) / texel) * texel
      const c = Vector3.Dot(target, sunDirection)
      right.scaleToRef(a, focusScratch)
      focusScratch.addInPlace(up.scaleToRef(b, axisScratch)).addInPlace(sunDirection.scaleToRef(c - 350, axisScratch))
      sun.position.copyFrom(focusScratch)
    },
    buildCollisionOctree(colliders) {
      const creation = (entry: TrunkCollider, block: OctreeBlock<TrunkCollider>) => {
        if (entry.max.x >= block.minPoint.x && entry.min.x <= block.maxPoint.x && entry.max.z >= block.minPoint.z && entry.min.z <= block.maxPoint.z && entry.max.y >= block.minPoint.y && entry.min.y <= block.maxPoint.y) block.entries.push(entry)
      }
      const octree = new Octree<TrunkCollider>(creation, 24, 4)
      const min = new Vector3(-600, -60, -600)
      const max = new Vector3(600, 120, 600)
      octree.update(min, max, colliders)
      collisionOctree = octree
      ctx.collisionOctree = octree
      return octree
    },
    queryTrunks(x, z, radius) {
      if (!collisionOctree) return []
      const found = collisionOctree.intersects(new Vector3(x, 5, z), radius + 1, false)
      const out: TrunkCollider[] = []
      for (let i = 0; i < found.length; i++) out.push(found.data[i])
      return out
    },
    enableTerrainOctree(ground) {
      ground.subdivide(64)
      ground.createOrUpdateSubmeshesOctree(32, 2)
      ground.useOctreeForCollisions = true
      ground.useOctreeForPicking = true
      ground.useOctreeForRenderingSelection = true
    },
    buildSelectionOctree() {
      const octree = scene.createOrUpdateSelectionOctree(48, 3)
      for (const mesh of dynamic) if (!octree.dynamicContent.includes(mesh)) octree.dynamicContent.push(mesh)
    },
    groundRay(ground, x, z) {
      ray.origin.set(x, 300, z)
      const hit = ground.intersects(ray, false)
      if (!hit.hit || !hit.pickedPoint) return null
      const normal = hit.getNormal(true, false) ?? Vector3.Up()
      return { y: hit.pickedPoint.y, normal }
    },
    setAds(amount) {
      camera.fov = 0.9 + (0.21 - 0.9) * amount
      camera.angularSensibility = 2200 + amount * 7600
    },
  }
  ray.length = 600

  addEventListener('resize', () => engine.resize())
  return ctx
}
