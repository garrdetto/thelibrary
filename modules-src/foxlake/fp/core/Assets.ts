/**
 * glTF loading through Babylon's glTF 2.0 loader. The library's models are
 * meshopt-compressed (EXT_meshopt_compression + KHR_mesh_quantization) with
 * WebP textures (EXT_texture_webp). Babylon would fetch its meshopt decoder
 * from a CDN; instead the bundled `meshoptimizer` decoder (WebAssembly, in
 * this page's own chunks) is handed to it before anything loads.
 *
 * Every URL loads once into an AssetContainer that is never added to the
 * scene; callers get clones that share its geometry, materials and textures
 * (`instance`), so a street of identical sofas or a dozen neighbors of one
 * body cost one upload. Disposing an instance frees only the instance.
 */
import { MeshoptDecoder } from 'meshoptimizer/decoder';
import { MeshoptCompression } from '@babylonjs/core/Meshes/Compression/meshoptCompression';
import { LoadAssetContainerAsync } from '@babylonjs/core/Loading/sceneLoader';
import type { AssetContainer, InstantiatedEntries } from '@babylonjs/core/assetContainer';
import { TransformNode } from '@babylonjs/core/Meshes/transformNode';
import type { AbstractMesh } from '@babylonjs/core/Meshes/abstractMesh';
import { Vector3 } from '@babylonjs/core/Maths/math.vector';
import type { Scene } from '@babylonjs/core/scene';
import '@babylonjs/loaders/glTF/2.0/glTFLoader';
import '@babylonjs/loaders/glTF/2.0/Extensions/EXT_meshopt_compression';
import '@babylonjs/loaders/glTF/2.0/Extensions/EXT_texture_webp';
import '@babylonjs/loaders/glTF/2.0/Extensions/KHR_mesh_quantization';
import '@babylonjs/loaders/glTF/2.0/Extensions/EXT_mesh_gpu_instancing';
import '@babylonjs/loaders/glTF/2.0/Extensions/KHR_materials_emissive_strength';
import '@babylonjs/loaders/glTF/2.0/Extensions/KHR_materials_clearcoat';
import '@babylonjs/loaders/glTF/2.0/Extensions/KHR_materials_unlit';
import '@babylonjs/loaders/glTF/2.0/Extensions/KHR_materials_specular';
import '@babylonjs/loaders/glTF/2.0/Extensions/KHR_materials_ior';
import '@babylonjs/loaders/glTF/2.0/Extensions/KHR_texture_transform';
import '@babylonjs/core/Meshes/thinInstanceMesh';
import '@babylonjs/core/Materials/Textures/Loaders/envTextureLoader';

let decoderInstalled = false;
/** Gives Babylon's meshopt path the bundled decoder instead of its CDN script. */
function installMeshopt() {
  if (decoderInstalled) return;
  decoderInstalled = true;
  (globalThis as unknown as { MeshoptDecoder: typeof MeshoptDecoder }).MeshoptDecoder = MeshoptDecoder;
  const inst = Object.create(MeshoptCompression.prototype) as unknown as { _decoderModulePromise: Promise<unknown>; _useNativeDecoder: boolean };
  inst._useNativeDecoder = false;
  inst._decoderModulePromise = MeshoptDecoder.ready;
  (MeshoptCompression as unknown as { _Default: unknown })._Default = inst;
}

export interface ModelInstance { root: TransformNode; entries: InstantiatedEntries }

export class Assets {
  private containers = new Map<string, Promise<AssetContainer | null>>();
  private loaded = new Map<string, AssetContainer | null>();

  constructor(private scene: Scene) { installMeshopt(); }

  /** The parsed container for a .glb/.gltf (null if it fails to load). */
  container(url: string): Promise<AssetContainer | null> {
    let p = this.containers.get(url);
    if (!p) {
      const ext = /\.gltf(\?|$)/i.test(url) ? '.gltf' : '.glb';
      p = LoadAssetContainerAsync(url, this.scene, { pluginExtension: ext })
        .then(c => { for (const m of c.meshes) { m.isPickable = false; m.doNotSyncBoundingInfo = false; } return c; })
        .catch(err => { console.warn('[foxplains2] model failed:', url, err); return null; });
      this.containers.set(url, p);
      void p.then(r => this.loaded.set(url, r));
    }
    return p;
  }

  /** Synchronous access once a container has loaded. */
  ready(url: string): AssetContainer | null | undefined { return this.loaded.get(url); }

  /** A new clone of the model under one root node, or null. */
  async instance(url: string, opts: { shadows?: boolean } = {}): Promise<ModelInstance | null> {
    const c = await this.container(url);
    return c ? instantiate(c, url, opts.shadows ?? true) : null;
  }

  /** Same as `instance` but only when already loaded. */
  instanceNow(url: string, opts: { shadows?: boolean } = {}): ModelInstance | null | undefined {
    const c = this.loaded.get(url);
    if (c === undefined) return undefined;
    return c ? instantiate(c, url, opts.shadows ?? true) : null;
  }
}

let serial = 0;
/** Clones a container's models under one node; geometry, materials and textures stay shared. */
export function instantiate(c: AssetContainer, name: string, shadows = true): ModelInstance {
  const n = ++serial;
  const entries = c.instantiateModelsToScene(s => `${s}#${n}`, false, { doNotInstantiate: true });
  const root = new TransformNode(`model:${name.split('/').pop()}#${n}`, c.scene);
  for (const r of entries.rootNodes) r.parent = root;
  for (const m of root.getChildMeshes(false)) { m.isPickable = false; m.receiveShadows = true; (m as AbstractMesh & { __caster?: boolean }).__caster = shadows; }
  return { root, entries };
}

/** Every mesh under a node that draws something. */
export function meshesOf(root: TransformNode): AbstractMesh[] {
  return root.getChildMeshes(false).filter(m => m.getTotalVertices() > 0);
}

/** Local-space bounds of everything under `root` (as if the root sat at the origin unrotated). */
export function localBounds(root: TransformNode): { center: Vector3; halfExtents: Vector3 } | null {
  const pos = root.position.clone(), rot = root.rotationQuaternion?.clone() ?? null, eul = root.rotation.clone(), scl = root.scaling.clone(), parent = root.parent;
  root.parent = null;
  root.position.setAll(0); root.rotationQuaternion = null; root.rotation.setAll(0); root.scaling.setAll(1);
  root.computeWorldMatrix(true);
  const min = new Vector3(Infinity, Infinity, Infinity), max = new Vector3(-Infinity, -Infinity, -Infinity);
  for (const m of meshesOf(root)) {
    m.computeWorldMatrix(true);
    m.refreshBoundingInfo({});
    const b = m.getBoundingInfo().boundingBox;
    min.minimizeInPlace(b.minimumWorld); max.maximizeInPlace(b.maximumWorld);
  }
  root.parent = parent;
  root.position.copyFrom(pos); root.rotation.copyFrom(eul); root.rotationQuaternion = rot; root.scaling.copyFrom(scl);
  if (!Number.isFinite(min.x)) return null;
  return { center: min.add(max).scaleInPlace(0.5), halfExtents: max.subtract(min).scaleInPlace(0.5) };
}
