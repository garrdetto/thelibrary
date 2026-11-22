/**
 * Sky, sun and shadows for the standalone county: a gradient sky dome coloured per vertex (no custom shaders) that follows the
 * camera, HDR sun and moon discs with an additive halo, a directional key light (the sun by day, the moon at night) with a
 * hemispheric fill, exponential fog in the horizon colour, a CPU-baked environment cube for PBR reflections, and sun shadows by
 * tier: none (low), one fitted map that follows the camera (medium), or cascades (high, ultra with soft contact-hardening edges).
 * `setTime(hours)` drives all of it from the sky model in `AtmosphereSky.ts`, plus an exposure tweak written to the scene's
 * image-processing configuration. Lights, the sky and the environment live at the scene root; nothing here touches the world.
 */
import type { Camera } from '@babylonjs/core/Cameras/camera'
import { Constants } from '@babylonjs/core/Engines/constants'
import { DirectionalLight } from '@babylonjs/core/Lights/directionalLight'
import { HemisphericLight } from '@babylonjs/core/Lights/hemisphericLight'
import { CascadedShadowGenerator } from '@babylonjs/core/Lights/Shadows/cascadedShadowGenerator'
import { ShadowGenerator } from '@babylonjs/core/Lights/Shadows/shadowGenerator'
import { Material } from '@babylonjs/core/Materials/material'
import { StandardMaterial } from '@babylonjs/core/Materials/standardMaterial'
import type { BaseTexture } from '@babylonjs/core/Materials/Textures/baseTexture'
import { Color3, Color4 } from '@babylonjs/core/Maths/math.color'
import { Quaternion, Vector3 } from '@babylonjs/core/Maths/math.vector'
import type { AbstractMesh } from '@babylonjs/core/Meshes/abstractMesh'
import { Mesh } from '@babylonjs/core/Meshes/mesh'
import { VertexData } from '@babylonjs/core/Meshes/mesh.vertexData'
import { Scene } from '@babylonjs/core/scene'
import { qualitySettings } from '../Quality'
import type { QualitySettings, QualityTier } from '../Quality'
import { SkyEnvironment } from './AtmosphereEnvironment'
import { computeSkyState, createSkyState, skyRadiance, smoothstep } from './AtmosphereSky'
import type { Rgb, SkyState } from './AtmosphereSky'

export const SKY_RADIUS = 4500
const SUN_DISTANCE = 4200
const HALO_DISTANCE = 4150
const SUN_RADIUS = 34
const MOON_RADIUS = 30
const HALO_RADIUS = 520
const DISC_SEGMENTS = 32
const SKY_LONGITUDES = 64
const SKY_ELEVATIONS = [-90, -35, -12, -5, -2, -0.5, 0.5, 1.5, 3, 5, 7.5, 10.5, 14, 18.5, 24, 31, 39, 49, 61, 75, 90]
const SUN_DISC_HDR = 26
const MOON_DISC_HDR = 1.6
const HALO_STRENGTH = 0.55
/** The image-processing exposure in clear midday light; `setTime` scales it for dusk and night. */
export const DAY_EXPOSURE = 1.0
const SHADOW_BACKOFF = 700
const RETIME_HOURS = 0.004
const REBAKE_HOURS = 0.1
/** Exponential-squared fog density times the fog range: about 88 % fogged at the range. */
const FOG_REACH = 1.45

export interface AtmosphereOptions {
  tier: QualityTier
  /** Camera the cascades are fitted to (defaults to the scene's active camera when shadows render). */
  camera?: Camera
  /** Clock hour to start at (default 14:00). */
  hours?: number
  /** Distance where the fog has all but hidden the land; defaults to the tier's streaming reach. */
  fogRange?: number
}

export type SunShadows = ShadowGenerator | CascadedShadowGenerator

