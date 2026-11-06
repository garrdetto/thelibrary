/** Placeholder players for the gray-box phase: team-colored capsules for the nine fielders, the batter with a bat, runners, the umpire, the ball with its ground shadow, and the batting cursor and strike zone frame. */
import * as THREE from 'three/webgpu'
import { BASES, FIELDER_HOME, FIELD_POSITIONS, PLATE_FRONT, strikeZone, type FieldPosition, type Hand, type TeamColors, type Vec3 } from '../sim'
import type { ModuleConfig } from '../config'
import { toWorld, worldXYZ } from './space'

type ActorLook = ModuleConfig['actors']

interface Body {
  group: THREE.Group
  jersey: THREE.MeshStandardMaterial
  cap: THREE.MeshStandardMaterial
}

export class Actors {
  readonly root = new THREE.Group()
  readonly fielders = new Map<FieldPosition, Body>()
  readonly runners = new Map<string, Body>()
  readonly batter: Body
  readonly bat: THREE.Group
  readonly ball: THREE.Mesh
  readonly ballShadow: THREE.Mesh
  readonly cursor: THREE.Group
  readonly cursorSweet: THREE.Mesh
  readonly zone: THREE.LineSegments
  readonly ghost: THREE.Mesh
  private readonly bodyGeometry: THREE.CapsuleGeometry
  private readonly headGeometry: THREE.SphereGeometry
  private readonly disposables: { dispose(): void }[] = []
  private readonly runnerPool: Body[] = []
  private swingStart = -1

  constructor(private readonly look: ActorLook) {
    this.root.name = 'actors'
    this.bodyGeometry = this.own(new THREE.CapsuleGeometry(look.radius, look.height - look.radius * 2 - 0.25, 6, 12))
    this.headGeometry = this.own(new THREE.SphereGeometry(0.15, 16, 12))
    for (const pos of FIELD_POSITIONS) {
      const body = this.makeBody()
      if (pos === 'C') body.group.scale.set(1, 0.62, 1)
      this.fielders.set(pos, body)
    }
    this.batter = this.makeBody()
    this.bat = new THREE.Group()
    const barrel = new THREE.Mesh(this.own(new THREE.CylinderGeometry(0.035, 0.018, look.bat, 10)), this.own(new THREE.MeshStandardMaterial({ color: '#c8955a', roughness: 0.5 })))
    barrel.rotation.z = Math.PI / 2
    barrel.position.x = look.bat / 2
    barrel.castShadow = true
    this.bat.add(barrel)
    this.bat.position.y = 1.15
    this.batter.group.add(this.bat)

    const umpire = this.makeBody()
    umpire.jersey.color.set('#1e2430')
    umpire.cap.color.set('#1e2430')
    umpire.group.position.copy(worldXYZ(0.6, 0, -2.0))
    umpire.group.scale.set(1, 0.9, 1)

    this.ball = new THREE.Mesh(this.own(new THREE.SphereGeometry(look.ball, 16, 12)), this.own(new THREE.MeshStandardMaterial({ color: '#fbfbf4', roughness: 0.35, emissive: new THREE.Color('#333022') })))
    this.ball.castShadow = true
    this.ballShadow = new THREE.Mesh(this.own(new THREE.CircleGeometry(0.12, 16)), this.own(new THREE.MeshBasicMaterial({ color: '#000000', transparent: true, opacity: 0.35, depthWrite: false })))
    this.ballShadow.rotation.x = -Math.PI / 2
    this.root.add(this.ball, this.ballShadow)

    this.cursor = new THREE.Group()
    const ring = new THREE.Mesh(this.own(new THREE.RingGeometry(0.105, 0.125, 40)), this.own(new THREE.MeshBasicMaterial({ color: '#e8b23a', transparent: true, opacity: 0.9, side: THREE.DoubleSide, depthTest: false })))
    this.cursorSweet = new THREE.Mesh(this.own(new THREE.CircleGeometry(0.035, 24)), this.own(new THREE.MeshBasicMaterial({ color: '#ffffff', transparent: true, opacity: 0.55, side: THREE.DoubleSide, depthTest: false })))
    this.cursor.add(ring, this.cursorSweet)
    this.cursor.renderOrder = 10
    ring.renderOrder = 10
    this.cursorSweet.renderOrder = 11
    this.cursor.visible = false
    this.root.add(this.cursor)

    const zoneGeometry = this.own(new THREE.BufferGeometry())
    zoneGeometry.setAttribute('position', new THREE.Float32BufferAttribute(new Float32Array(24), 3))
    this.zone = new THREE.LineSegments(zoneGeometry, this.own(new THREE.LineBasicMaterial({ color: '#ffffff', transparent: true, opacity: 0.55, depthTest: false })))
    this.zone.frustumCulled = false
    this.zone.renderOrder = 9
    this.root.add(this.zone)

    this.ghost = new THREE.Mesh(this.own(new THREE.RingGeometry(0.03, 0.045, 24)), this.own(new THREE.MeshBasicMaterial({ color: '#7fd6ff', side: THREE.DoubleSide, depthTest: false, transparent: true })))
    this.ghost.renderOrder = 12
    this.ghost.visible = false
    this.root.add(this.ghost)
  }

  private own<T extends { dispose(): void }>(item: T): T {
    this.disposables.push(item)
    return item
  }

