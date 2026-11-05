/**
 * Kestrel County's PlayCanvas renderer: the Fox Plains 2 setup (WebGL2,
 * CameraFrame in HDR with TAA, SSAO, bloom and grading, quality tiers and
 * adaptive render scale) retuned for the glossy clipart look: Neutral tone
 * mapping, richer vibrance, lifted cool shadows, a lighter vignette and a far
 * clip that reaches the horizon from a helicopter.
 */
import * as pc from 'playcanvas';
import { store } from '../../../maplestreet/src/core/Storage';
import { GRADE, LIGHT } from '../../config';

export type Quality = 'low' | 'medium' | 'high';
export const QUALITIES: Quality[] = ['low', 'medium', 'high'];
const QUALITY_KEY = 'county/quality';

export interface QualitySpec { cascades: number; shadowRes: number; shadowDistance: number; ssao: boolean; taa: boolean; samples: number; scale: number; bloom: number }
export const QUALITY: Record<Quality, QualitySpec> = {
  low: { cascades: 2, shadowRes: 1024, shadowDistance: 140, ssao: false, taa: false, samples: 1, scale: 0.8, bloom: GRADE.bloom.low },
  medium: { cascades: 3, shadowRes: 2048, shadowDistance: 200, ssao: true, taa: false, samples: 4, scale: 1, bloom: GRADE.bloom.medium },
  high: { cascades: 4, shadowRes: 2048, shadowDistance: 260, ssao: true, taa: true, samples: 1, scale: 1, bloom: GRADE.bloom.high },
};

function initialQuality(): Quality {
  const asked = new URLSearchParams(location.search).get('quality');
  if (asked && (QUALITIES as string[]).includes(asked)) return asked as Quality;
  const saved = store.get(QUALITY_KEY);
  if (saved && (QUALITIES as string[]).includes(saved)) return saved as Quality;
  const touch = matchMedia('(pointer: coarse)').matches;
  return touch || (navigator.hardwareConcurrency ?? 8) <= 4 ? 'medium' : 'high';
}

export class Renderer {
  readonly app: pc.AppBase;
  readonly device: pc.GraphicsDevice;
  readonly camera: pc.Entity;
  readonly skyLayer: pc.Layer;
  frame: pc.CameraFrame | null = null;
  quality: Quality = initialQuality();
  private scale = 1;
  private frameAvg = 1000 / 60;
  private adaptClock = 0;
  private listeners: ((q: Quality) => void)[] = [];

  private constructor(app: pc.AppBase, device: pc.GraphicsDevice) {
    this.app = app;
    this.device = device;
    const layers = app.scene.layers;
    this.skyLayer = new pc.Layer({ name: 'CountySky' });
    const skybox = layers.getLayerById(pc.LAYERID_SKYBOX)!;
    layers.insertOpaque(this.skyLayer, layers.getOpaqueIndex(skybox));

    this.camera = new pc.Entity('camera');
    this.camera.addComponent('camera', {
      fov: 50, nearClip: 0.15, farClip: LIGHT.farClip, clearColor: new pc.Color(0.6, 0.76, 0.92),
      layers: [pc.LAYERID_WORLD, pc.LAYERID_DEPTH, this.skyLayer.id, pc.LAYERID_IMMEDIATE, pc.LAYERID_UI],
    });
    app.root.addChild(this.camera);

    const lighting = app.scene.lighting;
    lighting.shadowsEnabled = false;
    lighting.cookiesEnabled = false;
    lighting.areaLightsEnabled = false;
    lighting.maxLightsPerCell = 12;
    lighting.cells = new pc.Vec3(12, 4, 12);
    this.applyQuality();
  }

