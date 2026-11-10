import { DirectionalLight } from '@babylonjs/core/Lights/directionalLight'
import { PointLight } from '@babylonjs/core/Lights/pointLight'
import type { Material } from '@babylonjs/core/Materials/material'
import { StandardMaterial } from '@babylonjs/core/Materials/standardMaterial'
import { Color3 } from '@babylonjs/core/Maths/math.color'
import { Vector3 } from '@babylonjs/core/Maths/math.vector'
import { Ray } from '@babylonjs/core/Culling/ray'
import type { AbstractMesh } from '@babylonjs/core/Meshes/abstractMesh'
import type { Mesh } from '@babylonjs/core/Meshes/mesh'
import { TransformNode } from '@babylonjs/core/Meshes/transformNode'
import { Scores } from '../../../engine/net/Scores'
import { EYE_HEIGHT, createEngineSetup } from '../core/EngineSetup'
import type { EngineContext } from '../core/EngineSetup'
import { MODEL_NAMES, disposeRig, instantiate, loadModel, partMesh } from '../core/ModelLibrary'
import type { ModelName, ModelRig, ModelTemplate } from '../core/ModelLibrary'
import { Audio } from '../systems/Audio'
import { EncounterDirector } from '../systems/EncounterDirector'
import { Fishing } from '../systems/Fishing'
import type { FishingEvent } from '../systems/Fishing'
import { RodFx } from '../systems/FishingFx'
import { LootTableManager, SPECIES_BY_ID, formatValue } from '../systems/LootTableManager'
import type { Specimen } from '../systems/LootTableManager'
import { REEL_TUNING, SWAY_TUNING, SkillCheckManager } from '../systems/SkillCheckManager'
import { VehicleController } from '../systems/VehicleController'
import type { Vehicle } from '../systems/VehicleController'
import { Wildlife } from '../systems/Wildlife'
import type { Animal } from '../systems/Wildlife'
import { Hud, compassWord } from '../ui/Hud'
import { Foliage } from '../world/Foliage'
import { foliageMaterial } from '../world/FoliageTextures'
import { creatureMaterial } from '../world/CreatureTextures'
import { texturedMaterial } from '../world/TexturedMaterial'
import type { CreatureSurface } from '../world/CreatureTextures'
import type { FoliageKind } from '../world/FoliageTextures'
import { PLAY_LIMIT, Terrain, bayCoord, channelDistance } from '../world/Terrain'
import { STAND_CLIMB_SECONDS, STAND_LAYOUTS, findStandSites, standToWorld } from '../world/TreeStand'
import type { StandSite } from '../world/TreeStand'
import { buildDock, buildGround, buildSky, buildWater, findLandmarks } from '../world/World'
import { Avatar, HIP_HEIGHT } from './Avatar'
import { Progress } from './Progress'
import type { CatchReport, EarnReport } from './Progress'
import { Panels } from '../ui/Panels'
import { CharacterCreator } from '../ui/CharacterCreator'
import { lookOf } from '../shared/Economy'
import type { Look } from '../shared/Economy'
import type { PanelTab } from '../ui/Panels'
import { Cabin } from '../world/Cabin'
import { Minimap } from '../ui/Minimap'
import type { MapMarker } from '../ui/Minimap'
import { Online, fetchLobbies } from './Online'
import type { PlayerState } from './Online'
import { LobbyBrowser, PauseMenu, loadSensitivity, saveSensitivity } from '../ui/PauseMenu'
import { formatValue as fmtValue } from '../systems/LootTableManager'
import type { CabinSpot } from '../world/Cabin'
import type { AvatarHands, AvatarStance } from './Avatar'
import { ANCHOR_MAX_SPEED, BOARD_MAX_SPEED, BOARD_RANGE, CONSOLE_SEAT, DECK_SEATS, DECK_SEAT_NAMES, PASSENGER_SEAT, createAnchorLine, otherSeat, swivelToward } from './BoatSeats'
import type { DeckSeat } from './BoatSeats'
import type { RemoteBoat } from './Online'
import { Bowfishing } from './Bowfishing'
import { BOWBOAT, deckHeight } from './BowBoat'
import { Clock, hourFromSearch } from '../systems/TimeOfDay'
import { Lighting } from '../world/Lighting'
import { buildHighway } from '../world/Highway'
import { Weeds } from '../world/Weeds'

type Tool = 'rod' | 'rifle'
type PlayerMode = 'foot' | 'vehicle' | 'climb' | 'stand' | 'crew' | 'bowfish'

const TWO_SIDED = new Set(['grass', 'fern', 'cattail'])
const GLOSSY = new Set(['utv', 'boat', 'rod', 'rifle', 'bow', 'fish-muskie', 'fish-pike', 'fish-walleye', 'fish-smallmouth', 'fish-perch'])
const MODULE_ID = 'rackreel'
/** A downed buck or bear counts once the hunter is within 10 yards of it. */
const TAG_RANGE = 10 * 0.9144
const WALK_SPEED = 2.5
const SPRINT_SPEED = 5.2
const CROUCH_SPEED = 1.2
const AIM_SPEED = 0.9
const CAMERA_DISTANCE = 3.3
const SHOULDER_OFFSET = 0.45
const DOUBLE_CLICK_MS = 380
const ARROW_YAW_RATE = 2.1
const ARROW_PITCH_RATE = 1.4
const ARROW_KEYS = new Set(['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'])

export class Game {
  private ctx!: EngineContext
  private terrain!: Terrain
  private ground!: Mesh
  private foliage!: Foliage
  private models = new Map<ModelName, ModelTemplate>()
  private vehicles!: VehicleController
  private wildlife!: Wildlife
  private fishing!: Fishing
  private readonly loot = new LootTableManager()
  private readonly skill = new SkillCheckManager(Math.random, { ...REEL_TUNING }, { ...SWAY_TUNING })
  private readonly progress = new Progress()
  private panels!: Panels
  private cabin!: Cabin
  private cabinRig!: ModelRig
  private standKills = new Set<number>()
  private gruntCooldown = 0
  private quadAdded = false
  private minimap!: Minimap
  private online!: Online
  private readonly director = new EncounterDirector()
  private readonly audio = new Audio()
  private readonly hud = new Hud()
  private skyMat!: import('@babylonjs/core/Materials/shaderMaterial').ShaderMaterial
  private waterMat!: import('@babylonjs/core/Materials/shaderMaterial').ShaderMaterial
  private avatar!: Avatar
  private rodRig!: ModelRig
  private rodTip!: TransformNode
  private rodFx!: RodFx
  private dragTimer = 0
  private jumpTold = false
  private fishCam = 0
  private rifleRig!: ModelRig
  private standRigs: ModelRig[] = []
  private stands: StandSite[] = []
  private stand!: StandSite
  private heroRig: ModelRig | null = null
  private heroClock = 0
  private heroLight: DirectionalLight | null = null
  private tool: Tool = 'rod'
  private keys = new Set<string>()
  private leftDown = false
  private rightDown = false
  /** Left button pressed since the last frame while bowfishing: loose the arrow. */
  private bowShoot = false
  /** Double right-click keeps the scope up without holding the button (for trackpads). */
  private scopeLock = false
  private lastRightAt = 0
  private ads = 0
  private crouch = false
  private playing = false
  private headingOut = false
  private pauseMenu!: PauseMenu
  private lobbies!: LobbyBrowser
  private time = 0
  private mode: PlayerMode = 'foot'
  private readonly foot = new Vector3()
  private readonly velocity = new Vector3()
  private facing = 0
  private moveSpeed = 0
  private climbT = 0
  private climbDir = 1
  private rifleCooldown = 0
  private recoil = 0
  private swayApplied = { x: 0, y: 0 }
  private bag: Specimen[] = []
  private baitHintShown = false
  private readonly creator = new CharacterCreator()
  /** The camera faces the hunter while the character creator is open. */
  private creating = false
  /** Animals this player put down, which tag themselves once the hunter walks within 10 yards. */
  private myKills = new Set<number>()
  private materials = new Map<string, Material>()
  private sessionKey = Math.random().toString(36).slice(2, 10)
  private signTimer = 0
  private placeTimer = 0
  private casters: AbstractMesh[] = []
  private readonly casterScratch: AbstractMesh[] = []
  private boat!: Vehicle
  private anchorLine!: Mesh
  private deckSeat: DeckSeat | null = null
  private swivel = 0
  private crewOf: string | null = null
  private crewBoat: RemoteBoat | null = null
  private crewAboard: string | null = null
  private handsNow: AvatarHands = 'rod'
  private dockEnd = new Vector3()
  private readonly clock = new Clock(hourFromSearch(location.search) ?? undefined)
  private lighting!: Lighting
  private weeds!: Weeds
  private bowfish!: Bowfishing
  private ledMaterial!: StandardMaterial

  constructor(private readonly canvas: HTMLCanvasElement) {}

