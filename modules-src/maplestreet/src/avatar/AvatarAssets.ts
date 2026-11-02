/**
 * Loads each body once (skinned .glb + clothing-region mask) and shares it:
 * every avatar clones the skeleton but reuses the geometry and textures.
 * A second geometry has the scanned hair pressed onto the scalp, for the buzz
 * cut and for wearing hats or long hair over it.
 */
import * as THREE from 'three/webgpu';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import type { Body } from '../../shared/Wardrobe';
import { MASK_STEP, REGIONS, RIG } from './RigData';

export interface BodyAsset {
  body: Body;
  scene: THREE.Object3D;
  geometry: THREE.BufferGeometry;
  /** Hair pressed onto the scalp: the buzz cut, and what's under hats and long hair. */
  flatGeometry: THREE.BufferGeometry;
  /** Hair pressed flat but the ponytail kept (a hat over the natural style). */
  tailGeometry: THREE.BufferGeometry;
  albedo: THREE.Texture;
  mask: THREE.Texture;
  /** Rest-pose joint positions (model space), read from the skeleton. */
  joints: Record<string, THREE.Vector3>;
}

const cache = new Map<Body, Promise<BodyAsset>>();
const assetUrl = (file: string) => new URL(`maplestreet/${file}`, location.href).toString();

async function loadMask(url: string) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`mask ${res.status}`);
  const bmp = await createImageBitmap(await res.blob(), { colorSpaceConversion: 'none', premultiplyAlpha: 'none' });
  const c = document.createElement('canvas');
  c.width = bmp.width; c.height = bmp.height;
  const g = c.getContext('2d', { willReadFrequently: true })!;
  g.drawImage(bmp, 0, 0);
  const data = g.getImageData(0, 0, c.width, c.height).data;
  const tex = new THREE.CanvasTexture(c);
  tex.flipY = false;
  tex.colorSpace = THREE.NoColorSpace;
  tex.magFilter = THREE.NearestFilter;
  tex.minFilter = THREE.NearestFilter;
  tex.generateMipmaps = false;
  return { tex, data, w: c.width, h: c.height };
}

/**
 * Presses the scanned hair onto the scalp ellipsoid (never the face). With
 * `keepTail` the female ponytail is left hanging (a hat over the natural
 * style); otherwise it's gathered onto the head too (pixie, long hair, bun).
 */
function flatten(geo: THREE.BufferGeometry, body: Body, region: Uint8Array, keepTail: boolean) {
  const out = geo.clone();
  const pos = out.getAttribute('position') as THREE.BufferAttribute;
  const { c, r } = RIG[body].scalp;
  const hair = REGIONS.indexOf('hair');
  const cloth = ['jacket', 'tee', 'pants', 'shoes', 'soles'].map(n => REGIONS.indexOf(n as (typeof REGIONS)[number]));
  const skinish = [REGIONS.indexOf('skin'), REGIONS.indexOf('eyes')];
  for (let i = 0; i < pos.count; i++) {
    const px = pos.getX(i), py = pos.getY(i), pz = pos.getZ(i);
    if (cloth.includes(region[i]) || Math.hypot(px - c[0], py - c[1], pz - c[2]) > 0.4) continue;
    if (skinish.includes(region[i])) {
      const face = pz > c[2] && Math.abs(px - c[0]) < 0.072 && py < c[1] + r[1] * 0.5;
      if (face || py < c[1] - r[1] * 0.7) continue;
    } else if (region[i] !== hair && py < c[1] - r[1] * 0.7) continue;
    if (keepTail && pos.getZ(i) < c[2] - r[2] * 0.45 && pos.getY(i) < c[1] + r[1] * 0.35) continue;
    const x = (pos.getX(i) - c[0]) / r[0], y = (pos.getY(i) - c[1]) / r[1], z = (pos.getZ(i) - c[2]) / r[2];
    const d = Math.hypot(x, y, z);
    if (d <= 1.02) continue;
    const k = 1.02 / d;
    pos.setXYZ(i, c[0] + x * k * r[0], c[1] + y * k * r[1], c[2] + z * k * r[2]);
  }
  pos.needsUpdate = true;
  out.computeVertexNormals();
  out.setAttribute('restPos', geo.getAttribute('restPos'));
  return out;
}

async function load(body: Body): Promise<BodyAsset> {
  const [gltf, mask] = await Promise.all([new GLTFLoader().loadAsync(assetUrl(`${body}.glb`)), loadMask(assetUrl(`${body}-mask.png`))]);
  let mesh: THREE.SkinnedMesh | null = null;
  gltf.scene.traverse(o => { if ((o as THREE.SkinnedMesh).isSkinnedMesh) mesh = o as THREE.SkinnedMesh; });
  if (!mesh) throw new Error('No skinned mesh in avatar');
  const skinned = mesh as THREE.SkinnedMesh;
  const geometry = skinned.geometry;
  geometry.setAttribute('restPos', geometry.getAttribute('position').clone());
  const albedo = (skinned.material as THREE.MeshStandardMaterial).map!;

  // Region of each vertex, sampled from the mask at its UV.
  const uv = geometry.getAttribute('uv');
  const region = new Uint8Array(uv.count);
  for (let i = 0; i < uv.count; i++) {
    const x = Math.min(mask.w - 1, Math.max(0, Math.floor(uv.getX(i) * mask.w)));
    const y = Math.min(mask.h - 1, Math.max(0, Math.floor(uv.getY(i) * mask.h)));
    region[i] = Math.round(mask.data[(y * mask.w + x) * 4] / MASK_STEP);
  }
  gltf.scene.updateMatrixWorld(true);
  const flatGeometry = flatten(geometry, body, region, false);
  const tailGeometry = body === 'female' ? flatten(geometry, body, region, true) : flatGeometry;

  const joints: Record<string, THREE.Vector3> = {};
  gltf.scene.traverse(o => { if ((o as THREE.Bone).isBone) joints[o.name] = o.getWorldPosition(new THREE.Vector3()); });
  return { body, scene: gltf.scene, geometry, flatGeometry, tailGeometry, albedo, mask: mask.tex, joints };
}

export function loadBody(body: Body): Promise<BodyAsset> {
  let p = cache.get(body);
  if (!p) {
    p = load(body);
    p.catch(() => cache.delete(body));
    cache.set(body, p);
  }
  return p;
}
