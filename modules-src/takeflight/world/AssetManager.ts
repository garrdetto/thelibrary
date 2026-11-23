/**
 * Reference-counted model loading. Each glTF URL is parsed once into an `AssetContainer` that is never added to the scene;
 * `acquire` hands out an instance (its own nodes, shared geometry, materials and textures) and bumps the URL's count, `release`
 * disposes the instance and drops the count. A container whose count reaches zero stays cached until the cache's byte estimate
 * passes its budget, then the least recently released containers are disposed first. Meshopt geometry is decoded by the bundled
 * decoder (never a CDN script).
 */
import type { AssetContainer, InstantiatedEntries } from '@babylonjs/core/assetContainer'
import { LoadAssetContainerAsync } from '@babylonjs/core/Loading/sceneLoader'
import { MeshoptCompression } from '@babylonjs/core/Meshes/Compression/meshoptCompression'
import type { AbstractMesh } from '@babylonjs/core/Meshes/abstractMesh'
import { TransformNode } from '@babylonjs/core/Meshes/transformNode'
import type { Node } from '@babylonjs/core/node'
import type { Scene } from '@babylonjs/core/scene'
import '@babylonjs/loaders/glTF/2.0/glTFLoader'
import '@babylonjs/loaders/glTF/2.0/Extensions/EXT_meshopt_compression'
import '@babylonjs/loaders/glTF/2.0/Extensions/EXT_texture_webp'
import '@babylonjs/loaders/glTF/2.0/Extensions/KHR_mesh_quantization'
import '@babylonjs/loaders/glTF/2.0/Extensions/KHR_materials_specular'
import '@babylonjs/loaders/glTF/2.0/Extensions/KHR_materials_emissive_strength'
import { MeshoptDecoder } from 'meshoptimizer/decoder'

let decoderInstalled = false

function installMeshopt(): void {
  if (decoderInstalled) return
  decoderInstalled = true
  ;(globalThis as unknown as { MeshoptDecoder: typeof MeshoptDecoder }).MeshoptDecoder = MeshoptDecoder
  const instance = Object.create(MeshoptCompression.prototype) as unknown as { _decoderModulePromise: Promise<unknown>; _useNativeDecoder: boolean }
  instance._useNativeDecoder = false
  instance._decoderModulePromise = MeshoptDecoder.ready
  ;(MeshoptCompression as unknown as { _Default: unknown })._Default = instance
}

export interface ModelInstance {
  readonly url: string
  readonly root: TransformNode
  readonly entries: InstantiatedEntries
  /** Nodes of this instance by their name in the file. */
  readonly nodes: Map<string, Node>
  readonly meshes: AbstractMesh[]
}

interface Entry {
  url: string
  promise: Promise<AssetContainer>
  container: AssetContainer | null
  references: number
  bytes: number
  releasedAt: number
}

export interface AssetStats {
  containers: number
  referenced: number
  bytes: number
  budget: number
}

let serial = 0

function estimateBytes(container: AssetContainer): number {
  let bytes = 0
  for (const geometry of container.geometries) {
    bytes += geometry.getTotalVertices() * 32 + (geometry.getTotalIndices() || 0) * 4
  }
  for (const texture of container.textures) {
    const size = texture.getSize()
    bytes += size.width * size.height * 4 * 1.34
  }
  return bytes
}

export class AssetManager {
  private readonly entries = new Map<string, Entry>()
  private disposed = false

  constructor(private readonly scene: Scene, public budgetBytes = 192 * 1024 * 1024) {
    installMeshopt()
  }

  private load(url: string): Entry {
    let entry = this.entries.get(url)
    if (entry) return entry
    const created: Entry = {
      url,
      container: null,
      references: 0,
      bytes: 0,
      releasedAt: 0,
      promise: LoadAssetContainerAsync(url, this.scene, { pluginExtension: '.glb' }).then((container) => {
        for (const mesh of container.meshes) mesh.isPickable = false
        created.container = container
        created.bytes = estimateBytes(container)
        if (this.disposed || !this.entries.has(url)) container.dispose()
        return container
      }),
    }
    this.entries.set(url, created)
    entry = created
    return entry
  }

  /** Starts loading without taking a reference. */
  preload(url: string): Promise<unknown> {
    return this.load(url).promise
  }

  /** A new instance of the model, with a reference held until `release`. */
  async acquire(url: string): Promise<ModelInstance> {
    const entry = this.load(url)
    entry.references++
    let container: AssetContainer
    try {
      container = await entry.promise
    } catch (error) {
      entry.references--
      throw error
    }
    const id = ++serial
    const entries = container.instantiateModelsToScene((name) => `${name}#${id}`, false, { doNotInstantiate: true })
    const root = new TransformNode(`${url}#${id}`, this.scene)
    const nodes = new Map<string, Node>()
    const meshes: AbstractMesh[] = []
    for (const node of entries.rootNodes) {
      node.parent = root
      const all = [node, ...node.getDescendants(false)]
      for (const child of all) {
        const name = child.name.replace(/#\d+$/, '')
        if (!nodes.has(name)) nodes.set(name, child)
        if ((child as AbstractMesh).getTotalVertices !== undefined && (child as AbstractMesh).getTotalVertices() > 0) meshes.push(child as AbstractMesh)
      }
    }
    return { url, root, entries, nodes, meshes }
  }

  release(instance: ModelInstance): void {
    instance.root.dispose(false, false)
    for (const animation of instance.entries.animationGroups) animation.dispose()
    for (const skeleton of instance.entries.skeletons) skeleton.dispose()
    const entry = this.entries.get(instance.url)
    if (!entry) return
    entry.references = Math.max(0, entry.references - 1)
    if (entry.references === 0) entry.releasedAt = performance.now()
    this.trim()
  }

  /** Disposes unreferenced containers, oldest release first, until the cache fits its budget. */
  trim(): void {
    let total = 0
    for (const entry of this.entries.values()) total += entry.bytes
    if (total <= this.budgetBytes) return
    const idle = [...this.entries.values()].filter((entry) => entry.references === 0 && entry.container).sort((a, b) => a.releasedAt - b.releasedAt)
    for (const entry of idle) {
      if (total <= this.budgetBytes) break
      entry.container?.dispose()
      this.entries.delete(entry.url)
      total -= entry.bytes
    }
  }

  get stats(): AssetStats {
    let bytes = 0
    let referenced = 0
    for (const entry of this.entries.values()) {
      bytes += entry.bytes
      if (entry.references > 0) referenced++
    }
    return { containers: this.entries.size, referenced, bytes, budget: this.budgetBytes }
  }

  dispose(): void {
    this.disposed = true
    for (const entry of this.entries.values()) entry.container?.dispose()
    this.entries.clear()
  }
}
