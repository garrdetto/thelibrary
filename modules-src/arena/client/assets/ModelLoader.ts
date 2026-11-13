import type { Scene } from '@babylonjs/core/scene'
import { SceneLoader } from '@babylonjs/core/Loading/sceneLoader'
import { MeshoptCompression } from '@babylonjs/core/Meshes/Compression/meshoptCompression'
import { TransformNode } from '@babylonjs/core/Meshes/transformNode'
import type { AbstractMesh } from '@babylonjs/core/Meshes/abstractMesh'
import type { Node } from '@babylonjs/core/node'
import type { AnimationGroup } from '@babylonjs/core/Animations/animationGroup'
import { Vector3 } from '@babylonjs/core/Maths/math.vector'
import { MeshoptDecoder } from 'meshoptimizer/decoder'
import '@babylonjs/loaders/glTF/2.0/glTFLoader'
import '@babylonjs/loaders/glTF/2.0/Extensions/EXT_meshopt_compression'
import '@babylonjs/loaders/glTF/2.0/Extensions/EXT_texture_webp'
import '@babylonjs/loaders/glTF/2.0/Extensions/KHR_mesh_quantization'
import '@babylonjs/loaders/glTF/2.0/Extensions/KHR_texture_transform'
import '@babylonjs/loaders/glTF/2.0/Extensions/KHR_materials_emissive_strength'

export interface LoadedModel {
  root: TransformNode
  meshes: AbstractMesh[]
  animations: Map<string, AnimationGroup>
  dispose(): void
}

export interface ModelFit {
  length?: number
  rotation?: Vector3
  position?: Vector3
}

let decoderReady = false
function installMeshoptDecoder(): void {
  if (decoderReady) return
  decoderReady = true
  ;(globalThis as unknown as { MeshoptDecoder: typeof MeshoptDecoder }).MeshoptDecoder = MeshoptDecoder
  const instance = Object.create(MeshoptCompression.prototype) as unknown as { _decoderModulePromise: Promise<unknown>; _useNativeDecoder: boolean }
  instance._useNativeDecoder = false
  instance._decoderModulePromise = MeshoptDecoder.ready
  ;(MeshoptCompression as unknown as { _Default: unknown })._Default = instance
}

let queue: Promise<unknown> = Promise.resolve()

function splitUrl(url: string): { rootUrl: string; fileName: string } {
  const slash = url.lastIndexOf('/') + 1
  return { rootUrl: url.slice(0, slash), fileName: url.slice(slash) }
}

function clipName(name: string): string {
  return name.toLowerCase().replace(/^.*[|:]/, '').trim()
}

async function appendModel(scene: Scene, url: string, name: string): Promise<LoadedModel> {
  installMeshoptDecoder()
  const meshesBefore = new Set(scene.meshes)
  const nodesBefore = new Set<Node>(scene.transformNodes)
  const groupsBefore = new Set(scene.animationGroups)
  const { rootUrl, fileName } = splitUrl(url)
  await SceneLoader.AppendAsync(rootUrl, fileName, scene)

  const meshes = scene.meshes.filter(mesh => !meshesBefore.has(mesh))
  const nodes: Node[] = [...meshes, ...scene.transformNodes.filter(node => !nodesBefore.has(node))]
  const added = new Set(nodes)
  const groups = scene.animationGroups.filter(group => !groupsBefore.has(group))

  const root = new TransformNode(`${name}-root`, scene)
  for (const node of nodes) if (!node.parent || !added.has(node.parent)) node.parent = root
  for (const group of groups) group.stop()

  const animations = new Map<string, AnimationGroup>()
  for (const group of groups) animations.set(clipName(group.name), group)

  return {
    root,
    meshes,
    animations,
    dispose() {
      for (const group of groups) group.dispose()
      root.dispose(false, true)
    },
  }
}

export function loadModel(scene: Scene, url: string, name = 'model'): Promise<LoadedModel> {
  const next = queue.then(() => appendModel(scene, url, name))
  queue = next.catch(() => undefined)
  return next
}

export function fitModel(model: LoadedModel, fit: ModelFit): { min: Vector3; max: Vector3 } {
  const { root } = model
  root.position.setAll(0)
  root.rotationQuaternion = null
  root.rotation.copyFrom(fit.rotation ?? Vector3.Zero())
  root.scaling.setAll(1)
  root.computeWorldMatrix(true)
  let bounds = root.getHierarchyBoundingVectors(true)
  if (fit.length) {
    const size = bounds.max.subtract(bounds.min)
    const longest = Math.max(size.x, size.y, size.z)
    if (longest > 0) root.scaling.setAll(fit.length / longest)
    root.computeWorldMatrix(true)
    bounds = root.getHierarchyBoundingVectors(true)
  }
  if (fit.position) root.position.copyFrom(fit.position)
  return { min: bounds.min.clone(), max: bounds.max.clone() }
}
