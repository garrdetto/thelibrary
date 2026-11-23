/**
 * The player's aircraft on screen: its three exported LODs (swapped by projected size), every moving part driven from the flight
 * model by node name (`aileron_L/R`, `elevator`, `rudder`, `flap_*`, `spoiler_*`, `gear_*`, `prop_*`/`fan_*`, `wheel_*`), a prop
 * disc that fades in with rpm, and nav, strobe and landing lights at the `light_*` nodes. Nodes are found once at load; the
 * per-frame update writes rotations into existing quaternions and allocates nothing.
 */
import { StandardMaterial } from '@babylonjs/core/Materials/standardMaterial'
import { Color3 } from '@babylonjs/core/Maths/math.color'
import { Quaternion } from '@babylonjs/core/Maths/math.vector'
import type { AbstractMesh } from '@babylonjs/core/Meshes/abstractMesh'
import { CreateSphere } from '@babylonjs/core/Meshes/Builders/sphereBuilder'
import type { Mesh } from '@babylonjs/core/Meshes/mesh'
import { TransformNode } from '@babylonjs/core/Meshes/transformNode'
import type { Node } from '@babylonjs/core/node'
import { PBRMaterial } from '@babylonjs/core/Materials/PBR/pbrMaterial'
import type { Scene } from '@babylonjs/core/scene'
import type { FlightModel } from '../sim/FlightModel'
import type { Livery } from '../shared/Liveries'
import type { InterpolatedState } from '../sim/Simulation'
import type { AssetManager, ModelInstance } from '../world/AssetManager'

const SURFACE_TRAVEL = {
  aileron: 20 * (Math.PI / 180),
  elevator: 25 * (Math.PI / 180),
  rudder: 22 * (Math.PI / 180),
  flap: 30 * (Math.PI / 180),
  spoiler: 50 * (Math.PI / 180),
}
const LOD_PIXELS = [260, 70]

interface Part {
  node: TransformNode
  rest: Quaternion
}

interface Lod {
  instance: ModelInstance
  ailerons: { part: Part; sign: number }[]
  elevators: Part[]
  rudders: Part[]
  flaps: Part[]
  spoilers: Part[]
  props: Part[]
  wheels: { part: Part; radius: number }[]
  noseGear: Part | null
  mainGears: { part: Part }[]
  gearDoors: Part[]
  disc: AbstractMesh[]
  blades: AbstractMesh[]
  meshes: AbstractMesh[]
}

interface Lamp {
  mesh: Mesh
  kind: 'nav-red' | 'nav-green' | 'strobe' | 'beacon' | 'landing'
}

function part(node: Node | undefined): Part | null {
  if (!node || !(node instanceof TransformNode)) return null
  if (!node.rotationQuaternion) node.rotationQuaternion = Quaternion.FromEulerVector(node.rotation)
  return { node, rest: node.rotationQuaternion.clone() }
}

const axisTurn = new Quaternion()
/** How far retractable gear legs fold (radians): mains forward into the nacelles or wing, the nose leg back into the nose; fully up they are hidden behind closed doors. */
const GEAR_FOLD = 1.45

function turn(p: Part, axis: 'x' | 'y' | 'z', angle: number): void {
  const half = angle * 0.5
  const s = Math.sin(half)
  axisTurn.set(axis === 'x' ? s : 0, axis === 'y' ? s : 0, axis === 'z' ? s : 0, Math.cos(half))
  p.rest.multiplyToRef(axisTurn, p.node.rotationQuaternion as Quaternion)
}

export class AircraftVisual {
  readonly root: TransformNode
  private readonly lods: Lod[] = []
  private active = -1
  private readonly lamps: Lamp[] = []
  private readonly lampMaterials: StandardMaterial[] = []
  private propAngle = 0
  private wheelAngle = 0
  private time = 0
  private hidden = false
  private disposed = false

  private constructor(private readonly scene: Scene, private readonly assets: AssetManager) {
    this.root = new TransformNode('takeflight-aircraft', scene)
    this.root.rotationQuaternion = new Quaternion()
  }

  static async load(scene: Scene, assets: AssetManager, model: string): Promise<AircraftVisual> {
    const visual = new AircraftVisual(scene, assets)
    const urls = [0, 1, 2].map((lod) => `/models/takeflight/${model}_lod${lod}.glb`)
    const instances = await Promise.all(urls.map((url) => assets.acquire(url)))
    if (visual.disposed) {
      for (const instance of instances) assets.release(instance)
      return visual
    }
    for (const instance of instances) visual.adopt(instance)
    visual.buildLamps(instances[0])
    visual.select(0)
    return visual
  }

