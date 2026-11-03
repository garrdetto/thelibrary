/**
 * Shader warm-up off the critical path. The first time three.js draws a new
 * material/geometry combination it compiles a pipeline synchronously, which
 * stalls that frame (a hitch every time a neighbor or a car comes into view).
 * `prewarm(obj)` compiles everything under `obj` with `renderer.compileAsync`
 * (parallel shader compilation where the browser has it) before the caller
 * shows it. Until Game wires the renderer in, or if compiling fails or takes
 * longer than MAX_WAIT_MS, it simply resolves and the object is drawn anyway.
 */
import type * as THREE from 'three/webgpu';

const MAX_WAIT_MS = 1500;

interface Target { renderer: { compileAsync(o: THREE.Object3D, c: THREE.Camera, s?: THREE.Scene | null): Promise<unknown> }; camera: THREE.Camera; scene: THREE.Scene }
let target: Target | null = null;

export function setPrewarmTarget(t: Target | null) { target = t; }

export function prewarm(obj: THREE.Object3D): Promise<void> {
  if (!target) return Promise.resolve();
  const { renderer, camera, scene } = target;
  return Promise.race([
    renderer.compileAsync(obj, camera, scene).then(() => undefined, () => undefined),
    new Promise<void>(r => setTimeout(r, MAX_WAIT_MS)),
  ]);
}
