/** Night carp bowfishing with Wisco Wild Man: his camp at the launch, the trip on his jon boat (he drives on autopilot, you shoot from the front deck), the bow, arrow and line, the carp drawn where refraction puts them, the fight, the tub and his cheering. */
import { PointLight } from '@babylonjs/core/Lights/pointLight'
import { StandardMaterial } from '@babylonjs/core/Materials/standardMaterial'
import { Color3 } from '@babylonjs/core/Maths/math.color'
import { Quaternion, Vector3 } from '@babylonjs/core/Maths/math.vector'
import type { UniversalCamera } from '@babylonjs/core/Cameras/universalCamera'
import { CreateBox } from '@babylonjs/core/Meshes/Builders/boxBuilder'
import { CreateCylinder } from '@babylonjs/core/Meshes/Builders/cylinderBuilder'
import { CreateLines } from '@babylonjs/core/Meshes/Builders/linesBuilder'
import type { InstancedMesh } from '@babylonjs/core/Meshes/instancedMesh'
import type { LinesMesh } from '@babylonjs/core/Meshes/linesMesh'
import type { Mesh } from '@babylonjs/core/Meshes/mesh'
import { TransformNode } from '@babylonjs/core/Meshes/transformNode'
import type { EngineContext } from '../core/EngineSetup'
import { instantiate, partMesh } from '../core/ModelLibrary'
import type { ModelName, ModelRig, ModelTemplate } from '../core/ModelLibrary'
import type { Audio } from '../systems/Audio'
import { Autopilot, SPEED, SPEED_STEPS, buildLoops, findLaunch } from '../systems/BowRoutes'
import type { Launch, Pt, RouteName } from '../systems/BowRoutes'
import { ArrowShot, BOW, CARP, CarpFight, CarpSchool, arrowSpeed, holdShake } from '../systems/BowfishingMotion'
import type { Carp } from '../systems/BowfishingMotion'
import { chooseCheer } from '../systems/Cheers'
import type { CheerTrigger } from '../systems/Cheers'
import { WaterFx } from '../systems/FishingFx'
import type { LootTableManager, Specimen } from '../systems/LootTableManager'
import { SPECIES_BY_ID, formatPounds, formatValue } from '../systems/LootTableManager'
import { apparentDepth } from '../systems/Refraction'
import { HOUR_SECONDS, hoursUntilDark } from '../systems/TimeOfDay'
import type { Clock } from '../systems/TimeOfDay'
import { bufferedSine } from '../systems/Waves'
import type { Hud } from '../ui/Hud'
import type { MapMarker } from '../ui/Minimap'
import type { Lighting } from '../world/Lighting'
import type { Terrain } from '../world/Terrain'
import type { Avatar } from './Avatar'
import { BOWBOAT, FLOOD, LIGHT_COLORS, LIGHT_ORDER, clampToDeck, deckHeight } from './BowBoat'
import type { LightMode } from './BowBoat'
import { WildMan } from './WildMan'
import type { BowTrip, PlayerState } from './Online'
import type { AvatarHands } from './Avatar'

export interface BowfishingHost {
  ctx: EngineContext
  terrain: Terrain
  models: Map<ModelName, ModelTemplate>
  hud: Hud
  audio: Audio
  loot: LootTableManager
  lighting: Lighting
  clock: Clock
  player: Avatar
  ledMaterial: StandardMaterial
  dock: { start: Vector3; end: Vector3 }
  parkedBoat: Vector3
  /** Puts a tubbed carp in the bag and the record book and pays for it; returns its record-book place (0 = none). */
  tubCarp(specimen: Specimen): 0 | 1 | 2 | 3
  announce(text: string): void
  /** The trip ended at the launch; the player stands at `at`. */
  tripEnded(at: Vector3, facing: number): void
}

type BowState = 'ready' | 'drawing' | 'out'
export type TripRole = 'none' | 'owner' | 'crew'

interface TubFish {
  rig: ModelRig
  flop: number
}

/** StandardMaterial takes four lights and the cabin's two lamps would push the boat's floods out, so they go dark while you're on the water (they're far away anyway). */
const CABIN_LIGHTS = ['cabin-lamp', 'cabin-stove']
const NIGHT_TO_FISH = 0.7
const DAWN = 0.3
const CAMP_RANGE = 3.4
const DRAW_BACK = 0.5
const MAX_TUB_RIGS = 16
const CARP_POOL = 40
const WALK_SPEED = 1.7
const AIM_WALK_SPEED = 0.6
const LINE_POINTS = 26
const FISH_LENGTH = 1.12

const LINES = {
  wait: 'Carp don\'t show till dark, bud. Pull up a bucket.',
  board: 'Ope, watch yer step, bud. Bow\'s up on the deck. Lights are on, let\'s go find some carp.',
  white: 'White light. Best for seein\' \'em.',
  amber: 'Amber cuts through the murk. Fewer bugs too, you betcha.',
  off: 'Lights off. Can\'t shoot what ya can\'t see, bud.',
  over: 'Over the back! Water bends the light. They\'re deeper than they look.',
  under: 'Under \'im! Not quite that low, bud. Ten feet out, four inches under.',
  heading: 'Alrighty, takin\' \'er in.',
  dawn: 'Sun\'s comin\' up, carp are done.',
  running: 'Hang on, bud!',
  faster: 'Pushin\' a little quicker.',
  slower: 'Easin\' off.',
  hold: 'Holdin\' up.',
  go: 'Here we go.',
  island: 'Over to the island flats. Hang on, bud!',
  shore: 'Back to the shoreline.',
  bay: 'Back bay, under the interstate. Hang on!',
  landed: 'Uff da, what a night.',
  wait4: 'Holler at yer buddies, bud. There\'s room for four on this rig. Space when we\'re ready to shove off.',
}

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t
}

export interface BowInput {
  /** Right button held, or locked on with a double right-click: the bow is up and drawn, the view zooms down the sight. */
  aim: boolean
  /** Left button pressed this frame: loose the arrow. */
  shoot: boolean
  reel: boolean
  locked: boolean
  /** Walking on the deck: forward and right, -1..1, relative to where the camera looks. */
  forward: number
  right: number
}

export class Bowfishing {
  readonly launch: Launch
  aboard = false
  /** The owner drives with Wild Man and shares the boat with the party; crew ride along on a party member's trip. */
  role: TripRole = 'none'
  /** Shooting spot on the front deck (0–3). */
  slot = 0
  private trip: BowTrip | null = null
  private taken: number[] = []
  private party = false
  private shoved = true
  private wildAtWheel = false
  private readonly ctx: EngineContext
  private readonly boatRig: ModelRig
  private readonly boatRoot: TransformNode
  private readonly prop: TransformNode | undefined
  private readonly pilot: Autopilot
  private readonly wild: WildMan
  private readonly flood: PointLight
  private readonly deckLight: PointLight
  private readonly bowRig: ModelRig
  private readonly bowHolder: TransformNode
  private readonly flyArrow: InstancedMesh
  private readonly line: LinesMesh
  private readonly linePoints: Vector3[] = []
  private readonly school: CarpSchool<Specimen>
  private readonly carpRigs: ModelRig[] = []
  private readonly carpOf = new Map<number, ModelRig>()
  private readonly tub: TubFish[] = []
  private readonly fx: WaterFx
  private readonly camp: TransformNode[] = []
  private lights: LightMode = 'white'
  private lightsUp = 1
  private bow: BowState = 'ready'
  private draw = 0
  private heldFull = 0
  private aimBlend = 0
  private aiming = false
  private shootQueued = false
  /** The shooter's feet on the deck, in boat space. */
  private readonly deckPos = new Vector3()
  private facing = 0
  /** How fast the shooter is walking on the deck (m/s), for the walk cycle and the party. */
  walkSpeed = 0
  private arrow: ArrowShot | null = null
  private shotDir = new Vector3(0, 0, 1)
  private nearMiss: { over: boolean; gap: number } | null = null
  private fight: CarpFight | null = null
  private hooked: Carp<Specimen> | null = null
  private landing: { t: number; from: Vector3; carp: Carp<Specimen>; rig: ModelRig } | null = null
  private tubCount = 0
  private tubPounds = 0
  private streak = 0
  private clock = 0
  private bob = 0
  private pitch = 0
  private roll = 0
  private lastHeading = 0
  private runSaid = 0
  private sayTimer = 0
  private wakeTimer = 0
  private spraySplash = 0
  private flopTimer = 3
  private homeAnnounced = false

