/** One lot as 3D: the house from its walls and floors, plus its furniture, placed on the street. */
import * as THREE from 'three/webgpu'
import { objectDef } from '../../shared/Catalog'
import { footprintSize, type PlacedObject } from '../../shared/Lot'
import { lotPlacement } from '../../shared/Street'
import { buildFurniture } from '../models/Furniture'
import { buildHouse, type House, type HouseData, type WallMode } from '../models/House'
import { detach } from '../models/Kit'

export interface LotData extends HouseData {
  objects: PlacedObject[]
}

export class LotModel {
  readonly group = new THREE.Group()
  house: House
  readonly objects = new Map<number, THREE.Group>()
  private readonly local = new THREE.Vector3()
  private mode: WallMode = 'up'
  private roof = true

  constructor(readonly lot: number, data: LotData) {
    const place = lotPlacement(lot)
    this.group.position.set(place.x, 0, place.z)
    this.group.rotation.y = place.yaw
    this.house = buildHouse(data)
    this.group.add(this.house.group)
    this.placeObjects(data.objects)
  }

  rebuild(data: LotData): void {
    detach(this.house.group)
    for (const object of this.objects.values()) detach(object)
    this.objects.clear()
    this.house = buildHouse(data)
    this.group.add(this.house.group)
    this.placeObjects(data.objects)
  }

  private placeObjects(list: PlacedObject[]): void {
    for (const object of list) {
      const def = objectDef(object.def)
      if (!def) continue
      const model = buildFurniture(def)
      const [fw, fd] = footprintSize(def, object.r)
      model.position.set(object.x + fw / 2, 0, object.z + fd / 2)
      model.rotation.y = -object.r * Math.PI / 2
      model.userData.objectId = object.id
      model.traverse(node => { node.userData.objectId = object.id })
      this.group.add(model)
      this.objects.set(object.id, model)
    }
  }

  setView(mode: WallMode, cameraWorld: THREE.Vector3, roof: boolean): void {
    this.mode = mode
    this.roof = roof
    this.local.copy(cameraWorld)
    this.group.worldToLocal(this.local)
    this.house.setView(mode, this.local, roof)
  }

  refreshView(cameraWorld: THREE.Vector3): void {
    this.setView(this.mode, cameraWorld, this.roof)
  }

  toLocal(world: THREE.Vector3): THREE.Vector3 {
    return this.group.worldToLocal(world.clone())
  }

  toWorld(x: number, y: number, z: number): THREE.Vector3 {
    return this.group.localToWorld(new THREE.Vector3(x, y, z))
  }

  dispose(): void {
    detach(this.group)
  }
}