  async start(): Promise<void> {
    this.ctx = createEngineSetup(this.canvas)
    const { scene } = this.ctx
    this.hud.setLoading(0.05, 'Carving the lake basin…')
    await nextFrame()
    this.terrain = new Terrain()
    this.ground = buildGround(this.ctx, this.terrain)
    this.skyMat = buildSky(this.ctx).material
    this.waterMat = buildWater(this.ctx, this.terrain).material
    this.lighting = new Lighting(this.ctx, this.skyMat, this.waterMat, this.clock)
    buildHighway(this.ctx, this.terrain)
    this.weeds = new Weeds(this.ctx, this.terrain)
    let loaded = 0
    await Promise.all(MODEL_NAMES.map(async (name) => {
      this.models.set(name, await loadModel(scene, name, (model, part, tag) => this.materialFor(model, part, tag)))
      loaded++
      this.hud.setLoading(0.1 + (loaded / MODEL_NAMES.length) * 0.5, `Bringing in the ${name.replace('fish-', '').replace('-lo', '').replace('treestand', 'tree stand')}…`)
    }))
    this.hud.setLoading(0.65, 'Planting the woods…')
    await nextFrame()
    const landmarks = findLandmarks(this.terrain)
    buildDock(this.ctx, landmarks)
    const inland = new Vector3(-Math.sin(landmarks.spawnHeading), 0, -Math.cos(landmarks.spawnHeading))
    this.cabin = new Cabin(this.terrain, landmarks.spawn.add(inland.scale(18)), landmarks.spawnHeading)
    this.stands = findStandSites(this.terrain, landmarks.spawn, [this.cabin.root, landmarks.dock.start, landmarks.utv])
    this.stand = this.stands[0]
    this.foliage = new Foliage(this.ctx, this.terrain, this.models, [landmarks.dock.start, landmarks.spawn, landmarks.utv, ...this.stands.map((st) => st.tree), this.cabin.root, this.cabin.toWorld(new Vector3(-9, 0, 1.5))])
    this.foliage.grassHoles.push({ x: this.cabin.root.x, z: this.cabin.root.z, r: 6.4 })
    for (const st of this.stands) {
      const r = st.kind === 'blind' ? 1.3 : 0.45
      this.foliage.colliders.push({ x: st.tree.x, z: st.tree.z, r, min: st.tree.add(new Vector3(-r, -1, -r)), max: st.tree.add(new Vector3(r, st.kind === 'blind' ? 2.9 : 16, r)) })
    }
    this.ctx.buildCollisionOctree(this.foliage.colliders)
    this.hud.setLoading(0.85, 'Fueling the UTV…')
    await nextFrame()
    const reg = (m: AbstractMesh) => this.ctx.registerDynamic(m)
    this.buildStand(reg)
    this.buildCabin(reg)
    this.vehicles = new VehicleController(this.ctx, this.terrain, this.ground)
    this.vehicles.add('ATV', instantiate(this.models.get('utv')!, null, scene, reg), landmarks.utv, landmarks.utvHeading)
    this.boat = this.vehicles.add('BOAT', instantiate(this.models.get('boat')!, null, scene, reg), landmarks.boat, landmarks.boatHeading)
    this.anchorLine = createAnchorLine(scene, this.boat.root)
    this.dockEnd.copyFrom(landmarks.dock.end)
    this.avatar = new Avatar(instantiate(this.models.get('hunter')!, null, scene, reg))
    this.buildGear(reg)
    this.bowfish = new Bowfishing({
      ctx: this.ctx, terrain: this.terrain, models: this.models, hud: this.hud, audio: this.audio, loot: this.loot, lighting: this.lighting, clock: this.clock,
      player: this.avatar, ledMaterial: this.ledMaterial, dock: { start: landmarks.dock.start, end: landmarks.dock.end }, parkedBoat: landmarks.boat,
      tubCarp: (specimen) => this.tubCarp(specimen),
      announce: (text) => this.online.announce(text),
      tripEnded: (at, facing) => {
        this.mode = 'foot'
        this.foot.copyFrom(at)
        this.facing = facing
        this.velocity.setAll(0)
        this.ctx.camera.fov = 0.9
      },
    })
    this.wildlife = new Wildlife(this.ctx, scene, this.terrain, this.loot, this.models)
    this.wildlife.onTurnover = () => this.hud.toast('The deer have moved off. A fresh bunch is filtering in across the property.')
    this.wildlife.onLegendSpawn = (a) => this.hud.toast(a.template.id === 'whitetail' ? 'Fresh rubs and scrapes: a record-class buck is roaming these woods' : `Fresh sign: a record-class ${SPECIES_BY_ID[a.template.id].name.toLowerCase()} is moving nearby`, 'big')
    this.wildlife.onLost = (a) => this.hud.toast(a.wounds ? 'The wounded animal is gone. Aim for the vitals behind the shoulder.' : `The ${a.template.name.toLowerCase()} slipped away.`)
    this.fishing = new Fishing(this.ctx, scene, this.terrain, this.loot, this.skill, (name) => this.models.get(name))
    this.fishing.onEvent = (e) => this.onFishing(e)
    this.minimap = new Minimap(this.terrain, document.getElementById('minimap')!)
    this.online = new Online(this.ctx, scene, this.models, {
      herd: (list) => {
        if (!this.wildlife.remote) {
          this.wildlife.clearAll()
          this.wildlife.remote = true
        }
        this.wildlife.applySnapshot(list)
      },
      shot: (id, vital, from) => {
        const a = this.wildlife.animals.find((x) => x.id === id && x.state !== 'down')
        if (a) this.wildlife.hit(a, vital, from)
      },
      tag: (id) => {
        const a = this.wildlife.animals.find((x) => x.id === id)
        if (a) a.tagged = true
      },
      news: (text) => this.hud.toast(text),
      status: (text) => {
        const chip = document.getElementById('party')
        if (chip) {
          chip.hidden = !text
          chip.textContent = text
        }
        if (!this.online.isGuest && this.wildlife.remote) {
          this.wildlife.clearAll()
          this.wildlife.remote = false
        }
        this.panels?.refresh()
        this.pauseMenu?.refresh()
      },
      seat: (from) => {
        if (this.mode !== 'vehicle' || this.vehicles.active !== this.boat || this.deckSeat === null) return
        this.deckSeat = otherSeat(this.deckSeat)
        this.hud.toast(`${from} swapped seats with you. You're on the ${DECK_SEAT_NAMES[this.deckSeat]} now.`)
      },
      localBoat: () => (this.vehicles.active === this.boat ? this.boat.root : null),
      bowBoat: () => this.bowfish.boatNode,
      bowSpot: (slot, deck) => (deck ? new Vector3(deck[0], deckHeight(deck[1]), deck[1]) : BOWBOAT.spots[slot] ?? BOWBOAT.spots[0]),
    })
    this.online.id = this.sessionKey
    this.online.carry(this.avatar.root)
    this.ctx.sensitivity = loadSensitivity()
    const cam = this.ctx.camera
    cam.keysUp = []
    cam.keysDown = []
    cam.keysLeft = []
    cam.keysRight = []
    cam.speed = 0
    this.foot.copyFrom(this.cabin.frontDoor)
    this.foot.y = this.terrain.heightAt(this.foot.x, this.foot.z)
    this.facing = landmarks.spawnHeading
    cam.rotation.set(0.18, landmarks.spawnHeading, 0)
    this.panels = new Panels(this.progress)
    this.panels.bag = () => this.bag
    const panelChange = this.progress.onChange
    this.progress.onChange = () => {
      panelChange?.()
      this.applyGear()
    }
    this.applyGear()
    this.panels.party = {
      status: () => this.online.describe(),
      code: () => (this.online.active ? this.online.room.code : ''),
      members: () => this.online.members.map((m) => m.name),
      host: () => this.online.host(),
      join: (code) => this.online.joinAndWait(code),
      leave: () => this.online.leave(),
    }
    void this.progress.load().then(() => {
      void this.progress.loadRecords()
      this.online.name = this.progress.username || `Guest-${this.sessionKey.slice(0, 4)}`
    })
    this.online.name = `Guest-${this.sessionKey.slice(0, 4)}`
    this.online.bridge()
    this.placeAvatar(0)
    this.placeCamera()
    this.collectCasters()

    this.foliage.updateGrass(this.foot)
    this.bindInput()
    scene.onBeforeCameraRenderObservable.add(() => this.afterCameraMove())
    scene.onAfterCameraRenderObservable.add(() => this.removeSway())
    this.ctx.engine.runRenderLoop(() => this.frame())
    await this.prewarmSpawns()
    this.hud.setLoading(1, 'Ready')
    document.getElementById('loading')!.hidden = true
    document.getElementById('start')!.hidden = false
    if (!this.headingOut) this.lobbies.start()
    ;(document.getElementById('start-btn') as HTMLButtonElement).focus()
  }

  /**
   * Animals and trophy fish only appear mid-session, as instances of templates
   * nothing else instances, so their instanced material and shadow-depth
   * shaders used to compile in the frame they first showed up. One copy of each
   * is built under the terrain, the scene waits until every shader (and the
   * instanced shadow variants) is ready, and the copies are freed.
   */
  private async prewarmSpawns(): Promise<void> {
    const { scene, shadows } = this.ctx
    const wild: ModelName[] = ['deer', 'antlers', 'bear']
    const fish = MODEL_NAMES.filter((name) => name.startsWith('fish-'))
    const rigs: ModelRig[] = []
    for (const name of wild) {
      const model = this.models.get(name)
      if (model) rigs.push(instantiate(model, null, scene))
    }
    for (const name of fish) {
      const model = this.models.get(name)
      if (model) rigs.push(instantiate(model, null, scene, (m) => {
        m.sourceMesh.renderingGroupId = 1
        m.sourceMesh.applyFog = false
      }))
    }
    for (const rig of rigs) rig.root.position.set(0, -400, 0)
    const wildRigs = rigs.slice(0, wild.length)
    const deadline = performance.now() + 8000
    await scene.whenReadyAsync()
    while (performance.now() < deadline) {
      let ready = true
      for (const rig of wildRigs) for (const mesh of rig.meshes) for (const sub of mesh.sourceMesh.subMeshes ?? []) if (!shadows.isReady(sub, true, false)) ready = false
      if (ready) break
      await nextFrame()
    }
    for (const rig of rigs.slice(wild.length)) for (const m of rig.meshes) {
      m.sourceMesh.renderingGroupId = 0
      m.sourceMesh.applyFog = true
    }
    await Promise.all([scene.whenReadyAsync(), this.fishing.prewarm()])
    for (const rig of rigs) disposeRig(rig)
  }

  private materialFor(model: ModelName, part: string, tag: string): Material {
    if (tag === 'led') {
      if (!this.ledMaterial) {
        this.ledMaterial = new StandardMaterial('rr-led', this.ctx.scene)
        this.ledMaterial.diffuseColor = new Color3(0.2, 0.2, 0.2)
        this.ledMaterial.specularColor = new Color3(0.5, 0.5, 0.5)
        this.ledMaterial.emissiveColor = new Color3(0.02, 0.02, 0.02)
      }
      return this.ledMaterial
    }
    if (model === 'bowboat') {
      const existing = this.materials.get('boat-metal')
      if (existing) return existing
      const mat = new StandardMaterial('rr-boat-metal', this.ctx.scene)
      mat.diffuseColor = Color3.White()
      mat.specularColor = new Color3(0.09, 0.09, 0.09)
      mat.specularPower = 22
      mat.ambientColor = new Color3(0.3, 0.3, 0.3)
      mat.backFaceCulling = false
      this.materials.set('boat-metal', mat)
      return mat
    }
    if (tag.startsWith('tex:')) return texturedMaterial(this.ctx.scene, tag.slice(4), this.materials)
    if (tag === 'needles' || tag === 'leaves' || tag === 'birchleaves') return foliageMaterial(this.ctx.scene, tag as FoliageKind)
    if (tag) return creatureMaterial(this.ctx.scene, tag as CreatureSurface)
    const key = TWO_SIDED.has(model) ? 'two' : GLOSSY.has(model) ? 'gloss' : 'matte'
    const existing = this.materials.get(key)
    if (existing) return existing
    const mat = new StandardMaterial(`rr-${key}`, this.ctx.scene)
    mat.diffuseColor = Color3.White()
    if (key === 'two') {
      mat.backFaceCulling = false
      mat.twoSidedLighting = true
      mat.specularColor = new Color3(0.02, 0.02, 0.02)
    } else if (key === 'gloss') {
      mat.specularColor = new Color3(0.32, 0.32, 0.3)
      mat.specularPower = 48
      mat.backFaceCulling = false
    } else {
      mat.specularColor = new Color3(0.035, 0.035, 0.03)
    }
    mat.ambientColor = new Color3(0.3, 0.3, 0.3)
    this.materials.set(key, mat)
    void part
    return mat
  }

  private buildStand(reg: (m: AbstractMesh) => void): void {
    const { scene } = this.ctx
    for (const st of this.stands) {
      const rig = instantiate(this.models.get(STAND_LAYOUTS[st.kind].model)!, null, scene, reg)
      rig.root.position.copyFrom(st.root)
      rig.root.rotation.y = st.heading
      this.standRigs.push(rig)
    }
  }

  private buildCabin(reg: (m: AbstractMesh) => void): void {
    this.cabinRig = instantiate(this.models.get('cabin')!, null, this.ctx.scene, reg)
    this.cabinRig.root.position.copyFrom(this.cabin.root)
    this.cabinRig.root.rotation.y = this.cabin.heading
    const lamp = new PointLight('cabin-lamp', this.cabin.toWorld(new Vector3(0.4, 2.4, 0.3)), this.ctx.scene)
    lamp.diffuse = new Color3(1.0, 0.78, 0.5)
    lamp.specular = new Color3(0.3, 0.25, 0.18)
    lamp.intensity = 1.7
    lamp.range = 8.5
    const stove = new PointLight('cabin-stove', this.cabin.toWorld(new Vector3(-3.0, 0.9, -0.8)), this.ctx.scene)
    stove.diffuse = new Color3(1.0, 0.5, 0.2)
    stove.intensity = 0.5
    stove.range = 3.5
  }

