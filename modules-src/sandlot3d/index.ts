import { createLegacyThree } from './three-legacy';
import { createAdaptiveResolution } from '../_shared/adaptive-resolution.js';
import { batchStatic } from '../_shared/static-batch.js';
import mainUrl from './main.js?url';

declare global {
  interface Window {
    THREE: ReturnType<typeof createLegacyThree>;
    __adaptiveResolution: typeof createAdaptiveResolution;
    __batchStatic: typeof batchStatic;
  }
}

window.THREE = createLegacyThree();
window.__adaptiveResolution = createAdaptiveResolution;
window.__batchStatic = batchStatic;

const script = document.createElement('script');
script.src = mainUrl;
document.body.appendChild(script);