  constructor(private readonly host: BowfishingHost) {
    const { ctx, terrain, models } = host
    this.ctx = ctx
    const scene = ctx.scene
    const dock = { start: { x: host.dock.start.x, z: host.dock.start.z }, end: { x: host.dock.end.x, z: host.dock.end.z } }
    this.launch = findLaunch(terrain, dock.start, dock.end)
    const loops = buildLoops(terrain, { points: [{ x: host.parkedBoat.x, z: host.parkedBoat.z }, this.launch.boat], segments: [[dock.start, dock.end]] })
    this.pilot = new Autopilot(terrain, loops, this.launch)
    const reg = (m: InstancedMesh) => ctx.registerDynamic(m)
    this.boatRig = instantiate(models.get('bowboat')!, null, scene, reg)
    this.boatRoot = this.boatRig.root
    this.boatRoot.rotationQuaternion = Quaternion.Identity()
    this.prop = this.boatRig.joints.get('prop')
    for (const m of this.boatRig.meshes) ctx.shadows.addShadowCaster(m)
    this.wild = new WildMan(instantiate(models.get('wildman')!, null, scene, reg), scene)
    this.wild.standLift = BOWBOAT.floor + 0.98 - BOWBOAT.driver.y
    this.wild.seatLift = BOWBOAT.seatTop + 0.98 - BOWBOAT.driver.y
    this.wild.onStomp = () => this.stomp()
    for (const m of this.wild.meshes) ctx.shadows.addShadowCaster(m)
    scene.requireLightSorting = true
    this.flood = new PointLight('bow-flood', BOWBOAT.flood.clone(), scene)
    this.flood.parent = this.boatRoot
    this.flood.range = FLOOD.reach
    this.flood.intensity = 0
    this.flood.renderPriority = 1
    this.flood.specular = new Color3(0.2, 0.2, 0.2)
    this.flood.setEnabled(false)
    this.deckLight = new PointLight('bow-deck', BOWBOAT.dome.clone(), scene)
    this.deckLight.parent = this.boatRoot
    this.deckLight.range = FLOOD.deckRange
    this.deckLight.intensity = 0
    this.deckLight.renderPriority = 1
    this.deckLight.specular = Color3.Black()
    this.deckLight.setEnabled(false)
    this.bowHolder = new TransformNode('bow-holder', scene)
    this.bowRig = instantiate(models.get('bow')!, this.bowHolder, scene, reg)
    this.bowHolder.setEnabled(false)
    this.flyArrow = partMesh(models.get('bow')!, 'arrow').createInstance('arrow-flying')
    this.flyArrow.rotationQuaternion = new Quaternion()
    this.flyArrow.isPickable = false
    this.flyArrow.setEnabled(false)
    ctx.registerDynamic(this.flyArrow)
    for (let i = 0; i < LINE_POINTS; i++) this.linePoints.push(new Vector3())
    this.line = CreateLines('bow-line', { points: this.linePoints, updatable: true }, scene)
    this.line.color = new Color3(1.0, 0.72, 0.12)
    this.line.isPickable = false
    this.line.alwaysSelectAsActiveMesh = true
    this.line.applyFog = false
    this.line.setEnabled(false)
    this.fx = new WaterFx(ctx, scene, (x, z) => (terrain.depthAt(x, z) > 0.04 ? 0 : null))
    this.school = new CarpSchool<Specimen>(terrain, Math.random, () => {
      const s = host.loot.createSpecimen('carp')
      return { weightLb: s.weightLb, lengthM: s.lengthIn * 0.0254, data: s }
    })
    for (let i = 0; i < CARP_POOL; i++) {
      const rig = instantiate(models.get('fish-carp')!, null, scene, reg)
      rig.root.setEnabled(false)
      this.carpRigs.push(rig)
    }
    this.flood.excludedMeshes = [...new Set([...this.boatRig.meshes, ...this.wild.meshes, ...host.player.meshes, ...this.bowRig.meshes].map((m) => ('sourceMesh' in m ? m.sourceMesh : m)))]
    this.buildCamp()
    this.placeAtCamp()
  }

  private buildCamp(): void {
    const scene = this.ctx.scene
    const { camp, shore } = this.launch
    const ground = this.host.terrain.heightAt(camp.x, camp.z)
    const face = Math.atan2(shore.x - camp.x, shore.z - camp.z)
    const make = (mesh: Mesh, color: Color3, emissive = Color3.Black()) => {
      const mat = new StandardMaterial(`${mesh.name}-mat`, scene)
      mat.diffuseColor = color
      mat.emissiveColor = emissive
      mat.specularColor = new Color3(0.08, 0.08, 0.08)
      mesh.material = mat
      mesh.isPickable = false
      mesh.receiveShadows = true
      this.ctx.shadows.addShadowCaster(mesh)
      this.camp.push(mesh)
      return mesh
    }
    const right = { x: Math.cos(face), z: -Math.sin(face) }
    const cooler = make(CreateBox('wild-cooler', { width: 0.62, height: 0.42, depth: 0.4 }, scene), new Color3(0.86, 0.86, 0.82))
    cooler.position.set(camp.x, ground + 0.21, camp.z)
    cooler.rotation.y = face
    const lid = make(CreateBox('wild-cooler-lid', { width: 0.64, height: 0.06, depth: 0.42 }, scene), new Color3(0.14, 0.34, 0.6))
    lid.position.set(camp.x, ground + 0.44, camp.z)
    lid.rotation.y = face
    const bucket = make(CreateCylinder('wild-bucket', { height: 0.37, diameterTop: 0.3, diameterBottom: 0.26, tessellation: 18 }, scene), new Color3(0.86, 0.42, 0.1))
    bucket.position.set(camp.x + right.x * 0.65, this.host.terrain.heightAt(camp.x + right.x * 0.65, camp.z + right.z * 0.65) + 0.185, camp.z + right.z * 0.65)
    const lantern = make(CreateCylinder('wild-lantern', { height: 0.22, diameter: 0.12, tessellation: 12 }, scene), new Color3(0.25, 0.2, 0.12), new Color3(1.0, 0.72, 0.32))
    lantern.position.set(camp.x - right.x * 0.6, this.host.terrain.heightAt(camp.x - right.x * 0.6, camp.z - right.z * 0.6) + 0.11, camp.z - right.z * 0.6)
  }

