/** Stand-in for models/CarBody in the node tests: no canvas, no geometry, just counts the dents. */
import * as THREE from 'three/webgpu'
import type { CarModel } from '../models/CarBody'

export interface StubCarModel extends CarModel {
  dentCount: number
}

export function createCar(): StubCarModel {
  const model: StubCarModel = {
    root: new THREE.Group(),
    body: new THREE.Mesh(),
    decals: [],
    wheels: [0, 1, 2, 3].map(() => new THREE.Mesh()),
    paint: new THREE.MeshStandardNodeMaterial(),
    dentCount: 0,
    dent() {
      model.dentCount++
    },
    showDamage() {
      return []
    },
    exhaustTip() {
      return null
    },
    dispose() {},
  }
  return model
}