  private applyGear(): void {
    const fx = this.progress.effects
    const l = this.progress.profile.loadout
    this.avatar.setOutfit([l.jacket, l.vest, l.cap, l.pants, l.pack])
    const r = this.skill.reel
    r.crankProgress = REEL_TUNING.crankProgress * fx.reelSpeed
    r.holdProgressPerSecond = REEL_TUNING.holdProgressPerSecond * fx.reelSpeed
    r.surgeStrength = REEL_TUNING.surgeStrength * fx.surge
    r.strainFrictionPerPoint = REEL_TUNING.strainFrictionPerPoint / fx.lineStrength
    this.skill.sway.adsAmplitude = SWAY_TUNING.adsAmplitude * fx.scopeSteady
    this.fishing.castRange = fx.castRange
    this.fishing.bias = fx.baitBias
    this.fishing.reelSpeed = fx.reelSpeed
    if (this.fishing.bait !== fx.bait) {
      this.fishing.bait = fx.bait
      this.baitHintShown = false
    }
    this.wildlife.detection = fx.detection
    this.wildlife.vitalScale = fx.vitalScale
    for (const v of this.vehicles.vehicles) v.power = v.kind === 'BOAT' ? fx.boatPower : v.rig.root.name.startsWith('quad') ? 1.15 : fx.utvPower
    if (!this.quadAdded && this.progress.profile.owned.includes('quad') && this.models.has('quad')) {
      this.quadAdded = true
      const spot = this.cabin.parking(0)
      spot.position.y = this.terrain.heightAt(spot.position.x, spot.position.z)
      const quad = this.vehicles.add('ATV', instantiate(this.models.get('quad')!, null, this.ctx.scene, (m) => this.ctx.registerDynamic(m)), spot.position, spot.heading)
      quad.seat.set(0, 1.12, -0.32)
      quad.power = 1.15
      this.casters.push(...quad.rig.meshes)
    }
  }

  private openPanel(tab: PanelTab, spot: CabinSpot | null): void {
    document.exitPointerLock()
    this.keys.clear()
    this.panels.openAt(tab, spot, () => this.lock())
  }

  private buildGear(reg: (m: AbstractMesh) => void): void {
    const { scene } = this.ctx
    this.rodRig = instantiate(this.models.get('rod')!, null, scene, reg)
    this.rodRig.root.parent = this.avatar.rightHand
    this.rodRig.root.position.set(0.02, -0.31, 0.03)
    this.rodRig.root.rotation.set(0.55, 0, 0)
    this.rodTip = new TransformNode('rod-tip', scene)
    this.rodTip.parent = this.rodRig.root
    this.rodTip.position.set(0, 0, 1.8)
    this.rodFx = new RodFx(this.ctx, scene, partMesh(this.models.get('rod')!, 'rod'), this.rodRig.root, this.rodTip, this.rodRig.meshes)
    this.rifleRig = instantiate(this.models.get('rifle')!, null, scene, reg)
    this.rifleRig.root.parent = this.avatar.chest
    this.rifleRig.root.setEnabled(false)
  }

  private collectCasters(): void {
    this.casters = [...this.avatar.meshes, ...this.rodRig.meshes, ...this.rifleRig.meshes, ...this.standRigs.flatMap((r) => r.meshes)]
    for (const veh of this.vehicles.vehicles) this.casters.push(...veh.rig.meshes)
  }

  private bindInput(): void {
    const start = async () => {
      if (this.playing || this.headingOut) return
      this.headingOut = true
      this.lobbies.stop()
      document.getElementById('start')!.hidden = true
      await this.progress.ready
      if (!this.progress.profile.verified) {
        await this.makeCharacter()
        if (this.progress.signedIn) this.hud.toast('Character saved to your account. Welcome to the northwoods.', 'big')
      }
      this.playing = true
      this.hud.showPlaying(true)
      this.audio.unlock()
      this.lock()
      const d = this.stand.tree.subtract(this.foot)
      this.hud.toast(`${this.stands.filter((st) => st.kind === 'ladder').length} ladder stands and a box blind are marked on the map; the nearest is ${Math.round(d.length() * 1.094)} yd to the ${compassWord(Math.atan2(d.x, d.z))}. Arrow keys look around.`)
    }
    document.getElementById('start-btn')!.addEventListener('click', () => void start())
    document.getElementById('book-btn')!.addEventListener('click', () => this.showRecords(() => undefined))
    const startCard = document.querySelector('#start .rr-card') as HTMLElement
    this.lobbies = new LobbyBrowser(startCard, startCard.querySelector('.rr-actions'), {
      list: () => fetchLobbies(),
      join: async (code) => {
        await this.online.joinAndWait(code)
        this.hud.toast(`Joined party ${this.online.room.code}. Your friends are marked on the map.`, 'big')
        await start()
      },
    })
    this.pauseMenu = new PauseMenu({
      resume: () => this.resume(),
      inventory: () => {
        this.pauseMenu.hide()
        this.panels.openAt('gear', this.mode === 'foot' ? this.cabin.spotNear(this.foot) : null, () => this.pause())
      },
      records: () => {
        this.pauseMenu.hide()
        this.showRecords(() => this.pause())
      },
      sensitivity: () => ({ ...this.ctx.sensitivity }),
      setSensitivity: (s) => {
        this.ctx.sensitivity = s
        saveSensitivity(s)
      },
      party: {
        status: () => this.online.describe(),
        code: () => (this.online.active ? this.online.room.code : ''),
        isHost: () => this.online.isHost,
        isGuest: () => this.online.isGuest,
        members: () => this.online.members.map((m) => m.name),
        lobbyOpen: () => this.online.lobbyOpen,
        host: () => this.online.host(),
        setLobby: (open) => this.online.setLobbyOpen(open),
        join: (code) => this.online.joinAndWait(code),
        leave: () => this.online.leave(),
      },
    })
    addEventListener('keydown', (e) => {
      if (e.code !== 'Escape' || !this.playing) return
      if (this.pauseMenu.open) {
        e.preventDefault()
        this.resume()
        return
      }
      if (this.hud.modalOpen) return
      e.preventDefault()
      if (document.pointerLockElement === this.canvas) document.exitPointerLock()
      else this.pause()
    })
    this.canvas.addEventListener('click', () => {
      if (this.playing && !this.hud.modalOpen && document.pointerLockElement !== this.canvas) this.lock()
    })
    this.canvas.addEventListener('contextmenu', (e) => e.preventDefault())
    document.addEventListener('pointerlockchange', () => {
      if (!document.pointerLockElement && this.playing && !this.hud.modalOpen) this.pause()
    })
    document.addEventListener('mousedown', (e) => {
      if (!this.playing || this.hud.modalOpen || document.pointerLockElement !== this.canvas) return
      if (e.button === 0) {
        this.leftDown = true
        if (this.mode === 'bowfish') {
          this.bowShoot = true
          return
        }
        this.primaryDown()
      } else if (e.button === 2) {
        this.rightDown = true
        const now = performance.now()
        const bow = this.mode === 'bowfish'
        if (this.scopeLock) {
          this.scopeLock = false
          this.lastRightAt = 0
        } else if ((this.tool === 'rifle' || bow) && now - this.lastRightAt < DOUBLE_CLICK_MS) {
          this.scopeLock = true
          this.lastRightAt = 0
          this.hud.toast(bow ? 'Bow locked up. Left-click to shoot; right-click again to lower it.' : 'Scope locked on. Left-click to fire; right-click again to lower it.')
        } else {
          this.lastRightAt = now
        }
      }
    })
    document.addEventListener('mouseup', (e) => {
      if (e.button === 0) {
        this.leftDown = false
        if (this.playing && this.mode !== 'bowfish') this.primaryUp()
      } else if (e.button === 2) {
        this.rightDown = false
      }
    })
    addEventListener('keydown', (e) => {
      if (!this.playing || this.hud.modalOpen) return
      this.keys.add(e.code)
      if (ARROW_KEYS.has(e.code) || e.code === 'Space') e.preventDefault()
      if (e.repeat) return
      if (this.mode === 'bowfish' && this.bowfish.key(e.code)) return
      if (this.mode === 'bowfish' && (e.code === 'KeyR' || e.code === 'KeyI' || e.code === 'KeyF')) return
      if (e.code === 'Digit1') this.setTool('rod')
      else if (e.code === 'Digit2') this.setTool('rifle')
      else if (e.code === 'KeyE') this.interact()
      else if (e.code === 'KeyC') this.crouch = !this.crouch
      else if (e.code === 'KeyR' && this.fishing.state === 'bite') this.fishing.setHook()
      else if (e.code === 'KeyM') this.audio.setMuted(!this.audio.muted)
      else if (e.code === 'KeyK') this.openBook()
      else if (e.code === 'KeyI') this.openPanel('gear', this.mode === 'foot' ? this.cabin.spotNear(this.foot) : null)
      else if (e.code === 'KeyG') this.grunt()
      else if (e.code === 'KeyN') this.hud.toast(this.minimap.cycleZoom())
      else if (e.code === 'KeyP') this.openPanel('party', null)
      else if (e.code === 'KeyQ') this.toggleAnchor()
      else if (e.code === 'KeyF') this.switchSeat()
    })
    addEventListener('keyup', (e) => this.keys.delete(e.code))
    addEventListener('blur', () => {
      this.keys.clear()
      this.leftDown = false
      this.rightDown = false
    })
  }

  private lock(): void {
    this.canvas.focus()
    try {
      const p = this.canvas.requestPointerLock() as unknown as Promise<void> | undefined
      p?.catch?.(() => undefined)
    } catch {
      return
    }
  }

  private pause(): void {
    this.keys.clear()
    this.leftDown = false
    this.rightDown = false
    this.hud.setPrompt('Paused — click the view to carry on')
    if (this.playing && !this.hud.modalOpen) this.pauseMenu.show()
  }

  private resume(): void {
    this.pauseMenu.hide()
    this.lock()
  }

  private openBook(): void {
    document.exitPointerLock()
    this.showRecords(() => this.lock())
  }

  private showRecords(onClose: () => void): void {
    this.hud.showBook(this.progress.board, this.progress.scoreName, onClose)
    void this.progress.loadRecords().then((board) => {
      if (!document.getElementById('book')?.hidden) this.hud.renderBook(board, this.progress.scoreName)
    })
  }

  /** Aiming down the scope: right button held, or locked on with a double right-click. */
  private get aimHeld(): boolean {
    return this.rightDown || this.scopeLock
  }

  private setTool(tool: Tool): void {
    this.scopeLock = false
    if (this.fishing.busy && tool !== 'rod') this.fishing.cancel()
    if ((this.vehicles.active || this.mode === 'crew') && tool === 'rifle') {
      this.hud.toast('Unload and step out before using the rifle.', 'warn')
      return
    }
    this.tool = tool
    this.hud.setTool(tool)
  }

  private interact(): void {
    if (this.mode === 'climb' || this.mode === 'bowfish') return
    if (this.mode === 'foot' && this.bowfish.nearCamp(this.foot)) {
      if (this.fishing.busy) this.fishing.cancel()
      if (this.bowfish.interactCamp()) {
        this.mode = 'bowfish'
        this.crouch = false
        this.ctx.camera.rotation.set(0.32, this.bowfish.launch.boatHeading, 0)
      }
      return
    }
    if (this.mode === 'stand') {
      if (this.fishing.busy) this.fishing.cancel()
      this.mode = 'climb'
      this.climbDir = -1
      this.climbT = 1
      return
    }
    if (this.mode === 'crew') {
      this.leaveCrew(false)
      return
    }
    if (this.mode === 'vehicle') {
      const spot = this.vehicles.exit()
      if (!spot) {
        this.hud.toast('Too deep to step out here. Run the boat up to shore.', 'warn')
        return
      }
      this.avatar.root.parent = null
      this.mode = 'foot'
      this.deckSeat = null
      this.anchorLine.setEnabled(false)
      this.foot.copyFrom(spot)
      this.velocity.setAll(0)
      return
    }
    const down = this.wildlife.nearestDown(this.foot, TAG_RANGE)
    if (down) {
      this.tag(down)
      return
    }
    const spot = this.cabin.spotNear(this.foot)
    if (spot) {
      this.openPanel(spot === 'wardrobe' ? 'wardrobe' : spot === 'rack' ? 'gear' : 'shop', spot)
      return
    }
    const v = this.nearOwnVehicle()
    const ride = this.nearRemoteBoat()
    if (ride && (!v || Vector3.Distance(this.foot, ride.root.position) < Vector3.Distance(this.foot, v.position))) {
      this.boardCrew(ride)
      return
    }
    if (v) {
      this.enterVehicle(v)
      return
    }
    const ladder = this.nearLadder()
    if (ladder) {
      this.stand = ladder
      if (this.fishing.busy) this.fishing.cancel()
      this.mode = 'climb'
      this.climbDir = 1
      this.climbT = 0
      this.crouch = false
    }
  }

