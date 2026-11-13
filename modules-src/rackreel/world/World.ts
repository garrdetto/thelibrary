import { Constants } from '@babylonjs/core/Engines/constants'
import { ShaderLanguage } from '@babylonjs/core/Materials/shaderLanguage'
import { ShaderMaterial } from '@babylonjs/core/Materials/shaderMaterial'
import { StandardMaterial } from '@babylonjs/core/Materials/standardMaterial'
import { DynamicTexture } from '@babylonjs/core/Materials/Textures/dynamicTexture'
import { RawTexture } from '@babylonjs/core/Materials/Textures/rawTexture'
import { Texture } from '@babylonjs/core/Materials/Textures/texture'
import { Color3 } from '@babylonjs/core/Maths/math.color'
import { Vector3, Vector4 } from '@babylonjs/core/Maths/math.vector'
import { CreateBox } from '@babylonjs/core/Meshes/Builders/boxBuilder'
import { CreateGround } from '@babylonjs/core/Meshes/Builders/groundBuilder'
import { CreateSphere } from '@babylonjs/core/Meshes/Builders/sphereBuilder'
import { Mesh } from '@babylonjs/core/Meshes/mesh'
import { VertexData } from '@babylonjs/core/Meshes/mesh.vertexData'
import type { Scene } from '@babylonjs/core/scene'
import type { EngineContext } from '../core/EngineSetup'
import { FOG_COLOR, FOG_DENSITY } from '../core/EngineSetup'
import './Shaders'
import { woodMaterial } from './Surfaces'
import { CELL, GRID, HALF, LAKE_CENTER, Terrain, WOODS_FLOOR, WORLD_SIZE, fbm, forestDensity, lakeCoord, lakeRadius, marshWeight, smoothstep, trailOffset } from './Terrain'

export interface Landmarks {
  dock: { start: Vector3; end: Vector3; heading: number }
  spawn: Vector3
  spawnHeading: number
  boat: Vector3
  boatHeading: number
  utv: Vector3
  utvHeading: number
}

function mixColor(a: readonly number[], b: readonly number[], t: number): number[] {
  const k = Math.min(1, Math.max(0, t))
  return [a[0] + (b[0] - a[0]) * k, a[1] + (b[1] - a[1]) * k, a[2] + (b[2] - a[2]) * k]
}

export function detailTexture(scene: Scene): DynamicTexture {
  const size = 256
  const tex = new DynamicTexture('ground-detail', { width: size, height: size }, scene, true)
  const ctx = tex.getContext() as CanvasRenderingContext2D
  const img = ctx.createImageData(size, size)
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const u = x / size
      const v = y / size
      const n = (fbm(u * 16, v * 16, 4, 77) + fbm(u * 64, v * 64, 2, 91) * 0.5) * 0.5
      const tiled = n
      const g = Math.max(0, Math.min(255, Math.round((0.86 + tiled * 0.36) * 210)))
      const i = (y * size + x) * 4
      img.data[i] = g
      img.data[i + 1] = g
      img.data[i + 2] = g
      img.data[i + 3] = 255
    }
  }
  ctx.putImageData(img, 0, 0)
  tex.update(false)
  tex.wrapU = Texture.WRAP_ADDRESSMODE
  tex.wrapV = Texture.WRAP_ADDRESSMODE
  tex.anisotropicFilteringLevel = 8
  return tex
}

