/**
 * The Blender-built models: the resident body (`public/models/hood/sim.glb`, from `tools/build-sim.py`) and the
 * furniture set (`public/models/hood/furniture.glb`, from `tools/build-furniture.py`). Both are loaded once before
 * the first scene; if either fails (or with `?sims=0` / `?props=0`) the older procedural models are used instead.
 */
import * as THREE from 'three/webgpu'
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js'
import { MeshoptDecoder } from 'three/addons/libs/meshopt_decoder.module.js'

export const models: { sim: THREE.Object3D | null; furniture: THREE.Object3D | null } = { sim: null, furniture: null }

let pending: Promise<void> | null = null

/** Marks every geometry shared so `detach` never disposes a template's buffers through one of its clones. */
function share(root: THREE.Object3D): THREE.Object3D {
  root.traverse(node => {
    const mesh = node as THREE.Mesh
    if (mesh.isMesh) mesh.geometry.userData.shared = true
  })
  return root
}

export function loadModels(): Promise<void> {
  if (pending) return pending
  const params = new URLSearchParams(location.search)
  const loader = new GLTFLoader().setMeshoptDecoder(MeshoptDecoder)
  const load = (url: string, off: boolean) =>
    off ? Promise.resolve(null) : loader.loadAsync(url).then(gltf => share(gltf.scene)).catch(error => {
      console.warn(`The Hood: ${url} could not load, using the simple models`, error)
      return null
    })
  pending = Promise.all([load('/models/hood/sim.glb', params.get('sims') === '0'), load('/models/hood/furniture.glb', params.get('props') === '0')]).then(([sim, furniture]) => {
    models.sim = sim
    models.furniture = furniture
  })
  return pending
}