  private nearLadder(): StandSite | null {
    for (const st of this.stands) {
      const base = standToWorld(st, STAND_LAYOUTS[st.kind].base)
      if (Math.hypot(base.x - this.foot.x, base.z - this.foot.z) < 1.8) return st
    }
    return null
  }

  private get layout() {
    return STAND_LAYOUTS[this.stand.kind]
  }

  private enterVehicle(v: Vehicle): void {
    if (this.fishing.busy) this.fishing.cancel()
    if (v.kind === 'ATV' && this.tool === 'rifle') this.setTool('rod')
    if (this.tool === 'rifle') this.setTool('rod')
    this.vehicles.enter(v)
    this.mode = 'vehicle'
    this.deckSeat = v.anchored ? 0 : null
    this.swivel = 0
    this.crouch = false
    const cam = this.ctx.camera
    cam.rotation.set(0.28, v.heading, 0)
    this.avatar.root.parent = v.root
    this.avatar.root.rotationQuaternion = null
    this.avatar.root.rotation.set(0, 0, 0)
    this.avatar.root.position.copyFrom(v.seat).addInPlaceFromFloats(0, -HIP_HEIGHT, 0)
    this.hud.toast(v.kind === 'ATV' ? 'W/S throttle · A/D steer · Space brake · E to step out' : 'W/S throttle · A/D tiller · Q to drop anchor · E to step out near shore')
  }

  private toggleAnchor(): void {
    const v = this.vehicles.active
    if (this.mode === 'crew') {
      this.hud.toast(`${this.crewBoat?.name ?? 'The captain'} handles the anchor.`)
      return
    }
    if (!v || v.kind !== 'BOAT' || this.mode !== 'vehicle') return
    if (v.anchored) {
      if (this.fishing.busy) this.fishing.cancel()
      v.anchored = false
      this.deckSeat = null
      this.swivel = 0
      this.anchorLine.setEnabled(false)
      this.audio.click()
      this.hud.toast('Anchor up. Back at the console — W/S throttle, A/D tiller.')
      return
    }
    if (Math.abs(v.speed) > ANCHOR_MAX_SPEED) {
      this.hud.toast('Slow down before you drop the anchor.', 'warn')
      return
    }
    v.anchored = true
    this.deckSeat = 0
    this.swivel = 0
    this.anchorLine.setEnabled(true)
    this.audio.splash()
    const crew = this.online.crewOf(this.online.id)
    this.hud.toast(`Anchor down. You're on the ${DECK_SEAT_NAMES[0]} seat${crew ? `, ${crew} has the ${DECK_SEAT_NAMES[1]}` : ''}. F switches seats · Q pulls the anchor.`)
  }

  private switchSeat(): void {
    if (this.mode === 'crew') {
      const b = this.crewBoat
      if (!b?.anchored) {
        this.hud.toast('The boat has to be anchored to move to the deck seats.')
        return
      }
      this.online.requestSeat(b.id)
      this.hud.toast(`Asked ${b.name} to swap seats.`)
      return
    }
    const v = this.vehicles.active
    if (this.mode !== 'vehicle' || v?.kind !== 'BOAT') return
    if (!v.anchored || this.deckSeat === null) {
      this.hud.toast('Drop the anchor (Q) first, then you can move to the deck seats.')
      return
    }
    if (this.fishing.busy) this.fishing.cancel()
    this.deckSeat = otherSeat(this.deckSeat)
    const crew = this.online.crewOf(this.online.id)
    this.hud.toast(`Moved to the ${DECK_SEAT_NAMES[this.deckSeat]} seat${crew ? `; ${crew} takes the other one` : ''}.`)
  }

  private hideOverlappedBoat(): void {
    const own = this.boat
    const covered = !own.occupied && this.online.boats().some((b) => Math.hypot(b.root.position.x - own.position.x, b.root.position.z - own.position.z) < 3.5)
    if (own.root.isEnabled() === covered) own.root.setEnabled(!covered)
  }

  private nearOwnVehicle(): Vehicle | null {
    const v = this.vehicles.nearest(this.foot, 4.2)
    return v && v.root.isEnabled() ? v : null
  }

  private nearRemoteBoat(): RemoteBoat | null {
    let best: RemoteBoat | null = null
    let bestD = BOARD_RANGE
    for (const b of this.online.boats()) {
      const d = Math.hypot(b.root.position.x - this.foot.x, b.root.position.z - this.foot.z)
      if (d < bestD) {
        bestD = d
        best = b
      }
    }
    return best
  }

  private boardCrew(b: RemoteBoat): void {
    if (b.crew) {
      this.hud.toast(`${b.name}'s boat is full — ${b.crew} already has the other seat.`, 'warn')
      return
    }
    if (b.speed > BOARD_MAX_SPEED) {
      this.hud.toast(`Wait for ${b.name} to stop the boat.`, 'warn')
      return
    }
    if (this.fishing.busy) this.fishing.cancel()
    if (this.tool === 'rifle') this.setTool('rod')
    this.mode = 'crew'
    this.crewOf = b.id
    this.crewBoat = b
    this.crouch = false
    this.swivel = 0
    this.avatar.root.parent = b.root
    this.avatar.root.rotationQuaternion = null
    this.avatar.root.rotation.set(0, 0, 0)
    this.online.announce(`climbed aboard ${b.name}'s boat.`)
    this.hud.toast(b.anchored ? `Aboard with ${b.name} on the ${DECK_SEAT_NAMES[otherSeat(b.deck)]} seat. Cast away · F asks to swap seats · E near shore to step off.` : `Aboard with ${b.name} in the passenger seat. When they anchor you'll move to a deck seat.`)
  }

  private leaveCrew(forced: boolean): void {
    const spot = this.vehicles.shoreNear(this.foot)
    if (!forced && (!spot || this.terrain.depthAt(spot.x, spot.z) > 0.9)) {
      this.hud.toast('Too deep to step off here. Ask the captain to run up to shore.', 'warn')
      return
    }
    if (this.fishing.busy) this.fishing.cancel()
    const name = this.crewBoat?.name ?? 'the captain'
    this.avatar.root.setParent(null)
    this.avatar.root.rotationQuaternion = null
    this.mode = 'foot'
    this.crewOf = null
    this.crewBoat = null
    this.velocity.setAll(0)
    if (spot) {
      this.foot.copyFrom(spot)
      this.foot.y = this.terrain.heightAt(spot.x, spot.z)
    } else {
      this.foot.copyFrom(this.dockEnd)
      this.foot.y = 0.58
    }
    if (forced) this.hud.toast(spot ? `${name} tied up the boat. You stepped ashore.` : `${name}'s boat is gone. You caught a ride back to the dock.`)
  }

  private seatLocal(): Vector3 | null {
    if (this.mode === 'crew') {
      const b = this.crewBoat
      if (!b) return null
      return b.anchored ? DECK_SEATS[otherSeat(b.deck)] : PASSENGER_SEAT
    }
    const v = this.vehicles.active
    if (this.mode !== 'vehicle' || !v) return null
    if (v.kind !== 'BOAT') return v.seat
    return this.deckSeat === null ? CONSOLE_SEAT : DECK_SEATS[this.deckSeat]
  }

  private get onDeck(): boolean {
    return this.mode === 'crew' || (this.mode === 'vehicle' && this.deckSeat !== null)
  }

  private updateCrew(dt: number): void {
    if (this.mode === 'vehicle' && this.vehicles.active === this.boat) {
      const crew = this.online.crewOf(this.online.id)
      if (crew !== this.crewAboard) {
        if (crew) this.hud.toast(`${crew} climbed aboard${this.deckSeat === null ? ' and took the passenger seat' : ` and took the ${DECK_SEAT_NAMES[otherSeat(this.deckSeat)]} seat`}.`)
        else if (this.crewAboard) this.hud.toast(`${this.crewAboard} stepped off the boat.`)
        this.crewAboard = crew
      }
    } else this.crewAboard = null
    if (this.mode !== 'crew' || !this.crewOf) return
    const b = this.online.boat(this.crewOf)
    if (!b || !this.online.active) {
      this.leaveCrew(true)
      return
    }
    const wasAnchored = this.crewBoat?.anchored
    this.crewBoat = b
    if (wasAnchored !== undefined && wasAnchored !== b.anchored) {
      if (b.anchored) this.hud.toast(`${b.name} dropped anchor. You're on the ${DECK_SEAT_NAMES[otherSeat(b.deck)]} seat.`)
      else {
        if (this.fishing.busy) this.fishing.cancel()
        this.hud.toast(`${b.name} pulled the anchor. Hang on in the passenger seat.`)
      }
    }
    if (this.avatar.root.parent !== b.root) {
      this.avatar.root.parent = b.root
      this.avatar.root.rotationQuaternion = null
    }
    this.swivel = b.anchored ? swivelToward(this.swivel, this.ctx.camera.rotation.y, b.heading, dt) : 0
    this.moveSpeed = 0
  }

  private primaryDown(): void {
    if (this.fishing.state === 'bite') {
      this.fishing.setHook()
      return
    }
    if (this.fishing.state === 'landing' || this.fishing.state === 'reeling' || this.fishing.state === 'nibble') return
    const v = this.vehicles.active
    if (this.tool === 'rod') {
      if (this.mode === 'climb' || this.mode === 'stand') {
        this.hud.toast('Climb down to fish. The stand is for the rifle.', 'warn')
        return
      }
      if (v && (v.kind === 'ATV' || Math.abs(v.speed) > 1.2)) {
        this.hud.toast(v.kind === 'ATV' ? 'Park the UTV and step out to fish.' : 'Ease off the throttle to cast.', 'warn')
        return
      }
      if (this.mode === 'crew' && (this.crewBoat?.speed ?? 0) > 1.2) {
        this.hud.toast('Hold on until the boat slows down.', 'warn')
        return
      }
      if (this.fishing.busy) return
      this.fishing.startCharge()
    } else if (this.mode !== 'climb') {
      this.fire()
    }
  }

  private primaryUp(): void {
    if (this.fishing.state === 'charging') {
      const dir = this.ctx.camera.getDirection(Vector3.Forward())
      this.fishing.release(this.castOrigin(), dir)
      this.avatar.cast()
      this.audio.whoosh()
    }
  }

  private castOrigin(): Vector3 {
    return this.rodTip.getAbsolutePosition().clone()
  }