export function buildGround(ctx: EngineContext, terrain: Terrain): Mesh {
  const { scene } = ctx
  const n = GRID + 1
  const positions = new Float32Array(n * n * 3)
  const colors = new Float32Array(n * n * 4)
  const uvs = new Float32Array(n * n * 2)
  const indices = new Uint32Array(GRID * GRID * 6)
  const sand = [0.62, 0.55, 0.42]
  const mud = [0.29, 0.25, 0.17]
  const lakebed = [0.36, 0.32, 0.22]
  const meadow = [0.42, 0.47, 0.22]
  const meadowDry = [0.56, 0.52, 0.3]
  const { needles, moss } = terrain.shape.woodsFloor ?? WOODS_FLOOR
  const marsh = [0.36, 0.38, 0.2]
  const rock = [0.45, 0.44, 0.41]
  const trail = [0.44, 0.36, 0.25]
  const shoulder = [0.43, 0.39, 0.31]
  for (let j = 0; j < n; j++) {
    for (let i = 0; i < n; i++) {
      const k = j * n + i
      const x = -HALF + i * CELL
      const z = -HALF + j * CELL
      const h = terrain.heights[k]
      positions[k * 3] = x
      positions[k * 3 + 1] = h
      positions[k * 3 + 2] = z
      uvs[k * 2] = x / 7
      uvs[k * 2 + 1] = z / 7
      const slope = terrain.slopeAt(x, z)
      const forest = forestDensity(x, z)
      const { s, angle } = lakeCoord(x, z)
      const varN = fbm(x * 0.05, z * 0.05, 3, 13) * 0.5 + 0.5
      let c = mixColor(meadow, meadowDry, fbm(x * 0.012, z * 0.012, 3, 41) + 0.4)
      c = mixColor(c, mixColor(needles, moss, varN * 0.8), smoothstep(0.25, 0.65, forest))
      c = mixColor(c, marsh, marshWeight(angle) * smoothstep(2.0, 1.2, s))
      if (s > 1.2) c = mixColor(trail, c, smoothstep(1.4, 3.6, trailOffset(x, z)))
      const road = terrain.shape.roadClear?.(x, z) ?? Infinity
      if (road < 4) c = mixColor(shoulder, c, smoothstep(0, 4, road))
      c = mixColor(c, rock, smoothstep(0.5, 0.8, slope))
      c = mixColor(c, sand, smoothstep(1.4, 0.4, h) * (1 - marshWeight(angle) * 0.8))
      c = mixColor(c, mud, smoothstep(0.6, -0.2, h) * marshWeight(angle))
      c = mixColor(c, lakebed, smoothstep(-0.2, -2.5, h))
      const lin = c
      const shade = 0.85 + varN * 0.3
      colors[k * 4] = lin[0] * shade
      colors[k * 4 + 1] = lin[1] * shade
      colors[k * 4 + 2] = lin[2] * shade
      colors[k * 4 + 3] = 1
    }
  }
  let t = 0
  for (let j = 0; j < GRID; j++) {
    for (let i = 0; i < GRID; i++) {
      const a = j * n + i
      const b = a + 1
      const c = a + n
      const d = c + 1
      indices[t++] = a
      indices[t++] = b
      indices[t++] = c
      indices[t++] = d
      indices[t++] = c
      indices[t++] = b
    }
  }
  const normals = new Float32Array(positions.length)
  VertexData.ComputeNormals(positions, indices, normals, { useRightHandedSystem: false })
  const data = new VertexData()
  data.positions = positions
  data.indices = indices
  data.normals = normals
  data.colors = colors
  data.uvs = uvs
  const ground = new Mesh('terrain', scene)
  data.applyToMesh(ground, false)
  const mat = new StandardMaterial('terrain-mat', scene)
  mat.diffuseTexture = detailTexture(scene)
  mat.specularColor = new Color3(0.02, 0.02, 0.02)
  mat.ambientColor = new Color3(0.4, 0.4, 0.4)
  mat.freeze()
  ground.material = mat
  ground.receiveShadows = true
  ground.isPickable = true
  ground.freezeWorldMatrix()
  ctx.enableTerrainOctree(ground)
  return ground
}

