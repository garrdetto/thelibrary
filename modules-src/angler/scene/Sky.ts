/** Procedural sky for the real date and time: gradient, sun and moon discs, stars and weather-driven clouds rendered into a cubemap that is both the skybox and the image-based lighting; drives the sun or moon light and the fog. */
import { now } from '../shared/Clock'
import * as pc from 'playcanvas'
import { bodyDirection, moonIllumination, moonPhase, moonPosition, sunPosition } from '../shared/Astro'
import { clamp, fbm, hash2, smoothstep } from '../shared/Random'
import type { Weather } from '../shared/Weather'

type C3 = [number, number, number]

export interface SkyState {
  sunDir: C3
  moonDir: C3
  sunAlt: number
  moonAlt: number
  day: number
  moonLight: number
  horizon: C3
}

const faces: ((u: number, v: number) => C3)[] = [
  (u, v) => [1, -v, -u],
  (u, v) => [-1, -v, u],
  (u, v) => [u, 1, v],
  (u, v) => [u, -1, -v],
  (u, v) => [u, -v, 1],
  (u, v) => [-u, -v, -1],
]

const mixC = (a: C3, b: C3, t: number): C3 => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t]

export function skyState(date: Date): SkyState {
  const sun = sunPosition(date)
  const moon = moonPosition(date)
  const phase = moonPhase(date)
  const day = smoothstep(-7, 8, sun.altitude)
  const moonLight = smoothstep(-2, 10, moon.altitude) * moonIllumination(phase) * (1 - day)
  const twilight = smoothstep(-10, 0, sun.altitude) * (1 - smoothstep(4, 16, sun.altitude))
  const horizon = mixC(mixC([0.012, 0.016, 0.03], [0.95, 0.55, 0.32], twilight), [0.72, 0.82, 0.92], smoothstep(2, 20, sun.altitude))
  return { sunDir: bodyDirection(sun), moonDir: bodyDirection(moon), sunAlt: sun.altitude, moonAlt: moon.altitude, day, moonLight, horizon }
}