  private fire(): void {
    if (this.rifleCooldown > 0) return
    this.rifleCooldown = 1.25
    this.recoil = 1
    this.audio.shot()
    const cam = this.ctx.camera
    const origin = cam.globalPosition.clone()
    const dir = cam.getDirection(Vector3.Forward()).normalize()
    const shot = this.wildlife.shoot(origin, dir, 420)
    let blockedAt = Infinity
    const groundHit = this.ground.intersects(new Ray(origin, dir, 420), false)
    if (groundHit.hit) blockedAt = groundHit.distance
    if (shot.animal) {
      for (let d = 1; d < Math.min(shot.distance, blockedAt); d += 0.9) {
        const p = origin.add(dir.scale(d))
        for (const t of this.ctx.queryTrunks(p.x, p.z, 0.5)) {
          if ((t.x - p.x) ** 2 + (t.z - p.z) ** 2 < t.r * t.r * 0.6 && p.y < t.max.y) {
            blockedAt = d
            break
          }
        }
        if (blockedAt === d) break
      }
    }
    this.wildlife.alertAll(origin, 280)
    if (!shot.animal || shot.distance > blockedAt) {
      this.hud.toast(blockedAt < 420 ? 'Missed — the shot hit cover.' : 'Missed.')
      return
    }
    const yards = Math.round(Vector3.Distance(this.foot, shot.animal.position) * 1.094)
    if (this.online.isGuest) this.online.sendShot(shot.animal.id, shot.vital, origin)
    const down = this.wildlife.hit(shot.animal, shot.vital, origin)
    if (down) this.myKills.add(shot.animal.id)
    if (down && this.mode === 'stand') this.standKills.add(shot.animal.id)
    const climbHint = this.mode === 'stand' ? ' Climb down (E) and walk within 10 yards to tag it.' : ' Walk within 10 yards to tag it.'
    if (down) this.hud.toast(`Clean ${shot.vital ? 'vital' : 'follow-up'} hit at ${yards} yd.${climbHint}`, 'big')
    else this.hud.toast(`Hit at ${yards} yd but high or back. It ran — a second hit will put it down.`, 'warn')
  }

  private tag(animal: Animal): void {
    animal.tagged = true
    this.online.sendTag(animal.id)
    this.online.announce(animal.doe ? 'filled an antlerless tag.' : `tagged a ${animal.template.id === 'whitetail' ? 'buck' : animal.template.name.toLowerCase()} — ${fmtValue(animal.specimen.species, animal.specimen.value)}${animal.specimen.legendary ? ', a record!' : ''}`)
    this.myKills.delete(animal.id)
    if (animal.doe) {
      this.bag.push(animal.specimen)
      this.hud.setBag(this.bag.length, this.bag.reduce((a, s) => a + s.trophyPoints, 0))
      this.hud.toast(`Antlerless tag filled: a ${animal.specimen.weightLb} lb doe for the freezer. Only bucks make the record book.`)
      void this.earn({ action: 'game', species: 'whitetail', value: 0, legendary: false, doe: true, stand: this.standKills.has(animal.id), seed: 0 })
      return
    }
    const report = this.earn({ action: 'game', species: animal.specimen.species, value: animal.specimen.value, legendary: animal.specimen.legendary, doe: false, stand: this.standKills.has(animal.id), seed: animal.specimen.seed })
    this.recordSpecimen(animal.specimen, report)
  }

  private playerState(): PlayerState {
    const v = this.vehicles.active
    const r = this.avatar.root
    const l = this.progress.profile.loadout
    const stance = this.mode === 'vehicle' || this.mode === 'stand' || this.mode === 'crew' ? 'sit' : this.mode === 'climb' ? (this.climbT < this.layout.climbSplit ? 'climb' : 'sit') : 'stand'
    if (this.mode === 'bowfish') {
      const lo = this.progress.profile.loadout
      const swivel = this.avatar.root.rotation.y
      return { id: this.online.id, n: this.online.name, p: [this.foot.x, this.foot.y, this.foot.z], f: Math.atan2(Math.sin(swivel), Math.cos(swivel)), st: 'stand', h: this.bowfish.hands, sp: Math.round(this.bowfish.walkSpeed * 10) / 10, c: false, cl: 0, ap: this.ctx.camera.rotation.x, o: [lo.jacket, lo.vest, lo.cap, lo.pants, lo.pack], b: this.bowfish.netState() }
    }
    const at = this.mode === 'vehicle' || this.mode === 'crew' ? this.foot : r.position
    const state: PlayerState = {
      id: this.online.id, n: this.online.name, p: [at.x, at.y, at.z], f: this.onDeck ? this.swivel : this.facing, st: stance, h: this.handsNow, sp: this.moveSpeed, c: this.crouch, cl: this.climbT * 9, ap: this.ctx.camera.rotation.x,
      o: [l.jacket, l.vest, l.cap, l.pants, l.pack],
    }
    const seat = this.seatLocal()
    if (v && seat) {
      const kind = v.kind === 'BOAT' ? 'boat' : v.rig.root.name.startsWith('quad') ? 'quad' : 'utv'
      state.v = { k: kind, p: [v.position.x, v.position.y, v.position.z], q: [v.heading, v.pitch, v.roll], s: [seat.x, seat.y, seat.z] }
      if (v.anchored) {
        state.v.a = 1
        state.v.d = this.deckSeat ?? 0
      }
      state.p = [v.position.x, v.position.y, v.position.z]
    } else if (this.mode === 'crew' && this.crewOf && seat) state.r = { o: this.crewOf, s: [seat.x, seat.y, seat.z] }
    return state
  }

  private mapMarkers(): MapMarker[] {
    const out: MapMarker[] = [{ x: this.cabin.root.x, z: this.cabin.root.z, kind: 'cabin' }]
    for (const st of this.stands) out.push({ x: st.tree.x, z: st.tree.z, kind: st.kind === 'blind' ? 'blind' : 'stand' })
    for (const v of this.vehicles.vehicles) {
      if (v === this.vehicles.active) continue
      out.push({ x: v.position.x, z: v.position.z, kind: v.kind === 'BOAT' ? 'boat' : v.rig.root.name.startsWith('quad') ? 'quad' : 'utv' })
    }
    for (const a of this.wildlife.animals) if (a.state === 'down' && !a.tagged) out.push({ x: a.position.x, z: a.position.z, kind: 'down' })
    for (const m of this.online.members) out.push({ x: m.at.x, z: m.at.z, kind: 'friend', label: m.name })
    const wild = this.bowfish.marker()
    if (wild) out.push(wild)
    return out
  }

  private async earn(report: CatchReport): Promise<EarnReport> {
    const result = await this.progress.report(report)
    if (result.paid > 0) this.hud.toast(`+$${result.paid.toLocaleString()} · cash $${this.progress.profile.cash.toLocaleString()}`, 'big')
    for (const t of result.completed) this.hud.toast(`Task complete: ${t.text} (+$${t.reward})`, 'big')
    return result
  }

  private grunt(): void {
    if (!this.progress.effects.call) {
      this.hud.toast('No grunt call in your pocket. Buy one from the catalog at the cabin, then equip it at the gear rack.', 'warn')
      return
    }
    if (this.gruntCooldown > 0) {
      this.hud.toast(`Give it a minute — overcalling spooks bucks (${Math.ceil(this.gruntCooldown)} s).`)
      return
    }
    this.gruntCooldown = 60
    this.audio.click()
    const buck = this.wildlife.lure(this.foot)
    if (buck) {
      const d = buck.position.subtract(this.foot)
      this.hud.toast(`A deer turns toward the grunt, ${Math.round(d.length() * 1.094)} yd to the ${compassWord(Math.atan2(d.x, d.z))}.`)
    } else this.hud.toast('Nothing answers the call. Try again later.')
  }

  private recordSpecimen(specimen: Specimen, report: Promise<EarnReport>): void {
    this.bag.push(specimen)
    this.loot.claim(specimen, 'You', this.placeName())
    const points = this.bag.reduce((a, s) => a + s.trophyPoints, 0)
    this.hud.setBag(this.bag.length, points)
    if (this.loot.isTrophy(specimen)) void Scores.submit(MODULE_ID, specimen.trophyPoints, { key: `${this.sessionKey}-${specimen.serial}` })
    document.exitPointerLock()
    this.hud.showCatch(specimen, () => {
      this.clearHero()
      this.lock()
    })
    this.hud.showCatchScores(specimen, this.progress.board, null, this.progress.scoreName)
    void report.then((r) => {
      this.hud.showCatchScores(specimen, this.progress.board, r.placed, this.progress.scoreName)
      const ranks = Object.values(r.placed)
      if (!ranks.length) return
      this.audio.chime()
      const top = Math.min(...ranks)
      const name = SPECIES_BY_ID[specimen.species].name.toLowerCase()
      this.hud.toast(top === 1 ? `New #1 high score for ${name}!` : `Your ${name} made the top three (#${top}).`, 'big')
      if (top === 1) this.online.announce(`took the #1 high score for ${name}!`)
    })
  }

  /** Bucks and bears this player shot tag themselves once the hunter walks within 10 yards. */
  private autoTag(): void {
    if (this.hud.modalOpen || this.panels.open || !this.myKills.size) return
    const v = this.vehicles.active
    const onGround = this.mode === 'foot' || (this.mode === 'vehicle' && v?.kind === 'ATV')
    if (!onGround) return
    const at = this.mode === 'vehicle' && v ? v.position : this.foot
    for (const a of this.wildlife.animals) {
      if (a.state !== 'down' || a.tagged || !this.myKills.has(a.id)) continue
      if (Math.hypot(a.position.x - at.x, a.position.z - at.z) <= TAG_RANGE) {
        this.tag(a)
        return
      }
    }
  }

  private onFishing(e: FishingEvent): void {
    if (e.type === 'cast') return
    if (e.type === 'splash') {
      this.audio.splash()
      if (!e.inWater) this.hud.toast('Too shallow there — cast out past the weeds.', 'warn')
      else if (!this.baitHintShown) {
        this.baitHintShown = true
        this.hud.toast(this.fishing.bait.hint)
      }
    } else if (e.type === 'nibble') {
      this.audio.splash()
      this.hud.toast('Something is nibbling… wait for the bobber to go under.')
    } else if (e.type === 'jump') {
      this.audio.splash(true)
      if (!this.jumpTold) this.hud.toast(`Jumper! ${SPECIES_BY_ID[e.specimen.species].name} clearing the water — keep the line tight.`)
      this.jumpTold = true
    } else if (e.type === 'bite') {
      this.director.rearm('fish')
      this.audio.splash()
      this.hud.toast(e.lure ? 'Strike! Click or press R to set the hook — fast!' : 'Bobber down! Click or press R to set the hook!', 'big')
    } else if (e.type === 'missed') {
      this.hud.toast(e.pulled ? 'You pulled the bait away from it. Leave live bait still until the float goes under.' : this.fishing.bait.kind === 'lure' ? 'Too slow — it let go of the lure. Keep working it.' : 'It spit the bait. Stay ready.')
    } else if (e.type === 'hooked') {
      this.audio.splash(true)
      this.jumpTold = false
      if (e.specimen.legendary) this.hud.toast('This one is heavy… a record-class fish!', 'big')
      else this.hud.toast('Fish on! Hold left-click or R to reel; let go to ease off. Keep the needle in the green.')
    } else if (e.type === 'landed') {
      this.audio.splash(true)
      this.online.announce(`landed a ${fmtValue(e.specimen.species, e.specimen.value)} ${SPECIES_BY_ID[e.specimen.species].name.toLowerCase()}${e.specimen.legendary ? ' — a record!' : ''}`)
      const report = this.earn({ action: 'fish', species: e.specimen.species, value: e.specimen.value, legendary: e.specimen.legendary, boat: this.vehicles.active?.kind === 'BOAT' || this.mode === 'crew', seed: e.specimen.seed })
      this.showHero(e.specimen)
      this.recordSpecimen(e.specimen, report)
    } else if (e.type === 'lost') {
      this.hud.toast(e.reason === 'snapped' ? 'Snap! Too much tension broke the line.' : 'The hook pulled free on slack line.', 'warn')
    }
  }

