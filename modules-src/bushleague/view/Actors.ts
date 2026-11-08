/** Everyone and everything that moves on the field: rigged ballplayers in club uniforms (one per player, created as they appear and cached), the umpire, the seamed ball with its shadow and pitch trail, the batting cursor, strike-zone frame and pitch ghost. Also the catch, throw and slide reactions during a play. */
import * as THREE from 'three/webgpu'
import { BASES, FIELDER_HOME, FIELD_POSITIONS, PLATE_FRONT, Rng, stringSeed, strikeZone, type Contest, type FieldPosition, type Hand, type Player, type Vec3 } from '../sim'
import type { ModuleConfig } from '../config'
import { Ballplayer } from '../players/Ballplayer'
import { modelGear, type Gear } from '../players/Models'
import { SKIN_TONES, UMPIRE_UNIFORM, teamUniform, type JerseyLook, type UniformColors } from '../players/Uniform'
import { faceTexture, leatherTexture, letteringTexture, type TextureDetail } from './Textures'
import { toWorld, worldXYZ } from './space'

type ActorLook = ModuleConfig['actors']

const SLIDE_BASES = [2, 3, 0].map((base) => toWorld(BASES[base]))

function skinFor(player: Player): string {
  return SKIN_TONES[new Rng(stringSeed(player.id)).int(0, SKIN_TONES.length - 1)]
}

export class Actors {
  readonly root = new THREE.Group()
  readonly ball: THREE.Mesh
  readonly ballShadow: THREE.Mesh
  readonly cursor: THREE.Group
  readonly cursorSweet: THREE.Mesh
  readonly zone: THREE.LineSegments
  readonly ghost: THREE.Mesh
  readonly trail: THREE.Line
  trailEnabled = true
  private readonly disposables: { dispose(): void }[] = []
  private readonly figures = new Map<string, Ballplayer>()
  private readonly uniforms = new Map<string, UniformColors>()
  private readonly gloveMaterial: THREE.MeshStandardMaterial
  private readonly gloveGeometry: THREE.BufferGeometry | Gear['glove']
  private readonly gear: Gear | null
  private readonly batGeometry: THREE.BufferGeometry
  private readonly batMaterial: THREE.MeshStandardMaterial
  private readonly umpire: Ballplayer
  private readonly trailPositions = new Float32Array(48 * 3)
  private trailCount = 0
  private contest: Contest | null = null
  private defense = new Map<FieldPosition, string>()
  private batterId: string | null = null
  private readonly onField = new Set<string>()
  private holder: string | null = null
  private caught = new Set<string>()
  private thrown = new Set<string>()
  private slid = new Set<string>()
  private readonly scratch = new THREE.Vector3()

