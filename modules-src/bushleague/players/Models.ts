/** The Blender-built ballplayer bodies (tools/build-ballplayer.py → public/modules/bushleague/players/*.glb) and their glove and bat (tools/build-gear.py): loaded once, joints remapped onto the shared rig's bone order, `_slot` mapped to the uniform slot attribute, and torso and head wrap coordinates derived from the bind pose so jersey lettering and faces land the same way they do on the procedural body. */
import * as THREE from 'three/webgpu'
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js'
import type { BodyType } from '../sim'
import { SLOT } from './BodyMesh'
import { BONES } from './Rig'

export type ModelBody = 'lean' | 'stocky' | 'belly'

const MODEL_FOR: Readonly<Record<BodyType, ModelBody>> = { lean: 'lean', tall: 'lean', stocky: 'stocky', short: 'stocky', belly: 'belly' }
const geometries = new Map<ModelBody, THREE.BufferGeometry>()

const TORSO_BOTTOM = 0.85
const TORSO_TOP = 1.4
const HEAD_CENTER = new THREE.Vector3(0, 1.705, 0.01)
const HEAD_RADII = new THREE.Vector3(0.094, 0.118, 0.104)

const sanitized = (name: string) => name.replace(/[\s.:/[\]]/g, '')

/** Joint indices in the file's skin order → indices in BONES. */
function remapJoints(geometry: THREE.BufferGeometry, skeleton: THREE.Skeleton): void {
  const lookup = skeleton.bones.map((bone) => BONES.findIndex((name) => sanitized(name) === sanitized(bone.name)))
  if (lookup.some((index) => index < 0)) throw new Error(`ballplayer model has unknown bones: ${skeleton.bones.map((bone) => bone.name).join(', ')}`)
  const source = geometry.getAttribute('skinIndex')
  const remapped = new Uint16Array(source.count * 4)
  for (let vertex = 0; vertex < source.count; vertex++) {
    for (let k = 0; k < 4; k++) remapped[vertex * 4 + k] = lookup[source.getComponent(vertex, k)] ?? 0
  }
  geometry.setAttribute('skinIndex', new THREE.Uint16BufferAttribute(remapped, 4))
}

function deriveWrap(geometry: THREE.BufferGeometry): void {
  const position = geometry.getAttribute('position')
  const slot = geometry.getAttribute('slot')
  const wrap = new Float32Array(position.count * 3)
  const cloth = new Set<number>([SLOT.jersey, SLOT.trim, SLOT.pants, SLOT.belt])
  const p = new THREE.Vector3()
  for (let vertex = 0; vertex < position.count; vertex++) {
    p.fromBufferAttribute(position, vertex)
    const kind = Math.round(slot.getX(vertex))
    let out: [number, number, number] = [0, -1, 0]
    if (cloth.has(kind) && Math.abs(p.x) < 0.21 && p.y > TORSO_BOTTOM && p.y < TORSO_TOP + 0.02) {
      const across = new THREE.Vector2(p.x / 0.19, p.z / 0.13).normalize()
      out = [across.x, (p.y - TORSO_BOTTOM) / (TORSO_TOP - TORSO_BOTTOM), across.y]
    } else if (kind === SLOT.skin && p.y > 1.56) {
      const n = p.clone().sub(HEAD_CENTER).divide(HEAD_RADII).normalize()
      out = [n.x, 2 + n.y, n.z]
    }
    wrap.set(out, vertex * 3)
  }
  geometry.setAttribute('wrap', new THREE.Float32BufferAttribute(wrap, 3))
}

async function loadOne(loader: GLTFLoader, base: string, body: ModelBody): Promise<void> {
  const gltf = await loader.loadAsync(`${base}ballplayer-${body}.glb`)
  gltf.scene.updateMatrixWorld(true)
  let found: THREE.SkinnedMesh | null = null
  gltf.scene.traverse((object) => {
    if (!found && (object as THREE.SkinnedMesh).isSkinnedMesh) found = object as THREE.SkinnedMesh
  })
  const mesh = found as THREE.SkinnedMesh | null
  if (!mesh) throw new Error(`ballplayer-${body}.glb has no skinned mesh`)
  const geometry = mesh.geometry.clone()
  geometry.applyMatrix4(mesh.bindMatrix)
  remapJoints(geometry, mesh.skeleton)
  const slot = geometry.getAttribute('_slot')
  if (!slot) throw new Error(`ballplayer-${body}.glb has no _slot attribute`)
  geometry.setAttribute('slot', slot)
  geometry.deleteAttribute('_slot')
  if (geometry.getAttribute('uv')) geometry.deleteAttribute('uv')
  deriveWrap(geometry)
  geometry.computeBoundingSphere()
  geometries.set(body, geometry)
  mesh.geometry.dispose()
}

export interface Gear {
  /** Fielder's gloves for the left and right hand, vertex-coloured, in the glove's own frame (fingers +y, pocket +z). */
  glove: Readonly<Record<'L' | 'R', THREE.BufferGeometry>>
  /** The bat standing on its knob at the origin, barrel up, 0.86 m long, vertex-coloured. */
  bat: THREE.BufferGeometry
}

let gear: Gear | null = null

async function loadGeometry(loader: GLTFLoader, url: string): Promise<THREE.BufferGeometry> {
  const gltf = await loader.loadAsync(url)
  gltf.scene.updateMatrixWorld(true)
  let found: THREE.Mesh | null = null
  gltf.scene.traverse((object) => {
    if (!found && (object as THREE.Mesh).isMesh) found = object as THREE.Mesh
  })
  const mesh = found as THREE.Mesh | null
  if (!mesh) throw new Error(`${url} has no mesh`)
  const geometry = mesh.geometry.clone().applyMatrix4(mesh.matrixWorld)
  mesh.geometry.dispose()
  if (!geometry.getAttribute('color')) throw new Error(`${url} has no vertex colours`)
  return geometry
}

function mirrored(geometry: THREE.BufferGeometry): THREE.BufferGeometry {
  const copy = geometry.clone().scale(-1, 1, 1)
  const index = copy.getIndex()
  if (index) {
    for (let i = 0; i < index.count; i += 3) {
      const second = index.getX(i + 1)
      index.setX(i + 1, index.getX(i + 2))
      index.setX(i + 2, second)
    }
  }
  copy.computeVertexNormals()
  return copy
}

/** Loads the three bodies, the glove and the bat; resolves false (and the procedural body and plain gear are used) if a body is missing or malformed. */
export async function loadBallplayerModels(base: string): Promise<boolean> {
  const loader = new GLTFLoader()
  const gearLoad = Promise.all([loadGeometry(loader, `${base}glove.glb`), loadGeometry(loader, `${base}bat.glb`)])
    .then(([glove, bat]) => {
      gear = { glove: { L: glove, R: mirrored(glove) }, bat }
    })
    .catch((error) => console.warn('Bush League: using plain glove and bat', error))
  try {
    await Promise.all([...(['lean', 'stocky', 'belly'] as const).map((body) => loadOne(loader, base, body)), gearLoad])
    return true
  } catch (error) {
    console.warn('Bush League: using procedural ballplayers', error)
    geometries.clear()
    return false
  }
}

/** The Blender glove and bat, or null before loading or after a failure. */
export function modelGear(): Gear | null {
  return gear
}

/** The shared Blender body for a body type, or null before loading or after a failure. */
export function modelGeometry(body: BodyType): THREE.BufferGeometry | null {
  return geometries.get(MODEL_FOR[body]) ?? null
}