  get meshes(): AbstractMesh[] {
    return this.lods.flatMap((lod) => lod.meshes)
  }

  /** Meshes of the most detailed LOD (shadow casters). */
  get detailMeshes(): AbstractMesh[] {
    return this.lods[0]?.meshes ?? []
  }

  private adopt(instance: ModelInstance): void {
    instance.root.parent = this.root
    const find = (pattern: RegExp) => [...instance.nodes.entries()].filter(([name]) => pattern.test(name)).map(([, node]) => node)
    const parts = (pattern: RegExp) => find(pattern).map(part).filter((p): p is Part => p !== null)
    const wheels = find(/^wheel_[a-z_A-Z]+$/).filter((node) => !/_hub$/.test(node.name.replace(/#\d+$/, '')))
    const lod: Lod = {
      instance,
      ailerons: [...parts(/^aileron_L$/).map((p) => ({ part: p, sign: 1 })), ...parts(/^aileron_R$/).map((p) => ({ part: p, sign: -1 }))],
      elevators: parts(/^elevator(_[LR])?$/),
      rudders: parts(/^rudder(_\w+)?$/),
      flaps: parts(/^flap_[LR]_\d+$/),
      spoilers: parts(/^spoiler_\w+$/),
      props: parts(/^(prop|fan)_\d+$/),
      wheels: wheels.map(part).filter((p): p is Part => p !== null).map((p) => ({ part: p, radius: /nose/.test(p.node.name) ? 0.25 : 0.28 })),
      noseGear: part(instance.nodes.get('gear_nose')),
      mainGears: [...parts(/^gear_main_L$/).map((p) => ({ part: p })), ...parts(/^gear_main_R$/).map((p) => ({ part: p }))],
      gearDoors: parts(/^gear_door_\w+$/),
      disc: find(/^prop_\d+_disc$/) as AbstractMesh[],
      blades: find(/^prop_\d+_blade_\d+$/) as AbstractMesh[],
      meshes: instance.meshes,
    }
    for (const disc of lod.disc) {
      disc.visibility = 0
      disc.isVisible = false
    }
    for (const mesh of instance.meshes) {
      mesh.receiveShadows = true
      mesh.alwaysSelectAsActiveMesh = false
    }
    instance.root.setEnabled(false)
    this.lods.push(lod)
  }

  private buildLamps(instance: ModelInstance): void {
    const make = (name: string, color: Color3, size: number, kind: Lamp['kind']) => {
      const node = instance.nodes.get(name)
      if (!node || !(node instanceof TransformNode)) return
      const material = new StandardMaterial(`takeflight-lamp-${name}`, this.scene)
      material.disableLighting = true
      material.emissiveColor = color
      material.specularColor = Color3.Black()
      this.lampMaterials.push(material)
      const mesh = CreateSphere(`takeflight-lamp-${name}`, { diameter: size, segments: 6 }, this.scene)
      mesh.material = material
      mesh.isPickable = false
      mesh.parent = this.root
      const chain: Node[] = []
      for (let at: Node | null = node; at; at = at.parent) chain.unshift(at)
      for (const link of chain) if (link instanceof TransformNode) link.computeWorldMatrix(true)
      mesh.position.copyFrom(node.absolutePosition)
      this.lamps.push({ mesh, kind })
    }
    for (const [name] of instance.nodes) {
      if (name === 'light_nav_L') make(name, new Color3(5, 0.1, 0.05), 0.12, 'nav-red')
      else if (name === 'light_nav_R') make(name, new Color3(0.1, 5, 0.4), 0.12, 'nav-green')
      else if (name === 'light_strobe_tail' || name === 'light_beacon') make(name, new Color3(6, 0.3, 0.2), 0.13, 'beacon')
      else if (name.startsWith('light_strobe_')) make(name, new Color3(14, 14, 14), 0.12, 'strobe')
      else if (name.startsWith('light_landing_')) make(name, new Color3(10, 9.5, 8), 0.16, 'landing')
    }
  }

  private select(index: number): void {
    if (index === this.active) return
    for (let i = 0; i < this.lods.length; i++) this.lods[i].instance.root.setEnabled(i === index && !this.hidden)
    this.active = index
  }

  /** Hides the exterior (cockpit view keeps it shown: its fuselage is culled from inside, wings stay visible through windows). */
  setHidden(hidden: boolean): void {
    this.hidden = hidden
    for (let i = 0; i < this.lods.length; i++) this.lods[i].instance.root.setEnabled(i === this.active && !hidden)
    for (const lamp of this.lamps) lamp.mesh.setEnabled(!hidden)
  }

  /**
   * Places and animates the aircraft. `pixels` is its approximate on-screen size (picks the LOD), `lightsOn` turns on landing
   * lights, `dt` real seconds since the last frame.
   */
  /** Repaints every LOD with a livery (paint, stripe and cowl materials); null restores nothing and keeps the current paint. */
  applyLivery(livery: Livery | null): void {
    if (!livery) return
    const cowl = livery.cowl ?? [livery.paint[0] * 0.92, livery.paint[1] * 0.92, livery.paint[2] * 0.92]
    for (const lod of this.lods) {
      for (const mesh of lod.meshes) {
        const material = mesh.material
        if (!(material instanceof PBRMaterial)) continue
        const colour = material.name.endsWith('_paint') ? livery.paint : material.name.endsWith('_stripe') ? livery.stripe : material.name.endsWith('_cowl') ? cowl : null
        if (colour) material.albedoColor.set(colour[0], colour[1], colour[2])
      }
    }
  }

  update(state: InterpolatedState, aircraft: FlightModel, pixels: number, lightsOn: boolean, dt: number): void {
    this.root.position.set(state.x, state.y, state.z)
    ;(this.root.rotationQuaternion as Quaternion).set(state.qx, state.qy, state.qz, state.qw)
    const lodIndex = pixels > LOD_PIXELS[0] ? 0 : pixels > LOD_PIXELS[1] ? 1 : 2
    this.select(Math.min(lodIndex, this.lods.length - 1))
    this.time += dt
    this.propAngle = (this.propAngle + (aircraft.rpm / 60) * Math.PI * 2 * dt) % (Math.PI * 2)
    this.wheelAngle = aircraft.wheelLoad > 0 ? this.wheelAngle - (aircraft.groundSpeed * dt) / 0.27 : this.wheelAngle * 0.98
    const lod = this.lods[this.active]
    if (!lod) return
    for (const { part: p, sign } of lod.ailerons) turn(p, 'z', sign * aircraft.aileron * SURFACE_TRAVEL.aileron)
    for (const p of lod.elevators) turn(p, 'z', -aircraft.elevator * SURFACE_TRAVEL.elevator)
    for (const p of lod.rudders) turn(p, 'y', aircraft.rudder * SURFACE_TRAVEL.rudder)
    for (const p of lod.flaps) turn(p, 'z', aircraft.flap * SURFACE_TRAVEL.flap)
    for (const p of lod.spoilers) turn(p, 'z', -aircraft.spoiler * SURFACE_TRAVEL.spoiler)
    for (const p of lod.props) turn(p, 'x', this.propAngle)
    for (const { part: p, radius } of lod.wheels) turn(p, 'z', (this.wheelAngle * 0.27) / radius)
    const retract = aircraft.spec.controls.retractable ? 1 - aircraft.gear : 0
    const stowed = retract > 0.98
    if (lod.noseGear) {
      if (retract > 0.001) turn(lod.noseGear, 'z', -retract * GEAR_FOLD)
      else turn(lod.noseGear, 'y', -aircraft.rudder * aircraft.spec.contacts[0].steer * (Math.PI / 180))
      if (lod.noseGear.node.isEnabled() === stowed) lod.noseGear.node.setEnabled(!stowed)
    }
    for (const { part: p } of lod.mainGears) {
      turn(p, 'z', retract * GEAR_FOLD)
      if (p.node.isEnabled() === stowed) p.node.setEnabled(!stowed)
    }
    for (const p of lod.gearDoors) if (p.node.isEnabled() === stowed) p.node.setEnabled(!stowed)
    const blur = Math.min(1, Math.max(0, (aircraft.rpm - 900) / 900))
    for (const disc of lod.disc) {
      disc.isVisible = blur > 0.02
      disc.visibility = blur * 0.35
    }
    for (const blade of lod.blades) blade.visibility = 1 - blur * 0.85
    const strobe = this.time % 1.2 < 0.06 || (this.time % 1.2 > 0.14 && this.time % 1.2 < 0.19)
    const beacon = this.time % 1.0 < 0.12
    for (const lamp of this.lamps) {
      if (this.hidden) continue
      if (lamp.kind === 'strobe') lamp.mesh.setEnabled(strobe)
      else if (lamp.kind === 'beacon') lamp.mesh.setEnabled(beacon)
      else if (lamp.kind === 'landing') lamp.mesh.setEnabled(lightsOn)
    }
  }

  dispose(): void {
    this.disposed = true
    for (const lod of this.lods) this.assets.release(lod.instance)
    this.lods.length = 0
    for (const lamp of this.lamps) lamp.mesh.dispose()
    for (const material of this.lampMaterials) material.dispose()
    this.root.dispose()
  }
}
