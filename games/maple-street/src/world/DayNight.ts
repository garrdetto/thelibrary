/**
 * Day/night cycle: physically-based sky (SkyMesh, Preetham model), a sun
 * directional light that casts the cascaded-style "follow the player"
 * shadow, a cool moonlight at night, hemisphere fill, fog tint and stars.
 * Time is driven by the server clock so every neighbor shares the sunset.
 */
import * as THREE from 'three/webgpu';
import { noNormalsMRT } from '../core/Engine';

const DAY = new THREE.Color(0xfff3e2), DUSK = new THREE.Color(0xff9a52), MOON = new THREE.Color(0x9bb4ff);
const SKY_DAY = new THREE.Color(0xa9c9ef), SKY_DUSK = new THREE.Color(0xe7a27a), SKY_NIGHT = new THREE.Color(0x0a1022);
const SHADOW_EXTENT = 55;
const SHADOW_MAP = 4096;

export class DayNight {
  hours = 8.5;
  /** 0 = full day, 1 = full night. Read by street lamps, headlights, windows. */
  night = 0;
  readonly sun = new THREE.DirectionalLight(0xffffff, 3);
  readonly hemi = new THREE.HemisphereLight(0xbcd6ff, 0x3d4a2a, 0.9);
  private sky: (THREE.Mesh & Record<string, { value: unknown }>) | null = null;
  private stars: THREE.Points;
  private fog: THREE.Fog;
  private dir = new THREE.Vector3();
  private envScene = new THREE.Scene();
  private envSky: (THREE.Mesh & Record<string, { value: unknown }>) | null = null;
  private pmrem: THREE.PMREMGenerator | null = null;
  private envTarget: THREE.RenderTarget | null = null;
  private envHours = -10;
  private dayK = 1;

  constructor(private scene: THREE.Scene) {
    const s = this.sun;
    s.castShadow = true;
    s.shadow.mapSize.set(SHADOW_MAP, SHADOW_MAP);
    const c = s.shadow.camera;
    c.left = c.bottom = -SHADOW_EXTENT; c.right = c.top = SHADOW_EXTENT;
    c.near = 1; c.far = 400;
    s.shadow.bias = -0.0004;
    s.shadow.normalBias = 0.035;
    scene.add(s, s.target, this.hemi);

    this.fog = new THREE.Fog(0xa9c9ef, 180, 900);
    scene.fog = this.fog;
    scene.background = SKY_DAY.clone();

    const starGeo = new THREE.BufferGeometry();
    const p = new Float32Array(3000 * 3);
    for (let i = 0; i < 3000; i++) {
      const v = new THREE.Vector3().randomDirection(); v.y = Math.abs(v.y) + 0.05; v.normalize().multiplyScalar(3000);
      p.set([v.x, v.y, v.z], i * 3);
    }
    starGeo.setAttribute('position', new THREE.BufferAttribute(p, 3));
    this.stars = new THREE.Points(starGeo, noNormalsMRT(new THREE.PointsMaterial({ color: 0xffffff, size: 2.2, sizeAttenuation: false, transparent: true, opacity: 0, fog: false, depthWrite: false })));
    scene.add(this.stars);
  }

  async initSky() {
    try {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { SkyMesh }: any = await import('three/addons/objects/SkyMesh.js');
      // SkyMesh writes a raw fragmentNode, which bypasses the AO normal buffer;
      // feeding the same node in as colorNode keeps it on the standard path.
      const asColor = (m: THREE.Mesh) => {
        const mat = m.material as THREE.Material & { colorNode: unknown; fragmentNode: unknown; fog: boolean };
        mat.colorNode = mat.fragmentNode; mat.fragmentNode = null; mat.fog = false;
      };
      const sky = new SkyMesh();
      sky.scale.setScalar(4500);
      asColor(sky);
      sky.turbidity.value = 2.5; sky.rayleigh.value = 2.4;
      sky.mieCoefficient.value = 0.004; sky.mieDirectionalG.value = 0.85;
      this.scene.add(sky);
      this.sky = sky;
      // A second sky in its own little scene feeds the PMREM environment map, so
      // car paint, glass and every PBR surface reflect the real sky color.
      const envSky = new SkyMesh();
      envSky.scale.setScalar(90);
      asColor(envSky);
      envSky.turbidity.value = 2.5; envSky.rayleigh.value = 2.4;
      envSky.mieCoefficient.value = 0.004; envSky.mieDirectionalG.value = 0.85;
      const ground = new THREE.Mesh(new THREE.CircleGeometry(80, 32).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({ color: 0x3f5530 }));
      ground.position.y = -2;
      this.envScene.add(envSky, ground);
      this.envSky = envSky;
    } catch (e) {
      console.warn('[DayNight] SkyMesh unavailable, using gradient background', e);
    }
  }

