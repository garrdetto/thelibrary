import * as THREE from 'three/webgpu';
import * as TSL from 'three/tsl';

const LEGACY_LIGHT_SCALE = Math.PI;

type LightClass = new (...args: any[]) => THREE.Light;

interface LegacyLight {
  legacyScaledIntensity: number;
}

function legacyIntensity<T extends LightClass>(Base: T): T {
  const LegacyLight = class extends Base {};
  Object.defineProperty(LegacyLight.prototype, 'intensity', {
    configurable: true,
    get(this: LegacyLight) {
      return this.legacyScaledIntensity;
    },
    set(this: LegacyLight, value: number) {
      this.legacyScaledIntensity = value * LEGACY_LIGHT_SCALE;
    },
  });
  return LegacyLight;
}

export function createLegacyThree() {
  THREE.ColorManagement.enabled = false;
  const DirectionalLight = legacyIntensity(THREE.DirectionalLight);
  const HemisphereLight = legacyIntensity(THREE.HemisphereLight);
  const AmbientLight = legacyIntensity(THREE.AmbientLight);
  return { ...THREE, TSL, DirectionalLight, HemisphereLight, AmbientLight };
}

export async function createRenderer(canvas: HTMLCanvasElement, forceWebGL: boolean, legacy: ReturnType<typeof createLegacyThree>) {
  const renderer = new THREE.WebGPURenderer({ canvas, antialias: true, powerPreference: 'high-performance', forceWebGL });
  renderer.outputColorSpace = THREE.LinearSRGBColorSpace;
  renderer.library.addLight(THREE.DirectionalLightNode, legacy.DirectionalLight);
  renderer.library.addLight(THREE.HemisphereLightNode, legacy.HemisphereLight);
  renderer.library.addLight(THREE.AmbientLightNode, legacy.AmbientLight);
  await renderer.init();
  return renderer;
}
