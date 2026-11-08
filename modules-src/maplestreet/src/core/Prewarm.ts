/**
 * Shader warm-up off the critical path. The first time three.js draws a new
 * material/geometry combination it compiles a pipeline synchronously, which
 * stalls that frame (a hitch every time a neighbor or a car comes into view).
 * `prewarm(obj)` compiles everything under `obj` with `renderer.compileAsync`
 * (parallel shader compilation where the browser has it) before the caller
 * shows it. Until Game wires the renderer in, or if compiling fails or takes
 * longer than MAX_WAIT_MS, it simply resolves and the object is drawn anyway.
 *
 * Two traps in `compileAsync` that this module works around:
 *
 *  - It frustum-culls with the camera it is given, so anything behind the
 *    camera was silently skipped and compiled later, synchronously, the moment
 *    the player turned around. `compileWhole` switches frustum culling off for
 *    the duration of the call. The scene walk happens synchronously inside the
 *    call (before its first await), so the flags can be restored right away.
 *  - It compiles for the renderer's current output, without the MRT the GTAO
 *    scene pass renders with, so with AO on its shaders never match the ones a
 *    frame actually uses. Game only sets a target when AO is off; with AO on,
 *    WorldChunks warms parts by drawing them once instead (`WorldChunks.cull`).
 */
import type * as THREE from 'three/webgpu';

const MAX_WAIT_MS = 1500;

export interface Compiler { compileAsync(o: THREE.Object3D, c: THREE.Camera, s?: THREE.Scene | null): Promise<unknown> }
interface Target { renderer: Compiler; camera: THREE.Camera; scene: THREE.Scene }
let target: Target | null = null;

export function setPrewarmTarget(t: Target | null) { target = t; }

const _culled: THREE.Object3D[] = [];

/** `compileAsync` for every mesh under `obj`, in view or not. */
export function compileWhole(compiler: Compiler, obj: THREE.Object3D, camera: THREE.Camera, scene: THREE.Scene | null): Promise<unknown> {
  const wasVisible = obj.visible;
  obj.visible = true;
  obj.traverse(o => { if (o.frustumCulled) { o.frustumCulled = false; _culled.push(o); } });
  try {
    return compiler.compileAsync(obj, camera, scene);
  } finally {
    for (const o of _culled) o.frustumCulled = true;
    _culled.length = 0;
    obj.visible = wasVisible;
  }
}

export function prewarm(obj: THREE.Object3D): Promise<void> {
  if (!target) return Promise.resolve();
  const { renderer, camera, scene } = target;
  return Promise.race([
    compileWhole(renderer, obj, camera, scene).then(() => undefined, () => undefined),
    new Promise<void>(r => setTimeout(r, MAX_WAIT_MS)),
  ]);
}
