/** Builds one lake: terrain from the shared bathymetry, depth-tinted water with moving ripples, seasonal forest, reeds and lily pads, cabins with docks and the public landing. */
import * as pc from 'playcanvas'
import { GeoBuilder, instanced, matrix, vertexColorMaterial } from './Geo'
import type { Rgb } from './Geo'
import { groundGrain, rippleNormals } from './Textures'
import { bottomAt, depthFeetAt, heightAt, interior, lakeExtent, landingOf, shorePoint } from '../shared/Lakes'
import type { Bottom, LakeDef } from '../shared/Lakes'
import { clamp, fbm, hash2, mulberry32, smoothstep } from '../shared/Random'

export type Quality = 'low' | 'medium' | 'high'

export interface Season {
  month: number
  /** 0 summer green to 1 peak fall colour. */
  fall: number
  /** Hardwoods have dropped their leaves. */
  bare: boolean
  snow: boolean
  tamarackGold: boolean
}

export function seasonFor(month: number, day: number): Season {
  const t = month + day / 31
  return {
    month,
    fall: smoothstep(8.6, 9.8, t) * (1 - smoothstep(10.2, 10.7, t)),
    bare: t >= 10.5 || t < 4.4,
    snow: t >= 11.3 || t < 2.6,
    tamarackGold: t >= 9.4 && t < 10.6,
  }
}

const bottomColor: Record<Bottom, Rgb> = {
  sand: [0.66, 0.6, 0.46], gravel: [0.55, 0.52, 0.46], rock: [0.46, 0.45, 0.42], muck: [0.28, 0.24, 0.17], weed: [0.27, 0.37, 0.18], timber: [0.36, 0.3, 0.2],
}

export class LakeScene {
  readonly root: pc.Entity
  private readonly waterMaterial: pc.StandardMaterial
  private time = 0

  constructor(app: pc.AppBase, readonly lake: LakeDef, quality: Quality, season: Season) {
    this.root = new pc.Entity(`lake-${lake.id}`)
    const device = app.graphicsDevice
    const grain = groundGrain(device)
    this.root.addChild(this.buildTerrain(app, grain, quality, season))
    this.root.addChild(this.buildHorizon(app, season))
    const water = this.buildWater(app)
    this.waterMaterial = water.material
    this.root.addChild(water.entity)
    this.root.addChild(this.buildForest(app, quality, season))
    this.root.addChild(this.buildShallows(app, quality, season))
    this.root.addChild(this.buildCabins(app, season))
    this.root.addChild(this.buildLanding(app))
  }

