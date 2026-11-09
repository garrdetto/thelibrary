/** Helpers shared by the procedural furniture builders. */
import * as THREE from 'three/webgpu'
import type { ObjectDef } from '../../shared/Catalog'
import { box, material, type Finish } from './Kit'
import { surface } from './Surfaces'

export const wood = (c: string) => surface('grain', 'tri', { size: 0.9, color: c, roughness: 0.55 })
export const cloth = (c: string) => surface('fabric', 'tri', { size: 0.45, color: c, roughness: 0.95 })

/** Builds one item into `g`, centred on its footprint (`w` by `d` metres) with its front facing -z. */
export type Builder = (def: ObjectDef, g: THREE.Group, w: number, d: number) => void

/** Where a seated or lying Sim goes, in the object's own frame; `yaw` turns them from the default (facing -z). */
export interface SeatSpot { x: number; y: number; z: number; yaw?: number }
export type SeatRule = (def: ObjectDef, seat: number, lie: boolean) => SeatSpot

export const STEEL = '#b9c0c6'
export const GLOW = { emissive: '#ffe2a8', emissiveIntensity: 1.4 }

export function legs(g: THREE.Group, w: number, d: number, h: number, color: string | THREE.Material, inset = 0.06, size = 0.05): void {
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) g.add(box(size, h, size, color, sx * (w / 2 - inset), h / 2, sz * (d / 2 - inset)))
}

const cones = new THREE.ConeGeometry(0.5, 1, 18)
const tori = new THREE.TorusGeometry(0.5, 0.08, 8, 28)
cones.userData.shared = true
tori.userData.shared = true

function placed(geometry: THREE.BufferGeometry, color: string | THREE.Material, finish: Finish | undefined, x: number, y: number, z: number, sx: number, sy: number, sz: number): THREE.Mesh {
  const mesh = new THREE.Mesh(geometry, typeof color === 'string' ? material(color, finish) : color)
  mesh.position.set(x, y, z)
  mesh.scale.set(sx, sy, sz)
  mesh.castShadow = true
  mesh.receiveShadow = true
  return mesh
}

/** A cone by base radius and height, its centre at (x, y, z). */
export function cone(radius: number, h: number, color: string | THREE.Material, x = 0, y = h / 2, z = 0, finish?: Finish): THREE.Mesh {
  return placed(cones, color, finish, x, y, z, radius * 2, h, radius * 2)
}

/** A ring lying flat (rotate it to stand it up); `tube` is the thickness relative to the radius. */
export function ring(radius: number, color: string | THREE.Material, x = 0, y = 0, z = 0, finish?: Finish, tube = 1): THREE.Mesh {
  const mesh = placed(tori, color, finish, x, y, z, radius * 2, radius * 2, radius * 2 * tube)
  mesh.rotation.x = Math.PI / 2
  return mesh
}
