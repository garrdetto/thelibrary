import { DirectionalLight } from '@babylonjs/core/Lights/directionalLight'
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
import { MODEL_NAMES, instantiate, loadModel } from '../core/ModelLibrary'
import type { ModelName, ModelRig, ModelTemplate } from '../core/ModelLibrary'
import { Audio } from '../systems/Audio'
import { EncounterDirector } from '../systems/EncounterDirector'
import { Fishing } from '../systems/Fishing'
import type { FishingEvent } from '../systems/Fishing'
import { LootTableManager, SPECIES_BY_ID, formatValue } from '../systems/LootTableManager'
import type { Specimen } from '../systems/LootTableManager'
import { SkillCheckManager } from '../systems/SkillCheckManager'
import { VehicleController } from '../systems/VehicleController'
import type { Vehicle } from '../systems/VehicleController'
import { Wildlife } from '../systems/Wildlife'
import type { Animal } from '../systems/Wildlife'
import { Hud, compassWord } from '../ui/Hud'
import { Foliage } from '../world/Foliage'
import { foliageMaterial } from '../world/FoliageTextures'
import { creatureMaterial } from '../world/CreatureTextures'
import type { CreatureSurface } from '../world/CreatureTextures'
import type { FoliageKind } from '../world/FoliageTextures'
import { PLAY_LIMIT, Terrain } from '../world/Terrain'
import { STAND_CLIMB_SECONDS, STAND_LADDER_BASE, STAND_LADDER_TOP, STAND_SEAT, findStandSite, standToWorld } from '../world/TreeStand'
import type { StandSite } from '../world/TreeStand'
import { buildDock, buildGround, buildSky, buildWater, findLandmarks } from '../world/World'
import { Avatar, HIP_HEIGHT } from './Avatar'
import type { AvatarHands, AvatarStance } from './Avatar'

type Tool = 'rod' | 'rifle'
type PlayerMode = 'foot' | 'vehicle' | 'climb' | 'stand'

