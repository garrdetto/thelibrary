import { AtlasCell } from './atlas'
import type { ParticleSpawn } from './webgpuRenderer'

export type Color = readonly [number, number, number, number]

export const GOLD: Color = [1, 0.82, 0.38, 1]
export const SAND: Color = [0.95, 0.78, 0.5, 0.5]
export const JADE: Color = [0.45, 1, 0.7, 1]
export const VIOLET: Color = [0.8, 0.55, 1, 1]
export const EMBER: Color = [1, 0.55, 0.2, 1]

const rand = (min: number, max: number) => min + Math.random() * (max - min)

export class ParticleEmitter {
  readonly queue: ParticleSpawn[] = []
  scale = 1

  drain(): ParticleSpawn[] {
    return this.queue.splice(0, this.queue.length)
  }

  sparks(x: number, y: number, count: number, color: Color = GOLD, speed = 420): void {
    const s = this.scale
    for (let index = 0; index < count; index++) {
      const angle = rand(0, Math.PI * 2)
      const v = rand(0.3, 1) * speed * s
      this.queue.push({
        x, y,
        vx: Math.cos(angle) * v,
        vy: Math.sin(angle) * v,
        life: rand(0.45, 0.95),
        size: rand(8, 18) * s,
        cell: AtlasCell.Spark,
        additive: true,
        color,
        rotation: 0,
        spin: 0,
        gravity: 260 * s,
        drag: 2.6,
      })
    }
  }

  scarabs(x: number, y: number, count: number): void {
    const s = this.scale
    for (let index = 0; index < count; index++) {
      const angle = rand(-Math.PI, 0)
      const v = rand(60, 220) * s
      this.queue.push({
        x: x + rand(-20, 20) * s, y: y + rand(-20, 20) * s,
        vx: Math.cos(angle) * v,
        vy: Math.sin(angle) * v,
        life: rand(1, 1.8),
        size: rand(10, 16) * s,
        cell: AtlasCell.ScarabSpark,
        additive: true,
        color: JADE,
        rotation: angle + Math.PI / 2,
        spin: rand(-2, 2),
        gravity: -40 * s,
        drag: 1.2,
      })
    }
  }

  coinFountain(x: number, y: number, count: number, spread = 1): void {
    const s = this.scale
    for (let index = 0; index < count; index++) {
      this.queue.push({
        x: x + rand(-30, 30) * s * spread, y,
        vx: rand(-320, 320) * s * spread,
        vy: rand(-1350, -800) * s,
        life: rand(1.6, 2.4),
        size: rand(14, 24) * s,
        cell: AtlasCell.SmallCoin,
        additive: false,
        color: [1, 1, 1, 1],
        rotation: rand(0, Math.PI),
        spin: rand(-9, 9),
        gravity: 1700 * s,
        drag: 0.25,
      })
    }
  }

  sandStorm(x: number, y: number, w: number, h: number, count: number): void {
    const s = this.scale
    for (let index = 0; index < count; index++) {
      this.queue.push({
        x: x + rand(0, w), y: y + rand(0, h),
        vx: rand(-90, 90) * s,
        vy: rand(-120, -20) * s,
        life: rand(1.6, 2.8),
        size: rand(30, 70) * s,
        cell: AtlasCell.Dust,
        additive: true,
        color: SAND,
        rotation: rand(0, Math.PI * 2),
        spin: rand(-1, 1),
        gravity: -10 * s,
        drag: 0.6,
      })
    }
  }

  stars(x: number, y: number, count: number, color: Color = GOLD): void {
    const s = this.scale
    for (let index = 0; index < count; index++) {
      const angle = rand(0, Math.PI * 2)
      const v = rand(80, 360) * s
      this.queue.push({
        x, y,
        vx: Math.cos(angle) * v,
        vy: Math.sin(angle) * v,
        life: rand(0.7, 1.3),
        size: rand(14, 30) * s,
        cell: AtlasCell.Star,
        additive: true,
        color,
        rotation: rand(0, Math.PI),
        spin: rand(-3, 3),
        gravity: 0,
        drag: 2,
      })
    }
  }

  ember(x: number, y: number, color: Color = EMBER): void {
    const s = this.scale
    this.queue.push({
      x, y,
      vx: rand(-30, 30) * s,
      vy: rand(-160, -60) * s,
      life: rand(0.5, 0.9),
      size: rand(8, 14) * s,
      cell: AtlasCell.Spark,
      additive: true,
      color,
      rotation: 0,
      spin: 0,
      gravity: -60 * s,
      drag: 1,
    })
  }

  mote(width: number, height: number): void {
    const s = this.scale
    this.queue.push({
      x: rand(0, width), y: height + 10,
      vx: rand(-20, 20) * s,
      vy: rand(-60, -25) * s,
      life: rand(5, 9),
      size: rand(3, 7) * s,
      cell: AtlasCell.Spark,
      additive: true,
      color: [1, 0.78, 0.42, 0.55],
      rotation: 0,
      spin: 0,
      gravity: 0,
      drag: 0,
    })
  }
}