export function buildSky(ctx: EngineContext): { mesh: Mesh; material: ShaderMaterial } {
  const { scene } = ctx
  const mesh = CreateSphere('sky', { diameter: 2000, segments: 24, sideOrientation: Mesh.BACKSIDE }, scene)
  const material = new ShaderMaterial('sky-mat', scene, 'rrSky', {
    attributes: ['position'],
    uniforms: ['worldViewProjection', 'sunDir', 'moonDir', 'night', 'glow', 'time'],
    shaderLanguage: ctx.engine.isWebGPU ? ShaderLanguage.WGSL : ShaderLanguage.GLSL,
  })
  material.setVector3('sunDir', ctx.sunDirection.scale(-1))
  material.setVector3('moonDir', ctx.sunDirection.clone())
  material.setFloat('night', 0)
  material.setFloat('glow', 0)
  material.setFloat('time', 0)
  material.backFaceCulling = false
  material.disableDepthWrite = true
  material.freeze()
  mesh.material = material
  mesh.infiniteDistance = true
  mesh.applyFog = false
  mesh.isPickable = false
  mesh.alwaysSelectAsActiveMesh = true
  mesh.doNotSyncBoundingInfo = true
  return { mesh, material }
}

export function buildWater(ctx: EngineContext, terrain: Terrain): { mesh: Mesh; material: ShaderMaterial } {
  const { scene } = ctx
  const n = GRID + 1
  const bytes = new Uint8Array(n * n * 4)
  for (let k = 0; k < n * n; k++) {
    const depth = Math.max(0, -terrain.heights[k])
    const v = Math.min(255, Math.round((depth / 24) * 255))
    bytes[k * 4] = depth > 0 ? Math.max(1, v) : 0
    bytes[k * 4 + 3] = 255
  }
  const depthMap = RawTexture.CreateRGBATexture(bytes, n, n, scene, false, false, Texture.BILINEAR_SAMPLINGMODE)
  depthMap.wrapU = Texture.CLAMP_ADDRESSMODE
  depthMap.wrapV = Texture.CLAMP_ADDRESSMODE
  const r = 330
  const mesh = CreateGround('water', { width: r * 2, height: r * 2, subdivisions: 2 }, scene)
  mesh.position.set(LAKE_CENTER.x + 40, 0, LAKE_CENTER.z + 60)
  const material = new ShaderMaterial('water-mat', scene, 'rrWater', {
    attributes: ['position'],
    uniforms: ['world', 'viewProjection', 'cameraPos', 'fogColor', 'fogDensity', 'time', 'worldSize', 'sunDir', 'moonDir', 'night', 'glow', 'lampPos', 'lampDir', 'lampColor'],
    samplers: ['depthMap'],
    needAlphaBlending: true,
    shaderLanguage: ctx.engine.isWebGPU ? ShaderLanguage.WGSL : ShaderLanguage.GLSL,
  })
  material.setTexture('depthMap', depthMap)
  material.setVector3('sunDir', ctx.sunDirection.scale(-1))
  material.setVector3('moonDir', ctx.sunDirection.clone())
  material.setFloat('night', 0)
  material.setFloat('glow', 0)
  material.setVector3('lampPos', new Vector3(0, -100, 0))
  material.setVector3('lampDir', new Vector3(0, -1, 0))
  material.setVector3('lampColor', Vector3.Zero())
  material.setColor3('fogColor', FOG_COLOR)
  material.setFloat('fogDensity', FOG_DENSITY)
  material.setFloat('worldSize', WORLD_SIZE)
  material.alphaMode = Constants.ALPHA_COMBINE
  material.backFaceCulling = false
  material.freeze()
  mesh.material = material
  mesh.isPickable = false
  mesh.alphaIndex = 0
  mesh.freezeWorldMatrix()
  return { mesh, material }
}