  static async create(container: HTMLElement): Promise<Renderer> {
    const canvas = document.createElement('canvas');
    canvas.id = 'scene';
    container.appendChild(canvas);
    const device = await pc.createGraphicsDevice(canvas, { deviceTypes: [pc.DEVICETYPE_WEBGL2], antialias: false, powerPreference: 'high-performance', alpha: false });
    device.maxPixelRatio = Math.min(devicePixelRatio || 1, 2);
    const opts = new pc.AppOptions();
    opts.graphicsDevice = device;
    opts.componentSystems = [pc.RenderComponentSystem, pc.CameraComponentSystem, pc.LightComponentSystem];
    opts.resourceHandlers = [pc.TextureHandler, pc.ContainerHandler];
    const app = new pc.AppBase(canvas);
    app.init(opts);
    app.setCanvasFillMode(pc.FILLMODE_FILL_WINDOW);
    app.setCanvasResolution(pc.RESOLUTION_AUTO);
    app.maxDeltaTime = 0.25;
    addEventListener('resize', () => app.resizeCanvas());
    const r = new Renderer(app, device);
    app.start();
    return r;
  }

  get spec() { return QUALITY[this.quality]; }

  onQuality(fn: (q: Quality) => void) { this.listeners.push(fn); }

  setQuality(q: Quality) {
    if (q === this.quality) return;
    this.quality = q;
    store.set(QUALITY_KEY, q);
    this.applyQuality();
    for (const fn of this.listeners) fn(q);
  }

  cycleQuality() {
    this.setQuality(QUALITIES[(QUALITIES.indexOf(this.quality) + 1) % QUALITIES.length]);
    return this.quality;
  }

  private applyQuality() {
    const s = this.spec;
    this.frame?.destroy();
    const f = new pc.CameraFrame(this.app, this.camera.camera!);
    f.rendering.toneMapping = pc.TONEMAP_NEUTRAL;
    f.rendering.samples = s.samples;
    f.rendering.sharpness = s.taa ? 0.5 : 0.2;
    f.rendering.renderTargetScale = s.scale;
    f.taa.enabled = s.taa;
    f.taa.jitter = 1;
    f.ssao.type = s.ssao ? pc.SSAOTYPE_LIGHTING : pc.SSAOTYPE_NONE;
    f.ssao.radius = GRADE.ssao.radius;
    f.ssao.intensity = GRADE.ssao.intensity;
    f.ssao.power = GRADE.ssao.power;
    f.ssao.samples = this.quality === 'high' ? 14 : 8;
    f.ssao.minAngle = 12;
    f.ssao.blurEnabled = !s.taa;
    f.ssao.randomize = s.taa;
    f.bloom.intensity = s.bloom;
    f.bloom.blurLevel = 12;
    f.grading.enabled = true;
    f.grading.saturation = GRADE.saturation;
    f.grading.contrast = GRADE.contrast;
    f.grading.brightness = GRADE.brightness;
    f.vignette.intensity = GRADE.vignette;
    f.vignette.inner = 0.6;
    f.vignette.outer = 1.35;
    f.vignette.curvature = 0.6;
    f.colorEnhance.enabled = true;
    f.colorEnhance.vibrance = GRADE.vibrance;
    f.colorEnhance.shadows = GRADE.shadows;
    f.colorEnhance.dehaze = GRADE.dehaze;
    f.update();
    this.frame = f;
    this.scale = s.scale;
  }

  /** Lamps, windows and nav lights bloom a little further after dark. */
  setNight(night: number) {
    if (!this.frame) return;
    const base = this.spec.bloom;
    const want = base > 0 ? base * (1 + night * GRADE.bloom.night) : 0;
    if (Math.abs(this.frame.bloom.intensity - want) > 0.0015) { this.frame.bloom.intensity = want; this.frame.update(); }
  }

  /** Lowers the render scale when frames are slow and raises it back when there is room. */
  adapt(dt: number) {
    if (!this.frame || dt <= 0) return;
    this.frameAvg += (dt * 1000 - this.frameAvg) * 0.05;
    this.adaptClock += dt;
    if (this.adaptClock < 1.5) return;
    this.adaptClock = 0;
    const top = this.spec.scale;
    let next = this.scale;
    if (this.frameAvg > 26 && this.scale > 0.55) next = Math.max(0.55, this.scale - 0.1);
    else if (this.frameAvg < 15 && this.scale < top) next = Math.min(top, this.scale + 0.05);
    if (next !== this.scale) {
      this.scale = next;
      this.frame.rendering.renderTargetScale = next;
      this.frame.update();
    }
  }

  get frameMs() { return this.frameAvg; }
  get renderScale() { return this.scale; }
}