const TWO_SIDED = new Set(['grass', 'fern', 'cattail'])
const GLOSSY = new Set(['utv', 'boat', 'rod', 'rifle', 'bobber', 'fish-muskie', 'fish-pike', 'fish-walleye', 'fish-smallmouth', 'fish-perch'])
const MODULE_ID = 'rackreel'
const WALK_SPEED = 2.5
const SPRINT_SPEED = 5.2
const CROUCH_SPEED = 1.2
const AIM_SPEED = 0.9
const CAMERA_DISTANCE = 3.3
const SHOULDER_OFFSET = 0.45
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
  private readonly skill = new SkillCheckManager()
  private readonly director = new EncounterDirector()
  private readonly audio = new Audio()
  private readonly hud = new Hud()
  private skyMat!: import('@babylonjs/core/Materials/shaderMaterial').ShaderMaterial
  private waterMat!: import('@babylonjs/core/Materials/shaderMaterial').ShaderMaterial
  private avatar!: Avatar
  private rodRig!: ModelRig
  private rodTip!: TransformNode
  private rifleRig!: ModelRig
  private standRig!: ModelRig
  private stand!: StandSite
  private heroRig: ModelRig | null = null
  private heroClock = 0
  private heroLight: DirectionalLight | null = null
  private tool: Tool = 'rod'
  private keys = new Set<string>()
  private leftDown = false
  private rightDown = false
  private ads = 0
  private crouch = false
  private playing = false
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
  private yourRecords = new Set<string>()
  private materials = new Map<string, Material>()
  private sessionKey = Math.random().toString(36).slice(2, 10)
  private signTimer = 0
  private placeTimer = 0
  private casters: AbstractMesh[] = []

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
    this.stand = findStandSite(this.terrain, landmarks.spawn)
    this.foliage = new Foliage(this.ctx, this.terrain, this.models, [landmarks.dock.start, landmarks.spawn, landmarks.utv, this.stand.tree])
    this.foliage.colliders.push({ x: this.stand.tree.x, z: this.stand.tree.z, r: 0.45, min: this.stand.tree.add(new Vector3(-0.45, -1, -0.45)), max: this.stand.tree.add(new Vector3(0.45, 16, 0.45)) })
    this.ctx.buildCollisionOctree(this.foliage.colliders)
    this.hud.setLoading(0.85, 'Fueling the UTV…')
    await nextFrame()
    const reg = (m: AbstractMesh) => this.ctx.registerDynamic(m)
    this.buildStand(reg)
    this.vehicles = new VehicleController(this.ctx, this.terrain, this.ground)
    this.vehicles.add('ATV', instantiate(this.models.get('utv')!, null, scene, reg), landmarks.utv, landmarks.utvHeading)
    this.vehicles.add('BOAT', instantiate(this.models.get('boat')!, null, scene, reg), landmarks.boat, landmarks.boatHeading)
    this.avatar = new Avatar(instantiate(this.models.get('hunter')!, null, scene, reg))
    this.buildGear(reg)
    this.wildlife = new Wildlife(this.ctx, scene, this.terrain, this.loot, this.models)
    this.wildlife.onLegendSpawn = (a) => this.hud.toast(`Fresh sign: a record-class ${SPECIES_BY_ID[a.template.id].name.toLowerCase()} is moving nearby`, 'big')
    this.wildlife.onLost = (a) => this.hud.toast(a.wounds ? 'The wounded animal is gone. Aim for the vitals behind the shoulder.' : `The ${a.template.name.toLowerCase()} slipped away.`)
    this.fishing = new Fishing(this.ctx, scene, this.terrain, this.loot, this.skill, this.models.get('bobber')!)
    this.fishing.onEvent = (e) => this.onFishing(e)
    const cam = this.ctx.camera
    cam.keysUp = []
    cam.keysDown = []
    cam.keysLeft = []
    cam.keysRight = []
    cam.speed = 0
    this.foot.copyFrom(landmarks.spawn)
    this.facing = landmarks.spawnHeading
    cam.rotation.set(0.18, landmarks.spawnHeading, 0)
    this.placeAvatar(0)
    this.placeCamera()
    this.collectCasters()

    this.foliage.updateGrass(this.foot)
    this.bindInput()
    scene.onBeforeCameraRenderObservable.add(() => this.afterCameraMove())
    scene.onAfterCameraRenderObservable.add(() => this.removeSway())
    this.ctx.engine.runRenderLoop(() => this.frame())
    await scene.whenReadyAsync()
    this.hud.setLoading(1, 'Ready')
    document.getElementById('loading')!.hidden = true
    document.getElementById('start')!.hidden = false
    ;(document.getElementById('start-btn') as HTMLButtonElement).focus()
  }

  private materialFor(model: ModelName, part: string, tag: string): Material {
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
    this.standRig = instantiate(this.models.get('treestand')!, null, scene, reg)
    this.standRig.root.position.copyFrom(this.stand.root)
    this.standRig.root.rotation.y = this.stand.heading
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
    this.rifleRig = instantiate(this.models.get('rifle')!, null, scene, reg)
    this.rifleRig.root.parent = this.avatar.chest
    this.rifleRig.root.setEnabled(false)
  }

  private collectCasters(): void {
    this.casters = [...this.avatar.meshes, ...this.rodRig.meshes, ...this.rifleRig.meshes, ...this.standRig.meshes]
    for (const veh of this.vehicles.vehicles) this.casters.push(...veh.rig.meshes)
  }

  private bindInput(): void {
    const start = () => {
      document.getElementById('start')!.hidden = true
      this.playing = true
      this.hud.showPlaying(true)
      this.audio.unlock()
      this.lock()
      const d = this.stand.tree.subtract(this.foot)
      this.hud.toast(`A ladder stand overlooks the oak opening ${Math.round(d.length() * 1.094)} yd to the ${compassWord(Math.atan2(d.x, d.z))}. Arrow keys look around.`)
    }
    document.getElementById('start-btn')!.addEventListener('click', start)
    document.getElementById('book-btn')!.addEventListener('click', () => this.hud.showBook(this.loot, this.yourRecords, () => undefined))
    this.canvas.addEventListener('click', () => {
      if (this.playing && !this.hud.modalOpen && document.pointerLockElement !== this.canvas) this.lock()
    })
    this.canvas.addEventListener('contextmenu', (e) => e.preventDefault())
    document.addEventListener('pointerlockchange', () => {
      if (!document.pointerLockElement && this.playing && !this.hud.modalOpen) this.pause()
    })
    document.addEventListener('pointerdown', (e) => {
      if (!this.playing || this.hud.modalOpen || document.pointerLockElement !== this.canvas) return
      if (e.button === 0) {
        this.leftDown = true
        this.primaryDown()
      } else if (e.button === 2) {
        this.rightDown = true
      }
    })
    document.addEventListener('pointerup', (e) => {
      if (e.button === 0) {
        this.leftDown = false
        if (this.playing) this.primaryUp()
      } else if (e.button === 2) {
        this.rightDown = false
      }
    })
    addEventListener('keydown', (e) => {
      if (!this.playing || this.hud.modalOpen) return
      this.keys.add(e.code)
      if (ARROW_KEYS.has(e.code) || e.code === 'Space') e.preventDefault()
      if (e.repeat) return
      if (e.code === 'Digit1') this.setTool('rod')
      else if (e.code === 'Digit2') this.setTool('rifle')
      else if (e.code === 'KeyE') this.interact()
      else if (e.code === 'KeyC') this.crouch = !this.crouch
      else if (e.code === 'KeyR') this.fishing.cancel()
      else if (e.code === 'KeyM') this.audio.setMuted(!this.audio.muted)
      else if (e.code === 'KeyK') this.openBook()
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
  }

  private openBook(): void {
    document.exitPointerLock()
    this.hud.showBook(this.loot, this.yourRecords, () => this.lock())
  }

  private setTool(tool: Tool): void {
    if (this.fishing.busy && tool !== 'rod') this.fishing.cancel()
    if (this.vehicles.active && tool === 'rifle') {
      this.hud.toast('Unload and step out before using the rifle.', 'warn')
      return
    }
    this.tool = tool
    this.hud.setTool(tool)
  }

  private interact(): void {
    if (this.mode === 'climb') return
    if (this.mode === 'stand') {
      if (this.fishing.busy) this.fishing.cancel()
      this.mode = 'climb'
      this.climbDir = -1
      this.climbT = 1
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
      this.foot.copyFrom(spot)
      this.velocity.setAll(0)
      return
    }
    const down = this.wildlife.nearestDown(this.foot, 3.8)
    if (down) {
      this.tag(down)
      return
    }
    const v = this.vehicles.nearest(this.foot, 4.2)
    if (v) {
      this.enterVehicle(v)
      return
    }
    if (this.nearLadder()) {
      if (this.fishing.busy) this.fishing.cancel()
      this.mode = 'climb'
      this.climbDir = 1
      this.climbT = 0
      this.crouch = false
    }
  }

  private nearLadder(): boolean {
    const base = standToWorld(this.stand, STAND_LADDER_BASE)
    return Math.hypot(base.x - this.foot.x, base.z - this.foot.z) < 1.8
  }

  private enterVehicle(v: Vehicle): void {
    if (this.fishing.busy) this.fishing.cancel()
    if (v.kind === 'ATV' && this.tool === 'rifle') this.setTool('rod')
    if (this.tool === 'rifle') this.setTool('rod')
    this.vehicles.enter(v)
    this.mode = 'vehicle'
    this.crouch = false
    const cam = this.ctx.camera
    cam.rotation.set(0.28, v.heading, 0)
    this.avatar.root.parent = v.root
    this.avatar.root.rotationQuaternion = null
    this.avatar.root.rotation.set(0, 0, 0)
    this.avatar.root.position.copyFrom(v.seat).addInPlaceFromFloats(0, -HIP_HEIGHT, 0)
    this.hud.toast(v.kind === 'ATV' ? 'W/S throttle · A/D steer · Space brake · E to step out' : 'W/S throttle · A/D tiller · stop to cast · E to step out near shore')
  }

  private primaryDown(): void {
    if (this.fishing.state === 'bite') {
      this.fishing.setHook()
      return
    }
    if (this.fishing.state === 'reeling') {
      this.skill.crank()
      this.audio.click()
      return
    }
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
      if (this.fishing.state === 'waiting') {
        this.hud.toast('Line is out. Wait for the bobber to go down, or press R to reel in.')
        return
      }
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
    const down = this.wildlife.hit(shot.animal, shot.vital, origin)
    const climbHint = this.mode === 'stand' ? ' Climb down (E) and walk up to tag it.' : ' Walk up and press E to tag it.'
    if (down) this.hud.toast(`Clean ${shot.vital ? 'vital' : 'follow-up'} hit at ${yards} yd.${climbHint}`, 'big')
    else this.hud.toast(`Hit at ${yards} yd but high or back. It ran — a second hit will put it down.`, 'warn')
  }

  private tag(animal: Animal): void {
    animal.tagged = true
    this.recordSpecimen(animal.specimen)
  }

  private recordSpecimen(specimen: Specimen): void {
    this.bag.push(specimen)
    const tier = this.loot.claim(specimen, 'You', this.placeName())
    if (tier) {
      this.yourRecords.add(`${specimen.species}:${specimen.value}:You`)
      this.audio.chime()
    }
    const points = this.bag.reduce((a, s) => a + s.trophyPoints, 0)
    this.hud.setBag(this.bag.length, points)
    if (this.loot.isTrophy(specimen)) void Scores.submit(MODULE_ID, specimen.trophyPoints, { key: `${this.sessionKey}-${specimen.serial}` })
    document.exitPointerLock()
    this.hud.showCatch(specimen, tier, () => {
      this.clearHero()
      this.lock()
    })
  }

  private onFishing(e: FishingEvent): void {
    if (e.type === 'cast') return
    if (e.type === 'splash') {
      this.audio.splash()
      if (!e.inWater) this.hud.toast('Too shallow there — cast out past the weeds.', 'warn')
    } else if (e.type === 'bite') {
      this.director.rearm('fish')
      this.audio.splash()
      this.hud.toast('Bobber down! Click to set the hook!', 'big')
    } else if (e.type === 'missed') {
      this.hud.toast('It spit the bait. Stay ready.')
    } else if (e.type === 'hooked') {
      if (e.specimen.legendary) this.hud.toast('This one is heavy… a record-class fish!', 'big')
      else this.hud.toast('Fish on! Hold or click to reel — keep the needle in the green.')
    } else if (e.type === 'landed') {
      this.audio.splash(true)
      this.showHero(e.specimen)
      this.recordSpecimen(e.specimen)
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

  private placeName(): string {
    if (this.mode === 'stand' || this.mode === 'climb') return 'Ladder stand'
    const g = this.terrain.groundAt(this.foot.x, this.foot.z)
    const v = this.vehicles.active
    if (v?.kind === 'BOAT') return this.fishing.habitat === 'deep' ? 'Deep basin' : 'Bear Paw Lake'
    return { water: 'Bear Paw Lake', shore: 'Lakeshore', marsh: 'Cattail Marsh', meadow: 'Oak Opening', forest: 'Pine Ridge', trail: 'Two-track trail', rock: 'Granite Bluff' }[g]
  }

  private frame(): void {
    const engine = this.ctx.engine
    const dt = Math.min(0.05, engine.getDeltaTime() / 1000)
    this.time += dt
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
    const reeling = this.fishing.state === 'reeling'
    const lookScale = this.ads > 0.5 ? 0.3 : 1
    cam.rotation.y += (this.key('ArrowRight') - this.key('ArrowLeft')) * ARROW_YAW_RATE * lookScale * dt * (active ? 1 : 0)
    cam.rotation.x += (this.key('ArrowDown') - this.key('ArrowUp')) * ARROW_PITCH_RATE * lookScale * dt * (active ? 1 : 0)
    const input = {
      throttle: active && !reeling && v ? this.key('KeyW') - this.key('KeyS') : 0,
      steer: active && !reeling && v ? this.key('KeyD') - this.key('KeyA') : 0,
      brake: this.keys.has('Space'),
    }
    this.vehicles.update(dt, input)
    if (v) this.audio.engine(true, Math.abs(v.speed) / 16, v.kind === 'BOAT')
    else this.audio.engine(false, 0, false)
    const sprint = this.keys.has('ShiftLeft') || this.keys.has('ShiftRight')
    const canAim = (this.mode === 'foot' || this.mode === 'stand') && this.tool === 'rifle'
    const wantAds = canAim && this.rightDown && locked
    this.ads += ((wantAds ? 1 : 0) - this.ads) * Math.min(1, dt * 10)
    this.ctx.setAds(this.ads > 0.55 ? (this.ads - 0.55) / 0.45 : 0)
    if (this.mode === 'foot') this.walk(dt, active, sprint)
    else if (this.mode === 'climb') this.climb(dt)
    else if (this.mode === 'vehicle' && v) this.moveSpeed = Math.abs(v.speed)
    else this.moveSpeed = 0
    this.rifleCooldown = Math.max(0, this.rifleCooldown - dt)
    this.recoil = Math.max(0, this.recoil - dt * 5)
    this.placeAvatar(dt)
    this.fishing.update(dt, this.castOrigin(), this.leftDown && locked)
    const noise = this.mode === 'vehicle' ? 1.4 : this.mode === 'stand' ? 0.03 : this.mode === 'climb' ? 0.5 : this.moveSpeed < 0.3 ? 0.04 : this.crouch ? 0.15 : sprint ? 1 : 0.45
    const focus = v ? v.position : this.foot
    this.wildlife.update(dt, focus, noise)
    const exploring = this.mode === 'stand' || (v ? Math.abs(v.speed) > 1 : this.moveSpeed > 0.5)
    const onLand = !v || v.kind === 'ATV'
    const signal = this.director.update(dt, { exploring, lineInWater: this.fishing.lineInWater, onLand })
    if (signal === 'fish') this.fishing.bite()
    else if (signal === 'game') {
      this.director.rearm('game')
      if (!this.wildlife.animals.some((a) => a.state !== 'down')) {
        const animal = this.wildlife.spawnNear(focus, cam.rotation.y)
        if (animal) {
          const d = animal.position.subtract(focus)
          this.hud.toast(`Movement to the ${compassWord(Math.atan2(d.x, d.z))}, about ${Math.round(d.length() * 1.094)} yd. Switch to the rifle (2) and ease in.`)
        }
      }
    }
    this.updateGear()
    this.updateHud(dt, locked)
    this.foliage.updateGrass(focus)
    this.ctx.setShadowFocus(focus)
    this.foliage.updateShadowCasters(focus, [...this.casters, ...this.wildlife.casters()])
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
    const busy = this.fishing.state === 'charging' || this.fishing.state === 'reeling'
    let speed = sprint && !this.crouch ? SPRINT_SPEED : this.crouch ? CROUCH_SPEED : WALK_SPEED
    if (this.ads > 0.3 || (this.tool === 'rifle' && this.rightDown)) speed = AIM_SPEED
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
    if (this.terrain.depthAt(p.x, p.z) > 1.05 && !this.onDock(p)) {
      p.x = prevX
      p.z = prevZ
      this.velocity.setAll(0)
    }
    const floor = Math.max(this.terrain.heightAt(p.x, p.z), this.onDock(p) ? 0.58 : -10)
    p.y += (floor - p.y) * Math.min(1, dt * 18)
    const moved = Math.hypot(p.x - prevX, p.z - prevZ) / Math.max(1e-3, dt)
    this.moveSpeed += (moved - this.moveSpeed) * Math.min(1, dt * 8)
    const faceCamera = this.fishing.busy || (this.tool === 'rifle' && (this.rightDown || this.rifleCooldown > 0.6))
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
      this.hud.toast('Settled in the stand. Deer won\'t hear you up here — rifle out (2), right-click to glass the opening.')
      return
    }
    if (this.climbT <= 0) {
      this.climbT = 0
      this.mode = 'foot'
      this.foot.copyFrom(standToWorld(this.stand, STAND_LADDER_BASE.add(new Vector3(0, 0, 0.45))))
      this.foot.y = this.terrain.heightAt(this.foot.x, this.foot.z)
      this.facing = this.stand.heading
      this.velocity.setAll(0)
      return
    }
    this.facing = this.stand.heading + Math.PI
  }

  private climbLocal(): Vector3 {
    const t = this.climbT
    const ladder = 0.86
    if (t < ladder) {
      const f = t / ladder
      return Vector3.Lerp(STAND_LADDER_BASE, STAND_LADDER_TOP, f).addInPlaceFromFloats(0, 0.02, 0.22)
    }
    const f = (t - ladder) / (1 - ladder)
    return Vector3.Lerp(STAND_LADDER_TOP.add(new Vector3(0, 0.02, 0.0)), STAND_SEAT.subtract(new Vector3(0, HIP_HEIGHT, 0)), f)
  }

  private placeAvatar(dt: number): void {
    const root = this.avatar.root
    let stance: AvatarStance = 'stand'
    if (this.mode === 'vehicle') {
      stance = 'sit'
    } else {
      root.rotationQuaternion = null
      root.rotation.set(0, this.facing, 0)
      if (this.mode === 'foot') root.position.copyFrom(this.foot)
      else if (this.mode === 'climb') {
        root.position.copyFrom(standToWorld(this.stand, this.climbLocal()))
        stance = this.climbT < 0.86 ? 'climb' : 'sit'
      } else {
        root.position.copyFrom(standToWorld(this.stand, STAND_SEAT.subtract(new Vector3(0, HIP_HEIGHT, 0))))
        stance = 'sit'
      }
    }
    if (this.mode === 'stand' || this.mode === 'climb') this.foot.copyFrom(root.position)
    const v = this.vehicles.active
    const st = this.fishing.state
    let hands: AvatarHands = 'free'
    if (stance === 'climb') hands = 'free'
    else if (this.mode === 'vehicle' && v && (v.kind === 'ATV' || !this.fishing.busy && (Math.abs(v.speed) > 1.2 || this.tool !== 'rod'))) hands = 'wheel'
    else if (this.tool === 'rifle') hands = this.rightDown && document.pointerLockElement === this.canvas ? 'aim' : 'rifle'
    else if (st === 'charging' || st === 'flying') hands = 'cast'
    else if (st === 'reeling') hands = 'reel'
    else hands = 'rod'
    this.avatar.update(dt, {
      stance,
      hands,
      speed: this.mode === 'foot' ? this.moveSpeed : 0,
      crouch: this.crouch && this.mode === 'foot',
      castPower: st === 'charging' ? this.fishing.power : 0,
      aimPitch: this.ctx.camera.rotation.x,
      climbPhase: this.climbT * 9,
    })
    this.avatar.setVisible(this.ads < 0.55)
  }

  private updateGear(): void {
    const v = this.vehicles.active
    const inStand = this.mode === 'stand' || this.mode === 'climb'
    const showRod = this.tool === 'rod' && !inStand && (!v || (v.kind === 'BOAT' && (this.fishing.busy || Math.abs(v.speed) < 1.2)))
    const showRifle = this.tool === 'rifle' && this.mode !== 'vehicle' && this.mode !== 'climb' && this.ads < 0.55
    this.rodRig.root.setEnabled(showRod)
    this.rifleRig.root.setEnabled(showRifle)
    if (showRifle) {
      const r = this.rifleRig.root
      if (this.rightDown && document.pointerLockElement === this.canvas) {
        const torsoPitch = this.avatar.chest.rotation.x
        r.position.set(0.15, 0.4, 0.46 - this.recoil * 0.06)
        r.rotation.set(this.ctx.camera.rotation.x - torsoPitch - this.recoil * 0.12, 0, 0)
      } else {
        r.position.set(0.04, 0.2, 0.24)
        r.rotation.set(-0.95, 0.15, -0.75)
      }
    }
  }

  private placeCamera(): void {
    const cam = this.ctx.camera
    const yaw = cam.rotation.y
    const pitch = cam.rotation.x
    const fwd = new Vector3(Math.sin(yaw) * Math.cos(pitch), -Math.sin(pitch), Math.cos(yaw) * Math.cos(pitch))
    const right = new Vector3(Math.cos(yaw), 0, -Math.sin(yaw))
    const v = this.vehicles?.active
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
    const pivot = base.add(new Vector3(0, high ? 0.62 : 1.62 - crouchK * 0.45, 0))
    const aimK = this.tool === 'rifle' && this.rightDown ? 1 : 0
    let pos: Vector3
    if (high) {
      const flat = new Vector3(Math.sin(yaw), 0, Math.cos(yaw))
      const toTree = this.stand.tree.subtract(pivot)
      toTree.y = 0
      const facingTree = Vector3.Dot(flat, toTree.normalize())
      const back = facingTree > 0.2 ? 2.6 : 0.7
      pos = pivot.add(right.scale(0.85)).add(new Vector3(0, 0.22 - fwd.y * 0.4, 0)).subtract(flat.scale(Math.max(0.25, back)))
    } else {
      const dist = CAMERA_DISTANCE * (1 - aimK * 0.3)
      pos = this.collideCamera(pivot, pivot.add(right.scale(SHOULDER_OFFSET)).subtract(fwd.scale(dist)))
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
      const floor = this.terrain.heightAt(p.x, p.z) + 0.35
      if (p.y < floor) p.y = floor
      let blocked = false
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
    if (this.mode === 'vehicle') cam.rotation.x = Math.max(-0.25, Math.min(0.95, cam.rotation.x))
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
      const status = v ? (v.kind === 'ATV' ? `UTV · ${Math.round(Math.abs(v.speed) * 2.237)} mph` : `Boat · ${Math.round(Math.abs(v.speed) * 2.237)} mph`) : this.mode === 'stand' ? 'In the stand' : this.mode === 'climb' ? 'Climbing' : this.crouch ? 'Crouched' : 'On foot'
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
    let prompt = ''
    if (!locked) prompt = this.hud.modalOpen ? '' : 'Click the view for mouse look · arrow keys also look around'
    else if (this.mode === 'climb') prompt = this.climbDir > 0 ? 'Climbing up…' : 'Climbing down…'
    else if (this.mode === 'stand') prompt = this.tool === 'rifle' ? (this.ads < 0.5 ? 'Right-click to aim · E to climb down' : 'Shift to hold your breath') : 'Press 2 for the rifle · E to climb down'
    else if (v) prompt = v.kind === 'BOAT' && Math.abs(v.speed) < 1.2 && !this.fishing.busy ? 'Left-click to cast from the boat · E near shore to step out' : ''
    else {
      const down = this.wildlife.nearestDown(this.foot, 3.8)
      const near = this.vehicles.nearest(this.foot, 4.2)
      if (down) prompt = `E — tag the ${down.template.name.toLowerCase()}`
      else if (this.fishing.state === 'bite') prompt = 'Click to set the hook!'
      else if (this.fishing.state === 'waiting') prompt = 'Watch the bobber… R to reel in'
      else if (near) prompt = near.kind === 'ATV' ? 'E — drive the UTV' : 'E — board the boat'
      else if (this.nearLadder()) prompt = 'E — climb into the tree stand'
      else if (this.tool === 'rod' && !this.fishing.busy) prompt = 'Hold left-click to load a cast, release to throw'
      else if (this.tool === 'rifle' && this.ads < 0.5) prompt = 'Right-click to aim · Shift to hold your breath'
    }
    this.hud.setPrompt(prompt)
  }
}

function nextFrame(): Promise<void> {
  return new Promise((r) => requestAnimationFrame(() => r()))
}