  private placeAtCamp(): void {
    const { camp, shore } = this.launch
    const ground = this.host.terrain.heightAt(camp.x, camp.z)
    this.wild.place = 'camp'
    this.wild.root.parent = null
    this.wild.root.position.set(camp.x, ground + 0.47 - 0.98, camp.z)
    this.wild.setYaw(Math.atan2(shore.x - camp.x, shore.z - camp.z))
  }

  private placeAtWheel(): void {
    this.wild.place = 'boat'
    this.wild.root.parent = this.boatRoot
    this.wild.root.position.set(BOWBOAT.driver.x, BOWBOAT.driver.y - 0.98, BOWBOAT.driver.z)
    this.wild.setYaw(0)
  }

  get running(): boolean {
    return this.pilot.onPlane
  }

  get fightActive(): boolean {
    return this.fight !== null || this.landing !== null
  }

  get boatPosition(): Pt {
    return { x: this.pilot.x, z: this.pilot.z }
  }

  get drawAmount(): number {
    return this.draw
  }

  nearCamp(foot: Vector3): boolean {
    return !this.aboard && Math.hypot(foot.x - this.launch.camp.x, foot.z - this.launch.camp.z) < CAMP_RANGE
  }

  campPrompt(foot: Vector3): string {
    if (!this.nearCamp(foot)) return ''
    if (this.trip) return this.tripAtLaunch() ? `E — climb aboard with ${this.trip.name} and Wild Man` : `Wild Man is out on the water with ${this.trip.name}`
    return this.host.lighting.night >= NIGHT_TO_FISH ? 'E — go bowfishing with Wisco Wild Man' : 'E — wait with Wisco Wild Man until dark'
  }

  /** Party state from Online: a party member's trip (if one owns the boat), the spots they've taken, and whether anyone else is in the party. */
  setParty(trip: BowTrip | null, taken: number[], party: boolean): void {
    this.trip = this.role === 'owner' ? null : trip
    this.taken = taken
    this.party = party
  }

  private tripAtLaunch(): boolean {
    if (!this.trip) return false
    const [x, z, , speed] = this.trip.pose
    return Math.hypot(x - this.launch.boat.x, z - this.launch.boat.z) < 18 && Math.abs(speed) < 1
  }

  get boatNode(): TransformNode {
    return this.boatRoot
  }

  get boatHeading(): number {
    return this.pilot.heading
  }

  /** What the party sees: the owner shares the boat, everyone their spot. */
  netState(): PlayerState['b'] {
    if (!this.aboard) return undefined
    const p = this.pilot
    const d: [number, number] = [Math.round(this.deckPos.x * 100) / 100, Math.round(this.deckPos.z * 100) / 100]
    if (this.role === 'owner') return { o: [p.x, p.z, p.heading, p.speed, LIGHT_ORDER.indexOf(this.lights), p.mode === 'docked' ? 1 : 0], s: this.slot, d }
    if (this.role === 'crew' && this.trip) return { w: this.trip.id, s: this.slot, d }
    return undefined
  }

  get hands(): AvatarHands {
    return this.bow === 'drawing' ? 'draw' : 'bow'
  }

  private freeSlot(): number | null {
    for (let i = 0; i < BOWBOAT.spots.length; i++) if (!this.taken.includes(i)) return i
    return null
  }

  private say(line: string, force = false): void {
    if (!force && this.sayTimer > 0) return
    this.sayTimer = 1.4
    this.host.hud.say(line)
  }

  /** E at the camp: wait for dark, or climb aboard. Returns true when the player boards. */
  interactCamp(): boolean {
    if (this.trip) {
      if (!this.tripAtLaunch()) {
        this.host.hud.toast(`Wild Man is out on the water with ${this.trip.name}. Catch him when he's back at the launch.`)
        return false
      }
      const slot = this.freeSlot()
      if (slot === null) {
        this.host.hud.toast('The boat is full: four shooters already.', 'warn')
        return false
      }
      this.role = 'crew'
      this.slot = slot
      this.board()
      this.say(`Climb aboard, bud. ${this.trip.name}'s callin' the shots tonight.`, true)
      return true
    }
    if (this.host.lighting.night < NIGHT_TO_FISH) {
      const wait = hoursUntilDark(this.host.clock.hour)
      this.host.clock.set(this.host.clock.hour + wait)
      this.host.lighting.update(true)
      this.say(LINES.wait, true)
      this.host.hud.toast(`You wait with Wild Man until ${this.host.clock.label}.`)
      return false
    }
    this.role = 'owner'
    this.slot = this.freeSlot() ?? 0
    this.board()
    return true
  }

  private board(): void {
    this.aboard = true
    this.homeAnnounced = false
    this.tubCount = 0
    this.tubPounds = 0
    this.streak = 0
    this.bow = 'ready'
    this.draw = 0
    this.lights = 'white'
    this.placeAtWheel()
    const p = this.host.player.root
    p.parent = this.boatRoot
    p.rotationQuaternion = null
    this.deckPos.copyFrom(BOWBOAT.spots[this.slot])
    this.walkSpeed = 0
    this.aimBlend = 0
    p.position.copyFrom(this.deckPos)
    this.bowHolder.setEnabled(true)
    for (const name of CABIN_LIGHTS) this.ctx.scene.getLightByName(name)?.setEnabled(false)
    this.flood.setEnabled(true)
    this.deckLight.setEnabled(true)
    const terrainMat = this.ctx.scene.getMaterialByName('terrain-mat')
    terrainMat?.unfreeze()
    if (this.role === 'owner') {
      this.shoved = !this.party
      if (this.shoved) this.pilot.depart()
      this.say(this.party ? LINES.wait4 : LINES.board, true)
      this.host.announce(this.party ? 'is bowfishing with Wisco Wild Man. Room for four on the boat; meet at his launch.' : 'headed out bowfishing with Wisco Wild Man.')
    } else {
      this.host.announce('climbed aboard Wild Man\'s boat.')
    }
  }

  private endTrip(): void {
    this.aboard = false
    this.role = 'none'
    this.clearShot()
    this.bowHolder.setEnabled(false)
    this.flood.setEnabled(false)
    this.deckLight.setEnabled(false)
    for (const name of CABIN_LIGHTS) this.ctx.scene.getLightByName(name)?.setEnabled(true)
    this.line.setEnabled(false)
    this.host.lighting.setLamp(Vector3.Zero(), new Vector3(0, -1, 0), Color3.Black(), false)
    this.ctx.scene.getMaterialByName('terrain-mat')?.freeze()
    this.school.clear()
    for (const rig of this.carpRigs) rig.root.setEnabled(false)
    this.carpOf.clear()
    for (const f of this.tub) f.rig.root.setEnabled(false)
    this.tub.length = 0
    this.host.hud.setTub(null)
    this.host.hud.setDraw(null, false)
    this.host.hud.setDot(false)
    this.host.hud.toast(`Night's tally: ${this.tubCount} carp, ${Math.round(this.tubPounds)} lb.`, 'big')
    this.say(LINES.landed, true)
    this.placeAtCamp()
    const p = this.host.player.root
    p.setParent(null)
    p.rotationQuaternion = null
    const { camp, shore } = this.launch
    const out = { x: camp.x + (shore.x - camp.x) * 0.5 + 1.2, z: camp.z + (shore.z - camp.z) * 0.5 }
    const at = new Vector3(out.x, this.host.terrain.heightAt(out.x, out.z), out.z)
    this.host.tripEnded(at, Math.atan2(shore.x - camp.x, shore.z - camp.z) + Math.PI)
  }

