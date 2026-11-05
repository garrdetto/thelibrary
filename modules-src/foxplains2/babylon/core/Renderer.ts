/**
 * The Babylon.js side of Fox Plains 2: a WebGPU engine (WebGL2 when the
 * browser has no WebGPU adapter, or with `?gpu=webgl`), one right-handed
 * scene so every position, quaternion and winding from the shared rules and
 * Rapier carries over unchanged, a third-person camera, and an HDR
 * post-processing chain (tone mapping, bloom, SSAO, MSAA or FXAA, sharpen,
 * vignette).
 *
 * Quality tiers (`?quality=low|medium|high`, the HUD button, kept per browser):
 *   high    4x MSAA, SSAO, bloom, sharpen, 3 shadow cascades at 2048
 *   medium  FXAA, lighter SSAO, bloom, sharpen, 3 cascades at 1536
 *   low     FXAA, no SSAO, 2 cascades at 1024, 80% render scale
 * Frames that run slow lower the render scale a step at a time and raise it
 * again once there is headroom.
 *
 * Lag guards: every material and pipeline state is compiled before play
 * (`warm`: the whole scene drawn once with frustum culling off, then
 * `whenReadyAsync`), so turning the camera toward something new never
 * stalls on a shader compile; static meshes freeze their world matrices; the
 * scene never picks on pointer moves.
 */
import type { AbstractEngine } from '@babylonjs/core/Engines/abstractEngine';
import { Engine } from '@babylonjs/core/Engines/engine';
import { WebGPUEngine } from '@babylonjs/core/Engines/webgpuEngine';
import { Scene } from '@babylonjs/core/scene';
import { TargetCamera } from '@babylonjs/core/Cameras/targetCamera';
import { Color3, Color4 } from '@babylonjs/core/Maths/math.color';
import { Matrix, Vector3 } from '@babylonjs/core/Maths/math.vector';
import { ImageProcessingConfiguration } from '@babylonjs/core/Materials/imageProcessingConfiguration';
import { DefaultRenderingPipeline } from '@babylonjs/core/PostProcesses/RenderPipeline/Pipelines/defaultRenderingPipeline';
import { SSAO2RenderingPipeline } from '@babylonjs/core/PostProcesses/RenderPipeline/Pipelines/ssao2RenderingPipeline';
import type { AbstractMesh } from '@babylonjs/core/Meshes/abstractMesh';
import type { Material } from '@babylonjs/core/Materials/material';
import '@babylonjs/core/Materials/standardMaterial';
import '@babylonjs/core/PostProcesses/RenderPipeline/postProcessRenderPipelineManagerSceneComponent';
import '@babylonjs/core/Rendering/prePassRendererSceneComponent';
import '@babylonjs/core/Rendering/geometryBufferRendererSceneComponent';
import '@babylonjs/core/Engines/Extensions/engine.alpha';
import '@babylonjs/core/Engines/Extensions/engine.cubeTexture';
import '@babylonjs/core/Engines/Extensions/engine.dynamicTexture';
import '@babylonjs/core/Engines/Extensions/engine.multiRender';
import '@babylonjs/core/Engines/Extensions/engine.rawTexture';
import '@babylonjs/core/Engines/Extensions/engine.readTexture';
import '@babylonjs/core/Engines/Extensions/engine.renderTarget';
import '@babylonjs/core/Engines/Extensions/engine.renderTargetCube';
import '@babylonjs/core/Engines/Extensions/engine.renderTargetTexture';
import '@babylonjs/core/Engines/WebGPU/Extensions/engine.alpha';
import '@babylonjs/core/Engines/WebGPU/Extensions/engine.cubeTexture';
import '@babylonjs/core/Engines/WebGPU/Extensions/engine.dynamicTexture';
import '@babylonjs/core/Engines/WebGPU/Extensions/engine.multiRender';
import '@babylonjs/core/Engines/WebGPU/Extensions/engine.rawTexture';
import '@babylonjs/core/Engines/WebGPU/Extensions/engine.readTexture';
import '@babylonjs/core/Engines/WebGPU/Extensions/engine.renderTarget';
import '@babylonjs/core/Engines/WebGPU/Extensions/engine.renderTargetCube';
import '@babylonjs/core/Engines/WebGPU/Extensions/engine.renderTargetTexture';
import { store } from '../../../maplestreet/src/core/Storage';

