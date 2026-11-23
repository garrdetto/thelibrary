/**
 * The cockpit interior, loaded only while the cockpit view is in use and released when it is left. Its `panel_screen` face shows
 * the `PanelPainter` gauges through a dynamic texture redrawn at the tier's gauge rate; both yokes follow the pitch and roll the
 * aircraft receives and the throttle knob follows the lever. Parented to the aircraft root, so it moves with the interpolated
 * aircraft.
 */
import { PBRMaterial } from '@babylonjs/core/Materials/PBR/pbrMaterial'
import { DynamicTexture } from '@babylonjs/core/Materials/Textures/dynamicTexture'
import { Texture } from '@babylonjs/core/Materials/Textures/texture'
import { Color3 } from '@babylonjs/core/Maths/math.color'
import { Quaternion, Vector3 } from '@babylonjs/core/Maths/math.vector'
import type { AbstractMesh } from '@babylonjs/core/Meshes/abstractMesh'
import { TransformNode } from '@babylonjs/core/Meshes/transformNode'
import type { Scene } from '@babylonjs/core/scene'
import type { ControlInput } from '../sim/Controls'
import type { FlightModel } from '../sim/FlightModel'
import type { AssetManager, ModelInstance } from '../world/AssetManager'
import { PANEL_HEIGHT, PANEL_WIDTH, PanelPainter } from './Instruments'

interface Moving {
  node: TransformNode
  rest: Vector3
  restRotation: Quaternion
}

export class Cockpit {
  private instance: ModelInstance | null = null
  private texture: DynamicTexture | null = null
  private material: PBRMaterial | null = null
  private painter: PanelPainter | null = null
  private yokes: Moving[] = []
  private throttle: Moving | null = null
  private sinceDraw = 0
  private loading: Promise<void> | null = null
  private active = false
  private readonly turn = new Quaternion()

  constructor(private readonly scene: Scene, private readonly assets: AssetManager, private readonly parent: TransformNode, private readonly aircraft: FlightModel) {}

  get loaded(): boolean {
    return this.instance !== null
  }

  /** Loads (once) and shows the interior, or hides and releases it. */
  async setActive(active: boolean): Promise<void> {
    this.active = active
    if (!active) {
      this.release()
      return
    }
    if (this.instance) return
    if (!this.loading) this.loading = this.load()
    await this.loading
    this.loading = null
    if (!this.active) this.release()
  }

  private async load(): Promise<void> {
    const instance = await this.assets.acquire(`/models/takeflight/${this.aircraft.spec.model}_cockpit.glb`)
    this.instance = instance
    instance.root.parent = this.parent
    const screen = instance.nodes.get('panel_screen') as AbstractMesh | undefined
    if (screen) {
      const texture = new DynamicTexture('takeflight-panel', { width: PANEL_WIDTH, height: PANEL_HEIGHT }, this.scene, true, Texture.TRILINEAR_SAMPLINGMODE)
      texture.anisotropicFilteringLevel = 8
      texture.wrapV = Texture.WRAP_ADDRESSMODE
      texture.vScale = -1
      const material = new PBRMaterial('takeflight-panel', this.scene)
      material.albedoTexture = texture
      material.emissiveTexture = texture
      material.emissiveColor = new Color3(0.55, 0.55, 0.55)
      material.metallic = 0
      material.roughness = 1
      material.metallicF0Factor = 0
      screen.material = material
      this.texture = texture
      this.material = material
      this.painter = new PanelPainter(this.aircraft)
      this.draw()
    }
    const moving = (name: string): Moving | null => {
      const node = instance.nodes.get(name)
      if (!(node instanceof TransformNode)) return null
      if (!node.rotationQuaternion) node.rotationQuaternion = Quaternion.FromEulerVector(node.rotation)
      return { node, rest: node.position.clone(), restRotation: node.rotationQuaternion.clone() }
    }
    this.yokes = ['yoke_L', 'yoke_R'].map(moving).filter((m): m is Moving => m !== null)
    this.throttle = moving('throttle')
    for (const mesh of instance.meshes) mesh.receiveShadows = true
  }

  private draw(): void {
    if (!this.texture || !this.painter) return
    const context = this.texture.getContext() as unknown as CanvasRenderingContext2D
    this.painter.paint(context)
    this.texture.update(true)
  }

  update(input: Readonly<ControlInput>, gaugeHz: number, dt: number): void {
    if (!this.instance || !this.active) return
    this.sinceDraw += dt
    if (this.sinceDraw >= 1 / gaugeHz) {
      this.sinceDraw = 0
      this.draw()
    }
    for (const yoke of this.yokes) {
      yoke.node.position.set(yoke.rest.x - input.pitch * 0.07, yoke.rest.y, yoke.rest.z)
      const half = input.roll * 0.6 * 0.5
      this.turn.set(Math.sin(half), 0, 0, Math.cos(half))
      yoke.restRotation.multiplyToRef(this.turn, yoke.node.rotationQuaternion as Quaternion)
    }
    if (this.throttle) this.throttle.node.position.set(this.throttle.rest.x + input.throttle * 0.07, this.throttle.rest.y, this.throttle.rest.z)
  }

  private release(): void {
    if (this.instance) this.assets.release(this.instance)
    this.instance = null
    this.texture?.dispose()
    this.material?.dispose()
    this.texture = null
    this.material = null
    this.painter = null
    this.yokes = []
    this.throttle = null
  }

  dispose(): void {
    this.active = false
    this.release()
  }
}