  private clearShot(): void {
    if (this.hooked) {
      this.hooked.hooked = false
      this.hooked = null
    }
    this.fight = null
    this.landing = null
    this.arrow = null
    this.bow = 'ready'
    this.draw = 0
    this.shootQueued = false
    this.flyArrow.setEnabled(false)
    this.host.hud.setReel(null, '')
  }

  /** A key pressed during the trip. Returns true when it was handled here. */
  key(code: string): boolean {
    if (!this.aboard) return false
    const p = this.pilot
    if (this.role === 'crew') {
      if (code === 'KeyE') {
        if (this.tripAtLaunch()) this.endTrip()
        else this.host.hud.toast(`Ask ${this.trip?.name ?? 'the skipper'} to take 'er in. You can step off at the launch.`)
        return true
      }
      if (['KeyT', 'KeyG', 'Space', 'KeyF', 'KeyL'].includes(code)) {
        this.host.hud.toast(`${this.trip?.name ?? 'Your buddy'} is calling the shots with Wild Man tonight.`)
        return true
      }
    }
    if (this.role === 'owner' && !this.shoved && code === 'Space') {
      this.shoved = true
      p.depart()
      this.say(LINES.board, true)
      return true
    }
    switch (code) {
      case 'KeyT':
        if (p.setting < SPEED_STEPS.length - 1) p.setting++
        p.hold = false
        this.say(LINES.faster, true)
        return true
      case 'KeyG':
        if (p.setting > 0) p.setting--
        this.say(LINES.slower, true)
        return true
      case 'Space':
        p.hold = !p.hold
        this.say(p.hold ? LINES.hold : LINES.go, true)
        return true
      case 'KeyF': {
        if (p.homeward) return true
        const route: RouteName = p.switchRoute()
        this.say(route === 'island' ? LINES.island : route === 'bay' ? LINES.bay : LINES.shore, true)
        return true
      }
      case 'KeyE':
        if (p.mode === 'docked') this.endTrip()
        else if (!p.homeward) {
          p.headHome()
          this.say(LINES.heading, true)
        }
        return true
      case 'KeyL': {
        this.lights = LIGHT_ORDER[(LIGHT_ORDER.indexOf(this.lights) + 1) % LIGHT_ORDER.length]
        this.say(LINES[this.lights], true)
        this.host.audio.click()
        return true
      }
      case 'Digit1':
      case 'Digit2':
        this.host.hud.toast('The bow is your tool tonight.')
        return true
      case 'KeyQ':
        this.host.hud.toast('Wild Man runs the boat. No anchor tonight.')
        return true
      case 'KeyC':
        return true
      default:
        return false
    }
  }

  private worldPoint(local: Vector3): Vector3 {
    return Vector3.TransformCoordinates(local, this.boatRoot.computeWorldMatrix(true))
  }

  private reelPoint(): Vector3 {
    return Vector3.TransformCoordinates(new Vector3(0, -0.1, 0.13), this.bowRig.root.computeWorldMatrix(true))
  }

  private nockPoint(): Vector3 {
    return Vector3.TransformCoordinates(new Vector3(0, 0.03, -0.17 - DRAW_BACK * this.draw), this.bowRig.root.computeWorldMatrix(true))
  }

  /** The point the shooter is aiming at: where the camera ray meets the water, or 35 m out. */
  private aimTarget(cam: UniversalCamera): Vector3 {
    const o = cam.globalPosition
    const d = cam.getDirection(Vector3.Forward())
    if (d.y < -0.01) {
      const t = -o.y / d.y
      if (t < 35) return o.add(d.scale(t))
    }
    return o.add(d.scale(35))
  }

  update(dt: number, input: BowInput): void {
    this.clock += dt
    this.sayTimer -= dt
    const cam = this.ctx.camera
    const terrain = this.host.terrain
    if (this.role === 'crew' && !this.trip) {
      this.host.hud.toast('The skipper stepped off. Wild Man ran you back to the launch.')
      this.endTrip()
    }
    const following = this.trip !== null && this.role !== 'owner'
    if (following !== this.wildAtWheel || (this.aboard && !this.wildAtWheel)) {
      if (following || this.aboard) this.placeAtWheel()
      else this.placeAtCamp()
      this.wildAtWheel = following || this.aboard
    }
    if (!this.aboard) {
      if (following) {
        this.followTrip(dt)
        this.moveBoat(dt)
        const rgb = this.lights === 'off' ? [0, 0, 0] : LIGHT_COLORS[this.lights as Exclude<LightMode, 'off'>]
        const k = this.pilot.onPlane ? 0 : 1
        this.host.ledMaterial.emissiveColor.set(rgb[0] * 0.7 * k + 0.02, rgb[1] * 0.7 * k + 0.02, rgb[2] * 0.7 * k + 0.02)
        this.host.lighting.setLamp(this.worldPoint(BOWBOAT.flood), new Vector3(0, 1, 0), new Color3(rgb[0] * k, rgb[1] * k, rgb[2] * k), k > 0 && this.lights !== 'off')
        this.fx.update(dt, cam)
      } else this.idleBoat(dt)
      this.wild.update(dt)
      return
    }
    const p = this.pilot
    if (this.role === 'crew') {
      this.followTrip(dt)
    } else {
      if (this.host.lighting.night < DAWN && !p.homeward) {
        p.headHome()
        this.say(LINES.dawn, true)
      }
      const events = p.update(dt, this.fightActive)
      if (events.onPlane) {
        this.say(LINES.running, true)
        this.host.audio.whoosh()
      }
      if (events.arrived === 'docked' && p.homeward && !this.homeAnnounced) {
        this.homeAnnounced = true
        this.endTrip()
        return
      }
    }
    this.moveBoat(dt)
    this.walk(dt, input)
    const running = p.onPlane
    this.lightsUp += ((running ? 0 : 1) - this.lightsUp) * Math.min(1, dt * (running ? 6 : 1.5))
    this.updateLights()
    this.school.update(dt, { x: p.x, z: p.z, heading: p.heading, length: BOWBOAT.length }, !running && !p.homeward)
    this.updateBow(dt, input, running, cam)
    this.updateArrow(dt, input.reel)
    this.updateFight(dt, input.reel)
    this.updateLanding(dt)
    this.updateTub(dt)
    this.placeCarp()
    this.drawArrowAndLine(cam)
    this.wild.update(dt)
    this.fx.update(dt, cam)
    this.host.audio.engine(true, Math.abs(p.speed) / 14, true)
    this.host.hud.setTub(this.tubCount, this.tubPounds)
    this.host.hud.setDraw(this.bow === 'drawing' ? this.draw : null, this.draw >= BOW.minDraw)
    this.host.hud.setDot(input.locked && this.bow !== 'out' && !running)
    void terrain
  }

  /** Rides along with a party member's trip: the boat follows their pose, smoothed between updates. */
  private followTrip(dt: number): void {
    const t = this.trip
    if (!t) return
    const [x, z, h, speed, light, docked] = t.pose
    const p = this.pilot
    const k = Math.min(1, dt * 8)
    if (Math.hypot(x - p.x, z - p.z) > 30) {
      p.x = x
      p.z = z
      p.heading = h
    } else {
      p.x += (x - p.x) * k
      p.z += (z - p.z) * k
      p.heading += Math.atan2(Math.sin(h - p.heading), Math.cos(h - p.heading)) * k
    }
    p.speed = speed
    p.mode = docked ? 'docked' : 'loop'
    this.lights = LIGHT_ORDER[light] ?? 'white'
  }