export type Quality = 'low' | 'medium' | 'high';
export type Backend = 'webgpu' | 'webgl2';
export const QUALITIES: Quality[] = ['low', 'medium', 'high'];
const QUALITY_KEY = 'foxplains2/quality';

export interface QualitySpec { cascades: number; shadowRes: number; shadowDistance: number; ssao: number; msaa: boolean; scale: number; bloom: number; anisotropy: number }
export const QUALITY: Record<Quality, QualitySpec> = {
  low: { cascades: 2, shadowRes: 1024, shadowDistance: 120, ssao: 0, msaa: false, scale: 0.8, bloom: 0, anisotropy: 4 },
  medium: { cascades: 3, shadowRes: 1536, shadowDistance: 160, ssao: 8, msaa: false, scale: 1, bloom: 0.12, anisotropy: 8 },
  high: { cascades: 3, shadowRes: 2048, shadowDistance: 200, ssao: 12, msaa: true, scale: 1, bloom: 0.15, anisotropy: 16 },
};

/** `integrated`: the GPU the browser was given shares memory with the CPU (laptops on battery, office machines). */
function initialQuality(integrated: boolean): Quality {
  const asked = new URLSearchParams(location.search).get('quality');
  if (asked && (QUALITIES as string[]).includes(asked)) return asked as Quality;
  const saved = store.get(QUALITY_KEY);
  if (saved && (QUALITIES as string[]).includes(saved)) return saved as Quality;
  const touch = matchMedia('(pointer: coarse)').matches;
  return integrated || touch || (navigator.hardwareConcurrency ?? 8) <= 4 ? 'medium' : 'high';
}

type Adapter = { info?: { vendor?: string; architecture?: string; type?: string }; isFallbackAdapter?: boolean };
/** Integrated or software adapters (WebGPU tells us; on WebGL2 we cannot know and assume a discrete GPU). */
function isIntegrated(a: Adapter | null) {
  if (!a) return false;
  const i = a.info ?? {};
  return !!a.isFallbackAdapter || i.type === 'integrated GPU' || i.type === 'CPU' || /intel|apple|qualcomm|arm|imagination/i.test(i.vendor ?? '');
}

async function createEngine(canvas: HTMLCanvasElement): Promise<{ engine: AbstractEngine; backend: Backend; integrated: boolean }> {
  const force = new URLSearchParams(location.search).get('gpu');
  const gpu = (navigator as Navigator & { gpu?: { requestAdapter(o?: { powerPreference?: string }): Promise<Adapter | null> } }).gpu;
  if (force !== 'webgl' && gpu) {
    try {
      const adapter = (await WebGPUEngine.IsSupportedAsync) ? await gpu.requestAdapter({ powerPreference: 'high-performance' }) : null;
      if (adapter) {
        const engine = new WebGPUEngine(canvas, { antialias: false, adaptToDeviceRatio: false, powerPreference: 'high-performance', setMaximumLimits: true, enableAllFeatures: false, doNotHandleContextLost: true });
        await engine.initAsync();
        return { engine, backend: 'webgpu', integrated: isIntegrated(adapter) };
      }
    } catch (e) { console.warn('[foxplains2] WebGPU unavailable, using WebGL2', e); }
  }
  const engine = new Engine(canvas, false, { powerPreference: 'high-performance', stencil: true, alpha: false, preserveDrawingBuffer: false, antialias: false, doNotHandleContextLost: true }, false);
  if (engine.webGLVersion < 2) throw new Error('WebGL2 is required');
  return { engine, backend: 'webgl2', integrated: false };
}