export function findLandmarks(terrain: Terrain): Landmarks {
  const angle = -0.9
  const radius = lakeRadius(angle)
  const dir = new Vector3(Math.cos(angle), 0, Math.sin(angle))
  let shoreDist = radius * 0.8
  for (let d = radius * 0.7; d < radius * 1.5; d += 0.5) {
    const x = LAKE_CENTER.x + dir.x * d
    const z = LAKE_CENTER.z + dir.z * d
    if (terrain.heightAt(x, z) > 0.6) {
      shoreDist = d
      break
    }
  }
  const at = (d: number) => new Vector3(LAKE_CENTER.x + dir.x * d, 0, LAKE_CENTER.z + dir.z * d)
  const start = at(shoreDist + 2)
  start.y = terrain.heightAt(start.x, start.z)
  const end = at(shoreDist - 16)
  const heading = Math.atan2(-dir.x, -dir.z)
  const spawn = at(shoreDist + 7)
  spawn.y = terrain.heightAt(spawn.x, spawn.z)
  const side = new Vector3(dir.z, 0, -dir.x)
  const boat = end.add(side.scale(2.6)).add(dir.scale(1.5))
  const utv = at(shoreDist + 14).add(side.scale(-6))
  utv.y = terrain.heightAt(utv.x, utv.z)
  return { dock: { start, end, heading }, spawn, spawnHeading: heading, boat, boatHeading: heading, utv, utvHeading: heading + Math.PI / 2 }
}

export function buildDock(ctx: EngineContext, landmarks: Landmarks): Mesh {
  const { scene } = ctx
  const { start, end } = landmarks.dock
  const length = Vector3.Distance(new Vector3(start.x, 0, start.z), new Vector3(end.x, 0, end.z))
  const planks: Mesh[] = []
  const posts: Mesh[] = []
  const deckY = 0.55
  const count = Math.floor(length / 0.3)
  let seed = 1
  const rand = () => {
    seed = (seed * 16807) % 2147483647
    return seed / 2147483647
  }
  for (let i = 0; i < count; i++) {
    const u0 = rand() * 0.45
    const v0 = rand() * 0.8
    const face = new Vector4(u0, v0, u0 + 0.5, v0 + 0.12)
    const p = CreateBox('plank', { width: 1.9, height: 0.06, depth: 0.27, faceUV: [face, face, face, face, face, face] }, scene)
    p.position.set((rand() - 0.5) * 0.04, deckY + (rand() - 0.5) * 0.008, -length / 2 + i * 0.3 + 0.15)
    p.rotation.y = (rand() - 0.5) * 0.012
    planks.push(p)
  }
  for (let i = 0; i <= Math.floor(length / 2.4); i++) {
    for (const sx of [-0.9, 0.9]) {
      const u0 = rand() * 0.6
      const face = new Vector4(u0, 0, u0 + 0.35, 1)
      const post = CreateBox('post', { width: 0.16, height: 3.2, depth: 0.16, faceUV: [face, face, face, face, face, face] }, scene)
      post.position.set(sx, deckY - 1.4, -length / 2 + i * 2.4)
      posts.push(post)
    }
  }
  const deck = Mesh.MergeMeshes(planks, true, true)!
  deck.material = woodMaterial(scene, 'dock-deck', false, [0.62, 0.52, 0.41], 11)
  const legs = Mesh.MergeMeshes(posts, true, true)!
  legs.material = woodMaterial(scene, 'dock-post', true, [0.4, 0.33, 0.26], 23)
  const dock = Mesh.MergeMeshes([deck, legs], true, true, undefined, true, true)!
  dock.name = 'dock'
  const mid = start.add(end).scale(0.5)
  dock.position.set(mid.x, 0, mid.z)
  dock.rotation.y = Math.atan2(end.x - start.x, end.z - start.z)
  dock.receiveShadows = true
  dock.isPickable = false
  ctx.shadows.addShadowCaster(dock)
  return dock
}

export function lakeShorePoint(terrain: Terrain, angle: number): Vector3 {
  const r = lakeRadius(angle)
  for (let d = r * 0.6; d < r * 1.6; d += 1) {
    const x = LAKE_CENTER.x + Math.cos(angle) * d
    const z = LAKE_CENTER.z + Math.sin(angle) * d
    if (terrain.heightAt(x, z) > 0) return new Vector3(x, 0, z)
  }
  return new Vector3(LAKE_CENTER.x, 0, LAKE_CENTER.z)
}