  private makeBody(): Body {
    const group = new THREE.Group()
    const jersey = this.own(new THREE.MeshStandardMaterial({ color: '#cccccc', roughness: 0.8 }))
    const cap = this.own(new THREE.MeshStandardMaterial({ color: '#333333', roughness: 0.7 }))
    const torso = new THREE.Mesh(this.bodyGeometry, jersey)
    torso.position.y = (this.look.height - 0.25) / 2
    torso.castShadow = true
    const head = new THREE.Mesh(this.headGeometry, cap)
    head.position.y = this.look.height - 0.15
    head.castShadow = true
    group.add(torso, head)
    this.root.add(group)
    return { group, jersey, cap }
  }

  setColors(defense: TeamColors, offense: TeamColors): void {
    for (const body of this.fielders.values()) {
      body.jersey.color.set(defense.primary)
      body.cap.color.set(defense.secondary)
    }
    for (const body of [this.batter, ...this.runners.values(), ...this.runnerPool]) {
      body.jersey.color.set(offense.primary)
      body.cap.color.set(offense.secondary)
    }
  }

  setZone(height: number): void {
    const zone = strikeZone(height)
    const half = 0.2159
    const z = -PLATE_FRONT
    const points = [-half, zone.bottom, half, zone.bottom, half, zone.bottom, half, zone.top, half, zone.top, -half, zone.top, -half, zone.top, -half, zone.bottom]
    const attribute = this.zone.geometry.getAttribute('position') as THREE.BufferAttribute
    for (let index = 0; index < points.length; index += 2) attribute.setXYZ(index / 2, points[index], points[index + 1], z)
    attribute.needsUpdate = true
    this.zone.geometry.computeBoundingSphere()
  }

  placeFieldersHome(): void {
    for (const [pos, body] of this.fielders) {
      body.group.position.copy(toWorld(FIELDER_HOME[pos]))
      body.group.lookAt(0, 0, 0)
    }
  }

  setFielder(pos: string, at: Vec3): void {
    const body = this.fielders.get(pos as FieldPosition)
    if (body) body.group.position.copy(toWorld({ x: at.x, y: 0, z: at.z }))
  }

  setBatter(hand: Hand, colors: TeamColors): void {
    this.batter.group.visible = true
    this.batter.jersey.color.set(colors.primary)
    this.batter.cap.color.set(colors.secondary)
    this.batter.group.position.copy(worldXYZ(hand === 'R' ? -0.85 : 0.85, 0, 0.25))
    this.batter.group.rotation.set(0, hand === 'R' ? -Math.PI / 2 : Math.PI / 2, 0)
    this.resetBat()
  }

  hideBatter(): void {
    this.batter.group.visible = false
  }

  resetBat(): void {
    this.swingStart = -1
    this.bat.rotation.set(0, 0, 0.9)
    this.bat.position.set(0, 1.35, -0.1)
  }

  swing(now: number): void {
    this.swingStart = now
  }

  updateBat(now: number, duration: number): void {
    if (this.swingStart < 0) return
    const t = Math.min(1, (now - this.swingStart) / Math.max(0.05, duration))
    const ease = t * t * (3 - 2 * t)
    this.bat.rotation.set(0, ease * Math.PI * 1.25, 0.9 - ease * 0.9)
    this.bat.position.set(0, 1.35 - ease * 0.25, -0.1)
  }

  runner(id: string, colors: TeamColors): Body {
    let body = this.runners.get(id)
    if (!body) {
      body = this.runnerPool.pop() ?? this.makeBody()
      body.jersey.color.set(colors.primary)
      body.cap.color.set(colors.secondary)
      body.group.visible = true
      this.runners.set(id, body)
    }
    return body
  }

  placeRunners(onBase: (string | null)[], colors: TeamColors): void {
    const keep = new Set(onBase.filter((id): id is string => !!id))
    for (const [id, body] of this.runners) {
      if (!keep.has(id)) {
        body.group.visible = false
        this.runners.delete(id)
        this.runnerPool.push(body)
      }
    }
    onBase.forEach((id, base) => {
      if (!id || base === 0) return
      const body = this.runner(id, colors)
      body.group.position.copy(toWorld(BASES[base])).add(new THREE.Vector3(0.6, 0, 0.6))
    })
  }

  setBall(at: Vec3 | null): void {
    this.ball.visible = !!at
    this.ballShadow.visible = !!at
    if (!at) return
    toWorld(at, this.ball.position)
    this.ballShadow.position.set(this.ball.position.x, 0.03, this.ball.position.z)
    const scale = Math.max(0.4, 1 - at.y / 25)
    this.ballShadow.scale.setScalar(scale)
  }

  setCursor(visible: boolean, x = 0, y = 0, radius = 0.12): void {
    this.cursor.visible = visible
    if (!visible) return
    this.cursor.position.copy(worldXYZ(x, y, PLATE_FRONT - 0.02))
    this.cursor.scale.setScalar(radius / 0.12)
  }

  setGhost(visible: boolean, x = 0, y = 0): void {
    this.ghost.visible = visible
    if (visible) this.ghost.position.copy(worldXYZ(x, y, PLATE_FRONT - 0.01))
  }

  dispose(): void {
    this.root.removeFromParent()
    for (const item of this.disposables) item.dispose()
  }
}
