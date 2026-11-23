import { Color3 } from '@babylonjs/core/Maths/math.color'
import { Vector3 } from '@babylonjs/core/Maths/math.vector'
import type { InstancedMesh } from '@babylonjs/core/Meshes/instancedMesh'
import '@babylonjs/core/Meshes/instancedMesh'
import { Mesh } from '@babylonjs/core/Meshes/mesh'
import { CreateDisc } from '@babylonjs/core/Meshes/Builders/discBuilder'
import { CreateSphere } from '@babylonjs/core/Meshes/Builders/sphereBuilder'
import { CreateTorus } from '@babylonjs/core/Meshes/Builders/torusBuilder'
import type { Scene } from '@babylonjs/core/scene'
import type { StandardMaterial } from '@babylonjs/core/Materials/standardMaterial'
import { flat, matte } from './materials'

type Particle = { mesh: InstancedMesh; velocity: Vector3; life: number; max: number; size: number; gravity: number; spin: number }

class Pool {
  private free: InstancedMesh[] = []
  private live: Particle[] = []

  constructor(source: Mesh, count: number) {
    source.isPickable = false
    source.setEnabled(true)
    source.isVisible = false
    for (let i = 0; i < count; i++) {
      const instance = source.createInstance(`${source.name}-${i}`)
      instance.isPickable = false
      instance.setEnabled(false)
      this.free.push(instance)
    }
  }

  spawn(at: Vector3, velocity: Vector3, life: number, size: number, gravity: number): void {
    const mesh = this.free.pop() ?? this.live.shift()?.mesh
    if (!mesh) return
    mesh.setEnabled(true)
    mesh.position.copyFrom(at)
    mesh.scaling.setAll(size)
    this.live.push({ mesh, velocity, life, max: life, size, gravity, spin: (Math.random() - 0.5) * 12 })
  }

  update(dt: number): void {
    for (let i = this.live.length - 1; i >= 0; i--) {
      const p = this.live[i]
      p.life -= dt
      if (p.life <= 0) {
        p.mesh.setEnabled(false)
        this.free.push(p.mesh)
        this.live.splice(i, 1)
        continue
      }
      p.velocity.y -= p.gravity * dt
      p.velocity.scaleInPlace(1 - dt * 1.6)
      p.mesh.position.addInPlace(p.velocity.scale(dt))
      p.mesh.rotation.z += p.spin * dt
      const k = p.life / p.max
      p.mesh.scaling.setAll(p.size * (0.35 + 0.65 * k))
    }
  }

  clear(): void {
    for (const p of this.live) { p.mesh.setEnabled(false); this.free.push(p.mesh) }
    this.live.length = 0
  }
}

export class Effects {
  private snow: Pool
  private stars: Pool
  private splash: Pool
  private ring: Mesh
  private ringMaterial: StandardMaterial
  private ringLife = 0
  private reduced: boolean

  constructor(scene: Scene, reduced: boolean) {
    this.reduced = reduced
    const snowMesh = CreateSphere('fx-snow', { diameter: 1, segments: 4 }, scene)
    const snowMat = matte(scene, 'fx-snow', '#ffffff', 0.55)
    snowMesh.material = snowMat
    this.snow = new Pool(snowMesh, reduced ? 60 : 160)
    const starMesh = CreateDisc('fx-star', { radius: 0.5, tessellation: 4, sideOrientation: Mesh.DOUBLESIDE }, scene)
    starMesh.billboardMode = Mesh.BILLBOARDMODE_ALL
    starMesh.material = flat(scene, 'fx-star', '#ffd447')
    this.stars = new Pool(starMesh, reduced ? 20 : 70)
    const dropMesh = CreateSphere('fx-drop', { diameter: 1, segments: 4 }, scene)
    dropMesh.material = matte(scene, 'fx-drop', '#7fc6ee', 0.4)
    this.splash = new Pool(dropMesh, 50)
    this.ring = CreateTorus('fx-ring', { diameter: 1, thickness: 0.06, tessellation: 32 }, scene)
    this.ringMaterial = flat(scene, 'fx-ring', '#fff3b0')
    this.ringMaterial.alpha = 0
    this.ring.material = this.ringMaterial
    this.ring.billboardMode = Mesh.BILLBOARDMODE_ALL
    this.ring.isPickable = false
    this.ring.setEnabled(false)
  }

  snowPuff(at: Vector3, strength: number): void {
    const count = Math.round((this.reduced ? 6 : 14) * Math.min(2.2, 0.4 + strength / 14))
    for (let i = 0; i < count; i++) {
      const a = Math.random() * Math.PI * 2
      const v = new Vector3(Math.cos(a) * 2.5 + strength * 0.1, 1.5 + Math.random() * (2 + strength * 0.12), Math.sin(a) * 2.5)
      this.snow.spawn(at.add(new Vector3(0, 0.1, 0)), v, 0.6 + Math.random() * 0.6, 0.12 + Math.random() * 0.2, 6)
    }
  }

  skidSpray(at: Vector3, speed: number): void {
    if (Math.random() > Math.min(1, speed / 12)) return
    this.snow.spawn(at.add(new Vector3(0, 0.05, (Math.random() - 0.5) * 0.4)), new Vector3(-speed * 0.15, 0.8 + Math.random() * 1.2, (Math.random() - 0.5) * 2), 0.45, 0.07 + Math.random() * 0.08, 4)
  }

  starburst(at: Vector3, big: boolean): void {
    const count = this.reduced ? 10 : big ? 46 : 18
    for (let i = 0; i < count; i++) {
      const a = Math.random() * Math.PI * 2
      const b = (Math.random() - 0.5) * Math.PI
      const speed = (big ? 9 : 5) * (0.5 + Math.random())
      const v = new Vector3(Math.cos(a) * Math.cos(b) * speed, Math.sin(b) * speed + 2, Math.sin(a) * Math.cos(b) * speed)
      this.stars.spawn(at.clone(), v, 0.5 + Math.random() * 0.4, (big ? 0.24 : 0.16) * (0.6 + Math.random()), 3)
    }
    if (big && !this.reduced) {
      this.ring.setEnabled(true)
      this.ring.position.copyFrom(at)
      this.ringLife = 0.45
    }
  }

  splashUp(at: Vector3): void {
    for (let i = 0; i < 26; i++) {
      const a = Math.random() * Math.PI * 2
      this.splash.spawn(at.add(new Vector3(0, 0.1, 0)), new Vector3(Math.cos(a) * 1.8, 3 + Math.random() * 4, Math.sin(a) * 1.8), 0.9, 0.1 + Math.random() * 0.12, 12)
    }
  }

  setStarColor(hex: string): void {
    this.ringMaterial.emissiveColor = Color3.FromHexString(hex)
  }

  update(dt: number): void {
    this.snow.update(dt)
    this.stars.update(dt)
    this.splash.update(dt)
    if (this.ringLife > 0) {
      this.ringLife -= dt
      const k = 1 - Math.max(0, this.ringLife) / 0.45
      this.ring.scaling.setAll(0.5 + k * 6)
      this.ringMaterial.alpha = (1 - k) * 0.9
      if (this.ringLife <= 0) this.ring.setEnabled(false)
    }
  }

  clear(): void {
    this.snow.clear()
    this.stars.clear()
    this.splash.clear()
    this.ring.setEnabled(false)
  }
}