  constructor(look: ActorLook, private readonly detail: TextureDetail = { size: 1024, anisotropy: 4 }) {
    this.root.name = 'actors'
    const gear = modelGear()
    this.gear = gear
    this.gloveMaterial = this.own(gear ? new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.62 }) : new THREE.MeshStandardMaterial({ color: '#6b3f1f', roughness: 0.7 }))
    this.gloveGeometry = gear ? gear.glove : this.own(new THREE.SphereGeometry(0.075, 12, 10).scale(1, 1.25, 0.55))
    this.batGeometry = gear ? gear.bat.clone().scale(1, look.bat / 0.86, 1) : new THREE.CylinderGeometry(0.034, 0.016, look.bat, 10)
    this.own(this.batGeometry)
    this.batMaterial = this.own(gear ? new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.4 }) : new THREE.MeshStandardMaterial({ color: '#c8955a', roughness: 0.45 }))
    this.umpire = this.makeFigure({ body: 'stocky', height: 1.8, throws: 'R' } as Player, UMPIRE_UNIFORM, '#d9a07a', { lettering: null, pinstripe: null, face: faceTexture(detail, 7) })
    this.umpire.showGlove(false)
    this.umpire.setBase('crouch')
    this.umpire.teleport(worldXYZ(0.55, 0, -2.0))
    this.umpire.face(0, true)
    this.root.add(this.umpire.group)

    this.ball = new THREE.Mesh(this.own(new THREE.SphereGeometry(look.ball, 24, 16)), this.own(new THREE.MeshStandardMaterial({ map: this.own(leatherTexture(detail)), roughness: 0.45, emissive: new THREE.Color('#2a2820') })))
    this.ball.castShadow = true
    const trailGeometry = this.own(new THREE.BufferGeometry())
    trailGeometry.setAttribute('position', new THREE.BufferAttribute(this.trailPositions, 3))
    this.trail = new THREE.Line(trailGeometry, this.own(new THREE.LineBasicMaterial({ color: '#ff5a36', transparent: true, opacity: 0.85, depthWrite: false })))
    this.trail.frustumCulled = false
    this.trail.visible = false
    this.root.add(this.trail)
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

  private makeFigure(player: Player, uniform: UniformColors, skin: string, jersey?: JerseyLook): Ballplayer {
    return new Ballplayer({ body: player.body ?? 'stocky', height: player.height ?? 1.85, throws: player.throws, uniform, skin, jersey }, this.gloveMaterial, this.batGeometry, this.batMaterial, this.gloveGeometry, this.gear !== null)
  }

  /** Surname, number and club wordmark in the uniform's trim, outlined against the jersey; some clubs wear pinstriped home whites. */
  private jerseyFor(player: Player, side: 0 | 1, uniform: UniformColors): JerseyLook {
    const team = this.contest!.teams[side].roster.team
    const light = new THREE.Color(uniform.jersey).getHSL({ h: 0, s: 0, l: 0 }).l > 0.6
    const lettering = letteringTexture({ name: player.last, number: player.number, wordmark: team.name, fill: uniform.trim, outline: light ? '#f7f4ec' : '#111318', pinstripe: null }, this.detail)
    const pinstripe = side === 1 && stringSeed(team.id) % 3 === 0 ? uniform.trim : null
    const skin = SKIN_TONES.indexOf(skinFor(player))
    return { lettering, pinstripe, face: faceTexture(this.detail, stringSeed(`${player.id}:face`), skin >= 5) }
  }

  /** Points the cast at a new contest: home whites for the home club, road colors for the visitors. */
  bind(contest: Contest): void {
    for (const figure of this.figures.values()) figure.dispose()
    this.figures.clear()
    this.uniforms.clear()
    this.contest = contest
    const [away, home] = contest.teams
    this.uniforms.set(away.roster.team.id, teamUniform(away.roster.team.colors, false))
    this.uniforms.set(home.roster.team.id, teamUniform(home.roster.team.colors, true))
  }

  /** The figure for a player, created the first time they take the field. */
  figure(id: string): Ballplayer | null {
    const contest = this.contest
    if (!contest) return null
    let figure = this.figures.get(id)
    if (!figure) {
      const side = contest.teams[0].players.has(id) ? 0 : 1
      const player = contest.player(id)
      const uniform = this.uniforms.get(contest.teams[side].roster.team.id)!
      figure = this.makeFigure(player, uniform, skinFor(player), this.jerseyFor(player, side, uniform))
      this.root.add(figure.group)
      this.figures.set(id, figure)
    }
    figure.group.visible = true
    this.onField.add(id)
    return figure
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

  /** Lines up a fresh pitch: the defense at their depths, the batter in the box, runners on their bases; everyone else leaves the field. */
  setScene(contest: Contest, batterHand: Hand): void {
    this.onField.clear()
    this.holder = null
    this.caught.clear()
    this.thrown.clear()
    this.slid.clear()
    this.defense.clear()
    const plate = toWorld({ x: 0, y: 0, z: 0 })
    for (const pos of FIELD_POSITIONS) {
      const id = contest.defenseTeam.defense[pos]
      this.defense.set(pos, id)
      const figure = this.figure(id)!
      figure.animator.stop()
      figure.animator.reach(null)
      figure.showGlove(true)
      figure.holdBat(false)
      figure.teleport(toWorld(FIELDER_HOME[pos]))
      figure.faceToward(pos === 'C' ? toWorld({ x: 0, y: 0, z: 18 }) : plate, true)
      figure.setBase(pos === 'C' ? 'crouch' : pos === 'P' ? 'idle' : 'ready')
    }
    const batter = contest.batter
    this.batterId = batter.id
    const hitter = this.figure(batter.id)!
    hitter.animator.stop()
    hitter.showGlove(false)
    hitter.holdBat(true)
    hitter.teleport(worldXYZ(batterHand === 'R' ? -0.85 : 0.85, 0, 0.25))
    hitter.face(batterHand === 'R' ? Math.PI / 2 : -Math.PI / 2, true)
    hitter.setBase('stance')
    for (const base of [1, 2, 3]) {
      const runner = contest.bases[base]
      if (!runner) continue
      const figure = this.figure(runner.id)!
      figure.animator.stop()
      figure.showGlove(false)
      figure.holdBat(false)
      figure.teleport(toWorld(BASES[base]).add(new THREE.Vector3(base === 2 ? 0 : 0.8, 0, base === 2 ? 0.8 : 0)))
      figure.faceToward(toWorld(BASES[(base + 1) % 4]), true)
      figure.setBase('ready')
    }
    for (const [id, figure] of this.figures) if (!this.onField.has(id)) figure.group.visible = false
    this.setCatcherHidden(this.catcherHidden)
  }

  private catcherHidden = false

  /** The catcher's-eye camera sits where the catcher crouches, so the catcher steps out of view while it is up. */
  setCatcherHidden(hidden: boolean): void {
    this.catcherHidden = hidden
    const catcher = this.defense.get('C')
    const figure = catcher ? this.figures.get(catcher) : null
    if (figure) figure.group.visible = !hidden
  }

  hideBatter(): void {
    const batter = this.batterId ? this.figures.get(this.batterId) : null
    batter?.holdBat(false)
    if (batter) batter.setBase('run')
  }

  windup(duration: number): void {
    const pitcher = this.defense.get('P')
    if (pitcher) this.figures.get(pitcher)?.play('pitch', duration)
  }

  swing(type: 'contact' | 'power' | 'bunt', duration: number): void {
    const batter = this.batterId ? this.figures.get(this.batterId) : null
    batter?.play(type === 'bunt' ? 'bunt' : 'swing', duration)
  }

  catchPitch(at: Vec3): void {
    const catcher = this.defense.get('C')
    const figure = catcher ? this.figures.get(catcher) : null
    figure?.animator.reach(toWorld(at))
  }

  setFielder(pos: string, at: Vec3, dt: number): void {
    const id = this.defense.get(pos as FieldPosition)
    const figure = id ? this.figures.get(id) : null
    figure?.moveTo(toWorld({ x: at.x, y: 0, z: at.z }), dt)
  }

  setRunner(id: string, at: Vec3, dt: number): void {
    const figure = this.figure(id)
    if (!figure) return
    figure.holdBat(false)
    figure.showGlove(false)
    const position = toWorld({ x: at.x, y: 0, z: at.z }, this.scratch)
    figure.moveTo(position, dt)
    if (!this.slid.has(id) && figure.animator.base === 'run') {
      for (const base of SLIDE_BASES) {
        if (position.distanceTo(base) < 3.2) {
          this.slid.add(id)
          figure.play('slide', 0.9)
          break
        }
      }
    }
  }

  /** Clears who has caught or thrown, so a replay plays the same reactions again. */
  resetReactions(): void {
    this.holder = null
    this.caught.clear()
    this.thrown.clear()
    this.slid.clear()
  }

  /** Catches when the ball reaches a fielder, throws when it leaves the one holding it. Returns true on the frame a catch starts. */
  reactToBall(at: Vec3 | null): boolean {
    if (!at) return false
    let caughtNow = false
    const ball = toWorld(at)
    let nearest: { id: string; distance: number } | null = null
    for (const id of this.defense.values()) {
      const figure = this.figures.get(id)
      if (!figure) continue
      const distance = Math.hypot(figure.group.position.x - ball.x, figure.group.position.z - ball.z)
      if (!nearest || distance < nearest.distance) nearest = { id, distance }
    }
    if (!nearest) return false
    const figure = this.figures.get(nearest.id)!
    if (nearest.distance < 2.2 && ball.y < 3.2 && !this.caught.has(nearest.id) && this.holder !== nearest.id) {
      this.caught.add(nearest.id)
      this.thrown.delete(nearest.id)
      figure.play(ball.y > 1.3 ? 'catchHigh' : 'catchLow', 0.5)
      figure.animator.reach(ball)
      caughtNow = true
    }
    if (nearest.distance < 1.2) {
      if (this.holder !== nearest.id) this.holder = nearest.id
      figure.animator.reach(null)
    }
    if (this.holder) {
      const holding = this.figures.get(this.holder)
      if (holding && !this.thrown.has(this.holder) && Math.hypot(holding.group.position.x - ball.x, holding.group.position.z - ball.z) > 1.6 && ball.y > 1) {
        this.thrown.add(this.holder)
        this.caught.delete(this.holder)
        holding.faceToward(ball)
        holding.play('throw', 0.45)
        this.holder = null
      }
    }
    return caughtNow
  }

  celebrate(teamId: string): void {
    const contest = this.contest
    if (!contest) return
    for (const [id, figure] of this.figures) {
      const side = contest.teams[0].players.has(id) ? 0 : 1
      if (figure.group.visible && contest.teams[side].roster.team.id === teamId) figure.play('celebrate', 3)
    }
  }

  update(dt: number): void {
    for (const figure of this.figures.values()) if (figure.group.visible) figure.update(dt)
    this.umpire.update(dt)
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

  /** Turns the ball about a horizontal axis at `rpm` so the seams show the spin. */
  spinBall(dt: number, rpm: number, tiltDegrees = 0): void {
    const tilt = (tiltDegrees * Math.PI) / 180
    const axis = new THREE.Vector3(Math.cos(tilt), Math.sin(tilt), 0).normalize()
    this.ball.rotateOnWorldAxis(axis, (rpm / 60) * Math.PI * 2 * dt)
  }

  clearTrail(): void {
    this.trailCount = 0
    this.trail.visible = false
    this.trail.geometry.setDrawRange(0, 0)
  }

  pushTrail(): void {
    if (!this.trailEnabled || !this.ball.visible) return
    const max = this.trailPositions.length / 3
    if (this.trailCount >= max) {
      this.trailPositions.copyWithin(0, 3)
      this.trailCount = max - 1
    }
    this.trailPositions.set([this.ball.position.x, this.ball.position.y, this.ball.position.z], this.trailCount * 3)
    this.trailCount++
    this.trail.geometry.setDrawRange(0, this.trailCount)
    this.trail.geometry.getAttribute('position').needsUpdate = true
    this.trail.visible = this.trailCount > 1
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
    for (const figure of this.figures.values()) figure.dispose()
    this.umpire.dispose()
    this.root.removeFromParent()
    for (const item of this.disposables) item.dispose()
  }
}