function skyColor(dir: C3, s: SkyState, weather: Weather, seed: number): C3 {
  const y = dir[1]
  const up = Math.max(0, y)
  const twilight = smoothstep(-10, 0, s.sunAlt) * (1 - smoothstep(5, 18, s.sunAlt))
  const zenithDay: C3 = [0.16, 0.34, 0.72], zenithNight: C3 = [0.004, 0.006, 0.016], zenithTwilight: C3 = [0.12, 0.13, 0.3]
  let zenith = mixC(zenithNight, zenithDay, s.day)
  zenith = mixC(zenith, zenithTwilight, twilight * 0.6)
  const sunDot = dir[0] * s.sunDir[0] + dir[1] * s.sunDir[1] + dir[2] * s.sunDir[2]
  const toward = Math.max(0, sunDot)
  const glowTint: C3 = mixC([1, 0.45, 0.2], [1, 0.95, 0.85], smoothstep(5, 30, s.sunAlt))
  let horizon = s.horizon
  horizon = mixC(horizon, mixC(horizon, glowTint, 0.7), twilight * Math.pow(toward, 3))
  let c = mixC(horizon, zenith, Math.pow(up, 0.45))
  const overcast = weather.cloud
  const grey = mixC([0.01, 0.012, 0.02], [0.62, 0.65, 0.68], s.day)
  c = mixC(c, mixC(grey, mixC(grey, horizon, 0.3), 1 - up), overcast * 0.75)
  const glow = Math.pow(toward, 12) * 0.35 + Math.pow(toward, 64) * 0.6
  c = [c[0] + glowTint[0] * glow * (s.day * 0.8 + twilight), c[1] + glowTint[1] * glow * (s.day * 0.8 + twilight), c[2] + glowTint[2] * glow * (s.day * 0.8 + twilight)]
  if (sunDot > 0.99985 && s.sunAlt > -1) {
    const disc = 1 - overcast * 0.85
    c = mixC(c, [4, 3.6, 3], disc)
  }
  if (y > 0.01) {
    const k = 1 / (y + 0.06)
    const cu = dir[0] * k * 0.9, cv = dir[2] * k * 0.9
    const n = fbm(cu + seed * 0.01, cv, 91, 4)
    const cover = 0.25 + overcast * 0.75
    const density = smoothstep(1 - cover, 1 - cover + 0.25, n) * smoothstep(0.01, 0.12, y)
    if (density > 0) {
      const lit = mixC([0.02, 0.025, 0.04], [0.95, 0.95, 0.96], s.day)
      const edge = mixC(lit, glowTint, twilight * 0.8 + Math.pow(toward, 4) * 0.4 * s.day)
      const shade = 0.75 + 0.25 * fbm(cu * 2 + 5, cv * 2, 92, 2)
      const cloudC: C3 = [edge[0] * shade * (1 - overcast * 0.35), edge[1] * shade * (1 - overcast * 0.35), edge[2] * shade * (1 - overcast * 0.35)]
      c = mixC(c, cloudC, clamp(density * (0.6 + overcast * 0.4), 0, 1))
    }
    const night = (1 - s.day) * (1 - overcast)
    if (night > 0.05) {
      const gx = Math.floor((dir[0] / (Math.abs(dir[1]) + 1)) * 900), gz = Math.floor((dir[2] / (Math.abs(dir[1]) + 1)) * 900)
      const h = hash2(gx, gz, 5)
      if (h > 0.9965) {
        const b = (h - 0.9965) / 0.0035 * night * 1.4
        c = [c[0] + b, c[1] + b, c[2] + b * 1.1]
      }
    }
    const moonDot = dir[0] * s.moonDir[0] + dir[1] * s.moonDir[1] + dir[2] * s.moonDir[2]
    if (moonDot > 0.99993) c = mixC(c, [1.6, 1.6, 1.5], (1 - overcast * 0.9) * clamp(s.moonLight * 3 + 0.25 * (1 - s.day), 0, 1))
    else if (moonDot > 0.995) {
      const halo = Math.pow((moonDot - 0.995) / 0.005, 4) * 0.12 * s.moonLight * (1 - overcast)
      c = [c[0] + halo, c[1] + halo, c[2] + halo]
    }
  } else {
    const ground = mixC([0.005, 0.006, 0.008], [0.12, 0.13, 0.12], s.day)
    c = mixC(horizon, ground, smoothstep(0, 0.25, -y))
  }
  return c
}

function encode(c: number): number {
  const mapped = c / (1 + c * 0.25)
  return Math.round(Math.pow(clamp(mapped, 0, 1), 1 / 2.2) * 255)
}

export class Sky {
  private readonly app: pc.AppBase
  readonly light: pc.Entity
  private cube: pc.Texture
  private envCube: pc.Texture
  private readonly size: number
  private readonly envSize = 64
  private generating = false
  state: SkyState
  private weather: Weather | null = null

  constructor(app: pc.AppBase, quality: 'low' | 'medium' | 'high') {
    this.app = app
    this.size = quality === 'high' ? 384 : quality === 'medium' ? 256 : 160
    this.cube = this.makeCube(this.size)
    this.envCube = this.makeCube(this.envSize)
    this.state = skyState(now())
    this.light = new pc.Entity('sun')
    this.light.addComponent('light', {
      type: 'directional',
      castShadows: true,
      shadowResolution: quality === 'high' ? 2048 : 1024,
      shadowDistance: 70,
      numCascades: quality === 'low' ? 1 : 2,
      cascadeDistribution: 0.6,
      shadowBias: 0.3,
      normalOffsetBias: 0.05,
      shadowType: pc.SHADOW_PCF3_32F,
    })
    app.root.addChild(this.light)
  }

  private makeCube(size: number): pc.Texture {
    return new pc.Texture(this.app.graphicsDevice, { name: 'sky', cubemap: true, width: size, height: size, format: pc.PIXELFORMAT_SRGBA8, mipmaps: false, minFilter: pc.FILTER_LINEAR, magFilter: pc.FILTER_LINEAR, addressU: pc.ADDRESS_CLAMP_TO_EDGE, addressV: pc.ADDRESS_CLAMP_TO_EDGE })
  }