export interface Atmosphere {
  /** The key light: the sun by day, the moon at night. */
  readonly sun: DirectionalLight
  readonly hemi: HemisphericLight
  /** The current shadow generator, or null on the low tier (and on engines without shadow support). */
  readonly shadows: SunShadows | null
  readonly sky: Mesh
  /** The sky cube PBR materials reflect (`scene.environmentTexture`), or null where raw cube textures aren't available. */
  readonly environment: BaseTexture | null
  readonly hours: number
  /** 0 by day, 1 at full dark: switch lamps on above about 0.5. */
  readonly night: number
  readonly state: Readonly<SkyState>
  readonly quality: Readonly<QualitySettings>
  setTime(hours: number): void
  /** Adds a mesh to the sun's shadow casters (kept across tier changes until removed). */
  addCaster(mesh: AbstractMesh): void
  removeCaster(mesh: AbstractMesh): void
  setQuality(tier: QualityTier): void
  setFogRange(metres: number): void
  /** Call every frame with the camera's position: re-centres the single shadow map in steps of one texel. */
  update(cameraPos: Vector3): void
  dispose(): void
}

function setColor(target: Color3, rgb: Rgb, scale = 1): void {
  target.r = rgb[0] * scale
  target.g = rgb[1] * scale
  target.b = rgb[2] * scale
}

function buildDome(scene: Scene): { mesh: Mesh; colors: Float32Array; directions: Float32Array } {
  const rings = SKY_ELEVATIONS.length
  const columns = SKY_LONGITUDES + 1
  const positions = new Float32Array(rings * columns * 3)
  const directions = new Float32Array(rings * columns * 3)
  const colors = new Float32Array(rings * columns * 4)
  const indices: number[] = []
  for (let ring = 0; ring < rings; ring++) {
    const elevation = (SKY_ELEVATIONS[ring] * Math.PI) / 180
    for (let column = 0; column < columns; column++) {
      const azimuth = (column / SKY_LONGITUDES) * Math.PI * 2
      const dx = Math.cos(elevation) * Math.cos(azimuth)
      const dy = Math.sin(elevation)
      const dz = Math.cos(elevation) * Math.sin(azimuth)
      const at = (ring * columns + column) * 3
      directions[at] = dx
      directions[at + 1] = dy
      directions[at + 2] = dz
      positions[at] = dx * SKY_RADIUS
      positions[at + 1] = dy * SKY_RADIUS
      positions[at + 2] = dz * SKY_RADIUS
      colors[(ring * columns + column) * 4 + 3] = 1
    }
  }
  for (let ring = 0; ring < rings - 1; ring++) {
    for (let column = 0; column < SKY_LONGITUDES; column++) {
      const a = ring * columns + column
      const b = a + 1
      const c = a + columns
      const d = c + 1
      indices.push(a, b, c, b, d, c)
    }
  }
  const mesh = new Mesh('trucksim-sky', scene)
  const data = new VertexData()
  data.positions = positions
  data.indices = indices
  data.applyToMesh(mesh, false)
  mesh.setVerticesData('color', colors, true, 4)
  return { mesh, colors, directions }
}

function buildFan(scene: Scene, name: string, radius: number): { mesh: Mesh; colors: Float32Array } {
  const count = DISC_SEGMENTS + 1
  const positions = new Float32Array(count * 3)
  const colors = new Float32Array(count * 4)
  const indices: number[] = []
  for (let segment = 0; segment < DISC_SEGMENTS; segment++) {
    const angle = (segment / DISC_SEGMENTS) * Math.PI * 2
    positions[(segment + 1) * 3] = Math.cos(angle) * radius
    positions[(segment + 1) * 3 + 1] = Math.sin(angle) * radius
    indices.push(0, segment + 1, ((segment + 1) % DISC_SEGMENTS) + 1)
  }
  for (let index = 0; index < count; index++) colors[index * 4 + 3] = 1
  const mesh = new Mesh(name, scene)
  const data = new VertexData()
  data.positions = positions
  data.indices = indices
  data.applyToMesh(mesh, false)
  mesh.setVerticesData('color', colors, true, 4)
  return { mesh, colors }
}

function prepareSkyMesh(mesh: Mesh, material: Material): void {
  mesh.material = material
  mesh.infiniteDistance = true
  mesh.isPickable = false
  mesh.receiveShadows = false
  mesh.applyFog = false
  mesh.alwaysSelectAsActiveMesh = true
  mesh.doNotSyncBoundingInfo = true
}

/**
 * StandardMaterial treats its colour as gamma-encoded and the image processing linearises it with a 2.2 power before tone
 * mapping, so sky colours (linear, possibly HDR) are written encoded and come out exactly as computed.
 */
function encode(linear: number): number {
  return linear > 0 ? Math.pow(linear, 1 / 2.2) : 0
}