export class Renderer {
  readonly engine: AbstractEngine;
  readonly scene: Scene;
  readonly camera: TargetCamera;
  readonly canvas: HTMLCanvasElement;
  readonly backend: Backend;
  quality: Quality;
  private pipeline: DefaultRenderingPipeline | null = null;
  private ssao: SSAO2RenderingPipeline | null = null;
  private scale = 1;
  private frameAvg = 1000 / 60;
  private adaptClock = 0;
  private listeners: ((q: Quality) => void)[] = [];
  private updaters: ((dt: number) => void)[] = [];
  private warmFrames = 0;
  private slowChecks = 0;
  private readonly casters = new Set<AbstractMesh>();
  /**
   * The post-process's own image-processing settings (tone mapping, exposure,
   * contrast, vignette). Materials watch the scene's settings and re-check
   * their defines on every change; keeping these separate means exposure can
   * follow the sky without touching a single material.
   */
  readonly post = new ImageProcessingConfiguration();
  /** Materials that write colour only (the sky): kept out of the SSAO pre-pass targets. */
  private prePassExcluded: Material[] = [];
  private readonly _vp = new Matrix();
  private readonly _clip = new Vector3();
  private readonly _identity = Matrix.Identity();

  private constructor(engine: AbstractEngine, backend: Backend, canvas: HTMLCanvasElement, integrated: boolean) {
    this.quality = initialQuality(integrated);
    this.engine = engine;
    this.backend = backend;
    this.canvas = canvas;
    const scene = new Scene(engine);
    this.scene = scene;
    scene.useRightHandedSystem = true;
    scene.clearColor = new Color4(0.55, 0.7, 0.86, 1);
    scene.ambientColor = new Color3(0, 0, 0);
    scene.skipPointerMovePicking = true;
    scene.skipPointerDownPicking = true;
    scene.skipPointerUpPicking = true;
    scene.constantlyUpdateMeshUnderPointer = false;
    scene.detachControl();
    scene.skipFrustumClipping = false;
    scene.autoClearDepthAndStencil = true;
    scene.blockMaterialDirtyMechanism = false;

    this.camera = new TargetCamera('camera', new Vector3(0, 5, -10), scene, true);
    this.camera.fov = (55 * Math.PI) / 180;
    this.camera.minZ = 0.15;
    this.camera.maxZ = 2600;
    this.camera.layerMask = 0x0fffffff;
    scene.activeCamera = this.camera;

    const ip = this.post;
    ip.toneMappingEnabled = true;
    ip.toneMappingType = ImageProcessingConfiguration.TONEMAPPING_KHR_PBR_NEUTRAL;
    ip.contrast = 1.06;
    ip.exposure = 1;
    ip.vignetteEnabled = true;
    ip.vignetteWeight = 0.7;
    ip.vignetteStretch = 0;
    ip.vignetteColor = new Color4(0, 0, 0, 0);
    ip.vignetteCameraFov = 0.6;
    scene.imageProcessingConfiguration.applyByPostProcess = true;
    this.applyQuality();
  }

  static async create(container: HTMLElement): Promise<Renderer> {
    const canvas = document.createElement('canvas');
    canvas.id = 'scene';
    canvas.style.touchAction = 'none';
    container.appendChild(canvas);
    const { engine, backend, integrated } = await createEngine(canvas);
    const r = new Renderer(engine, backend, canvas, integrated);
    // No CPU copies of textures and buffers are kept (doNotHandleContextLost): if the GPU is reset, start over.
    engine.onContextLostObservable.add(() => setTimeout(() => location.reload(), 1500));
    r.resize();
    addEventListener('resize', () => r.resize());
    let last = performance.now();
    engine.runRenderLoop(() => {
      const now = performance.now();
      const dt = Math.min(0.25, Math.max(0, (now - last) / 1000));
      last = now;
      for (const fn of r.updaters) fn(dt);
      r.scene.render();
      r.afterFrame();
    });
    return r;
  }

  get spec() { return QUALITY[this.quality]; }
  get renderScale() { return this.scale; }

  onUpdate(fn: (dt: number) => void) { this.updaters.push(fn); }
  onQuality(fn: (q: Quality) => void) { this.listeners.push(fn); }