  private showHero(specimen: Specimen): void {
    const t = SPECIES_BY_ID[specimen.species]
    const model = this.models.get(t.model as ModelName)
    if (!model) return
    this.heroRig = instantiate(model, null, this.ctx.scene, (m) => {
      m.sourceMesh.renderingGroupId = 1
      m.sourceMesh.applyFog = false
      this.ctx.registerDynamic(m)
    })
    const length = specimen.lengthIn * 0.0254
    this.heroRig.root.parent = this.ctx.camera
    this.heroRig.root.scaling.setAll(length)
    this.heroRig.root.position.set(0, 0.06, 0.55 + length * 0.75)
    this.heroRig.root.rotation.set(0, Math.PI / 2, 0)
    this.heroClock = 0
    if (!this.heroLight) {
      this.heroLight = new DirectionalLight('hero-key', new Vector3(0, -1, 0), this.ctx.scene)
      this.heroLight.intensity = 1.5
      this.heroLight.diffuse = new Color3(1, 0.95, 0.86)
      this.heroLight.specular = new Color3(0.6, 0.58, 0.55)
    }
    this.heroLight.direction = this.ctx.camera.getDirection(new Vector3(-0.35, -0.55, 1)).normalize()
    this.heroLight.includedOnlyMeshes = [...model.parts.values()].map((p) => p.mesh)
    this.heroLight.setEnabled(true)
  }

  private clearHero(): void {
    if (!this.heroRig) return
    for (const m of this.heroRig.meshes) {
      this.ctx.unregisterDynamic(m)
      m.dispose()
    }
    this.heroRig.root.dispose()
    this.heroRig = null
    this.heroLight?.setEnabled(false)
  }

  /** A carp swung into Wild Man's tub: bag, record book, Trophy Room and pay. Returns its record-book place (0 = none). */
  private tubCarp(specimen: Specimen): 0 | 1 | 2 | 3 {
    this.bag.push(specimen)
    const tier = this.loot.claim(specimen, 'You', this.placeName())
    this.hud.setBag(this.bag.length, this.bag.reduce((a, s) => a + s.trophyPoints, 0))
    if (this.loot.isTrophy(specimen)) void Scores.submit(MODULE_ID, specimen.trophyPoints, { key: `${this.sessionKey}-${specimen.serial}` })
    const report = this.earn({ action: 'fish', species: 'carp', value: specimen.value, legendary: specimen.legendary, boat: true, seed: specimen.seed })
    this.online.announce(`arrowed a ${fmtValue('carp', specimen.value)} carp${tier ? ', a record!' : ''}`)
    if (tier) {
      this.audio.chime()
      document.exitPointerLock()
      this.hud.showCatch(specimen, () => this.lock())
      this.hud.showCatchScores(specimen, this.progress.board, null, this.progress.scoreName)
    }
    void report.then((r) => {
      if (tier) this.hud.showCatchScores(specimen, this.progress.board, r.placed, this.progress.scoreName)
      const ranks = Object.values(r.placed)
      if (!ranks.length) return
      const top = Math.min(...ranks)
      this.hud.toast(top === 1 ? 'New #1 high score for carp!' : `Your carp made the top three (#${top}).`, 'big')
      if (top === 1) this.online.announce('took the #1 high score for carp!')
    })
    return tier
  }

  private placeName(): string {
    if (this.mode === 'stand' || this.mode === 'climb') return this.layout.name.replace(/^./, (c) => c.toUpperCase())
    const g = this.terrain.groundAt(this.foot.x, this.foot.z)
    const v = this.vehicles.active
    if (this.mode === 'bowfish') {
      const b = this.bowfish.boatPosition
      return bayCoord(b.x, b.z) < 1.15 ? 'Back Bay' : channelDistance(b.x, b.z) < 20 ? 'Interstate channel' : 'Bear Paw Lake'
    }
    if (v?.kind === 'BOAT' || this.mode === 'crew') return this.fishing.habitat === 'deep' ? 'Deep basin' : 'Bear Paw Lake'
    return { water: 'Bear Paw Lake', shore: 'Lakeshore', marsh: 'Cattail Marsh', meadow: 'Oak Opening', forest: 'Pine Ridge', trail: 'Two-track trail', rock: 'Granite Bluff' }[g]
  }

  private frame(): void {
    const engine = this.ctx.engine
    const dt = Math.min(0.05, engine.getDeltaTime() / 1000)
    this.time += dt
    if (this.playing) this.clock.advance(dt)
    this.lighting.update()
    this.hud.setClock(this.clock.label)
    this.weeds.update(this.ctx.camera.globalPosition)
    this.skyMat.setFloat('time', this.time)
    this.waterMat.setFloat('time', this.time)
    this.waterMat.setVector3('cameraPos', this.ctx.camera.globalPosition)
    if (this.playing) this.update(dt)
    this.ctx.scene.render()
  }

  private key(code: string): number {
    return this.keys.has(code) ? 1 : 0
  }

  private update(dt: number): void {
    const cam = this.ctx.camera
    const locked = document.pointerLockElement === this.canvas && !this.hud.modalOpen
    const active = !this.hud.modalOpen
    const v = this.vehicles.active
    const reeling = this.fishing.fighting
    const sens = this.ctx.sensitivity
    const aimingLook = this.ads > 0.5 || (this.mode === 'bowfish' && this.aimHeld)
    const lookScale = this.ads > 0.5 ? 0.3 * sens.aim : aimingLook ? sens.aim : sens.look
    if (this.mode === 'bowfish') cam.angularSensibility = 2200 / (aimingLook ? sens.aim : sens.look)
    cam.rotation.y += (this.key('ArrowRight') - this.key('ArrowLeft')) * ARROW_YAW_RATE * lookScale * dt * (active ? 1 : 0)
    cam.rotation.x += (this.key('ArrowDown') - this.key('ArrowUp')) * ARROW_PITCH_RATE * lookScale * dt * (active ? 1 : 0)
    const input = {
      throttle: active && !reeling && v ? this.key('KeyW') - this.key('KeyS') : 0,
      steer: active && !reeling && v ? this.key('KeyD') - this.key('KeyA') : 0,
      brake: this.keys.has('Space'),
    }
    this.vehicles.update(dt, input)
    const bowfishing = this.mode === 'bowfish'
    this.bowfish.setParty(this.online.bowTrip(), this.online.bowSlots(), this.online.active && this.online.members.length > 0)
    const walkKeys = bowfishing && active
    this.bowfish.update(dt, {
      aim: bowfishing && this.aimHeld,
      shoot: this.bowShoot,
      reel: (this.keys.has('KeyR') || this.leftDown) && active,
      locked,
      forward: walkKeys ? this.key('KeyW') - this.key('KeyS') : 0,
      right: walkKeys ? this.key('KeyD') - this.key('KeyA') : 0,
    })
    this.bowShoot = false
    if (bowfishing) this.bowfish.feet(this.foot)
    else if (v && !v.anchored) this.audio.engine(true, Math.abs(v.speed) / 16, v.kind === 'BOAT')
    else this.audio.engine(false, 0, false)
    this.updateCrew(dt)
    this.hideOverlappedBoat()
    if (this.mode === 'vehicle' && v && this.deckSeat !== null) this.swivel = swivelToward(this.swivel, cam.rotation.y, v.heading, dt)
    const sprint = this.keys.has('ShiftLeft') || this.keys.has('ShiftRight')
    const canAim = ((this.mode === 'foot' || this.mode === 'stand') && this.tool === 'rifle') || bowfishing
    if (!canAim) this.scopeLock = false
    const wantAds = canAim && !bowfishing && this.aimHeld && locked
    this.ads += ((wantAds ? 1 : 0) - this.ads) * Math.min(1, dt * 10)
    if (!bowfishing) this.ctx.setAds(this.ads > 0.55 ? (this.ads - 0.55) / 0.45 : 0, this.progress.effects.scopeZoom)
    this.gruntCooldown = Math.max(0, this.gruntCooldown - dt)
    void this.progress.update(dt, active && !this.panels.open)
    if (this.mode === 'foot') this.walk(dt, active, sprint)
    else if (this.mode === 'climb') this.climb(dt)
    else if (this.mode === 'vehicle' && v) this.moveSpeed = Math.abs(v.speed)
    else if (this.mode !== 'crew') this.moveSpeed = 0
    if (bowfishing && this.fishing.busy) this.fishing.cancel()
    this.rifleCooldown = Math.max(0, this.rifleCooldown - dt)
    this.recoil = Math.max(0, this.recoil - dt * 5)
    this.placeAvatar(dt)
    this.rodFx.update(dt, this.fishing.rodBend, this.fishing.busy ? this.fishing.lineEnd : null, this.fishing.lineTaut, this.fishing.crankSpeed)
    this.fishing.update(dt, this.castOrigin(), (this.leftDown || this.keys.has('KeyR')) && locked)
    if (this.fishing.dragging) {
      this.dragTimer -= dt
      if (this.dragTimer <= 0) {
        this.dragTimer = 0.045 + Math.random() * 0.02
        this.audio.click()
      }
    }
    const noise = bowfishing ? 0.08 : this.onDeck ? 0.12 : this.mode === 'vehicle' ? 1.4 : this.mode === 'stand' ? 0.03 : this.mode === 'climb' ? 0.5 : this.moveSpeed < 0.3 ? 0.04 : this.crouch ? 0.15 : sprint ? 1 : 0.45
    const focus = v ? v.position : this.foot
    this.wildlife.update(dt, [{ p: focus, noise }, ...this.online.members.map((m) => ({ p: m.at, noise: 0.35 }))])
    this.autoTag()
    const exploring = this.mode === 'stand' || (v ? Math.abs(v.speed) > 1 : this.mode === 'crew' ? (this.crewBoat?.speed ?? 0) > 1 : this.moveSpeed > 0.5)
    const onLand = (!v || v.kind === 'ATV') && this.mode !== 'crew'
    const lure = this.fishing.bait.kind === 'lure'
    const baitWorking = this.fishing.lineInWater && (lure ? this.fishing.retrieving : !this.fishing.retrieving)
    const signal = bowfishing ? null : this.director.update(dt, { exploring, lineInWater: baitWorking, onLand, fishRate: this.progress.effects.biteRate })
    if (signal === 'fish') this.fishing.bite()
    else if (signal === 'game') {
      this.director.rearm('game')
      const animal = onLand ? this.wildlife.lure(focus) : null
      if (animal) {
        const d = animal.position.subtract(focus)
        this.hud.toast(`${animal.doe ? 'Does are' : animal.template.id === 'whitetail' ? 'A buck is' : 'A bear is'} moving to the ${compassWord(Math.atan2(d.x, d.z))}, about ${Math.round(d.length() * 1.094)} yd. Switch to the rifle (2) and ease in.`)
      }
    }
    this.wildlife.maintain(dt, [focus, ...this.online.members.map((m) => m.at)])
    const watching = this.mode === 'foot' && (this.fishing.lineInWater || this.fishing.fighting || this.fishing.state === 'flying')
    this.fishCam += ((watching ? 1 : 0) - this.fishCam) * Math.min(1, dt * 2.5)
    this.updateGear()
    this.online.update(dt, this.playerState(), () => this.wildlife.snapshot())
    this.minimap.draw(dt, this.foot.x, this.foot.z, cam.rotation.y, v ? v.heading : this.facing, this.mapMarkers())
    this.updateHud(dt, locked)
    this.foliage.updateGrass(focus)
    this.ctx.setShadowFocus(focus)
    const casterList = this.casterScratch
    casterList.length = 0
    for (const mesh of this.casters) casterList.push(mesh)
    this.wildlife.collectCasters(casterList)
    for (const mesh of this.online.casters()) casterList.push(mesh)
    this.foliage.updateShadowCasters(focus, casterList)
    if (this.heroRig) {
      this.heroClock += dt
      this.heroRig.root.rotation.y = Math.PI / 2 + Math.sin(this.heroClock * 0.8) * 0.35
      const tail = this.heroRig.joints.get('tail')
      if (tail) tail.rotation.y = Math.sin(this.heroClock * 9) * 0.35
    }
  }

