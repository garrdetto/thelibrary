import { Mesh } from '@babylonjs/core/Meshes/mesh'
import { CreateDisc } from '@babylonjs/core/Meshes/Builders/discBuilder'
import { CreateSphere } from '@babylonjs/core/Meshes/Builders/sphereBuilder'
import { TransformNode } from '@babylonjs/core/Meshes/transformNode'
import type { Scene } from '@babylonjs/core/scene'
import { glossy, matte } from './materials'

export class Fish {
  readonly root: TransformNode
  readonly spinner: TransformNode
  private tail: Mesh
  private wiggle = 0

  constructor(scene: Scene) {
    this.root = new TransformNode('fish', scene)
    this.spinner = new TransformNode('fish-spin', scene)
    this.spinner.parent = this.root
    const scale = 0.5 / 0.62
    this.spinner.scaling.setAll(scale * 1.9)
    const belly = glossy(scene, 'fish-belly', '#f0b6a6', 0.15)
    const back = glossy(scene, 'fish-back', '#4f6f78', 0.15)
    const fin = matte(scene, 'fish-fin', '#d9806a')
    fin.backFaceCulling = false
    const dark = matte(scene, 'fish-eye', '#101015')
    const body = CreateSphere('fish-body', { diameter: 1, segments: 18 }, scene)
    body.scaling.set(0.62, 0.2, 0.15)
    body.material = belly
    body.parent = this.spinner
    const top = CreateSphere('fish-back', { diameter: 1, segments: 16 }, scene)
    top.scaling.set(0.56, 0.13, 0.13)
    top.position.set(0.0, 0.045, 0)
    top.material = back
    top.parent = this.spinner
    this.tail = CreateDisc('fish-tail', { radius: 0.15, tessellation: 3, sideOrientation: Mesh.DOUBLESIDE }, scene)
    this.tail.position.set(-0.36, 0, 0)
    this.tail.scaling.set(1, 1.15, 1)
    this.tail.material = fin
    this.tail.parent = this.spinner
    const dorsal = CreateDisc('fish-dorsal', { radius: 0.09, tessellation: 3, sideOrientation: Mesh.DOUBLESIDE }, scene)
    dorsal.position.set(0.02, 0.12, 0)
    dorsal.rotation.z = Math.PI / 2 + 0.4
    dorsal.scaling.set(1.2, 0.7, 1)
    dorsal.material = fin
    dorsal.parent = this.spinner
    for (const side of [-1, 1]) {
      const eye = CreateSphere('fish-eye', { diameter: 0.045, segments: 8 }, scene)
      eye.position.set(0.22, 0.025, side * 0.058)
      eye.material = dark
      eye.parent = this.spinner
      const pectoral = CreateDisc('fish-pec', { radius: 0.06, tessellation: 3, sideOrientation: Mesh.DOUBLESIDE }, scene)
      pectoral.position.set(0.12, -0.04, side * 0.07)
      pectoral.rotation.set(side * 0.6, 0, Math.PI)
      pectoral.material = fin
      pectoral.parent = this.spinner
    }
  }

  place(x: number, y: number, z: number, pitch: number, roll: number, yaw = 0): void {
    this.root.position.set(x, y, z)
    this.root.rotation.set(0, yaw, pitch)
    this.spinner.rotation.x = roll
  }

  flap(dt: number, rate: number): void {
    this.wiggle += dt * rate
    this.tail.rotation.y = Math.sin(this.wiggle) * 0.6
  }

  setVisible(on: boolean): void {
    this.root.setEnabled(on)
  }
}