  /** Meshes that cast sun shadows (the shadow generator reads this set on every rebuild). */
  addCaster(m: AbstractMesh) { this.casters.add(m); m.onDisposeObservable.addOnce(() => this.casters.delete(m)); this.casterListener?.(m, true); }
  removeCaster(m: AbstractMesh) { if (this.casters.delete(m)) this.casterListener?.(m, false); }
  get shadowCasters(): ReadonlySet<AbstractMesh> { return this.casters; }
  casterListener: ((m: AbstractMesh, add: boolean) => void) | null = null;

  private resize() {
    const dpr = Math.min(devicePixelRatio || 1, 2);
    this.engine.setHardwareScalingLevel(1 / (dpr * this.scale));
    this.engine.resize();
  }

  setQuality(q: Quality) {
    if (q === this.quality) return;
    this.quality = q;
    store.set(QUALITY_KEY, q);
    this.applyQuality();
    for (const fn of this.listeners) fn(q);
    this.warm(3);
  }

  cycleQuality() {
    this.setQuality(QUALITIES[(QUALITIES.indexOf(this.quality) + 1) % QUALITIES.length]);
    return this.quality;
  }

  private applyQuality() {
    const s = this.spec, scene = this.scene;
    this.pipeline?.dispose();
    this.ssao?.dispose();
    this.ssao = null;
    if (s.ssao > 0) {
      try {
        const ssao = new SSAO2RenderingPipeline('ssao', scene, { ssaoRatio: 0.5, blurRatio: 0.5 }, [this.camera], false);
        ssao.radius = 1.6;
        ssao.totalStrength = 0.9;
        ssao.base = 0.12;
        ssao.samples = s.ssao;
        ssao.maxZ = 160;
        ssao.minZAspect = 0.4;
        ssao.expensiveBlur = this.quality === 'high';
        ssao.bilateralSamples = this.quality === 'high' ? 12 : 8;
        this.ssao = ssao;
        this.applyPrePassExclusions();
      } catch (e) { console.warn('[foxplains2] SSAO unavailable', e); }
    }
    const p = new DefaultRenderingPipeline('main', true, scene, [this.camera]);
    p.samples = s.msaa ? 4 : 1;
    p.fxaaEnabled = !s.msaa;
    p.bloomEnabled = s.bloom > 0;
    p.bloomThreshold = 1.1;
    p.bloomWeight = s.bloom;
    p.bloomKernel = 64;
    p.bloomScale = 0.5;
    p.sharpenEnabled = this.quality !== 'low';
    if (p.sharpenEnabled) { p.sharpen.edgeAmount = 0.18; p.sharpen.colorAmount = 1; }
    p.imageProcessingEnabled = true;
    if (p.imageProcessing) p.imageProcessing.imageProcessingConfiguration = this.post;
    this.pipeline = p;
    this.scale = s.scale;
    this.resize();
  }

  /** Keeps a colour-only material (the sky) out of the pre-pass depth and normal targets SSAO reads. */
  excludeFromPrePass(m: Material) { this.prePassExcluded.push(m); this.applyPrePassExclusions(); }

  private applyPrePassExclusions() {
    const pp = this.scene.prePassRenderer;
    if (!pp) return;
    for (const m of this.prePassExcluded) if (!pp.excludedMaterials.includes(m)) pp.excludedMaterials.push(m);
    // Pixels nothing writes depth to (the sky) read as far away, so SSAO leaves them alone.
    pp.useSpecificClearForDepthTexture = true;
    (pp as unknown as { _clearDepthColor: Color4 })._clearDepthColor = new Color4(1e8, 1e8, 1e8, 1);
  }

  /** Exposure for the tone mapper (post only: no material sees it). */
  setExposure(e: number) { if (Math.abs(this.post.exposure - e) > 0.002) this.post.exposure = e; }

  /** Night-time eye adaptation: bloom carries lamps and windows a little further after dark. */
  setNight(night: number) {
    const p = this.pipeline;
    if (!p || !p.bloomEnabled) return;
    const want = this.spec.bloom * (1 + night * 1.6);
    if (Math.abs(p.bloomWeight - want) > 0.004) p.bloomWeight = want;
  }

