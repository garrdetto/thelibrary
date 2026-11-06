import '../_shared/peer-global';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { MeshoptDecoder } from 'three/addons/libs/meshopt_decoder.module.js';
import { bloom } from 'three/addons/tsl/display/BloomNode.js';
import type { Material, MeshStandardMaterial, SkinnedMesh, Texture, WebGPURenderer } from 'three/webgpu';
import { createLegacyThree, createRenderer } from './three-legacy';
import { createAdaptiveResolution } from '../_shared/adaptive-resolution.js';
import { batchStatic } from '../_shared/static-batch.js';
import mainUrl from './main.js?url';

interface FieldMaps {
  detail: Texture;
  normal: Texture;
  roughness: Texture;
}

declare global {
  interface Window {
    THREE: ReturnType<typeof createLegacyThree>;
    __adaptiveResolution: typeof createAdaptiveResolution;
    __batchStatic: typeof batchStatic;
    __athlete: SkinnedMesh[] | null;
    __field: { grass: FieldMaps; dirt: FieldMaps } | null;
    __renderer: WebGPURenderer;
    __bloom: typeof bloom;
  }
}

const params = new URLSearchParams(location.search);
window.THREE = createLegacyThree();
window.__adaptiveResolution = createAdaptiveResolution;
window.__batchStatic = batchStatic;
window.__bloom = bloom;

const loader = new GLTFLoader().setMeshoptDecoder(MeshoptDecoder);

async function loadAthlete(): Promise<SkinnedMesh[] | null> {
  if (params.get('athlete') === '0') return null;
  try {
    const gltf = await loader.loadAsync('/models/sandlot3d/athlete.glb');
    gltf.scene.updateMatrixWorld(true);
    const parts: SkinnedMesh[] = [];
    gltf.scene.traverse((node) => {
      if ((node as SkinnedMesh).isSkinnedMesh) parts.push(node as SkinnedMesh);
    });
    return parts.length ? parts : null;
  } catch {
    return null;
  }
}

async function loadField(): Promise<Window['__field']> {
  try {
    const gltf = await loader.loadAsync('/models/sandlot3d/field_detail.glb');
    const maps: Record<string, FieldMaps> = {};
    gltf.scene.traverse((node) => {
      const material = (node as unknown as { material?: Material }).material as MeshStandardMaterial | undefined;
      if (!material?.map || !material.normalMap || !material.roughnessMap) return;
      const tiles = [material.map, material.normalMap, material.roughnessMap];
      for (const tile of tiles) {
        tile.wrapS = tile.wrapT = window.THREE.RepeatWrapping;
        tile.colorSpace = window.THREE.NoColorSpace;
        tile.anisotropy = 8;
        tile.needsUpdate = true;
      }
      maps[material.name] = { detail: material.map, normal: material.normalMap, roughness: material.roughnessMap };
    });
    return maps.grass && maps.dirt ? { grass: maps.grass, dirt: maps.dirt } : null;
  } catch {
    return null;
  }
}

const canvas = document.getElementById('gl') as HTMLCanvasElement;
Promise.all([createRenderer(canvas, params.get('renderer') === 'webgl', window.THREE), loadAthlete(), loadField()]).then(([renderer, athlete, field]) => {
  window.__renderer = renderer;
  window.__athlete = athlete;
  window.__field = field;
  const script = document.createElement('script');
  script.src = mainUrl;
  document.body.appendChild(script);
});