function fillFan(colors: Float32Array, center: Rgb, centerScale: number, rimScale: number): void {
  const count = colors.length / 4
  for (let index = 0; index < count; index++) {
    const scale = index === 0 ? centerScale : rimScale
    colors[index * 4] = encode(center[0] * scale)
    colors[index * 4 + 1] = encode(center[1] * scale)
    colors[index * 4 + 2] = encode(center[2] * scale)
  }
}

const FORWARD = new Vector3(0, 0, 1)

function faceToward(mesh: Mesh, toward: Rgb, distance: number, scratch: Vector3): void {
  mesh.position.set(toward[0] * distance, toward[1] * distance, toward[2] * distance)
  scratch.set(-toward[0], -toward[1], -toward[2])
  const quaternion = mesh.rotationQuaternion ?? new Quaternion()
  Quaternion.FromUnitVectorsToRef(FORWARD, scratch, quaternion)
  mesh.rotationQuaternion = quaternion
}

/** Creates the sky, lights, fog, environment and sun shadows for `scene`. */
export function createAtmosphere(scene: Scene, options: AtmosphereOptions): Atmosphere {
  let quality = qualitySettings(options.tier)
  const state = createSkyState()
  const radiance: Rgb = [0, 0, 0]
  const scratch = new Vector3()
  const shadowRight = new Vector3(1, 0, 0)
  const shadowUp = new Vector3(0, 0, 1)
  const shadowFocus = new Vector3()
  const casters = new Set<AbstractMesh>()
  let fogRange = options.fogRange ?? (quality.streamRadius - 0.5) * 256
  let shadows: SunShadows | null = null
  let lastHours = Number.NaN
  let lastBakeHours = Number.NaN
  let disposed = false

  const sun = new DirectionalLight('trucksim-sun', new Vector3(0.3, -1, 0.4).normalize(), scene)
  sun.autoUpdateExtends = false
  sun.autoCalcShadowZBounds = false
  const hemi = new HemisphericLight('trucksim-skylight', new Vector3(0, 1, 0), scene)
  hemi.specular = Color3.Black()

  const skyMaterial = new StandardMaterial('trucksim-sky', scene)
  skyMaterial.diffuseColor = Color3.Black()
  skyMaterial.specularColor = Color3.Black()
  skyMaterial.emissiveColor = Color3.White()
  skyMaterial.disableLighting = true
  skyMaterial.backFaceCulling = false
  skyMaterial.fogEnabled = false
  const haloMaterial = new StandardMaterial('trucksim-sun-halo', scene)
  haloMaterial.diffuseColor = Color3.Black()
  haloMaterial.specularColor = Color3.Black()
  haloMaterial.emissiveColor = Color3.White()
  haloMaterial.disableLighting = true
  haloMaterial.backFaceCulling = false
  haloMaterial.fogEnabled = false
  haloMaterial.disableDepthWrite = true
  haloMaterial.alphaMode = Constants.ALPHA_ADD
  haloMaterial.transparencyMode = Material.MATERIAL_ALPHABLEND

  const dome = buildDome(scene)
  prepareSkyMesh(dome.mesh, skyMaterial)
  const sunDisc = buildFan(scene, 'trucksim-sun-disc', SUN_RADIUS)
  prepareSkyMesh(sunDisc.mesh, skyMaterial)
  const moonDisc = buildFan(scene, 'trucksim-moon-disc', MOON_RADIUS)
  prepareSkyMesh(moonDisc.mesh, skyMaterial)
  const halo = buildFan(scene, 'trucksim-sun-halo', HALO_RADIUS)
  prepareSkyMesh(halo.mesh, haloMaterial)

  let environment = new SkyEnvironment(scene, quality.environmentSize)
  if (environment.texture) scene.environmentTexture = environment.texture

  scene.fogMode = Scene.FOGMODE_EXP2

  function applyFog(): void {
    scene.fogDensity = FOG_REACH / Math.max(200, fogRange)
  }

  function shadowStrength(): number {
    if (state.sunIntensity >= state.moonIntensity) return smoothstep(0.5, 7, (state.sunElevation * 180) / Math.PI)
    return 0.45 * smoothstep(2, 12, (state.moonElevation * 180) / Math.PI)
  }

  function refreshShadowBasis(): void {
    const direction = sun.direction
    Vector3.CrossToRef(Vector3.UpReadOnly, direction, shadowRight)
    if (shadowRight.lengthSquared() < 1e-8) shadowRight.set(1, 0, 0)
    shadowRight.normalize()
    Vector3.CrossToRef(direction, shadowRight, shadowUp)
    shadowUp.normalize()
  }

  function placeShadowFrame(force: boolean): void {
    if (!(shadows instanceof ShadowGenerator) || shadows instanceof CascadedShadowGenerator) return
    const texel = (quality.shadowDistance * 2) / quality.shadowMapSize
    const a = Math.round(Vector3.Dot(shadowFocus, shadowRight) / texel) * texel
    const b = Math.round(Vector3.Dot(shadowFocus, shadowUp) / texel) * texel
    const c = Vector3.Dot(shadowFocus, sun.direction) - SHADOW_BACKOFF
    const x = shadowRight.x * a + shadowUp.x * b + sun.direction.x * c
    const y = shadowRight.y * a + shadowUp.y * b + sun.direction.y * c
    const z = shadowRight.z * a + shadowUp.z * b + sun.direction.z * c
    const position = sun.position
    if (!force && Math.abs(position.x - x) < 1e-4 && Math.abs(position.y - y) < 1e-4 && Math.abs(position.z - z) < 1e-4) return
    position.set(x, y, z)
  }

  function createShadows(): void {
    shadows?.dispose()
    shadows = null
    if (quality.shadows === 'off') return
    const cascaded = quality.shadows === 'cascaded' && CascadedShadowGenerator.IsSupported
    if (cascaded) {
      const generator = new CascadedShadowGenerator(quality.shadowMapSize, sun, undefined, options.camera)
      generator.numCascades = Math.max(2, quality.shadowCascades)
      generator.lambda = 0.82
      generator.shadowMaxZ = quality.shadowDistance
      generator.stabilizeCascades = true
      generator.cascadeBlendPercentage = 0.08
      generator.depthClamp = true
      generator.bias = 0.0025
      generator.normalBias = 0.025
      generator.filteringQuality = quality.softShadows ? ShadowGenerator.QUALITY_HIGH : ShadowGenerator.QUALITY_MEDIUM
      if (quality.softShadows) {
        generator.useContactHardeningShadow = true
        generator.contactHardeningLightSizeUVRatio = 0.035
      }
      shadows = generator
    } else {
      const extent = quality.shadowDistance > 0 ? Math.min(quality.shadowDistance, 220) : 150
      const generator = new ShadowGenerator(quality.shadowMapSize, sun)
      generator.usePercentageCloserFiltering = true
      generator.filteringQuality = ShadowGenerator.QUALITY_MEDIUM
      generator.bias = 0.0012
      generator.normalBias = 0.02
      sun.orthoLeft = -extent
      sun.orthoRight = extent
      sun.orthoBottom = -extent
      sun.orthoTop = extent
      sun.shadowMinZ = 1
      sun.shadowMaxZ = SHADOW_BACKOFF * 2
      shadows = generator
      refreshShadowBasis()
      placeShadowFrame(true)
    }
    for (const mesh of casters) shadows.addShadowCaster(mesh, false)
    shadows.setDarkness(1 - shadowStrength())
  }

  function colourDome(): void {
    const { colors, directions } = dome
    const count = directions.length / 3
    for (let index = 0; index < count; index++) {
      const at = index * 3
      skyRadiance(state, directions[at], directions[at + 1], directions[at + 2], radiance)
      colors[index * 4] = encode(radiance[0])
      colors[index * 4 + 1] = encode(radiance[1])
      colors[index * 4 + 2] = encode(radiance[2])
    }
    dome.mesh.updateVerticesData('color', colors)
  }

  function placeDiscs(): void {
    const sunVisible = state.sunDisc > 0.001
    sunDisc.mesh.setEnabled(sunVisible)
    halo.mesh.setEnabled(sunVisible)
    if (sunVisible) {
      faceToward(sunDisc.mesh, state.sun, SUN_DISTANCE, scratch)
      faceToward(halo.mesh, state.sun, HALO_DISTANCE, scratch)
      fillFan(sunDisc.colors, state.sunColor, SUN_DISC_HDR * state.sunDisc, SUN_DISC_HDR * state.sunDisc * 0.82)
      sunDisc.mesh.updateVerticesData('color', sunDisc.colors)
      const glow = HALO_STRENGTH * state.sunDisc * (0.55 + 0.45 * state.lowSun)
      fillFan(halo.colors, state.sunColor, glow, 0)
      halo.mesh.updateVerticesData('color', halo.colors)
    }
    const moonVisible = state.moonDisc > 0.001
    moonDisc.mesh.setEnabled(moonVisible)
    if (moonVisible) {
      faceToward(moonDisc.mesh, state.moon, SUN_DISTANCE, scratch)
      const moonTint: Rgb = state.moonColor
      fillFan(moonDisc.colors, moonTint, MOON_DISC_HDR * state.moonDisc, MOON_DISC_HDR * state.moonDisc * 0.9)
      moonDisc.mesh.updateVerticesData('color', moonDisc.colors)
    }
  }

  function applyState(): void {
    sun.direction.set(-state.keyDirection[0], -state.keyDirection[1], -state.keyDirection[2])
    setColor(sun.diffuse, state.keyColor)
    setColor(sun.specular, state.keyColor)
    sun.intensity = state.keyIntensity
    setColor(hemi.diffuse, state.hemiSky)
    setColor(hemi.groundColor, state.hemiGround)
    hemi.intensity = state.hemiIntensity
    setColor(scene.fogColor, state.fog)
    const clear = scene.clearColor
    clear.r = state.fog[0]
    clear.g = state.fog[1]
    clear.b = state.fog[2]
    clear.a = 1
    const exposure = DAY_EXPOSURE * state.exposure
    if (Math.abs(scene.imageProcessingConfiguration.exposure - exposure) > 1e-4) scene.imageProcessingConfiguration.exposure = exposure
    refreshShadowBasis()
    placeShadowFrame(true)
    if (shadows) shadows.setDarkness(1 - shadowStrength())
    colourDome()
    placeDiscs()
  }

  function setTime(hours: number): void {
    if (disposed) return
    if (Number.isFinite(lastHours) && Math.abs(hours - lastHours) < RETIME_HOURS) return
    lastHours = hours
    computeSkyState(state, hours)
    applyState()
    if (!Number.isFinite(lastBakeHours) || Math.abs(hours - lastBakeHours) >= REBAKE_HOURS) {
      lastBakeHours = hours
      environment.bake(state)
    }
  }

  scene.clearColor = new Color4(0.5, 0.6, 0.7, 1)
  applyFog()
  createShadows()
  setTime(options.hours ?? 14)

  const atmosphere: Atmosphere = {
    sun,
    hemi,
    get shadows() {
      return shadows
    },
    sky: dome.mesh,
    get environment() {
      return environment.texture
    },
    get hours() {
      return state.hours
    },
    get night() {
      return state.night
    },
    state,
    get quality() {
      return quality
    },
    setTime,
    addCaster(mesh) {
      if (casters.has(mesh)) return
      casters.add(mesh)
      shadows?.addShadowCaster(mesh, false)
    },
    removeCaster(mesh) {
      if (!casters.delete(mesh)) return
      shadows?.removeShadowCaster(mesh, false)
    },
    setQuality(tier) {
      if (disposed || tier === quality.tier) return
      const previous = quality
      quality = qualitySettings(tier)
      if (previous.shadows !== quality.shadows || previous.shadowMapSize !== quality.shadowMapSize || previous.shadowCascades !== quality.shadowCascades || previous.shadowDistance !== quality.shadowDistance || previous.softShadows !== quality.softShadows) createShadows()
      if (previous.environmentSize !== quality.environmentSize) {
        environment.dispose()
        environment = new SkyEnvironment(scene, quality.environmentSize)
        if (environment.texture) scene.environmentTexture = environment.texture
        environment.bake(state)
      }
    },
    setFogRange(metres) {
      fogRange = metres
      applyFog()
    },
    update(cameraPos) {
      if (!shadows || shadows instanceof CascadedShadowGenerator) return
      shadowFocus.copyFrom(cameraPos)
      placeShadowFrame(false)
    },
    dispose() {
      if (disposed) return
      disposed = true
      shadows?.dispose()
      shadows = null
      casters.clear()
      environment.dispose()
      dome.mesh.dispose()
      sunDisc.mesh.dispose()
      moonDisc.mesh.dispose()
      halo.mesh.dispose()
      skyMaterial.dispose()
      haloMaterial.dispose()
      hemi.dispose()
      sun.dispose()
    },
  }
  return atmosphere
}
