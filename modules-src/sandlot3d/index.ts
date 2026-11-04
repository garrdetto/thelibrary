import { createLegacyThree } from './three-legacy';
import { createAdaptiveResolution } from '../_shared/adaptive-resolution.js';
import mainUrl from './main.js?url';

declare global {
  interface Window {
    THREE: ReturnType<typeof createLegacyThree>;
    __adaptiveResolution: typeof createAdaptiveResolution;
  }
}

window.THREE = createLegacyThree();
window.__adaptiveResolution = createAdaptiveResolution;

const script = document.createElement('script');
script.src = mainUrl;
document.body.appendChild(script);
