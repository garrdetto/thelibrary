import type { Material } from '@babylonjs/core/Materials/material'
import { StandardMaterial } from '@babylonjs/core/Materials/standardMaterial'
import { Color3 } from '@babylonjs/core/Maths/math.color'
import { Vector3 } from '@babylonjs/core/Maths/math.vector'
import { Ray } from '@babylonjs/core/Culling/ray'
import type { AbstractMesh } from '@babylonjs/core/Meshes/abstractMesh'
import type { InstancedMesh } from '@babylonjs/core/Meshes/instancedMesh'
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
import type { FoliageKind } from '../world/FoliageTextures'
import { PLAY_LIMIT, Terrain } from '../world/Terrain'
import { buildDock, buildGround, buildSky, buildWater, findLandmarks } from '../world/World'

type Tool = 'rod' | 'rifle'

const TWO_SIDED = new Set(['grass', 'fern', 'cattail'])
const GLOSSY = new Set(['utv', 'boat', 'rod', 'rifle', 'bobber', 'fish-muskie', 'fish-pike', 'fish-walleye', 'fish-smallmouth', 'fish-perch'])
const MODULE_ID = 'rackreel'

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
  private driver!: ModelRig
  private rodRig!: ModelRig
  private rodTip!: TransformNode
  private rifleRig!: ModelRig
  private heroRig: ModelRig | null = null
  private heroClock = 0
  private tool: Tool = 'rod'
  private keys = new Set<string>()
  private leftDown = false
  private rightDown = false
  private ads = 0
  private crouch = false
  private playing = false
  private time = 0
  private lastFoot = new Vector3()
  private moveSpeed = 0
  private rifleCooldown = 0
  private recoil = 0
  private swayApplied = { x: 0, y: 0 }
  private bag: Specimen[] = []
  private yourRecords = new Set<string>()
  private materials = new Map<string, Material>()
  private sessionKey = Math.random().toString(36).slice(2, 10)
  private signTimer = 0
  private placeTimer = 0

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
      this.hud.setLoading(0.1 + (loaded / MODEL_NAMES.length) * 0.5, `Bringing in the ${name.replace('fish-', '').replace('-lo', '')}…`)
    }))
    this.hud.setLoading(0.65, 'Planting the woods…')
    await nextFrame()
    const landmarks = findLandmarks(this.terrain)
    buildDock(this.ctx, landmarks)
    this.foliage = new Foliage(this.ctx, this.terrain, this.models, [landmarks.dock.start, landmarks.spawn, landmarks.utv])
    this.ctx.buildCollisionOctree(this.foliage.colliders)
    this.hud.setLoading(0.85, 'Fueling the UTV…')
    await nextFrame()
    this.vehicles = new VehicleController(this.ctx, this.terrain, this.ground)
    const reg = (m: AbstractMesh) => this.ctx.registerDynamic(m)
    this.vehicles.add('ATV', instantiate(this.models.get('utv')!, null, scene, reg), landmarks.utv, landmarks.utvHeading)
    this.vehicles.add('BOAT', instantiate(this.models.get('boat')!, null, scene, reg), landmarks.boat, landmarks.boatHeading)
    this.driver = instantiate(this.models.get('hunter')!, null, scene, reg)
    this.driver.root.setEnabled(false)
    this.buildViewmodels()
    this.wildlife = new Wildlife(this.ctx, scene, this.terrain, this.loot, this.models)
    this.wildlife.onLegendSpawn = (a) => this.hud.toast(`Fresh sign: a record-class ${SPECIES_BY_ID[a.template.id].name.toLowerCase()} is moving nearby`, 'big')
    this.wildlife.onLost = (a) => this.hud.toast(a.wounds ? 'The wounded animal is gone. Aim for the vitals behind the shoulder.' : `The ${a.template.name.toLowerCase()} slipped away.`)
    this.fishing = new Fishing(this.ctx, scene, this.terrain, this.loot, this.skill, this.models.get('bobber')!)
    this.fishing.onEvent = (e) => this.onFishing(e)
    const cam = this.ctx.camera
    cam.position.set(landmarks.spawn.x, landmarks.spawn.y + EYE_HEIGHT, landmarks.spawn.z)
    cam.rotation.set(0.05, landmarks.spawnHeading, 0)
    this.lastFoot.copyFrom(cam.position)

    this.foliage.updateGrass(cam.position)
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
    if (tag) return foliageMaterial(this.ctx.scene, tag as FoliageKind)
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

  private buildViewmodels(): void {
    const { scene, camera } = this.ctx
    const viewReg = (m: InstancedMesh) => {
      m.sourceMesh.renderingGroupId = 1
      m.sourceMesh.applyFog = false
      this.ctx.registerDynamic(m)
    }
    this.rodRig = instantiate(this.models.get('rod')!, null, scene, viewReg)
    this.rodRig.root.parent = camera
    this.rodRig.root.position.set(0.3, -0.36, 0.42)
    this.rodRig.root.rotation.set(-0.55, -0.08, 0)
    this.rodTip = new TransformNode('rod-tip', scene)
    this.rodTip.parent = this.rodRig.root
    this.rodTip.position.set(0, 0, 1.8)
    this.rifleRig = instantiate(this.models.get('rifle')!, null, scene, viewReg)
    this.rifleRig.root.parent = camera
    this.rifleRig.root.position.set(0.2, -0.2, 0.42)
    this.rifleRig.root.setEnabled(false)
  }

  private bindInput(): void {
    const start = () => {
      document.getElementById('start')!.hidden = true
      this.playing = true
      this.hud.showPlaying(true)
      this.audio.unlock()
      this.lock()
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
      if (e.repeat) return
      if (e.code === 'Digit1') this.setTool('rod')
      else if (e.code === 'Digit2') this.setTool('rifle')
      else if (e.code === 'KeyE') this.interact()
      else if (e.code === 'KeyC') this.crouch = !this.crouch
      else if (e.code === 'KeyR') this.fishing.cancel()
      else if (e.code === 'KeyM') this.audio.setMuted(!this.audio.muted)
      else if (e.code === 'KeyK') this.openBook()
      if (e.code === 'Space') e.preventDefault()
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
    const cam = this.ctx.camera
    if (this.vehicles.active) {
      const spot = this.vehicles.exit()
      if (!spot) {
        this.hud.toast('Too deep to step out here. Run the boat up to shore.', 'warn')
        return
      }
      this.driver.root.setEnabled(false)
      this.driver.root.parent = null
      cam.position.set(spot.x, spot.y + EYE_HEIGHT, spot.z)
      this.lastFoot.copyFrom(cam.position)
      cam.keysUp = [87]
      cam.keysDown = [83]
      cam.keysLeft = [65]
      cam.keysRight = [68]
      return
    }
    const feet = new Vector3(cam.position.x, cam.position.y - EYE_HEIGHT, cam.position.z)
    const down = this.wildlife.nearestDown(feet, 3.8)
    if (down) {
      this.tag(down)
      return
    }
    const v = this.vehicles.nearest(feet, 4.2)
    if (v) this.enterVehicle(v)
  }

  private enterVehicle(v: Vehicle): void {
    if (this.fishing.busy) this.fishing.cancel()
    if (v.kind === 'ATV' && this.tool === 'rifle') this.setTool('rod')
    this.vehicles.enter(v)
    const cam = this.ctx.camera
    cam.keysUp = []
    cam.keysDown = []
    cam.keysLeft = []
    cam.keysRight = []
    cam.rotation.set(0.28, v.heading, 0)
    cam.cameraDirection.setAll(0)
    this.driver.root.setEnabled(true)
    this.driver.root.parent = v.root
    this.driver.root.position.copyFrom(v.seat).addInPlaceFromFloats(0, -0.92, 0)
    this.driver.root.rotationQuaternion = null
    this.driver.root.rotation.set(0, 0, 0)
    for (const leg of ['legL', 'legR']) this.driver.joints.get(leg)!.rotation.x = -1.45
    for (const arm of ['armL', 'armR']) this.driver.joints.get(arm)!.rotation.x = -0.95
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
      if (v && (v.kind === 'ATV' || Math.abs(v.speed) > 1.2)) {
        this.hud.toast(v.kind === 'ATV' ? 'Park the UTV and step out to fish.' : 'Ease off the throttle to cast.', 'warn')
        return
      }
      if (this.fishing.state === 'waiting') {
        this.hud.toast('Line is out. Wait for the bobber to go down, or press R to reel in.')
        return
      }
      this.fishing.startCharge()
    } else {
      this.fire()
    }
  }

  private primaryUp(): void {
    if (this.fishing.state === 'charging') {
      const dir = this.ctx.camera.getDirection(Vector3.Forward())
      this.fishing.release(this.castOrigin(), dir)
      this.audio.whoosh()
    }
  }

  private castOrigin(): Vector3 {
    if (this.vehicles.active) {
      const v = this.vehicles.active
      const seat = this.vehicles.localToWorld(v, v.seat)
      const dir = this.ctx.camera.getDirection(Vector3.Forward())
      return seat.add(new Vector3(dir.x, 0, dir.z).normalize().scale(1.2)).addInPlaceFromFloats(0, 1.5, 0)
    }
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
    const yards = Math.round(shot.distance * 1.094)
    const down = this.wildlife.hit(shot.animal, shot.vital, origin)
    if (down) this.hud.toast(`Clean ${shot.vital ? 'vital' : 'follow-up'} hit at ${yards} yd. Walk up and press E to tag it.`, 'big')
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
  }

  private clearHero(): void {
    if (!this.heroRig) return
    for (const m of this.heroRig.meshes) {
      this.ctx.unregisterDynamic(m)
      m.dispose()
    }
    this.heroRig.root.dispose()
    this.heroRig = null
  }

  private placeName(): string {
    const cam = this.ctx.camera.position
    const g = this.terrain.groundAt(cam.x, cam.z)
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

  private update(dt: number): void {
    const cam = this.ctx.camera
    const locked = document.pointerLockElement === this.canvas && !this.hud.modalOpen
    const v = this.vehicles.active
    const reeling = this.fishing.state === 'reeling'
    const input = {
      throttle: locked && !reeling ? (this.keys.has('KeyW') ? 1 : 0) - (this.keys.has('KeyS') ? 1 : 0) : 0,
      steer: locked && !reeling ? (this.keys.has('KeyD') ? 1 : 0) - (this.keys.has('KeyA') ? 1 : 0) : 0,
      brake: this.keys.has('Space'),
    }
    this.vehicles.update(dt, input)
    if (v) this.audio.engine(true, Math.abs(v.speed) / 16, v.kind === 'BOAT')
    else this.audio.engine(false, 0, false)
    const onFoot = !v
    const sprint = this.keys.has('ShiftLeft') || this.keys.has('ShiftRight')
    const wantAds = onFoot && this.tool === 'rifle' && this.rightDown && locked
    this.ads += ((wantAds ? 1 : 0) - this.ads) * Math.min(1, dt * 12)
    this.ctx.setAds(this.ads)
    if (onFoot) {
      cam.speed = reeling ? 0 : this.ads > 0.5 ? 0.16 : this.crouch ? 0.2 : sprint ? 0.82 : 0.42
      if (!locked) cam.speed = 0
    }
    this.rifleCooldown = Math.max(0, this.rifleCooldown - dt)
    this.recoil = Math.max(0, this.recoil - dt * 5)
    this.fishing.update(dt, this.castOrigin(), this.leftDown && locked)
    const noise = v ? 1.4 : this.moveSpeed < 0.3 ? 0.04 : this.crouch ? 0.15 : sprint ? 1 : 0.45
    const feet = new Vector3(cam.position.x, cam.position.y - EYE_HEIGHT, cam.position.z)
    const focus = v ? v.position : feet
    this.wildlife.update(dt, focus, noise)
    const exploring = (v ? Math.abs(v.speed) > 1 : this.moveSpeed > 0.5)
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
    this.updateViewmodels(dt, onFoot)
    this.updateHud(dt, locked)
    this.foliage.updateGrass(focus)
    this.ctx.setShadowFocus(focus)
    const casters: AbstractMesh[] = [...this.wildlife.casters()]
    for (const veh of this.vehicles.vehicles) casters.push(...veh.rig.meshes)
    if (v) casters.push(...this.driver.meshes)
    this.foliage.updateShadowCasters(focus, casters)
    if (this.heroRig) {
      this.heroClock += dt
      this.heroRig.root.rotation.y = Math.PI / 2 + Math.sin(this.heroClock * 0.8) * 0.35
      const tail = this.heroRig.joints.get('tail')
      if (tail) tail.rotation.y = Math.sin(this.heroClock * 9) * 0.35
    }
  }

  private afterCameraMove(): void {
    const cam = this.ctx.camera
    const v = this.vehicles.active
    if (v) {
      cam.rotation.x = Math.max(-0.25, Math.min(0.95, cam.rotation.x))
      const dist = v.kind === 'BOAT' ? 8.5 : 7
      const yaw = cam.rotation.y
      const pitch = cam.rotation.x
      const pivot = v.position.add(new Vector3(0, v.kind === 'BOAT' ? 1.6 : 1.9, 0))
      const fwd = new Vector3(Math.sin(yaw) * Math.cos(pitch), -Math.sin(pitch), Math.cos(yaw) * Math.cos(pitch))
      const pos = pivot.subtract(fwd.scale(dist))
      const floor = Math.max(this.terrain.heightAt(pos.x, pos.z), 0) + 0.6
      if (pos.y < floor) pos.y = floor
      cam.position.copyFrom(pos)
      this.moveSpeed = Math.abs(v.speed)
    } else {
      cam.rotation.x = Math.max(-1.35, Math.min(1.35, cam.rotation.x))
      const p = cam.position
      p.x = Math.max(-PLAY_LIMIT, Math.min(PLAY_LIMIT, p.x))
      p.z = Math.max(-PLAY_LIMIT, Math.min(PLAY_LIMIT, p.z))
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
      const depth = this.terrain.depthAt(p.x, p.z)
      if (depth > 1.05) {
        p.x = this.lastFoot.x
        p.z = this.lastFoot.z
      }
      const floor = Math.max(this.terrain.heightAt(p.x, p.z), this.onDock(p) ? 0.58 : -10)
      const eye = this.crouch ? 1.05 : EYE_HEIGHT
      const targetY = floor + eye + (this.moveSpeed > 0.5 ? Math.sin(this.time * (this.moveSpeed > 3 ? 13 : 9)) * 0.025 : 0)
      p.y += (targetY - p.y) * Math.min(1, this.ctx.engine.getDeltaTime() / 1000 * 18)
      const dt = Math.max(1e-3, this.ctx.engine.getDeltaTime() / 1000)
      const moved = Math.hypot(p.x - this.lastFoot.x, p.z - this.lastFoot.z) / dt
      this.moveSpeed += (moved - this.moveSpeed) * Math.min(1, dt * 6)
      this.lastFoot.copyFrom(p)
    }
    const sway = this.tool === 'rifle' && !v ? this.skill.updateSway(this.ctx.engine.getDeltaTime() / 1000, Math.min(1, this.moveSpeed / 2), this.ads > 0.6, (this.keys.has('ShiftLeft') || this.keys.has('ShiftRight')) && this.ads > 0.6) : { x: 0, y: 0, amplitude: 0 }
    this.swayApplied.x = sway.y - this.recoil * 0.05
    this.swayApplied.y = sway.x
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

  private updateViewmodels(dt: number, onFoot: boolean): void {
    const showRod = onFoot && this.tool === 'rod'
    const showRifle = onFoot && this.tool === 'rifle' && this.ads < 0.7
    this.rodRig.root.setEnabled(showRod)
    this.rifleRig.root.setEnabled(showRifle)
    const bob = this.moveSpeed > 0.5 ? Math.sin(this.time * 9) * 0.012 : 0
    if (showRod) {
      const state = this.fishing.state
      let pitch = -0.55
      if (state === 'charging') pitch = -0.55 - 0.9 * this.fishing.power
      else if (state === 'reeling') pitch = -0.75 - (this.fishing.reel?.tension ?? 40) / 100 * 0.35 + Math.sin(this.time * 18) * 0.01
      const r = this.rodRig.root.rotation
      r.x += (pitch - r.x) * Math.min(1, dt * (state === 'flying' ? 20 : 8))
      this.rodRig.root.position.y = -0.36 + bob
    }
    if (showRifle) {
      this.rifleRig.root.position.set(0.2 - this.ads * 0.2, -0.2 + this.ads * 0.12 + bob, 0.42 - this.recoil * 0.08)
      this.rifleRig.root.rotation.x = -this.recoil * 0.15
    }
  }

  private updateHud(dt: number, locked: boolean): void {
    const cam = this.ctx.camera
    const v = this.vehicles.active
    this.hud.setCompass(cam.rotation.y)
    this.placeTimer -= dt
    if (this.placeTimer <= 0) {
      this.placeTimer = 0.5
      this.hud.setPlace(this.placeName(), v ? (v.kind === 'ATV' ? `UTV · ${Math.round(Math.abs(v.speed) * 2.237)} mph` : `Boat · ${Math.round(Math.abs(v.speed) * 2.237)} mph`) : this.crouch ? 'Crouched' : 'On foot')
    }
    const scoped = this.tool === 'rifle' && !v && this.ads > 0.7
    this.hud.setAim(!v && this.tool === 'rifle' ? (scoped ? 'scope' : 'hip') : 'none', this.skill.swayAmplitude)
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
    if (!locked) prompt = this.hud.modalOpen ? '' : 'Click the view to look around'
    else if (v) prompt = v.kind === 'BOAT' && Math.abs(v.speed) < 1.2 && !this.fishing.busy ? 'Left-click to cast from the boat · E near shore to step out' : ''
    else {
      const feet = new Vector3(cam.position.x, cam.position.y - EYE_HEIGHT, cam.position.z)
      const down = this.wildlife.nearestDown(feet, 3.8)
      const near = this.vehicles.nearest(feet, 4.2)
      if (down) prompt = `E — tag the ${down.template.name.toLowerCase()}`
      else if (this.fishing.state === 'bite') prompt = 'Click to set the hook!'
      else if (this.fishing.state === 'waiting') prompt = 'Watch the bobber… R to reel in'
      else if (near) prompt = near.kind === 'ATV' ? 'E — drive the UTV' : 'E — board the boat'
      else if (this.tool === 'rod' && !this.fishing.busy) prompt = 'Hold left-click to load a cast, release to throw'
      else if (this.tool === 'rifle' && this.ads < 0.5) prompt = 'Right-click to aim · Shift to hold your breath'
    }
    this.hud.setPrompt(prompt)
  }
}

function nextFrame(): Promise<void> {
  return new Promise((r) => requestAnimationFrame(() => r()))
}

