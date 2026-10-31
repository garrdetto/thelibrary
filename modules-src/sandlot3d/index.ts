import { createLegacyThree } from './three-legacy';
import mainUrl from './main.js?url';

declare global {
  interface Window {
    THREE: ReturnType<typeof createLegacyThree>;
  }
}

window.THREE = createLegacyThree();

const script = document.createElement('script');
script.src = mainUrl;
document.body.appendChild(script);
