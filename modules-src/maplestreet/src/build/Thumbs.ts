/**
 * Catalog thumbnails rendered from the real furniture models, one per frame
 * in the background, so the Buy catalog shows the actual sofa you'll get.
 * Each render goes to a small off-screen target with its own studio lights;
 * pixels are read back asynchronously and handed to the HUD as data URLs.
 */
import * as THREE from 'three/webgpu';
import { CATALOG } from '../../shared/Catalog';
import { buildFurniture } from './Furniture';
import { whenCustomModelReady } from './CustomModels';

const SIZE = 256;          // rendered size (supersampled)
const OUT = 128;           // stored thumbnail size

export class ThumbnailRenderer {
  private scene = new THREE.Scene();
  private cam = new THREE.PerspectiveCamera(30, 1, 0.05, 200);
  private rt = new THREE.RenderTarget(SIZE, SIZE);
  private queue: string[] = [];
  private busy = false;
  private failed = false;
  readonly urls = new Map<string, string>();

  constructor(private renderer: THREE.WebGPURenderer, private onReady: (id: string, url: string) => void) {
    this.scene.background = new THREE.Color(0xe9e4da);
    this.scene.add(new THREE.HemisphereLight(0xffffff, 0x8a7f70, 2.2));
    const key = new THREE.DirectionalLight(0xffffff, 2.6);
    key.position.set(-3, 6, 5);
    this.scene.add(key);
    const floor = new THREE.Mesh(new THREE.CircleGeometry(30, 40).rotateX(-Math.PI / 2), new THREE.MeshStandardMaterial({ color: 0xd8d1c4, roughness: 1 }));
    floor.position.y = -0.002;
    this.scene.add(floor);
  }

  request(ids: string[]) {
    for (const id of ids) if (!this.urls.has(id) && !this.queue.includes(id) && CATALOG[id]) this.queue.push(id);
  }

  /** Call once per frame, after the main render. Renders at most one item. */
  pump() {
    if (this.busy || this.failed || !this.queue.length) return;
    const id = this.queue.shift()!;
    this.busy = true;
    this.renderOne(id)
      .then(url => { this.urls.set(id, url); this.onReady(id, url); })
      .catch(e => { this.failed = true; console.warn('[thumbs] disabled:', e); })
      .finally(() => { this.busy = false; });
  }

  private async renderOne(id: string): Promise<string> {
    const item = CATALOG[id];
    if (item.custom) await whenCustomModelReady(id);
    const model = buildFurniture(id);
    this.scene.add(model);
    const box = new THREE.Box3().setFromObject(model);
    const size = box.getSize(new THREE.Vector3()), center = box.getCenter(new THREE.Vector3());
    const radius = Math.max(0.35, size.length() / 2);
    const dist = radius / Math.sin(THREE.MathUtils.degToRad(this.cam.fov / 2)) * 0.92;
    // Wall décor is seen face-on; everything else from a three-quarter view.
    const dir = item.layer === 'wall' ? new THREE.Vector3(0.25, 0.12, 1) : item.layer === 'ceiling' ? new THREE.Vector3(0.7, -0.35, 1) : new THREE.Vector3(0.85, 0.75, 1);
    this.cam.position.copy(center).addScaledVector(dir.normalize(), dist);
    this.cam.lookAt(center);

    const prev = this.renderer.getRenderTarget();
    this.renderer.setRenderTarget(this.rt);
    this.renderer.render(this.scene, this.cam);
    this.renderer.setRenderTarget(prev);
    this.scene.remove(model);
    model.traverse(o => { const m = o as THREE.Mesh; if (m.isMesh) m.geometry.dispose(); });

    const px = await this.renderer.readRenderTargetPixelsAsync(this.rt, 0, 0, SIZE, SIZE) as Uint8Array;
    const c = document.createElement('canvas');
    c.width = c.height = SIZE;
    const g = c.getContext('2d')!;
    const img = g.createImageData(SIZE, SIZE);
    const flip = (this.renderer as unknown as { backend: { isWebGLBackend?: boolean } }).backend.isWebGLBackend === true;
    // The off-screen target holds linear light: tone-map and gamma-encode for the 2D canvas.
    const enc = (v: number) => { const l = v / 255; const t = l / (1 + l * 0.25) * 1.25; return Math.round(255 * Math.min(1, Math.pow(Math.max(0, t), 1 / 2.2))); };
    for (let yy = 0; yy < SIZE; yy++) {
      const src = (flip ? SIZE - 1 - yy : yy) * SIZE * 4, dst = yy * SIZE * 4;
      for (let x = 0; x < SIZE * 4; x += 4) {
        img.data[dst + x] = enc(px[src + x]); img.data[dst + x + 1] = enc(px[src + x + 1]); img.data[dst + x + 2] = enc(px[src + x + 2]); img.data[dst + x + 3] = 255;
      }
    }
    g.putImageData(img, 0, 0);
    const out = document.createElement('canvas');
    out.width = out.height = OUT;
    const og = out.getContext('2d')!;
    og.imageSmoothingQuality = 'high';
    og.drawImage(c, 0, 0, OUT, OUT);
    return out.toDataURL('image/webp', 0.86);
  }
}