  async refresh(date: Date, weather: Weather): Promise<void> {
    if (this.generating) return
    this.generating = true
    try {
      this.weather = weather
      const state = skyState(date)
      const seed = Math.floor(date.getTime() / 600000) % 1000
      const render = async (size: number, texture: pc.Texture, yieldEach: boolean) => {
        const levels: Uint8Array[] = []
        for (let f = 0; f < 6; f++) {
          const data = new Uint8Array(size * size * 4)
          for (let py = 0; py < size; py++) for (let px = 0; px < size; px++) {
            const u = ((px + 0.5) / size) * 2 - 1, v = ((py + 0.5) / size) * 2 - 1
            const d = faces[f](u, v)
            const l = Math.hypot(d[0], d[1], d[2])
            const c = skyColor([d[0] / l, d[1] / l, d[2] / l], state, weather, seed)
            const i = (py * size + px) * 4
            data[i] = encode(c[0]); data[i + 1] = encode(c[1]); data[i + 2] = encode(c[2]); data[i + 3] = 255
          }
          levels.push(data)
          if (yieldEach) await new Promise(r => setTimeout(r, 0))
        }
        levels.forEach((data, face) => {
          texture.lock({ face, mode: pc.TEXTURELOCK_WRITE }).set(data)
          texture.unlock()
        })
      }
      await render(this.envSize, this.envCube, false)
      await render(this.size, this.cube, true)
      this.state = state
      const scene = this.app.scene
      const source = pc.EnvLighting.generateLightingSource(this.envCube, { size: 64 })
      const atlas = pc.EnvLighting.generateAtlas(source, { size: 256 })
      source.destroy()
      const old = scene.envAtlas
      scene.envAtlas = atlas
      if (old && old !== atlas) old.destroy()
      scene.skybox = this.cube
      scene.skyboxMip = 0
      this.applyLight()
    } finally {
      this.generating = false
    }
  }

  applyLight(): void {
    const s = this.state
    const w = this.weather
    const scene = this.app.scene
    const light = this.light.light!
    const sunUp = s.sunAlt > -3
    const dir = sunUp ? s.sunDir : s.moonDir
    const target = new pc.Vec3(-dir[0], -dir[1], -dir[2])
    const m = new pc.Mat4().setLookAt(pc.Vec3.ZERO, target, Math.abs(target.y) > 0.99 ? pc.Vec3.RIGHT : pc.Vec3.UP)
    const q = new pc.Quat().setFromMat4(m)
    this.light.setRotation(q)
    this.light.rotateLocal(-90, 0, 0)
    const cloud = w?.cloud ?? 0
    if (sunUp) {
      const warm = smoothstep(0, 25, s.sunAlt)
      light.color = new pc.Color(1, 0.62 + 0.33 * warm, 0.42 + 0.48 * warm)
      light.intensity = (0.15 + 2.1 * s.day) * (1 - cloud * 0.6)
      light.castShadows = cloud < 0.9
    } else {
      light.color = new pc.Color(0.55, 0.65, 0.9)
      light.intensity = 0.06 + s.moonLight * 0.35
      light.castShadows = s.moonLight > 0.3
    }
    scene.skyboxIntensity = 0.6 + 0.6 * s.day
    scene.exposure = 0.9 + (1 - s.day) * 1.3
    const fogAmount = w ? w.fog : 0
    scene.fog.type = pc.FOG_LINEAR
    const h = s.horizon
    const g = cloud * 0.5
    scene.fog.color = new pc.Color(h[0] * (1 - g) + 0.6 * g * s.day, h[1] * (1 - g) + 0.62 * g * s.day, h[2] * (1 - g) + 0.65 * g * s.day)
    scene.fog.start = 250 * (1 - fogAmount * 0.9)
    scene.fog.end = 2600 * (1 - fogAmount * 0.85) + 300
  }
}