  private buildTerrain(app: pc.AppBase, grain: pc.Texture, quality: Quality, season: Season): pc.Entity {
    const lake = this.lake
    const extent = lakeExtent(lake)
    const max = quality === 'high' ? 480 : quality === 'medium' ? 360 : 240
    const n = Math.round(clamp((extent * 2) / 6.5, 160, max))
    const step = (extent * 2) / n
    const positions = new Float32Array((n + 1) * (n + 1) * 3)
    const colors = new Uint8Array((n + 1) * (n + 1) * 4)
    const uvs = new Float32Array((n + 1) * (n + 1) * 2)
    const heights = new Float32Array((n + 1) * (n + 1))
    for (let j = 0; j <= n; j++) for (let i = 0; i <= n; i++) {
      const x = -extent + i * step, z = -extent + j * step
      heights[j * (n + 1) + i] = heightAt(lake, x, z)
    }
    const grass: Rgb = season.snow ? [0.9, 0.92, 0.95] : season.bare ? [0.5, 0.45, 0.32] : [0.38 + season.fall * 0.14, 0.48 - season.fall * 0.08, 0.22]
    const floor: Rgb = season.snow ? [0.84, 0.86, 0.9] : [0.34, 0.29, 0.19]
    const beach: Rgb = lake.id === 'tamarack' ? [0.34, 0.31, 0.2] : lake.id === 'mill-pond' || lake.id === 'wolf-rapids' ? [0.54, 0.46, 0.33] : [0.72, 0.66, 0.52]
    for (let j = 0; j <= n; j++) for (let i = 0; i <= n; i++) {
      const k = j * (n + 1) + i
      const x = -extent + i * step, z = -extent + j * step
      const h = heights[k]
      positions[k * 3] = x; positions[k * 3 + 1] = h; positions[k * 3 + 2] = z
      uvs[k * 2] = x / 9; uvs[k * 2 + 1] = z / 9
      const hl = heights[j * (n + 1) + Math.max(0, i - 1)], hr = heights[j * (n + 1) + Math.min(n, i + 1)]
      const hd = heights[Math.max(0, j - 1) * (n + 1) + i], hu = heights[Math.min(n, j + 1) * (n + 1) + i]
      const slope = Math.hypot(hr - hl, hu - hd) / (2 * step)
      let c: Rgb
      if (h < -0.15) {
        c = bottomColor[bottomAt(lake, x, z)]
      } else if (h < 1.1) {
        c = beach
      } else {
        const forest = fbm(x / 120, z / 120, lake.seed + 31, 3)
        c = forest > 0.5 ? floor : grass
        const v = 0.85 + 0.3 * fbm(x / 25, z / 25, lake.seed + 41, 2)
        c = [c[0] * v, c[1] * v, c[2] * v]
      }
      if (slope > 0.6 && h > 0.5) c = [0.5, 0.49, 0.46]
      colors[k * 4] = Math.round(clamp(c[0], 0, 1) * 255)
      colors[k * 4 + 1] = Math.round(clamp(c[1], 0, 1) * 255)
      colors[k * 4 + 2] = Math.round(clamp(c[2], 0, 1) * 255)
      colors[k * 4 + 3] = 255
    }
    const indices = new Uint32Array(n * n * 6)
    let p = 0
    for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) {
      const a = j * (n + 1) + i, b = a + 1, c = a + n + 1, d = c + 1
      indices[p++] = a; indices[p++] = c; indices[p++] = b
      indices[p++] = b; indices[p++] = c; indices[p++] = d
    }
    const mesh = new pc.Mesh(app.graphicsDevice)
    mesh.setPositions(positions)
    mesh.setNormals(pc.calculateNormals(Array.from(positions), Array.from(indices)))
    mesh.setColors32(colors)
    mesh.setUvs(0, uvs)
    mesh.setIndices(indices)
    mesh.update()
    const material = new pc.StandardMaterial()
    material.diffuse = new pc.Color(1, 1, 1)
    material.diffuseVertexColor = true
    ;(material as pc.StandardMaterial & { vertexColorGamma: boolean }).vertexColorGamma = true
    material.diffuseMap = grain
    material.useMetalness = true
    material.metalness = 0
    material.gloss = 0.12
    material.update()
    const entity = new pc.Entity('terrain')
    const mi = new pc.MeshInstance(mesh, material)
    mi.receiveShadow = true
    mi.castShadow = false
    entity.addComponent('render', { meshInstances: [mi], castShadows: false, receiveShadows: true })
    return entity
  }

  private buildHorizon(app: pc.AppBase, season: Season): pc.Entity {
    const extent = lakeExtent(this.lake)
    const g = new GeoBuilder()
    const segs = 96
    const inner = extent * 0.96, outer = extent + 4200
    const ring: number[] = []
    const col: Rgb = season.snow ? [0.55, 0.58, 0.62] : season.bare ? [0.22, 0.2, 0.16] : [0.1, 0.16, 0.09]
    for (let s = 0; s <= segs; s++) {
      const a = (s / segs) * Math.PI * 2
      const ridge = 40 + fbm(Math.cos(a) * 4 + 3, Math.sin(a) * 4 + 3, this.lake.seed + 77, 4) * 160
      for (const [r, y] of [[inner, 1], [inner + 600, ridge * 0.4], [outer, ridge]] as const) {
        ring.push(g.positions.length / 3)
        g.positions.push(Math.cos(a) * r, y, Math.sin(a) * r)
        g.normals.push(-Math.cos(a) * 0.3, 1, -Math.sin(a) * 0.3)
        g.colors.push(...col)
        g.uvs.push(0, 0)
      }
    }
    for (let s = 0; s < segs; s++) for (let k = 0; k < 2; k++) {
      const a = s * 3 + k, b = (s + 1) * 3 + k
      g.indices.push(a, a + 1, b, b, a + 1, b + 1)
    }
    const e = new pc.Entity('horizon')
    e.addComponent('render', { meshInstances: [new pc.MeshInstance(g.toMesh(app.graphicsDevice), vertexColorMaterial({ gloss: 0.05 }))], castShadows: false })
    return e
  }

  private buildWater(app: pc.AppBase): { entity: pc.Entity; material: pc.StandardMaterial } {
    const lake = this.lake
    const span = lake.radius * Math.max(lake.stretch[0], lake.stretch[1]) * 1.4
    const n = 150
    const step = (span * 2) / n
    const positions = new Float32Array((n + 1) * (n + 1) * 3)
    const colors = new Uint8Array((n + 1) * (n + 1) * 4)
    const uvs = new Float32Array((n + 1) * (n + 1) * 2)
    const deep = lake.water.deep, shallow = lake.water.shallow
    const seeFt = 2 + lake.water.clarity * 12
    for (let j = 0; j <= n; j++) for (let i = 0; i <= n; i++) {
      const k = j * (n + 1) + i
      const x = -span + i * step, z = -span + j * step
      positions[k * 3] = x; positions[k * 3 + 1] = 0; positions[k * 3 + 2] = z
      uvs[k * 2] = x; uvs[k * 2 + 1] = z
      const d = depthFeetAt(lake, x, z)
      const t = smoothstep(0, seeFt * 1.5, d)
      colors[k * 4] = Math.round((shallow[0] + (deep[0] - shallow[0]) * t) * 255)
      colors[k * 4 + 1] = Math.round((shallow[1] + (deep[1] - shallow[1]) * t) * 255)
      colors[k * 4 + 2] = Math.round((shallow[2] + (deep[2] - shallow[2]) * t) * 255)
      colors[k * 4 + 3] = Math.round(clamp(0.42 + smoothstep(0, seeFt, d) * 0.56, 0, 0.97) * 255)
    }
    const indices = new Uint32Array(n * n * 6)
    let p = 0
    for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) {
      const a = j * (n + 1) + i, b = a + 1, c = a + n + 1, d = c + 1
      indices[p++] = a; indices[p++] = c; indices[p++] = b
      indices[p++] = b; indices[p++] = c; indices[p++] = d
    }
    const mesh = new pc.Mesh(app.graphicsDevice)
    mesh.setPositions(positions)
    mesh.setNormals(new Float32Array(positions.length).map((_, i) => (i % 3 === 1 ? 1 : 0)))
    mesh.setColors32(colors)
    mesh.setUvs(0, uvs)
    mesh.setIndices(indices)
    mesh.update()
    const material = new pc.StandardMaterial()
    material.diffuse = new pc.Color(1, 1, 1)
    material.diffuseVertexColor = true
    material.opacityVertexColor = true
    material.opacityVertexColorChannel = 'a'
    material.blendType = pc.BLEND_NORMAL
    material.depthWrite = true
    material.useMetalness = false
    material.specular = new pc.Color(0.3, 0.32, 0.33)
    material.fresnelModel = pc.FRESNEL_SCHLICK
    material.gloss = 0.93
    material.normalMap = rippleNormals(app.graphicsDevice, 6, 101)
    material.normalMapTiling = new pc.Vec2(1 / 7, 1 / 7)
    material.bumpiness = 0.45
    material.normalDetailMap = rippleNormals(app.graphicsDevice, 4, 211)
    material.normalDetailMapTiling = new pc.Vec2(1 / 2.2, 1 / 2.2)
    material.normalDetailMapBumpiness = 0.35
    material.update()
    const entity = new pc.Entity('water')
    const mi = new pc.MeshInstance(mesh, material)
    mi.castShadow = false
    mi.receiveShadow = true
    entity.addComponent('render', { meshInstances: [mi], castShadows: false, receiveShadows: true })
    return { entity, material }
  }

  setWind(speedMph: number): void {
    this.waterMaterial.bumpiness = 0.25 + clamp(speedMph / 18, 0, 1) * 0.75
    this.waterMaterial.update()
  }

  update(dt: number, wind: { x: number; z: number; speed: number }): void {
    this.time += dt
    const s = 0.012 + wind.speed * 0.0016
    const m = this.waterMaterial
    m.normalMapOffset = new pc.Vec2((this.time * s * wind.x) % 1, (this.time * s * wind.z) % 1)
    m.normalDetailMapOffset = new pc.Vec2((-this.time * 0.021 + this.time * s * 0.6 * wind.z) % 1, (this.time * 0.017) % 1)
    m.update()
  }

  private buildForest(app: pc.AppBase, quality: Quality, season: Season): pc.Entity {
    const lake = this.lake
    const root = new pc.Entity('forest')
    const extent = lakeExtent(lake)
    const rand = mulberry32(lake.seed * 97)
    const budget = quality === 'high' ? 9000 : quality === 'medium' ? 5500 : 2600
    const kinds = ['pine', 'spruce', 'birch', 'hardwood', 'tamarack'] as const
    const weights = { pine: lake.shore.pine * 0.55, spruce: lake.shore.pine * 0.45, birch: lake.shore.birch, hardwood: lake.shore.hardwood, tamarack: lake.shore.tamarack }
    const total = kinds.reduce((s, k) => s + weights[k], 0)
    const mats: Record<string, number[]> = { pine: [], spruce: [], birch: [], hardwood: [], tamarack: [] }
    const landing = landingOf(lake)
    let placed = 0
    for (let attempt = 0; attempt < budget * 6 && placed < budget; attempt++) {
      const x = (rand() * 2 - 1) * extent, z = (rand() * 2 - 1) * extent
      const s = interior(lake, x, z)
      if (s > -0.012) continue
      const h = heightAt(lake, x, z)
      if (h < 1.4) continue
      if (Math.hypot(x - landing.shoreX, z - landing.shoreZ) < 45) continue
      const density = fbm(x / 160, z / 160, lake.seed + 51, 3)
      const nearShore = 1 - smoothstep(0.02, 0.5, -s)
      if (rand() > density * 1.2 + nearShore * 0.35) continue
      let pick = rand() * total
      let kind: (typeof kinds)[number] = 'pine'
      for (const k of kinds) { pick -= weights[k]; if (pick <= 0) { kind = k; break } }
      const scale = 0.75 + rand() * 0.6
      mats[kind].push(...matrix(x, h - 0.3, z, rand() * 360, scale, scale * (0.85 + rand() * 0.35), (rand() - 0.5) * 6, (rand() - 0.5) * 6))
      placed++
    }
    const material = vertexColorMaterial({ gloss: 0.1 })
    for (const kind of kinds) {
      if (!mats[kind].length) continue
      const mesh = treeMesh(kind, season).toMesh(app.graphicsDevice)
      root.addChild(instanced(app, mesh, material, new Float32Array(mats[kind]), `trees-${kind}`, quality !== 'low'))
    }
    return root
  }

  private buildShallows(app: pc.AppBase, quality: Quality, season: Season): pc.Entity {
    const lake = this.lake
    const root = new pc.Entity('shallows')
    const rand = mulberry32(lake.seed * 13 + 5)
    const reedMats: number[] = []
    const padMats: number[] = []
    const count = Math.round((quality === 'low' ? 900 : 2200) * lake.shore.reeds)
    for (let i = 0; i < count * 8 && reedMats.length / 16 < count; i++) {
      const a = rand() * Math.PI * 2
      const [sx, sz] = shorePoint(lake, a)
      const inward = 2 + rand() * 18
      const d = Math.hypot(sx, sz) || 1
      const x = sx - (sx / d) * inward + (rand() - 0.5) * 6, z = sz - (sz / d) * inward + (rand() - 0.5) * 6
      const depth = depthFeetAt(lake, x, z)
      if (depth < 0.3 || depth > 3.5) continue
      if (hash2(Math.floor(x / 14), Math.floor(z / 14), lake.seed) < 0.45) continue
      reedMats.push(...matrix(x, heightAt(lake, x, z), z, rand() * 360, 1.2 + rand() * 0.6, 1 + rand() * 0.5))
    }
    for (const f of lake.features) {
      if (f.kind !== 'weed') continue
      const n = Math.round(f.r * 1.2)
      for (let i = 0; i < n; i++) {
        const r = Math.sqrt(rand()) * f.r, a = rand() * Math.PI * 2
        const x = f.x + Math.cos(a) * r, z = f.z + Math.sin(a) * r
        const depth = depthFeetAt(lake, x, z)
        if (depth < 1 || depth > 9) continue
        padMats.push(...matrix(x, 0.015, z, rand() * 360, 0.5 + rand() * 0.6, 1))
      }
    }
    const reedColor: Rgb = season.bare ? [0.55, 0.47, 0.3] : season.fall > 0.3 ? [0.5, 0.48, 0.25] : [0.3, 0.42, 0.16]
    const reeds = new GeoBuilder()
    for (let k = 0; k < 7; k++) {
      const a = k * 51
      reeds.card(reedColor, { pos: [Math.sin(a) * 0.25, -0.2, Math.cos(a) * 0.25], rot: [(k % 3) * 4 - 4, a, 0], scale: [0.08, 1.6 + (k % 3) * 0.3, 1] }, [reedColor[0] * 1.2, reedColor[1] * 1.15, reedColor[2]])
      if (k % 2 === 0) reeds.cylinder([0.32, 0.2, 0.1], 0.025, 0.02, 5, { pos: [Math.sin(a) * 0.25, 1.15 + (k % 3) * 0.2, Math.cos(a) * 0.25], scale: [1, 0.22, 1] })
    }
    const pads = new GeoBuilder()
    if (!season.snow) {
      for (let s = 0; s < 12; s++) {
        const a0 = (s / 12) * Math.PI * 2 + 0.25, a1 = ((s + 1) / 12) * Math.PI * 2 + 0.25
        const base = pads.positions.length / 3
        const c: Rgb = season.bare ? [0.3, 0.28, 0.14] : [0.16, 0.34, 0.1]
        pads.positions.push(0, 0, 0, Math.cos(a0) * 0.5, 0, Math.sin(a0) * 0.5, Math.cos(a1) * 0.5, 0, Math.sin(a1) * 0.5)
        pads.normals.push(0, 1, 0, 0, 1, 0, 0, 1, 0)
        pads.colors.push(...c, ...c, ...c)
        pads.uvs.push(0, 0, 0, 0, 0, 0)
        pads.indices.push(base, base + 2, base + 1)
      }
    }
    const mat = vertexColorMaterial({ gloss: 0.25, cull: pc.CULLFACE_NONE })
    if (reedMats.length) root.addChild(instanced(app, reeds.toMesh(app.graphicsDevice), mat, new Float32Array(reedMats), 'reeds', false))
    if (padMats.length && pads.positions.length) root.addChild(instanced(app, pads.toMesh(app.graphicsDevice), vertexColorMaterial({ gloss: 0.55 }), new Float32Array(padMats), 'pads', false))
    return root
  }

  private buildCabins(app: pc.AppBase, season: Season): pc.Entity {
    const lake = this.lake
    const g = new GeoBuilder()
    const lights: [number, number, number][] = []
    const rand = mulberry32(lake.seed * 29 + 1)
    const landing = landingOf(lake)
    const walls: Rgb[] = [[0.45, 0.3, 0.18], [0.62, 0.58, 0.5], [0.3, 0.36, 0.3], [0.55, 0.22, 0.17], [0.7, 0.68, 0.62]]
    let placed = 0
    for (let i = 0; i < lake.shore.cabins * 5 && placed < lake.shore.cabins; i++) {
      const a = rand() * Math.PI * 2
      if (Math.abs(Math.atan2(Math.sin(a - landing.angle), Math.cos(a - landing.angle))) < 0.25) continue
      const [sx, sz] = shorePoint(lake, a)
      const d = Math.hypot(sx, sz)
      const ox = sx / d, oz = sz / d
      const cx = sx + ox * 26, cz = sz + oz * 26
      const h = heightAt(lake, cx, cz)
      if (h < 1.2 || h > 12) continue
      const yaw = (Math.atan2(-ox, -oz) * 180) / Math.PI
      const wall = walls[Math.floor(rand() * walls.length)]
      const w = 7 + rand() * 4, dd = 6 + rand() * 3
      g.box(wall, { pos: [cx, h + 1.4, cz], rot: [0, yaw, 0], scale: [w, 3, dd] })
      g.box(wall, { pos: [cx, h - 0.4, cz], rot: [0, yaw, 0], scale: [w, 1, dd] })
      const roof: Rgb = season.snow ? [0.9, 0.92, 0.95] : [0.2, 0.18, 0.16]
      for (const s of [-1, 1]) {
        const r = (yaw * Math.PI) / 180
        const px = cx + Math.cos(r) * s * w * 0.26, pz = cz - Math.sin(r) * s * w * 0.26
        g.box(roof, { pos: [px, h + 3.55, pz], rot: [0, yaw, s * 28], scale: [w * 0.6, 0.18, dd + 0.8] })
      }
      const fr = (yaw * Math.PI) / 180
      const fx = -Math.sin(fr), fz = -Math.cos(fr)
      for (const s of [-0.25, 0.25]) {
        const wx = cx + fx * (dd / 2 + 0.02) + Math.cos(fr) * s * w, wz = cz + fz * (dd / 2 + 0.02) - Math.sin(fr) * s * w
        g.box([0.95, 0.75, 0.4], { pos: [wx, h + 1.6, wz], rot: [0, yaw, 0], scale: [1.1, 1, 0.06] })
        lights.push([wx + fx * 0.6, h + 1.6, wz + fz * 0.6])
      }
      const dockLen = 14
      const dx = sx - ox * (dockLen / 2 - 3), dz = sz - oz * (dockLen / 2 - 3)
      g.box([0.48, 0.4, 0.3], { pos: [dx, 0.55, dz], rot: [0, yaw, 0], scale: [1.6, 0.12, dockLen] })
      for (let k = 0; k < 4; k++) {
        const t = -dockLen / 2 + 1 + k * ((dockLen - 2) / 3)
        for (const s of [-0.7, 0.7]) g.box([0.3, 0.25, 0.2], { pos: [dx + ox * -t + Math.cos(fr) * s * 0.5, -0.3, dz + oz * -t - Math.sin(fr) * s * 0.5], scale: [0.18, 1.7, 0.18] })
      }
      placed++
    }
    const root = new pc.Entity('cabins')
    root.addComponent('render', { meshInstances: [new pc.MeshInstance(g.toMesh(app.graphicsDevice), vertexColorMaterial({ gloss: 0.15 }))], castShadows: true, receiveShadows: true })
    this.windowLights = lights
    return root
  }

  windowLights: [number, number, number][] = []

  private buildLanding(app: pc.AppBase): pc.Entity {
    const lake = this.lake
    const L = landingOf(lake)
    const d = Math.hypot(L.shoreX, L.shoreZ)
    const ox = L.shoreX / d, oz = L.shoreZ / d
    const yaw = (Math.atan2(-ox, -oz) * 180) / Math.PI
    const r = (yaw * Math.PI) / 180
    const side = [Math.cos(r), -Math.sin(r)]
    const g = new GeoBuilder()
    for (let k = 0; k < 10; k++) {
      const t = -10 + k * 3
      const x = L.shoreX + ox * t, z = L.shoreZ + oz * t
      const h = Math.max(heightAt(lake, x, z), -1.6)
      g.box([0.55, 0.55, 0.53], { pos: [x, h + 0.12, z], rot: [0, yaw, 0], scale: [5, 0.3, 3.2] })
    }
    const dockX = L.shoreX - ox * 9 + side[0] * 4.2, dockZ = L.shoreZ - oz * 9 + side[1] * 4.2
    g.box([0.5, 0.43, 0.32], { pos: [dockX, 0.5, dockZ], rot: [0, yaw, 0], scale: [1.8, 0.14, 22] })
    for (let k = 0; k < 6; k++) {
      const t = -10 + k * 4
      g.box([0.32, 0.27, 0.2], { pos: [dockX - ox * t, -0.4, dockZ - oz * t], scale: [0.2, 1.9, 0.2] })
    }
    const lotX = L.shoreX + ox * 30, lotZ = L.shoreZ + oz * 30
    g.box([0.3, 0.3, 0.3], { pos: [lotX, heightAt(lake, lotX, lotZ) + 0.05, lotZ], rot: [0, yaw, 0], scale: [22, 0.2, 16] })
    g.box([0.42, 0.3, 0.2], { pos: [L.shoreX + ox * 14 + side[0] * 7, heightAt(lake, L.shoreX + ox * 14, L.shoreZ + oz * 14) + 1.4, L.shoreZ + oz * 14 + side[1] * 7], rot: [0, yaw, 0], scale: [0.2, 2.8, 0.2] })
    g.box([0.15, 0.32, 0.2], { pos: [L.shoreX + ox * 14 + side[0] * 7, heightAt(lake, L.shoreX + ox * 14, L.shoreZ + oz * 14) + 2.8, L.shoreZ + oz * 14 + side[1] * 7], rot: [0, yaw, 0], scale: [2.6, 1.2, 0.12] })
    const root = new pc.Entity('landing')
    root.addComponent('render', { meshInstances: [new pc.MeshInstance(g.toMesh(app.graphicsDevice), vertexColorMaterial({ gloss: 0.1 }))], castShadows: true, receiveShadows: true })
    return root
  }
}

