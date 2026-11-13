import { Scene } from '@babylonjs/core/scene'
import { MeshBuilder } from '@babylonjs/core/Meshes/meshBuilder'
import type { Mesh } from '@babylonjs/core/Meshes/mesh'
import { StandardMaterial } from '@babylonjs/core/Materials/standardMaterial'
import { CubeTexture } from '@babylonjs/core/Materials/Textures/cubeTexture'
import { Texture } from '@babylonjs/core/Materials/Textures/texture'
import { DirectionalLight } from '@babylonjs/core/Lights/directionalLight'
import { HemisphericLight } from '@babylonjs/core/Lights/hemisphericLight'
import { ShadowGenerator } from '@babylonjs/core/Lights/Shadows/shadowGenerator'
import '@babylonjs/core/Lights/Shadows/shadowGeneratorSceneComponent'
import { Color3, Color4 } from '@babylonjs/core/Maths/math.color'
import { Vector3 } from '@babylonjs/core/Maths/math.vector'
import { fbm, smoothstep } from './Noise'

export interface ArenaEnvironment {
  sun: DirectionalLight
  shadows: ShadowGenerator
  skybox: Mesh
}

export const SUN_DIRECTION = new Vector3(-0.7, 0.85, 0.3).normalize()
export const HAZE = new Color3(0.7, 0.78, 0.86)

const FACE_SIZE = 512
const FACES = ['px', 'py', 'pz', 'nx', 'ny', 'nz'] as const
const ZENITH = [58, 112, 196]
const HORIZON = [192, 212, 232]
const GROUND_HAZE = [176, 190, 200]
const SUN_GLOW = [255, 232, 196]

function faceDirection(face: typeof FACES[number], u: number, v: number): [number, number, number] {
  switch (face) {
    case 'px': return [1, -v, -u]
    case 'nx': return [-1, -v, u]
    case 'py': return [u, 1, v]
    case 'ny': return [u, -1, -v]
    case 'pz': return [u, -v, 1]
    case 'nz': return [-u, -v, -1]
  }
}

function skyColor(dx: number, dy: number, dz: number, out: number[]): void {
  const sun = Math.max(0, dx * SUN_DIRECTION.x + dy * SUN_DIRECTION.y + dz * SUN_DIRECTION.z)
  if (dy < 0) {
    const fade = Math.min(1, -dy * 6)
    for (let channel = 0; channel < 3; channel++) out[channel] = HORIZON[channel] * (1 - fade) + GROUND_HAZE[channel] * fade
    return
  }
  const height = Math.pow(dy, 0.42)
  const halo = Math.pow(sun, 10) * 0.32 + Math.pow(sun, 300) * 0.9
  for (let channel = 0; channel < 3; channel++) {
    out[channel] = HORIZON[channel] * (1 - height) + ZENITH[channel] * height + SUN_GLOW[channel] * halo
  }
  if (dy < 0.012) return
  const lift = 1 / (dy + 0.06)
  const cx = dx * lift * 0.55 + 11
  const cz = dz * lift * 0.55 - 4
  const shape = fbm(cx, cz, 5, 5)
  const wisps = fbm(cx * 3.1 + 40, cz * 3.1, 9, 3)
  const density = smoothstep(0.5, 0.74, shape * 0.85 + wisps * 0.15) * smoothstep(0.012, 0.16, dy)
  if (density <= 0) return
  const lit = 0.84 + Math.pow(sun, 3) * 0.2 - smoothstep(0.62, 0.9, shape) * 0.22
  const cover = density * 0.94
  for (let channel = 0; channel < 3; channel++) {
    const cloud = (248 - channel * 2) * lit + SUN_GLOW[channel] * Math.pow(sun, 24) * 0.25
    out[channel] = out[channel] * (1 - cover) + cloud * cover
  }
}

function paintFace(face: typeof FACES[number]): string {
  const canvas = document.createElement('canvas')
  canvas.width = canvas.height = FACE_SIZE
  const context = canvas.getContext('2d') as CanvasRenderingContext2D
  const image = context.createImageData(FACE_SIZE, FACE_SIZE)
  const color = [0, 0, 0]
  for (let py = 0; py < FACE_SIZE; py++) {
    for (let px = 0; px < FACE_SIZE; px++) {
      const [x, y, z] = faceDirection(face, (px + 0.5) / FACE_SIZE * 2 - 1, (py + 0.5) / FACE_SIZE * 2 - 1)
      const length = Math.hypot(x, y, z)
      skyColor(x / length, y / length, z / length, color)
      const offset = (py * FACE_SIZE + px) * 4
      image.data[offset] = Math.min(255, color[0])
      image.data[offset + 1] = Math.min(255, color[1])
      image.data[offset + 2] = Math.min(255, color[2])
      image.data[offset + 3] = 255
    }
  }
  context.putImageData(image, 0, 0)
  return canvas.toDataURL('image/png')
}

function createSky(scene: Scene): Mesh {
  const urls = FACES.map(face => paintFace(face))
  const environment = CubeTexture.CreateFromImages(urls, scene, false)
  scene.environmentTexture = environment
  scene.environmentIntensity = 1

  const backdrop = CubeTexture.CreateFromImages(urls, scene, true)
  backdrop.coordinatesMode = Texture.SKYBOX_MODE
  const material = new StandardMaterial('arena-sky', scene)
  material.backFaceCulling = false
  material.reflectionTexture = backdrop
  material.diffuseColor = Color3.Black()
  material.specularColor = Color3.Black()
  material.disableLighting = true
  const skybox = MeshBuilder.CreateBox('arena-skybox', { size: 1000 }, scene)
  skybox.material = material
  skybox.infiniteDistance = true
  skybox.isPickable = false
  skybox.applyFog = false
  return skybox
}

export function createEnvironment(scene: Scene): ArenaEnvironment {
  scene.clearColor = new Color4(HAZE.r, HAZE.g, HAZE.b, 1)
  scene.ambientColor = new Color3(0.3, 0.32, 0.36)
  scene.fogMode = Scene.FOGMODE_EXP2
  scene.fogDensity = 0.0017
  scene.fogColor = HAZE.clone()

  const skybox = createSky(scene)

  const fill = new HemisphericLight('arena-fill', new Vector3(0, 1, 0), scene)
  fill.intensity = 0.65
  fill.diffuse = new Color3(0.72, 0.82, 1)
  fill.groundColor = new Color3(0.5, 0.46, 0.38)
  fill.specular = Color3.Black()

  const sun = new DirectionalLight('arena-sun', SUN_DIRECTION.scale(-1), scene)
  sun.position = SUN_DIRECTION.scale(150)
  sun.intensity = 3.8
  sun.diffuse = new Color3(1, 0.95, 0.86)
  sun.shadowMinZ = 1
  sun.shadowMaxZ = 340

  const shadows = new ShadowGenerator(2048, sun)
  shadows.usePercentageCloserFiltering = true
  shadows.filteringQuality = ShadowGenerator.QUALITY_HIGH
  shadows.bias = 0.0006
  shadows.normalBias = 0.02
  shadows.darkness = 0

  return { sun, shadows, skybox }
}