  private idleBoat(dt: number): void {
    this.pilot.mode = 'docked'
    const b = this.launch.boat
    this.pilot.x = b.x
    this.pilot.z = b.z
    this.pilot.heading = this.launch.boatHeading
    this.pilot.speed = 0
    this.moveBoat(dt)
    this.fx.update(dt, this.ctx.camera)
  }

  private moveBoat(dt: number): void {
    const p = this.pilot
    const t = this.clock
    const turn = Math.atan2(Math.sin(p.heading - this.lastHeading), Math.cos(p.heading - this.lastHeading)) / Math.max(1e-3, dt)
    this.lastHeading = p.heading
    const plane = p.planing
    const climb = Math.min(1, Math.max(0, (p.speed - SPEED.push) / (SPEED.run - SPEED.push)))
    const bowUp = (Math.sin(climb * Math.PI) ** 0.8) * 0.105 + climb * 0.026
    const bankTarget = Math.max(-0.14, Math.min(0.14, -turn * Math.abs(p.speed) * 0.045))
    this.pitch += (bowUp - this.pitch) * Math.min(1, dt * 2.5)
    this.roll += (bankTarget - this.roll) * Math.min(1, dt * 2)
    const calm = 1 - plane * 0.6
    this.bob = (bufferedSine(t * 1.4) * 0.025 + bufferedSine(t * 2.3 + 1.7) * 0.012) * calm + plane * 0.06
    const rollBob = (bufferedSine(t * 1.1 + 0.6) * 0.022 + bufferedSine(t * 1.9) * 0.008) * calm
    const pitchBob = bufferedSine(t * 1.3 + 2.1) * 0.012 * calm
    this.boatRoot.position.set(p.x, this.bob, p.z)
    Quaternion.FromEulerAnglesToRef(-this.pitch + pitchBob, p.heading, this.roll + rollBob, this.boatRoot.rotationQuaternion!)
    if (this.prop) this.prop.rotation.z += p.speed * dt * 9
    const world = this.boatRoot.computeWorldMatrix(true)
    if (p.speed > 0.6) {
      this.wakeTimer -= dt
      if (this.wakeTimer <= 0) {
        this.wakeTimer = p.onPlane ? 0.07 : 0.3
        const stern = Vector3.TransformCoordinates(new Vector3(0, 0, BOWBOAT.stern), world)
        this.fx.ring(stern.x, stern.z, 0.8 + p.speed * 0.12, p.onPlane ? 0.9 : 0.45, 1.8, 1)
      }
    }
    if (p.onPlane) {
      this.spraySplash -= dt
      if (this.spraySplash <= 0) {
        this.spraySplash = 0.05
        const tail = Vector3.TransformCoordinates(new Vector3(0, 0.1, BOWBOAT.stern - 0.4), world)
        this.fx.splash(tail, 0.75)
      }
    }
  }

  private updateLights(): void {
    const on = this.lights !== 'off'
    const rgb = on ? LIGHT_COLORS[this.lights as Exclude<LightMode, 'off'>] : [0, 0, 0]
    const k = this.lightsUp
    const color = new Color3(rgb[0], rgb[1], rgb[2])
    this.flood.diffuse.copyFrom(color)
    this.deckLight.diffuse.copyFrom(color)
    this.flood.intensity = on ? FLOOD.intensity * k : 0
    this.deckLight.intensity = on ? FLOOD.deckIntensity * k : 0
    this.host.ledMaterial.emissiveColor.copyFrom(color.scale(on ? 0.7 * k + 0.02 : 0.02))
    const pos = this.worldPoint(BOWBOAT.flood)
    this.host.lighting.setLamp(pos, new Vector3(0, 1, 0), color.scale(k), on && k > 0.05)
  }

  private updateBow(dt: number, input: BowInput, running: boolean, cam: UniversalCamera): void {
    const aimWanted = input.aim && input.locked
    if (input.shoot && input.locked) {
      if (running) {
        if (this.runSaid <= 0) {
          this.say(LINES.running, true)
          this.runSaid = 3
        }
      } else if (this.bow === 'drawing') this.shootQueued = true
      else if (this.bow === 'ready' && !this.fightActive && !aimWanted) this.host.hud.toast('Right-click to raise the bow and aim, then left-click to shoot.')
    }
    this.runSaid -= dt
    this.aiming = aimWanted && !running && this.bow !== 'out' && !this.fightActive
    if (running) {
      if (this.bow === 'drawing') this.bow = 'ready'
      this.shootQueued = false
      this.draw = Math.max(0, this.draw - dt * 4)
    } else if (this.bow === 'ready') {
      this.draw = Math.max(0, this.draw - dt * 4)
      if (this.aiming) {
        this.bow = 'drawing'
        this.heldFull = 0
      }
    } else if (this.bow === 'drawing') {
      if (!this.aiming) {
        this.bow = 'ready'
        this.shootQueued = false
      } else {
        this.draw = Math.min(1, this.draw + dt / BOW.fullDraw)
        if (this.draw >= 1) this.heldFull += dt
        if (this.shootQueued && this.draw >= BOW.minDraw) {
          this.shootQueued = false
          this.fire(cam)
        }
      }
    }
    this.aimBlend += ((this.aiming ? 1 : 0) - this.aimBlend) * Math.min(1, dt * 9)
    this.placeBow(dt, cam)
  }

  /** WASD walks the shooter around the deck, relative to the camera; slower with the bow up. */
  private walk(dt: number, input: BowInput): void {
    let f = input.forward
    let r = input.right
    const n = Math.hypot(f, r)
    if (n > 1) {
      f /= n
      r /= n
    }
    const speed = (this.aiming || this.bow === 'drawing' ? AIM_WALK_SPEED : WALK_SPEED) * Math.min(1, n)
    const yaw = this.ctx.camera.rotation.y - this.pilot.heading
    const dx = (Math.sin(yaw) * f + Math.cos(yaw) * r) * speed * dt
    const dz = (Math.cos(yaw) * f - Math.sin(yaw) * r) * speed * dt
    const before = { x: this.deckPos.x, z: this.deckPos.z }
    const at = { x: before.x + dx, z: before.z + dz }
    clampToDeck(at)
    this.deckPos.set(at.x, deckHeight(at.z), at.z)
    const moved = Math.hypot(at.x - before.x, at.z - before.z)
    this.walkSpeed += (moved / Math.max(1e-4, dt) - this.walkSpeed) * Math.min(1, dt * 12)
    if (moved > 1e-4 && !this.aiming && this.bow !== 'drawing') this.facing = Math.atan2(at.x - before.x, at.z - before.z)
  }