  /**
   * Draws everything once with frustum culling off for a few frames, so every
   * material, shadow depth shader and pipeline that could ever be on screen
   * is compiled now and not the first time the camera turns toward it.
   */
  warm(frames = 2) {
    this.warmFrames = Math.max(this.warmFrames, frames);
    this.scene.skipFrustumClipping = true;
  }

  /** True while the warm-up draws everything (shadow culling stands aside too). */
  get warming() { return this.warmFrames > 0; }

  /**
   * Waits until every material in the scene has compiled (call once the
   * world is built), then until the GPU has worked through the warm-up
   * frames, so that backlog is spent behind the loading screen and not in the
   * first second of play.
   */
  async ready() {
    this.warm(3);
    await this.scene.whenReadyAsync(true);
    await new Promise(res => setTimeout(res, 100));
    await this.gpuIdle();
  }

  /** Resolves once the GPU has finished everything submitted so far. */
  async gpuIdle() {
    const dev = (this.engine as unknown as { _device?: { queue: { onSubmittedWorkDone(): Promise<void> } } })._device;
    if (dev) { await dev.queue.onSubmittedWorkDone(); return; }
    const gl = (this.engine as unknown as { _gl?: WebGL2RenderingContext })._gl;
    if (!gl) return;
    const sync = gl.fenceSync(gl.SYNC_GPU_COMMANDS_COMPLETE, 0);
    gl.flush();
    for (let i = 0; i < 400 && sync; i++) {
      const st = gl.clientWaitSync(sync, 0, 0);
      if (st === gl.ALREADY_SIGNALED || st === gl.CONDITION_SATISFIED || st === gl.WAIT_FAILED) break;
      await new Promise(res => setTimeout(res, 25));
    }
    if (sync) gl.deleteSync(sync);
  }

  private afterFrame() {
    if (this.warmFrames > 0 && --this.warmFrames === 0) this.scene.skipFrustumClipping = false;
  }

  /** Lowers the render scale when frames are slow (and raises it back when there is room). */
  adapt(dt: number) {
    if (dt <= 0) return;
    this.frameAvg += (dt * 1000 - this.frameAvg) * 0.05;
    this.adaptClock += dt;
    if (this.adaptClock < 2.5) return;
    this.adaptClock = 0;
    const top = this.spec.scale;
    let next = this.scale;
    this.slowChecks = this.frameAvg > 26 ? this.slowChecks + 1 : 0;
    if (this.slowChecks >= 2 && this.scale > 0.6) { next = Math.max(0.6, this.scale - 0.1); this.slowChecks = 0; }
    else if (this.frameAvg < 14 && this.scale < top) next = Math.min(top, this.scale + 0.05);
    if (next !== this.scale) { this.scale = next; this.resize(); }
  }

  /** World → CSS pixel position, or null when behind the camera. Reuses `out`. */
  toScreen(p: { x: number; y: number; z: number }, out: Vector3): Vector3 | null {
    this.camera.getViewMatrix().multiplyToRef(this.camera.getProjectionMatrix(), this._vp);
    const m = this._vp.m;
    const x = p.x * m[0] + p.y * m[4] + p.z * m[8] + m[12];
    const y = p.x * m[1] + p.y * m[5] + p.z * m[9] + m[13];
    const w = p.x * m[3] + p.y * m[7] + p.z * m[11] + m[15];
    if (w <= 0.01) return null;
    const cw = this.canvas.clientWidth, ch = this.canvas.clientHeight;
    out.set((x / w * 0.5 + 0.5) * cw, (1 - (y / w * 0.5 + 0.5)) * ch, w);
    this._clip.copyFrom(out);
    return out;
  }

  /** A world-space ray through a CSS pixel. */
  ray(x: number, y: number, origin: Vector3, dir: Vector3) {
    const r = this.scene.createPickingRay(x, y, this._identity, this.camera);
    origin.copyFrom(r.origin);
    dir.copyFrom(r.direction);
  }

  get stats() {
    const e = this.engine as AbstractEngine & { _drawCalls?: { current: number } };
    return { backend: this.backend, meshes: this.scene.getActiveMeshes().length, drawCalls: e._drawCalls?.current ?? null };
  }
}
