import * as THREE from 'three';

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
  class WebGLRenderer extends THREE.WebGLRenderer {
    constructor(parameters?: THREE.WebGLRendererParameters) {
      super(parameters);
      this.outputColorSpace = THREE.LinearSRGBColorSpace;
    }
  }
  return { ...THREE, DirectionalLight, HemisphereLight, AmbientLight, WebGLRenderer };
}
