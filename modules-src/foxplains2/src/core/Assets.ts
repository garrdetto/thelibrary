/**
 * glTF loading for PlayCanvas. The library's models are meshopt-compressed
 * (EXT_meshopt_compression + KHR_mesh_quantization) with WebP textures
 * (EXT_texture_webp); PlayCanvas reads neither on its own, so the container
 * parser gets two hooks: buffer views are decoded with meshoptimizer's
 * decoder, and WebP texture sources are promoted to the core `source`.
 * Every URL loads once; callers get a fresh entity per instance.
 */
import * as pc from 'playcanvas';
import { MeshoptDecoder } from 'meshoptimizer/decoder';

interface MeshoptExt { buffer: number; byteOffset?: number; byteLength: number; byteStride: number; count: number; mode: string; filter?: string }
type BufferViewHook = (view: { extensions?: { EXT_meshopt_compression?: MeshoptExt } }, buffers: Promise<Uint8Array>[], cb: (err: string | null, result?: Uint8Array) => void) => void;

const processAsync: BufferViewHook = (view, buffers, cb) => {
  const ext = view.extensions?.EXT_meshopt_compression;
  if (!ext) { cb(null); return; }
  Promise.all([MeshoptDecoder.ready, buffers[ext.buffer]]).then(([, buf]) => {
    const src = new Uint8Array(buf.buffer, buf.byteOffset + (ext.byteOffset ?? 0), ext.byteLength);
    const out = new Uint8Array(ext.count * ext.byteStride);
    MeshoptDecoder.decodeGltfBuffer(out, ext.count, ext.byteStride, src, ext.mode, ext.filter);
    cb(null, out);
  }).catch(e => cb(String(e)));
};

const texturePre = (t: { source?: number; extensions?: { EXT_texture_webp?: { source: number } } }) => {
  const webp = t.extensions?.EXT_texture_webp;
  if (webp && t.source === undefined) t.source = webp.source;
};

export class Assets {
  private containers = new Map<string, Promise<pc.ContainerResource | null>>();
  private loaded = new Map<string, pc.ContainerResource | null>();

  constructor(private app: pc.AppBase) {}

  /** The parsed container for a .glb/.gltf (null if it fails to load). */
  container(url: string): Promise<pc.ContainerResource | null> {
    let p = this.containers.get(url);
    if (!p) {
      p = new Promise(resolve => {
        const asset = new pc.Asset(url, 'container', { url, filename: url.split('?')[0].split('/').pop() || 'model.glb' }, undefined, {
          bufferView: { processAsync },
          texture: { preprocess: texturePre },
        } as unknown as Record<string, unknown>);
        asset.once('load', () => resolve(asset.resource as pc.ContainerResource));
        asset.once('error', (err: unknown) => { console.warn('[foxplains2] model failed:', url, err); resolve(null); });
        this.app.assets.add(asset);
        this.app.assets.load(asset);
      });
      this.containers.set(url, p);
      void p.then(r => this.loaded.set(url, r));
    }
    return p;
  }

  /** Synchronous access once a container has loaded. */
  ready(url: string): pc.ContainerResource | null | undefined { return this.loaded.get(url); }

  /** A new entity tree for the model, or null. */
  async instance(url: string): Promise<pc.Entity | null> {
    const c = await this.container(url);
    return c ? c.instantiateRenderEntity({ castShadows: true, receiveShadows: true }) : null;
  }

  /** Same as `instance` but only when already loaded. */
  instanceNow(url: string): pc.Entity | null | undefined {
    const c = this.loaded.get(url);
    if (c === undefined) return undefined;
    return c ? c.instantiateRenderEntity({ castShadows: true, receiveShadows: true }) : null;
  }
}

/** Every mesh instance under an entity. */
export function meshInstances(root: pc.Entity): pc.MeshInstance[] {
  const out: pc.MeshInstance[] = [];
  for (const r of root.findComponents('render') as pc.RenderComponent[]) out.push(...r.meshInstances);
  return out;
}

/** Local-space bounds of everything under `root`, measured with the entity at the origin. */
export function localBounds(root: pc.Entity): pc.BoundingBox | null {
  const pos = root.getLocalPosition().clone(), rot = root.getLocalRotation().clone(), scl = root.getLocalScale().clone();
  const parent = root.parent;
  parent?.removeChild(root);
  root.setLocalPosition(0, 0, 0); root.setLocalRotation(0, 0, 0, 1); root.setLocalScale(1, 1, 1);
  root.syncHierarchy();
  let box: pc.BoundingBox | null = null;
  for (const mi of meshInstances(root)) {
    const b = mi.aabb;
    if (!box) box = new pc.BoundingBox(b.center.clone(), b.halfExtents.clone());
    else box.add(b);
  }
  root.setLocalPosition(pos); root.setLocalRotation(rot); root.setLocalScale(scl);
  parent?.addChild(root);
  return box;
}
