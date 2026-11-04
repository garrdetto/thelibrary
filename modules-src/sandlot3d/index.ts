import { createLegacyThree } from './three-legacy';
import { batchStatic } from '../_shared/static-batch.js';
import mainUrl from './main.js?url';

declare global {
  interface Window {
    THREE: ReturnType<typeof createLegacyThree>;
    __batchStatic: typeof batchStatic;
  }
}

window.THREE = createLegacyThree();
window.__batchStatic = batchStatic;

const script = document.createElement('script');
script.src = mainUrl;
document.body.appendChild(script);