  private fire(cam: UniversalCamera): void {
    const tip = this.nockPoint().add(this.shotAxis().scale(0.84))
    const target = this.aimTarget(cam)
    const eye = cam.globalPosition
    const ray = target.subtract(eye).normalize()
    const origin = eye.add(ray.scale(Math.max(0.5, Vector3.Dot(tip.subtract(eye), ray))))
    const dir = target.subtract(origin).normalize()
    const shake = holdShake(this.heldFull)
    if (shake > 0) {
      dir.x += (Math.random() - 0.5) * shake * 2
      dir.y += (Math.random() - 0.5) * shake * 2
      dir.z += (Math.random() - 0.5) * shake * 2
      dir.normalize()
    }
    this.shotDir.copyFrom(dir)
    this.arrow = new ArrowShot({ x: origin.x, y: origin.y, z: origin.z }, { x: dir.x, y: dir.y, z: dir.z }, arrowSpeed(this.draw), this.host.terrain)
    this.nearMiss = null
    this.bow = 'out'
    this.draw = 0
    this.host.audio.twang()
  }

  private shotAxis(): Vector3 {
    return Vector3.TransformNormal(new Vector3(0, 0, 1), this.bowRig.root.computeWorldMatrix(true)).normalize()
  }

  /** Puts the bow in the shooter's left hand, pointed along the aim while drawing or held low at the ready. */
  private placeBow(dt: number, cam: UniversalCamera): void {
    const hand = this.host.player.leftHand
    const handPos = Vector3.TransformCoordinates(new Vector3(0.0, -0.27, 0.03), hand.computeWorldMatrix(true))
    const aim = this.aimTarget(cam).subtract(handPos).normalize()
    const drawing = this.bow === 'drawing'
    const yaw = Math.atan2(aim.x, aim.z)
    const pitch = drawing ? Math.asin(Math.max(-1, Math.min(1, -aim.y))) : 0.6
    const cant = drawing ? 0.16 : 0.35
    this.bowHolder.position.copyFrom(handPos)
    const q = Quaternion.FromEulerAngles(pitch, yaw, cant)
    if (!this.bowHolder.rotationQuaternion) this.bowHolder.rotationQuaternion = q
    else Quaternion.SlerpToRef(this.bowHolder.rotationQuaternion, q, Math.min(1, dt * 18), this.bowHolder.rotationQuaternion)
    const arrowJoint = this.bowRig.joints.get('arrow')
    const nockZ = -0.17 - DRAW_BACK * this.draw
    if (arrowJoint) {
      arrowJoint.position.z = nockZ
      arrowJoint.setEnabled(this.bow !== 'out')
    }
    for (const [name, camY] of [['stringU', 0.36], ['stringL', -0.36]] as const) {
      const j = this.bowRig.joints.get(name)
      if (!j) continue
      const rest = new Vector3(0, 0.03 - camY, -0.17 + 0.085)
      const now = new Vector3(0, 0.03 - camY, nockZ + 0.085)
      j.rotationQuaternion = Quaternion.FromUnitVectorsToRef(rest.normalizeToNew(), now.normalizeToNew(), j.rotationQuaternion ?? new Quaternion())
      j.scaling.setAll(now.length() / rest.length())
    }
  }

  private updateArrow(dt: number, reel: boolean): void {
    const a = this.arrow
    if (!a || this.fight || this.landing) return
    const reelAt = this.reelPoint()
    if (a.state === 'flying' || a.state === 'sinking') {
      const e = a.step(dt, { x: reelAt.x, y: reelAt.y, z: reelAt.z })
      if (e.entered) {
        this.fx.splash(new Vector3(e.entered.x, 0, e.entered.z), 0.45)
        this.host.audio.splash()
        this.school.spook(e.entered.x, e.entered.z, 1.6)
      }
      if (a.state === 'flying' || e.path.length) {
        for (const [p0, p1] of e.path) {
          const hit = this.school.hit(p0, p1)
          if (hit) {
            this.stone(hit.carp)
            return
          }
          const miss = this.school.nearMiss(p0, p1)
          if (miss && (!this.nearMiss || miss.gap < this.nearMiss.gap)) this.nearMiss = { over: miss.over, gap: miss.gap }
        }
      }
      if (a.state !== 'flying') this.missed()
    }
    if (reel && a.state !== 'flying' && a.state !== 'fish') {
      if (a.reelIn(dt, { x: reelAt.x, y: reelAt.y, z: reelAt.z })) {
        this.arrow = null
        this.bow = 'ready'
        this.host.audio.click()
      } else if (Math.random() < dt * 14) this.host.audio.click()
    }
  }

  private missedDone = new WeakSet<ArrowShot>()

  private missed(): void {
    const a = this.arrow
    if (!a || this.missedDone.has(a)) return
    this.missedDone.add(a)
    this.streak = 0
    const id = chooseCheer({ kind: 'miss' })
    const line = this.wild.celebrate(id)
    if (this.nearMiss) this.say(this.nearMiss.over ? LINES.over : LINES.under, true)
    else this.say(line, true)
  }

  private stone(carp: Carp<Specimen>): void {
    const a = this.arrow!
    a.state = 'fish'
    carp.hooked = true
    carp.mode = 'flee'
    this.hooked = carp
    const lip = this.worldPoint(BOWBOAT.bowLip)
    const dist = Math.hypot(carp.x - lip.x, carp.z - lip.z)
    this.fight = new CarpFight(carp.weightLb, SPECIES_BY_ID.carp.fight, dist, Math.atan2(carp.x - lip.x, carp.z - lip.z), Math.random)
    this.fx.splash(new Vector3(carp.x, 0, carp.z), 0.8)
    this.host.audio.splash(true)
    this.cheer({ kind: 'hit' })
    this.host.audio.whoop(false)
  }

  private cheer(trigger: CheerTrigger): void {
    const id = chooseCheer(trigger)
    this.say(this.wild.celebrate(id), true)
    if (id === 'crazy' || id === 'meltdown') this.host.audio.whoop(true)
    else if (id === 'hype') this.host.audio.whoop(false)
  }

  private updateFight(dt: number, reel: boolean): void {
    const f = this.fight
    const c = this.hooked
    if (!f || !c) return
    const outcome = f.update(dt, reel)
    const lip = this.worldPoint(BOWBOAT.bowLip)
    const terrain = this.host.terrain
    let x = lip.x + Math.sin(f.bearing) * f.distance
    let z = lip.z + Math.cos(f.bearing) * f.distance
    if (terrain.depthAt(x, z) < 0.25) {
      f.bearing += dt * 1.6
      x = lip.x + Math.sin(f.bearing) * f.distance
      z = lip.z + Math.cos(f.bearing) * f.distance
    }
    const depth = Math.max(0.2, terrain.depthAt(x, z))
    const near = f.distance < 4
    const y = near ? -0.12 + Math.sin(this.clock * 19) * 0.04 : -Math.min(depth - 0.15, 0.25 + f.distance * 0.06)
    c.x = x
    c.z = z
    c.y = y
    c.heading = f.bearing + Math.sin(this.clock * 3) * 0.3
    c.pitch = 0
    c.tail += dt * (f.running ? 22 : 9)
    if ((near || f.running) && Math.random() < dt * (near ? 5 : 2)) this.fx.splash(new Vector3(x, 0, z), near ? 0.5 : 0.3)
    this.host.hud.setReel({ tension: f.tension, progress: f.progress, lineHealth: f.lineHealth, slack: !reel && !f.running, strain: f.strain > 0.5, surge: f.run * 100, outcome: 'fighting' }, `${Math.round(c.lengthM / 0.0254)}″? carp on`)
    if (outcome === 'torn') {
      this.fight = null
      this.hooked = null
      c.hooked = false
      c.mode = 'flee'
      c.speed = 3.2
      c.timer = 2
      this.streak = 0
      const a = this.arrow
      if (a) {
        a.state = 'sinking'
        a.pos.x = x
        a.pos.y = y
        a.pos.z = z
      }
      this.host.hud.setReel(null, '')
      this.fx.splash(new Vector3(x, 0, z), 0.7)
      this.cheer({ kind: 'tearOff' })
      this.host.hud.toast('The barbs tore out. Reel the arrow back in (R).', 'warn')
    } else if (outcome === 'landed') {
      this.fight = null
      this.host.hud.setReel(null, '')
      const rig = this.carpOf.get(c.id)
      if (rig) {
        this.carpOf.delete(c.id)
        this.landing = { t: 0, from: new Vector3(x, y, z), carp: c, rig }
      }
      this.school.remove(c)
      this.hooked = null
      if (!rig) this.finishLanding(c, null)
    }
  }

