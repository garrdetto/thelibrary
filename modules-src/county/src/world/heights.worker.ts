/** Samples the county's ground on a grid off the main thread; the layout is rebuilt here from the same shared code. */
import { county } from '../../shared/County';

const { terrain } = county();

self.onmessage = (ev: MessageEvent<{ id: number; x0: number; z0: number; n: number; step: number }>) => {
  const { id, x0, z0, n, step } = ev.data, w = n + 1, h = new Float32Array(w * w);
  for (let j = 0; j < w; j++) for (let i = 0; i < w; i++) h[j * w + i] = terrain.heightAt(x0 + i * step, z0 + j * step);
  (self as unknown as Worker).postMessage({ id, h }, [h.buffer]);
};