function treeMesh(kind: string, season: Season): GeoBuilder {
  const g = new GeoBuilder()
  const bark: Rgb = [0.24, 0.18, 0.13]
  if (kind === 'pine' || kind === 'spruce' || (kind === 'tamarack' && !(season.bare && !season.tamarackGold))) {
    const height = kind === 'pine' ? 17 : kind === 'spruce' ? 14 : 13
    const green: Rgb = kind === 'tamarack' ? (season.tamarackGold ? [0.72, 0.56, 0.18] : [0.33, 0.45, 0.2]) : kind === 'pine' ? [0.12, 0.22, 0.1] : [0.09, 0.18, 0.12]
    g.cylinder(bark, 0.28, 0.08, 6, { scale: [1, height, 1] }, false)
    const layers = kind === 'pine' ? 4 : 6
    for (let i = 0; i < layers; i++) {
      const t = i / layers
      const y = height * (kind === 'pine' ? 0.42 : 0.18) + t * height * (kind === 'pine' ? 0.5 : 0.75)
      const r = (kind === 'pine' ? 3.2 : 2.8) * (1 - t * 0.8)
      const shade = 0.8 + 0.4 * ((i * 37) % 10) / 10
      const c: Rgb = [green[0] * shade, green[1] * shade, green[2] * shade]
      if (season.snow) g.cylinder([0.85, 0.88, 0.92], r * 0.85, 0.1, 9, { pos: [0, y + height * 0.12 * 0.5, 0], scale: [1, height * 0.07, 1] }, false, 0.15, i)
      g.cylinder(c, r, 0.05, 9, { pos: [0, y, 0], scale: [1, height * (kind === 'pine' ? 0.2 : 0.16), 1] }, true, 0.22, i + 3)
    }
    return g
  }
  if (kind === 'birch') {
    g.cylinder((y, a) => (Math.sin(a * 5 + y * 40) > 0.7 ? [0.12, 0.11, 0.1] : [0.86, 0.85, 0.8]), 0.18, 0.08, 7, { scale: [1, 12, 1] }, false)
    if (!season.bare) {
      const leaf: Rgb = season.fall > 0.3 ? [0.85, 0.7, 0.15] : [0.32, 0.5, 0.16]
      for (let i = 0; i < 4; i++) g.blob(leaf, { pos: [Math.sin(i * 2.1) * 1.4, 8 + i * 1.1, Math.cos(i * 2.1) * 1.4], scale: [3.6, 3.2, 3.6] }, 5, 0.22, i)
    } else {
      for (let i = 0; i < 5; i++) g.cylinder([0.5, 0.48, 0.45], 0.06, 0.02, 4, { pos: [0, 6 + i * 1.2, 0], rot: [50, i * 72, 0], scale: [1, 3, 1] }, false)
    }
    return g
  }
  g.cylinder(bark, 0.35, 0.18, 7, { scale: [1, 9, 1] }, false)
  if (kind === 'tamarack' || season.bare) {
    for (let i = 0; i < 7; i++) g.cylinder(kind === 'tamarack' ? [0.38, 0.32, 0.22] : bark, 0.09, 0.02, 4, { pos: [0, 5 + i * 0.9, 0], rot: [55, i * 51, 0], scale: [1, 4, 1] }, false)
    return g
  }
  const palettes: Rgb[] = season.fall > 0.3 ? [[0.78, 0.25, 0.08], [0.9, 0.5, 0.1], [0.65, 0.12, 0.08]] : [[0.2, 0.36, 0.12], [0.24, 0.4, 0.14], [0.18, 0.3, 0.1]]
  for (let i = 0; i < 5; i++) g.blob(palettes[i % 3], { pos: [Math.sin(i * 1.7) * 2, 8 + (i % 2) * 1.6, Math.cos(i * 1.7) * 2], scale: [5, 4.4, 5] }, 5, 0.25, i)
  return g
}