  /** `serverHours` when provided gently corrects drift toward the authority clock. */
  update(dt: number, focus: THREE.Vector3, dayLengthSec: number, serverHours?: number) {
    this.hours = (this.hours + (dt * 24) / dayLengthSec) % 24;
    if (serverHours !== undefined) {
      let diff = serverHours - this.hours;
      if (diff > 12) diff -= 24; if (diff < -12) diff += 24;
      this.hours = (this.hours + diff * Math.min(1, dt * 2) + 24) % 24;
    }

    // Sun path: rises in the east (+x) at 6:00, peaks ~68° at noon, sets west at 18:00.
    const theta = ((this.hours - 6) / 24) * Math.PI * 2;
    const elev = Math.sin(theta);
    this.dir.set(Math.cos(theta), elev * 0.93, 0.38).normalize();

    const dayK = THREE.MathUtils.smoothstep(elev, -0.08, 0.22);
    this.dayK = dayK;
    this.night = 1 - THREE.MathUtils.smoothstep(elev, -0.18, 0.05);
    const duskK = 1 - THREE.MathUtils.smoothstep(Math.abs(elev), 0.0, 0.3);

    const light = this.sun;
    if (elev > -0.05) {
      light.color.copy(DAY).lerp(DUSK, duskK * 0.85);
      light.intensity = 3.6 * dayK + 0.05;
    } else {
      this.dir.multiplyScalar(-1);                    // moon opposite the sun
      this.dir.y = Math.max(this.dir.y, 0.35);
      light.color.copy(MOON);
      light.intensity = 0.22;
    }

    // Texel-snapped shadow follow keeps edges from shimmering as you drive.
    const texel = (SHADOW_EXTENT * 2) / SHADOW_MAP;
    const fx = Math.round(focus.x / texel) * texel, fz = Math.round(focus.z / texel) * texel;
    light.target.position.set(fx, 0, fz);
    light.position.set(fx + this.dir.x * 160, this.dir.y * 160, fz + this.dir.z * 160);

    if (!this.envSky) this.hemi.intensity = 0.12 + 0.8 * dayK;
    this.hemi.color.copy(SKY_NIGHT).lerp(SKY_DAY, dayK);

    const skyCol = new THREE.Color().copy(SKY_NIGHT).lerp(SKY_DAY, dayK).lerp(SKY_DUSK, duskK * 0.5 * dayK + duskK * 0.25);
    this.fog.color.copy(skyCol);
    if (this.sky) {
      (this.sky.sunPosition.value as THREE.Vector3).set(Math.cos(theta), elev, 0.38).normalize();
      this.sky.visible = this.night < 0.97;
      (this.scene.background as THREE.Color | null)?.copy?.(skyCol);
    } else {
      (this.scene.background as THREE.Color).copy(skyCol);
    }
    (this.stars.material as THREE.PointsMaterial).opacity = this.night * 0.9;
    this.stars.position.copy(focus);
  }

  /** Re-bake the sky reflection every quarter in-game hour (cheap: one 256px cube). */
  updateEnvironment(renderer: THREE.WebGPURenderer) {
    if (!this.envSky) return;
    const scene = this.scene as THREE.Scene & { environmentIntensity?: number };
    scene.environmentIntensity = 0.05 + 0.32 * this.dayK;
    this.hemi.intensity = 0.04 + 0.22 * this.dayK;          // the sky reflection now carries most of the fill light
    let dh = Math.abs(this.hours - this.envHours);
    if (dh > 12) dh = 24 - dh;
    if (dh < 0.25) return;
    this.envHours = this.hours;
    try {
      const theta = ((this.hours - 6) / 24) * Math.PI * 2;
      (this.envSky.sunPosition.value as THREE.Vector3).set(Math.cos(theta), Math.sin(theta), 0.38).normalize();
      this.pmrem ??= new THREE.PMREMGenerator(renderer);
      this.envTarget = this.pmrem.fromScene(this.envScene, 0, 0.1, 100, this.envTarget);
      this.scene.environment = this.envTarget.texture;
    } catch (e) {
      console.warn('[DayNight] environment bake failed', e);
      this.envSky = null;
    }
  }

  get clockLabel() {
    const h = Math.floor(this.hours), m = Math.floor((this.hours - h) * 60);
    const ampm = h >= 12 ? 'PM' : 'AM';
    return `${((h + 11) % 12) + 1}:${m.toString().padStart(2, '0')} ${ampm}`;
  }
}