  private updateLanding(dt: number): void {
    const l = this.landing
    if (!l) return
    l.t += dt
    const lip = this.worldPoint(BOWBOAT.bowLip).addInPlaceFromFloats(0, 0.35, 0)
    const tubAt = this.worldPoint(BOWBOAT.tub).addInPlaceFromFloats(0, 0.15, 0)
    const root = l.rig.root
    const scale = Math.min(l.carp.lengthM, 0.85) / FISH_LENGTH
    root.scaling.setAll(scale)
    let pos: Vector3
    if (l.t < 0.55) {
      const k = l.t / 0.55
      pos = Vector3.Lerp(l.from, lip, k * k * (3 - 2 * k))
      root.rotation.set(-0.9 * k, l.carp.heading, Math.sin(l.t * 30) * 0.3)
      if (Math.random() < dt * 30) this.fx.drip(pos.add(new Vector3((Math.random() - 0.5) * 0.3, -0.1, (Math.random() - 0.5) * 0.3)))
    } else {
      const k = Math.min(1, (l.t - 0.55) / 0.7)
      pos = Vector3.Lerp(lip, tubAt, k)
      pos.y += Math.sin(k * Math.PI) * 0.6
      root.rotation.set(-0.9 + k * 0.9, l.carp.heading + k * 2.5, k * 3)
    }
    root.position.copyFrom(pos)
    const tail = l.rig.joints.get('tail')
    if (tail) tail.rotation.y = Math.sin(l.t * 24) * 0.45
    if (l.t >= 1.25) {
      this.landing = null
      this.finishLanding(l.carp, l.rig)
    }
  }

  private finishLanding(carp: Carp<Specimen>, rig: ModelRig | null): void {
    const specimen = carp.data
    this.arrow = null
    this.bow = 'ready'
    this.tubCount++
    this.tubPounds += specimen.weightLb
    this.streak++
    if (rig) {
      if (this.tub.length < MAX_TUB_RIGS) {
        const i = this.tub.length
        rig.root.parent = this.boatRoot
        rig.root.rotationQuaternion = null
        const a = i * 1.7
        const layer = Math.floor(i / 4)
        rig.root.position.set(BOWBOAT.tub.x + Math.cos(a) * BOWBOAT.tubRadius * 0.4, BOWBOAT.tub.y + 0.07 + layer * 0.1, BOWBOAT.tub.z + Math.sin(a) * BOWBOAT.tubRadius * 0.4)
        rig.root.rotation.set(0, a + Math.PI / 2, Math.PI / 2 + (Math.random() - 0.5) * 0.4)
        rig.root.scaling.setAll(Math.min(carp.lengthM, 0.72) / FISH_LENGTH)
        this.tub.push({ rig, flop: 0 })
      } else {
        rig.root.parent = null
        rig.root.setEnabled(false)
      }
      const pool = this.carpRigs.indexOf(rig)
      if (pool >= 0) this.carpRigs.splice(pool, 1)
      if (this.carpRigs.length < 8 && rig.root.parent === this.boatRoot) {
        const fresh = instantiate(this.host.models.get('fish-carp')!, null, this.ctx.scene, (m) => this.ctx.registerDynamic(m))
        fresh.root.setEnabled(false)
        this.carpRigs.push(fresh)
      }
    }
    const tier = this.host.tubCarp(specimen)
    this.host.audio.splash(false)
    this.cheer({ kind: 'tubbed', lengthIn: specimen.lengthIn, record: tier > 0, streak: this.streak })
    if (!tier) this.host.hud.toast(`${formatValue('carp', specimen.value)} carp (${formatPounds(specimen.weightLb)}) into the tub`)
  }

  private updateTub(dt: number): void {
    this.flopTimer -= dt
    if (this.flopTimer <= 0 && this.tub.length) {
      this.flopTimer = 2.5 + Math.random() * 2.5
      this.tub[Math.floor(Math.random() * this.tub.length)].flop = 0.6
    }
    for (const f of this.tub) {
      const tail = f.rig.joints.get('tail')
      if (f.flop > 0) {
        f.flop -= dt
        const k = Math.max(0, f.flop / 0.6)
        f.rig.root.rotation.x = Math.sin(f.flop * 28) * 0.35 * k
        if (tail) tail.rotation.y = Math.sin(f.flop * 30) * 0.6 * k
      } else if (tail) tail.rotation.y = Math.sin(this.clock * 1.3 + f.rig.root.position.x * 9) * 0.06
    }
  }

  private stomp(): void {
    if (!this.aboard) return
    const at = this.worldPoint(new Vector3(BOWBOAT.driver.x, 0, BOWBOAT.driver.z))
    for (let i = 0; i < 6; i++) {
      const a = (i / 6) * Math.PI * 2
      this.fx.splash(new Vector3(at.x + Math.cos(a) * 1.6, 0, at.z + Math.sin(a) * 1.6), 0.25)
    }
    this.fx.ring(at.x, at.z, 3.2, 0.9, 1.2, 1)
  }

  private placeCarp(): void {
    const eye = this.ctx.camera.globalPosition
    const live = new Set<number>()
    for (const c of this.school.carp) {
      live.add(c.id)
      let rig = this.carpOf.get(c.id)
      if (!rig) {
        const used = new Set(this.carpOf.values())
        rig = this.carpRigs.find((r) => !used.has(r) && !this.tub.some((t) => t.rig === r) && this.landing?.rig !== r)
        if (!rig) continue
        this.carpOf.set(c.id, rig)
        rig.root.parent = null
        rig.root.rotationQuaternion = null
        rig.root.setEnabled(true)
      }
      const d = -c.y
      const D = Math.hypot(c.x - eye.x, c.z - eye.z)
      const a = d > 0 ? apparentDepth(Math.max(0.05, eye.y), d, D) : d
      const scale = (c.lengthM * (d > 0 ? CARP.look : 1)) / FISH_LENGTH
      rig.root.position.set(c.x, -a, c.z)
      rig.root.rotation.set(-c.pitch, c.heading, 0)
      rig.root.scaling.set(scale, scale * Math.max(0.35, d > 0 ? a / d : 1), scale)
      const tail = rig.joints.get('tail')
      if (tail) tail.rotation.y = Math.sin(c.tail) * (c.mode === 'flee' || c.hooked ? 0.45 : 0.25)
    }
    for (const [id, rig] of this.carpOf) {
      if (live.has(id)) continue
      this.carpOf.delete(id)
      rig.root.setEnabled(false)
    }
  }

