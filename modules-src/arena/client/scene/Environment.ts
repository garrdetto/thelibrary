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
import { GlowLayer } from '@babylonjs/core/Layers/glowLayer'
import { Color3, Color4 } from '@babylonjs/core/Maths/math.color'
import { Vector3 } from '@babylonjs/core/Maths/math.vector'

export interface ArenaEnvironment {
  sun: DirectionalLight
  shadows: ShadowGenerator
  glow: GlowLayer
  skybox: Mesh
}

const FACE_SIZE = 256
const FACES = ['px', 'py', 'pz', 'nx', 'ny', 'nz'] as const

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

function hash(x: number, y: number, seed: number): number {
  let h = Math.imul(x * 374761393 + y * 668265263 + seed * 2147483647, 1274126177)
  h = Math.imul(h ^ (h >>> 13), 1103515245)
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296
}

function paintFace(face: typeof FACES[number], index: number): string {
  const canvas = document.createElement('canvas')
  canvas.width = canvas.height = FACE_SIZE
  const context = canvas.getContext('2d') as CanvasRenderingContext2D
  const image = context.createImageData(FACE_SIZE, FACE_SIZE)
  const zenith = [6, 10, 28]
  const horizon = [42, 74, 120]
  const glow = [120, 210, 255]
  for (let py = 0; py < FACE_SIZE; py++) {
    for (let px = 0; px < FACE_SIZE; px++) {
      const [dx, dy, dz] = faceDirection(face, (px + 0.5) / FACE_SIZE * 2 - 1, (py + 0.5) / FACE_SIZE * 2 - 1)
      const length = Math.hypot(dx, dy, dz)
      const up = dy / length
      const height = Math.max(0, up)
      const blend = Math.pow(height, 0.55)
      const band = Math.exp(-Math.pow(up * 9, 2)) * 0.55
      const sunward = Math.max(0, (-dx * 0.5 + dz * 0.3 + dy * 0.4) / length)
      const halo = Math.pow(sunward, 18) * 0.6
      const offset = (py * FACE_SIZE + px) * 4
      for (let channel = 0; channel < 3; channel++) {
        let value = horizon[channel] * (1 - blend) + zenith[channel] * blend
        value += glow[channel] * (band + halo)
        if (up < 0) value *= 0.35 + 0.65 * (1 + up)
        image.data[offset + channel] = Math.min(255, value)
      }
      image.data[offset + 3] = 255
      if (up > 0.08 && hash(px, py, index) > 0.9975) {
        const twinkle = 150 + hash(py, px, index + 7) * 105
        image.data[offset] = image.data[offset + 1] = image.data[offset + 2] = twinkle
      }
    }
  }
  context.putImageData(image, 0, 0)
  return canvas.toDataURL('image/png')
}

function createSkybox(scene: Scene): Mesh {
  const urls = FACES.map((face, index) => paintFace(face, index))
  const texture = CubeTexture.CreateFromImages(urls, scene, true)
  texture.coordinatesMode = Texture.SKYBOX_MODE
  const material = new StandardMaterial('arena-sky', scene)
  material.backFaceCulling = false
  material.reflectionTexture = texture
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
  scene.clearColor = new Color4(0.02, 0.03, 0.07, 1)
  scene.ambientColor = new Color3(0.25, 0.28, 0.35)
  scene.fogMode = Scene.FOGMODE_EXP2
  scene.fogDensity = 0.0035
  scene.fogColor = new Color3(0.12, 0.2, 0.32)

  const skybox = createSkybox(scene)

  const fill = new HemisphericLight('arena-fill', new Vector3(0, 1, 0), scene)
  fill.intensity = 0.45
  fill.diffuse = new Color3(0.62, 0.74, 0.95)
  fill.groundColor = new Color3(0.14, 0.12, 0.16)
  fill.specular = Color3.Black()

  const sun = new DirectionalLight('arena-sun', new Vector3(0.45, -1, -0.3).normalize(), scene)
  sun.position = new Vector3(-60, 110, 40)
  sun.intensity = 1.25
  sun.diffuse = new Color3(1, 0.95, 0.86)
  sun.shadowMinZ = 1
  sun.shadowMaxZ = 260

  const shadows = new ShadowGenerator(2048, sun)
  shadows.usePercentageCloserFiltering = true
  shadows.filteringQuality = ShadowGenerator.QUALITY_MEDIUM
  shadows.bias = 0.0008
  shadows.normalBias = 0.02
  shadows.darkness = 0.25

  const glow = new GlowLayer('arena-glow', scene, { mainTextureRatio: 0.5, blurKernelSize: 48 })
  glow.intensity = 0.85

  return { sun, shadows, glow, skybox }
}