  private walk(dt: number, active: boolean, sprint: boolean): void {
    const cam = this.ctx.camera
    const yaw = cam.rotation.y
    const f = active ? this.key('KeyW') - this.key('KeyS') : 0
    const s = active ? this.key('KeyD') - this.key('KeyA') : 0
    const busy = this.fishing.state === 'charging' || this.fishing.fighting
    let speed = sprint && !this.crouch ? SPRINT_SPEED : this.crouch ? CROUCH_SPEED : WALK_SPEED
    if (this.ads > 0.3 || (this.tool === 'rifle' && this.aimHeld)) speed = AIM_SPEED
    if (busy) speed = 0
    const dir = new Vector3(Math.sin(yaw) * f + Math.cos(yaw) * s, 0, Math.cos(yaw) * f - Math.sin(yaw) * s)
    const len = dir.length()
    if (len > 0) dir.scaleInPlace(speed / len)
    const accel = Math.min(1, dt * (len > 0 ? 9 : 12))
    this.velocity.x += (dir.x - this.velocity.x) * accel
    this.velocity.z += (dir.z - this.velocity.z) * accel
    const prevX = this.foot.x
    const prevZ = this.foot.z
    const p = this.foot
    p.x = Math.max(-PLAY_LIMIT, Math.min(PLAY_LIMIT, p.x + this.velocity.x * dt))
    p.z = Math.max(-PLAY_LIMIT, Math.min(PLAY_LIMIT, p.z + this.velocity.z * dt))
    this.cabin.collide(p, 0.3)
    for (const t of this.ctx.queryTrunks(p.x, p.z, 0.4)) {
      const dx = p.x - t.x
      const dz = p.z - t.z
      const d = Math.hypot(dx, dz)
      const min = t.r + 0.3
      if (d < min && d > 1e-4) {
        p.x = t.x + (dx / d) * min
        p.z = t.z + (dz / d) * min
      }
    }
    if (this.terrain.depthAt(p.x, p.z) > this.progress.effects.wadeDepth && !this.onDock(p)) {
      p.x = prevX
      p.z = prevZ
      this.velocity.setAll(0)
    }
    const floor = Math.max(this.terrain.heightAt(p.x, p.z), this.onDock(p) ? 0.58 : -10, this.cabin.floorAt(p) ?? -10)
    p.y += (floor - p.y) * Math.min(1, dt * 18)
    const moved = Math.hypot(p.x - prevX, p.z - prevZ) / Math.max(1e-3, dt)
    this.moveSpeed += (moved - this.moveSpeed) * Math.min(1, dt * 8)
    const faceCamera = this.fishing.busy || (this.tool === 'rifle' && (this.aimHeld || this.rifleCooldown > 0.6))
    let target = this.facing
    if (faceCamera) target = yaw
    else if (Math.hypot(this.velocity.x, this.velocity.z) > 0.3) target = Math.atan2(this.velocity.x, this.velocity.z)
    let delta = target - this.facing
    delta = Math.atan2(Math.sin(delta), Math.cos(delta))
    this.facing += delta * Math.min(1, dt * (faceCamera ? 16 : 10))
  }

  private climb(dt: number): void {
    this.climbT += (this.climbDir * dt) / STAND_CLIMB_SECONDS
    this.moveSpeed = 0
    if (this.climbT >= 1) {
      this.climbT = 1
      this.mode = 'stand'
      this.facing = this.stand.heading
      this.hud.toast(`Settled in the ${this.layout.name}. Deer won't hear you up here — rifle out (2), right-click to glass the opening.`)
      return
    }
    if (this.climbT <= 0) {
      this.climbT = 0
      this.mode = 'foot'
      const out = this.layout.base
      this.foot.copyFrom(standToWorld(this.stand, out.add(new Vector3(0, 0, Math.sign(out.z) * 0.45))))
      this.foot.y = this.terrain.heightAt(this.foot.x, this.foot.z)
      this.facing = this.stand.heading
      this.velocity.setAll(0)
      return
    }
    this.facing = this.stand.heading + (this.layout.base.z > 0 ? Math.PI : 0)
  }

  private climbLocal(): Vector3 {
    const t = this.climbT
    const L = this.layout
    const ladder = L.climbSplit
    if (t < ladder) {
      const f = t / ladder
      return Vector3.Lerp(L.base, L.top, f).addInPlaceFromFloats(0, 0.02, Math.sign(L.base.z) * 0.22)
    }
    const f = (t - ladder) / (1 - ladder)
    return Vector3.Lerp(L.top.add(new Vector3(0, 0.02, 0.0)), L.seat.subtract(new Vector3(0, HIP_HEIGHT, 0)), f)
  }

  private placeAvatar(dt: number): void {
    if (this.mode === 'bowfish') {
      this.bowfish.placePlayer(dt)
      this.handsNow = 'free'
      return
    }
    const root = this.avatar.root
    let stance: AvatarStance = 'stand'
    const seat = this.seatLocal()
    if ((this.mode === 'vehicle' || this.mode === 'crew') && seat && root.parent) {
      stance = 'sit'
      root.rotationQuaternion = null
      root.rotation.set(0, this.onDeck ? this.swivel : 0, 0)
      root.position.set(seat.x, seat.y - HIP_HEIGHT, seat.z)
      const parent = root.parent as TransformNode
      this.foot.copyFrom(Vector3.TransformCoordinates(seat, parent.computeWorldMatrix(true))).addInPlaceFromFloats(0, -HIP_HEIGHT, 0)
    } else if (this.mode === 'vehicle' || this.mode === 'crew') {
      stance = 'sit'
    } else {
      root.rotationQuaternion = null
      root.rotation.set(0, this.facing, 0)
      if (this.mode === 'foot') root.position.copyFrom(this.foot)
      else if (this.mode === 'climb') {
        root.position.copyFrom(standToWorld(this.stand, this.climbLocal()))
        stance = this.climbT < this.layout.climbSplit ? 'climb' : 'sit'
      } else {
        root.position.copyFrom(standToWorld(this.stand, this.layout.seat.subtract(new Vector3(0, HIP_HEIGHT, 0))))
        stance = 'sit'
      }
    }
    if (this.mode === 'stand' || this.mode === 'climb') this.foot.copyFrom(root.position)
    const v = this.vehicles.active
    const st = this.fishing.state
    let hands: AvatarHands = 'free'
    if (stance === 'climb') hands = 'free'
    else if (this.mode === 'vehicle' && v && this.deckSeat === null && (v.kind === 'ATV' || !this.fishing.busy && (Math.abs(v.speed) > 1.2 || this.tool !== 'rod'))) hands = 'wheel'
    else if (this.mode === 'crew' && !this.fishing.busy && (this.crewBoat?.speed ?? 0) > 1.2) hands = 'free'
    else if (this.tool === 'rifle') hands = this.aimHeld && document.pointerLockElement === this.canvas ? 'aim' : 'rifle'
    else if (st === 'charging' || st === 'flying') hands = 'cast'
    else if (st === 'reeling' || st === 'landing') hands = 'reel'
    else hands = 'rod'
    this.handsNow = hands
    this.avatar.update(dt, {
      stance,
      hands,
      speed: this.mode === 'foot' ? this.moveSpeed : 0,
      crouch: this.crouch && this.mode === 'foot',
      castPower: st === 'charging' ? this.fishing.power : 0,
      aimPitch: this.ctx.camera.rotation.x,
      climbPhase: this.climbT * 9,
      crankPhase: this.rodFx.crankPhase,
      rodLoad: this.fishing.rodBend,
    })
    this.avatar.setVisible(this.ads < 0.55 && !(this.mode === 'stand' && this.layout.firstPerson))
  }

  private updateGear(): void {
    const v = this.vehicles.active
    const inStand = this.mode === 'stand' || this.mode === 'climb'
    const crewSlow = this.mode !== 'crew' || this.fishing.busy || (this.crewBoat?.speed ?? 0) < 1.2
    const showRod = this.mode !== 'bowfish' && this.tool === 'rod' && !inStand && crewSlow && (!v || (v.kind === 'BOAT' && (this.fishing.busy || Math.abs(v.speed) < 1.2)))
    const showRifle = this.tool === 'rifle' && this.mode !== 'bowfish' && this.mode !== 'vehicle' && this.mode !== 'crew' && this.mode !== 'climb' && this.ads < 0.55 && !(this.mode === 'stand' && this.layout.firstPerson)
    this.rodRig.root.setEnabled(showRod)
    this.rifleRig.root.setEnabled(showRifle)
    if (showRifle) {
      const r = this.rifleRig.root
      if (this.aimHeld && document.pointerLockElement === this.canvas) {
        const torsoPitch = this.avatar.chest.rotation.x
        r.position.set(0.15, 0.4, 0.46 - this.recoil * 0.06)
        r.rotation.set(this.ctx.camera.rotation.x - torsoPitch - this.recoil * 0.12, 0, 0)
      } else {
        r.position.set(0.04, 0.2, 0.24)
        r.rotation.set(-0.95, 0.15, -0.75)
      }
    }
  }

  /** Shows the character creator with a front view of the hunter; resolves once it is saved. */
  private makeCharacter(): Promise<void> {
    return new Promise((resolve) => {
      this.creating = true
      const wear = (look: Look) => this.avatar.setOutfit([look.jacket, look.vest, look.cap, look.pants, look.pack])
      this.creator.show(lookOf(this.progress.profile), {
        preview: wear,
        submit: (look) => this.progress.createCharacter(look),
        done: () => {
          this.creating = false
          this.applyGear()
          this.ctx.camera.rotation.set(0.18, this.facing, 0)
          resolve()
        },
      })
    })
  }

