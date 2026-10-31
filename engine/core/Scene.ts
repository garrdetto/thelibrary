/** Scene graph with the five named layers (world, props, characters, fx, ui) and add/remove/find helpers. */
import * as THREE from 'three/webgpu'
import type { LayerName } from '../config'
import { disposeObject } from './disposeObject'

const LAYER_NAMES: readonly LayerName[] = ['world', 'props', 'characters', 'fx', 'ui']

export class SceneGraph {
  static readonly layerNames = LAYER_NAMES
  readonly scene = new THREE.Scene()
  private readonly layers = new Map<LayerName, THREE.Group>()

  constructor() {
    for (const name of LAYER_NAMES) {
      const group = new THREE.Group()
      group.name = `layer:${name}`
      this.layers.set(name, group)
      this.scene.add(group)
    }
  }

  layer(name: LayerName): THREE.Group {
    const group = this.layers.get(name)
    if (!group) throw new Error(`Unknown layer ${name}`)
    return group
  }

  add<T extends THREE.Object3D>(name: LayerName, object: T): T {
    this.layer(name).add(object)
    return object
  }

  remove(object: THREE.Object3D, dispose = false): void {
    object.removeFromParent()
    if (dispose) disposeObject(object)
  }

  clear(name: LayerName, dispose = true): void {
    const group = this.layer(name)
    for (const child of [...group.children]) this.remove(child, dispose)
  }

  setVisible(name: LayerName, visible: boolean): void {
    this.layer(name).visible = visible
  }

  find<T extends THREE.Object3D = THREE.Object3D>(objectName: string): T | undefined {
    return this.scene.getObjectByName(objectName) as T | undefined
  }

  dispose(): void {
    disposeObject(this.scene)
    for (const name of LAYER_NAMES) this.layer(name).clear()
  }
}
