/** The bow's pin sight: a Meshy model (`/models/rackreel/bow-sight.glb`, from `assets-src/models/rackreel/bow-sight.glb`) loaded through Babylon's glTF loader with the bundled meshopt decoder, re-materialled for the module's StandardMaterial lighting (its fibre-optic pins glow a little at night) and mounted on the riser on a short bar. Aiming looks through its ring from `SIGHT_EYE`. */
import { MeshoptDecoder } from 'meshoptimizer/decoder'
import { MeshoptCompression } from '@babylonjs/core/Meshes/Compression/meshoptCompression'
import { LoadAssetContainerAsync } from '@babylonjs/core/Loading/sceneLoader'
import { StandardMaterial } from '@babylonjs/core/Materials/standardMaterial'
import type { PBRMaterial } from '@babylonjs/core/Materials/PBR/pbrMaterial'
import type { BaseTexture } from '@babylonjs/core/Materials/Textures/baseTexture'
import { Color3 } from '@babylonjs/core/Maths/math.color'
import { Vector3 } from '@babylonjs/core/Maths/math.vector'
import type { AbstractMesh } from '@babylonjs/core/Meshes/abstractMesh'
import { CreateBox } from '@babylonjs/core/Meshes/Builders/boxBuilder'
import { TransformNode } from '@babylonjs/core/Meshes/transformNode'
import type { Scene } from '@babylonjs/core/scene'
import '@babylonjs/loaders/glTF/2.0/glTFLoader'
import '@babylonjs/loaders/glTF/2.0/Extensions/EXT_meshopt_compression'
import '@babylonjs/loaders/glTF/2.0/Extensions/EXT_texture_webp'
import '@babylonjs/loaders/glTF/2.0/Extensions/KHR_mesh_quantization'
import '@babylonjs/loaders/glTF/2.0/Extensions/KHR_texture_transform'

export const SIGHT_URL = '/models/rackreel/bow-sight.glb'

/** Centre of the sight ring in bow space (+z toward the target, +x to the right of the riser, y up from the grip). */
export const SIGHT_RING = new Vector3(0.045, 0.125, 0.15)
/** Where the shooter's eye sits behind a drawn bow (bow space): at anchor, in line with the ring. */
export const SIGHT_EYE = new Vector3(0.045, 0.125, -0.74)

/** The Meshy sight's ring centre and outer diameter in its own units (measured from the model). */
const MODEL_RING = { center: new Vector3(0, 0.16, 0.7), diameter: 1.36 }
const RING_DIAMETER = 0.062

let decoderInstalled = false
function installMeshopt(): void {
  if (decoderInstalled) return
  decoderInstalled = true
  ;(globalThis as unknown as { MeshoptDecoder: typeof MeshoptDecoder }).MeshoptDecoder = MeshoptDecoder
  const inst = Object.create(MeshoptCompression.prototype) as unknown as { _decoderModulePromise: Promise<unknown>; _useNativeDecoder: boolean }
  inst._useNativeDecoder = false
  inst._decoderModulePromise = MeshoptDecoder.ready
  ;(MeshoptCompression as unknown as { _Default: unknown })._Default = inst
}

/** Loads the sight onto `bow` (the bow rig's root). Resolves with the sight's meshes, or an empty list when it can't load. */
export async function mountBowSight(scene: Scene, bow: TransformNode): Promise<AbstractMesh[]> {
  const mount = new TransformNode('bow-sight', scene)
  mount.parent = bow
  const bar = CreateBox('bow-sight-bar', { width: SIGHT_RING.x, height: 0.012, depth: 0.012 }, scene)
  const barMat = new StandardMaterial('rr-bow-sight-bar', scene)
  barMat.diffuseColor = new Color3(0.05, 0.05, 0.055)
  barMat.specularColor = new Color3(0.2, 0.2, 0.2)
  bar.material = barMat
  bar.parent = bow
  bar.position.set(SIGHT_RING.x / 2, SIGHT_RING.y - 0.04, (SIGHT_RING.z + 0.03) / 2)
  bar.scaling.z = (SIGHT_RING.z - 0.03) / 0.012
  bar.isPickable = false
  const meshes: AbstractMesh[] = [bar]
  installMeshopt()
  try {
    const container = await LoadAssetContainerAsync(SIGHT_URL, scene, { pluginExtension: '.glb' })
    container.addAllToScene()
    const s = RING_DIAMETER / MODEL_RING.diameter
    mount.scaling.setAll(s)
    mount.position.copyFrom(SIGHT_RING.subtract(MODEL_RING.center.scale(s)))
    for (const node of container.rootNodes) node.parent = mount
    const done = new Map<string, StandardMaterial>()
    for (const m of container.meshes) {
      m.isPickable = false
      if (!m.getTotalVertices()) continue
      const pbr = m.material as PBRMaterial | null
      const key = pbr?.uniqueId?.toString() ?? 'none'
      let mat = done.get(key)
      if (!mat) {
        mat = new StandardMaterial(`rr-bow-sight-${done.size}`, scene)
        const tex = (pbr?.albedoTexture ?? null) as BaseTexture | null
        mat.diffuseTexture = tex
        mat.emissiveTexture = tex
        mat.emissiveColor = new Color3(0.22, 0.22, 0.22)
        mat.diffuseColor = tex ? Color3.White() : new Color3(0.08, 0.08, 0.09)
        mat.specularColor = new Color3(0.25, 0.25, 0.25)
        mat.specularPower = 48
        mat.backFaceCulling = false
        done.set(key, mat)
      }
      m.material = mat
      m.alwaysSelectAsActiveMesh = true
      meshes.push(m)
    }
    for (const mat of container.materials) if (![...done.values()].includes(mat as StandardMaterial)) mat.dispose(false, false)
  } catch (err) {
    console.warn('[rackreel] bow sight failed to load', err)
  }
  return meshes
}