  private placeCamera(): void {
    const cam = this.ctx.camera
    if (this.creating) {
      const ahead = new Vector3(Math.sin(this.facing), 0, Math.cos(this.facing))
      const side = new Vector3(Math.cos(this.facing), 0, -Math.sin(this.facing))
      const eye = this.foot.add(ahead.scale(2.7)).add(side.scale(-0.7)).add(new Vector3(0, 1.45, 0))
      cam.position.copyFrom(eye)
      cam.setTarget(this.foot.add(side.scale(-0.45)).add(new Vector3(0, 1.05, 0)))
      return
    }
    const yaw = cam.rotation.y
    const pitch = cam.rotation.x
    const fwd = new Vector3(Math.sin(yaw) * Math.cos(pitch), -Math.sin(pitch), Math.cos(yaw) * Math.cos(pitch))
    const right = new Vector3(Math.cos(yaw), 0, -Math.sin(yaw))
    const v = this.vehicles?.active
    if (this.mode === 'bowfish') {
      this.bowfish.placeCamera(cam)
      return
    }
    if (this.onDeck) {
      const pivot = this.foot.add(new Vector3(0, HIP_HEIGHT + 0.66, 0))
      const pos = pivot.add(right.scale(SHOULDER_OFFSET + 0.2)).subtract(fwd.scale(CAMERA_DISTANCE + 0.9))
      const floor = Math.max(this.terrain.heightAt(pos.x, pos.z), 0) + 0.45
      if (pos.y < floor) pos.y = floor
      cam.position.copyFrom(pos)
      return
    }
    if (this.mode === 'crew' && this.crewBoat) {
      const pivot = this.crewBoat.root.position.add(new Vector3(0, 1.6, 0))
      const pos = pivot.subtract(fwd.scale(8.5))
      pos.y = Math.max(pos.y, Math.max(this.terrain.heightAt(pos.x, pos.z), 0) + 0.6)
      cam.position.copyFrom(pos)
      return
    }
    if (this.mode === 'vehicle' && v) {
      const dist = v.kind === 'BOAT' ? 8.5 : 7
      const pivot = v.position.add(new Vector3(0, v.kind === 'BOAT' ? 1.6 : 1.9, 0))
      const pos = pivot.subtract(fwd.scale(dist))
      const floor = Math.max(this.terrain.heightAt(pos.x, pos.z), 0) + 0.6
      if (pos.y < floor) pos.y = floor
      cam.position.copyFrom(pos)
      return
    }
    const high = this.mode === 'stand' || this.mode === 'climb'
    const base = high ? this.avatar.root.position.add(new Vector3(0, HIP_HEIGHT, 0)) : this.foot
    const crouchK = this.mode === 'foot' && this.crouch ? 1 : 0
    const fishK = this.fishCam * this.fishCam * (3 - 2 * this.fishCam)
    const pivot = base.add(new Vector3(0, high ? 0.62 : 1.62 - crouchK * 0.45 + fishK * 0.4, 0))
    const aimK = this.tool === 'rifle' && this.aimHeld ? 1 : 0
    let pos: Vector3
    if (high && this.mode === 'stand' && this.layout.firstPerson) {
      pos = this.avatar.root.position.add(new Vector3(0, HIP_HEIGHT + 0.66, 0))
    } else if (high) {
      const flat = new Vector3(Math.sin(yaw), 0, Math.cos(yaw))
      const toTree = this.stand.tree.subtract(pivot)
      toTree.y = 0
      const facingTree = Vector3.Dot(flat, toTree.normalize())
      const back = facingTree > 0.2 ? 2.6 : 0.7
      pos = pivot.add(right.scale(0.85)).add(new Vector3(0, 0.22 - fwd.y * 0.4, 0)).subtract(flat.scale(Math.max(0.25, back)))
    } else {
      const indoors = this.cabin.inside(this.foot)
      const fishOut = indoors ? 0 : fishK
      const dist = (indoors ? 1.9 : CAMERA_DISTANCE + fishOut * 0.6) * (1 - aimK * 0.3)
      pos = this.collideCamera(pivot, pivot.add(right.scale(indoors ? 0.3 : SHOULDER_OFFSET + fishOut * 0.75)).subtract(fwd.scale(dist)))
    }
    const eye = high ? this.avatar.root.position.add(new Vector3(0, HIP_HEIGHT + 0.68, 0)) : this.foot.add(new Vector3(0, (this.crouch ? 1.08 : EYE_HEIGHT) + 0.0, 0))
    eye.addInPlace(new Vector3(Math.sin(yaw), 0, Math.cos(yaw)).scale(0.12))
    const k = Math.max(0, Math.min(1, (this.ads - 0.25) / 0.5))
    cam.position.copyFrom(Vector3.Lerp(pos, eye, k * k * (3 - 2 * k)))
  }

  private collideCamera(pivot: Vector3, want: Vector3): Vector3 {
    const steps = 14
    let last = pivot.clone()
    for (let i = 1; i <= steps; i++) {
      const p = Vector3.Lerp(pivot, want, i / steps)
      const floor = Math.max(this.terrain.heightAt(p.x, p.z), this.cabin.floorAt(p) ?? -10) + 0.35
      if (p.y < floor) p.y = floor
      let blocked = this.cabin.near(p, 1) && this.cabin.segmentBlocked(pivot, p)
      for (const t of this.ctx.queryTrunks(p.x, p.z, 0.3)) {
        if ((t.x - p.x) ** 2 + (t.z - p.z) ** 2 < (t.r * 0.75 + 0.2) ** 2 && p.y < t.max.y) blocked = true
      }
      if (blocked) return Vector3.Lerp(pivot, last, 0.92)
      last = p
    }
    return last
  }

  private afterCameraMove(): void {
    const cam = this.ctx.camera
    if (this.mode === 'bowfish') cam.rotation.x = Math.max(-0.5, Math.min(1.15, cam.rotation.x))
    else if ((this.mode === 'vehicle' || this.mode === 'crew') && !this.onDeck) cam.rotation.x = Math.max(-0.25, Math.min(0.95, cam.rotation.x))
    else cam.rotation.x = Math.max(-1.1, Math.min(1.25, cam.rotation.x))
    this.placeCamera()
    const dt = this.ctx.engine.getDeltaTime() / 1000
    const rifleOut = this.tool === 'rifle' && (this.mode === 'foot' || this.mode === 'stand')
    const sway = rifleOut ? this.skill.updateSway(dt, this.mode === 'stand' ? 0 : Math.min(1, this.moveSpeed / 2), this.ads > 0.6, (this.keys.has('ShiftLeft') || this.keys.has('ShiftRight')) && this.ads > 0.6) : { x: 0, y: 0, amplitude: 0 }
    const steady = this.mode === 'stand' ? 0.55 : 1
    this.swayApplied.x = sway.y * steady - this.recoil * 0.05
    this.swayApplied.y = sway.x * steady
    cam.rotation.x += this.swayApplied.x
    cam.rotation.y += this.swayApplied.y
  }

  private removeSway(): void {
    const cam = this.ctx.camera
    cam.rotation.x -= this.swayApplied.x
    cam.rotation.y -= this.swayApplied.y
    this.swayApplied.x = 0
    this.swayApplied.y = 0
  }

  private onDock(p: Vector3): boolean {
    const dock = this.ctx.scene.getMeshByName('dock')
    if (!dock) return false
    const local = p.subtract(dock.position)
    const a = -dock.rotation.y
    const x = local.x * Math.cos(a) + local.z * Math.sin(a)
    const z = -local.x * Math.sin(a) + local.z * Math.cos(a)
    const bb = dock.getBoundingInfo().boundingBox
    return Math.abs(x) < 1.0 && z > bb.minimum.z && z < bb.maximum.z
  }

  private updateHud(dt: number, locked: boolean): void {
    const cam = this.ctx.camera
    const v = this.vehicles.active
    this.hud.setCompass(cam.rotation.y)
    this.placeTimer -= dt
    if (this.placeTimer <= 0) {
      this.placeTimer = 0.5
      const status = this.mode === 'bowfish' ? this.bowfish.status() : this.mode === 'crew' ? `Aboard with ${this.crewBoat?.name ?? 'a friend'}${this.crewBoat?.anchored ? ' · anchored' : ''}`
        : v?.anchored ? `Anchored · ${DECK_SEAT_NAMES[this.deckSeat ?? 0]} seat`
          : v ? (v.kind === 'ATV' ? `UTV · ${Math.round(Math.abs(v.speed) * 2.237)} mph` : `Boat · ${Math.round(Math.abs(v.speed) * 2.237)} mph`) : this.mode === 'stand' ? 'In the stand' : this.mode === 'climb' ? 'Climbing' : this.crouch ? 'Crouched' : 'On foot'
      this.hud.setPlace(this.placeName(), status)
    }
    const rifleOut = this.tool === 'rifle' && (this.mode === 'foot' || this.mode === 'stand')
    const scoped = rifleOut && this.ads > 0.7
    this.hud.setAim(rifleOut ? (scoped ? 'scope' : 'hip') : 'none', this.skill.swayAmplitude)
    this.hud.setBreath(scoped ? this.skill.breath : null)
    this.hud.setCast(this.fishing.state === 'charging' ? this.fishing.power : null)
    const hooked = this.fishing.hooked
    this.hud.setReel(this.fishing.state === 'reeling' ? this.fishing.reel : null, hooked ? `${SPECIES_BY_ID[hooked.species].name} on` : 'Fish on')
    const legend = this.wildlife.legendNearby()
    this.hud.setLegend(legend ? `Record-class ${SPECIES_BY_ID[legend.template.id].name} in the area · ${formatValue(legend.template.id, legend.specimen.value)}?` : null)
    this.signTimer -= dt
    if (this.signTimer <= 0) {
      this.signTimer = 1
      const fishLeft = this.director.remaining('fish', 3)
      const gameLeft = this.director.remaining('game')
      this.hud.setActivity(this.fishing.lineInWater ? (fishLeft < 15 ? 'Fish circling' : 'Line out') : gameLeft < 30 ? 'Fresh sign' : this.wildlife.animals.length ? 'Animal nearby' : 'Quiet')
    }
    const st = this.fishing.state
    const lure = this.fishing.bait.kind === 'lure'
    const fishPrompt = st === 'bite' ? (lure ? 'Strike! Click to set the hook!' : 'Click to set the hook!')
      : st === 'nibble' ? 'Nibble… keep still and wait for the float to go under'
        : st === 'waiting' ? (lure ? (this.fishing.retrieving ? 'Working the lure… let go to pause' : 'Hold left-click or R to work the lure in') : (this.fishing.retrieving ? 'Reeling in… let go to stop' : 'Watch the float… hold R to reel in'))
          : st === 'reeling' ? 'Hold left-click or R to reel · let go to ease off'
            : st === 'landing' ? 'Swinging it in…'
              : ''
    let prompt = ''
    if (!locked) prompt = this.hud.modalOpen ? '' : 'Click the view for mouse look · arrow keys also look around'
    else if (this.mode === 'bowfish') prompt = this.bowfish.prompt()
    else if (this.mode === 'climb') prompt = this.climbDir > 0 ? 'Climbing up…' : 'Climbing down…'
    else if (this.mode === 'stand') prompt = this.tool === 'rifle' ? (this.ads < 0.5 ? 'Right-click to aim (double right-click locks it) · E to climb down' : this.scopeLock ? 'Left-click to fire · Shift to hold your breath · right-click to lower' : 'Shift to hold your breath') : 'Press 2 for the rifle · E to climb down'
    else if (this.mode === 'crew') {
      const b = this.crewBoat
      prompt = fishPrompt || (!b || b.speed > 1.2 ? `${b?.name ?? 'The captain'} is driving — hold on` : b.anchored ? 'Left-click to cast · F to ask for the other seat · E near shore to step off' : 'Left-click to cast · E near shore to step off')
    } else if (v) {
      const idle = v.kind === 'BOAT' && Math.abs(v.speed) < 1.2 && !this.fishing.busy
      prompt = fishPrompt || (!idle ? '' : v.anchored ? 'Left-click to cast · F to switch seats · Q to pull the anchor' : 'Left-click to cast · Q to drop anchor · E near shore to step out')
    } else {
      const down = this.wildlife.nearestDown(this.foot, TAG_RANGE)
      const near = this.nearOwnVehicle()
      const ride = this.nearRemoteBoat()
      const camp = this.bowfish.campPrompt(this.foot)
      if (camp) prompt = camp
      else if (down) prompt = `E — tag the ${down.doe ? "doe" : down.template.id === "whitetail" ? "buck" : down.template.name.toLowerCase()}`
      else if (fishPrompt) prompt = fishPrompt
      else if (this.cabin.spotNear(this.foot)) prompt = this.cabin.spotLabel(this.cabin.spotNear(this.foot)!)
      else if (ride && (!near || Vector3.Distance(this.foot, ride.root.position) < Vector3.Distance(this.foot, near.position))) prompt = ride.crew ? `${ride.name}'s boat is full` : `E — climb aboard ${ride.name}'s boat`
      else if (near) prompt = near.kind === 'ATV' ? (near.rig.root.name.startsWith('quad') ? 'E — ride the quad' : 'E — drive the UTV') : 'E — board the boat'
      else if (this.nearLadder()) prompt = `E — climb into the ${STAND_LAYOUTS[this.nearLadder()!.kind].name}`
      else if (this.tool === 'rod' && !this.fishing.busy) prompt = 'Hold left-click to load a cast, release to throw'
      else if (this.tool === 'rifle' && this.ads < 0.5) prompt = 'Right-click to aim · double right-click to lock the scope'
      else if (this.tool === 'rifle' && this.scopeLock) prompt = 'Left-click to fire · Shift to hold your breath · right-click to lower'
    }
    this.hud.setPrompt(prompt)
  }
}

function nextFrame(): Promise<void> {
  return new Promise((r) => requestAnimationFrame(() => r()))
}