  private mapToEye(p: Vector3, eye: Vector3): Vector3 {
    if (p.y >= 0) return p
    const a = apparentDepth(Math.max(0.05, eye.y), -p.y, Math.hypot(p.x - eye.x, p.z - eye.z))
    return new Vector3(p.x, -a, p.z)
  }

  private drawArrowAndLine(cam: UniversalCamera): void {
    const eye = cam.globalPosition
    const a = this.arrow
    let tail: Vector3 | null = null
    if (a && a.state !== 'home') {
      let tip: Vector3
      let dir: Vector3
      if (a.state === 'fish' && this.hooked) {
        const c = this.hooked
        dir = this.shotDir.clone()
        tip = new Vector3(c.x, c.y, c.z).addInPlace(dir.scale(c.lengthM * 0.45))
      } else if (this.landing) {
        dir = this.shotDir.clone()
        tip = this.landing.rig.root.position.add(dir.scale(0.3))
      } else {
        tip = new Vector3(a.pos.x, a.pos.y, a.pos.z)
        const v = new Vector3(a.vel.x, a.vel.y, a.vel.z)
        dir = a.state === 'flying' && v.lengthSquared() > 1 ? v.normalize() : a.state === 'reeling' ? this.reelPoint().subtract(tip).scaleInPlace(-1).normalize() : this.shotDir.clone()
      }
      const nock = tip.subtract(dir.scale(0.84))
      const vt = this.mapToEye(tip, eye)
      const vn = this.mapToEye(nock, eye)
      const axis = vt.subtract(vn)
      const len = axis.length()
      this.flyArrow.setEnabled(len > 0.05)
      this.flyArrow.position.copyFrom(vn)
      Quaternion.FromUnitVectorsToRef(new Vector3(0, 0, 1), axis.scale(1 / Math.max(1e-6, len)), this.flyArrow.rotationQuaternion!)
      this.flyArrow.scaling.set(1, 1, len / 0.84)
      tail = nock
    } else {
      this.flyArrow.setEnabled(false)
    }
    if (!tail || !this.aboard) {
      this.line.setEnabled(false)
      return
    }
    const from = this.reelPoint()
    const span = Vector3.Distance(from, tail)
    const tight = this.fight !== null || a?.state === 'reeling' || a?.state === 'flying'
    const sag = tight ? span * 0.01 : Math.min(1.6, span * 0.08)
    for (let i = 0; i < LINE_POINTS; i++) {
      const k = i / (LINE_POINTS - 1)
      const p = Vector3.Lerp(from, tail, k)
      p.y -= Math.sin(k * Math.PI) * sag
      if (p.y < tail.y && tail.y >= 0) p.y = Math.max(p.y, -0.02)
      this.linePoints[i].copyFrom(this.mapToEye(p, eye))
    }
    CreateLines('bow-line', { points: this.linePoints, instance: this.line })
    this.line.setEnabled(true)
  }

  /** Stands the shooter on the front deck, facing the camera, bow in hand. */
  placePlayer(dt: number): void {
    const avatar = this.host.player
    const root = avatar.root
    const cam = this.ctx.camera
    if (root.parent !== this.boatRoot) root.parent = this.boatRoot
    root.rotationQuaternion = null
    root.position.copyFrom(this.deckPos)
    const look = cam.rotation.y - this.pilot.heading
    const walking = this.walkSpeed > 0.25 && !this.aiming && this.bow !== 'drawing'
    const want = walking ? this.facing : look
    const now = root.rotation.y
    const turn = Math.atan2(Math.sin(want - now), Math.cos(want - now))
    root.rotation.set(0, now + turn * Math.min(1, dt * (walking ? 10 : 18)), 0)
    avatar.update(dt, { stance: 'stand', hands: this.bow === 'drawing' ? 'draw' : 'bow', speed: this.walkSpeed, crouch: false, castPower: 0, aimPitch: cam.rotation.x, climbPhase: 0 })
    avatar.setVisible(true)
  }

  /** World position of the shooter's feet (for the minimap, wildlife and grass). */
  feet(out: Vector3): Vector3 {
    return out.copyFrom(this.worldPoint(this.deckPos))
  }

  /** Close over the right shoulder and a little high, looking down into the light; aiming pulls in tight behind the bow and zooms down the sight. */
  placeCamera(cam: UniversalCamera): void {
    const head = this.worldPoint(this.deckPos.add(new Vector3(0, 1.62, 0)))
    const yaw = cam.rotation.y
    const pitch = cam.rotation.x
    const fwd = new Vector3(Math.sin(yaw) * Math.cos(pitch), -Math.sin(pitch), Math.cos(yaw) * Math.cos(pitch))
    const right = new Vector3(Math.cos(yaw), 0, -Math.sin(yaw))
    const k = this.aimBlend
    const pos = head.add(right.scale(lerp(0.72, 0.32, k))).addInPlaceFromFloats(0, lerp(0.5, 0.1, k), 0).subtract(fwd.scale(lerp(1.45, 0.5, k)))
    pos.y = Math.max(pos.y, 0.6)
    cam.position.copyFrom(pos)
    cam.fov = lerp(0.9, 0.5, k)
  }

  marker(): MapMarker | null {
    if (this.aboard) return null
    if (this.trip) return { x: this.pilot.x, z: this.pilot.z, kind: 'wildman', label: `Wild Man · ${this.trip.name}` }
    return { x: this.pilot.x, z: this.pilot.z, kind: 'wildman' }
  }

  prompt(): string {
    const p = this.pilot
    if (this.role === 'owner' && !this.shoved) return 'Space — shove off once your party is aboard · E — step off'
    if (this.role === 'crew' && this.tripAtLaunch()) return 'E — step off · or wait to shove off'
    if (p.mode === 'docked' && p.homeward) return 'E — step off'
    if (p.onPlane) return 'Hang on — Wild Man is running across on plane'
    if (this.fight) return 'Hold R or left-click to reel · ease off when he runs'
    if (this.landing) return 'Swinging him aboard…'
    if (this.arrow && this.arrow.state !== 'flying') return 'Hold R or left-click to reel the arrow back'
    if (this.arrow) return ''
    if (this.bow === 'drawing') return 'Left-click to shoot · aim low, they\'re deeper than they look · WASD walk'
    if (this.role === 'crew') return `Right-click to aim · double right-click locks it · WASD walk the deck · ${this.trip?.name ?? 'your buddy'} is calling the shots`
    return p.homeward ? 'Heading in · right-click to aim if you see one · WASD walk the deck' : 'Right-click to aim · double right-click locks it · WASD walk the deck · L lights · T/G speed · Space hold · F flats · E take me in'
  }

  /** A short status for the HUD's mode chip. */
  status(): string {
    const p = this.pilot
    const mph = Math.round(Math.abs(p.speed) * 2.237)
    const where = p.route === 'island' ? 'island flats' : p.route === 'bay' ? 'back bay' : 'shoreline'
    if (p.mode === 'docked') return 'At the launch'
    if (p.homeward) return `Heading in · ${mph} mph`
    if (p.travelling) return `Running to the ${where} · ${mph} mph`
    return `${where.replace(/^./, (c) => c.toUpperCase())} · ${p.hold || this.fightActive ? 'holding' : `${mph} mph`} · lights ${this.lights}`
  }

  /** Seconds of real time per in-module hour (for HUD hints). */
  static readonly hourSeconds = HOUR_SECONDS
}
