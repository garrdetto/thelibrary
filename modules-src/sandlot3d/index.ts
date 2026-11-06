import '../_shared/peer-global';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { MeshoptDecoder } from 'three/addons/libs/meshopt_decoder.module.js';
import type { SkinnedMesh } from 'three';
import { createLegacyThree } from './three-legacy';
import { createAdaptiveResolution } from '../_shared/adaptive-resolution.js';
import { batchStatic } from '../_shared/static-batch.js';
import mainUrl from './main.js?url';

declare global {
  interface Window {
    THREE: ReturnType<typeof createLegacyThree>;
    __adaptiveResolution: typeof createAdaptiveResolution;
    __batchStatic: typeof batchStatic;
    __athlete: SkinnedMesh[] | null;
  }
}

window.THREE = createLegacyThree();
window.__adaptiveResolution = createAdaptiveResolution;
window.__batchStatic = batchStatic;

async function loadAthlete(): Promise<SkinnedMesh[] | null> {
  if (new URLSearchParams(location.search).get('athlete') === '0') return null;
  try {
    const gltf = await new GLTFLoader().setMeshoptDecoder(MeshoptDecoder).loadAsync('/models/sandlot3d/athlete.glb');
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

loadAthlete().then((athlete) => {
  window.__athlete = athlete;
  const script = document.createElement('script');
  script.src = mainUrl;
  document.body.appendChild(script);
});
