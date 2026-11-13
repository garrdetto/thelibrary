/**
 * What vehicles reflect. The town's own environment cube is the sky alone, so
 * a car's paint, glass and chrome had nothing to mirror: no horizon, no ground,
 * and every panel came out the same flat tone. This bakes a second cube for
 * vehicles only: Rack & Reel's sky over a dark treeline, a lit ground plane
 * and a paler road apron, so body sides pick up the bright-over-dark break
 * along the horizon and hoods and roofs carry the sky.
 *
 * The stand-in ground and treeline are ordinary lit meshes that exist only
 * while the cube is drawn; they follow the sun and the night the same way the
 * world does. The cube is re-baked when the sky has moved on (TownGfx).
 */
import { ReflectionProbe } from '@babylonjs/core/Probes/reflectionProbe';
import { StandardMaterial } from '@babylonjs/core/Materials/standardMaterial';
import { Color3 } from '@babylonjs/core/Maths/math.color';
import { CreateCylinder } from '@babylonjs/core/Meshes/Builders/cylinderBuilder';
import { CreateDisc } from '@babylonjs/core/Meshes/Builders/discBuilder';
import { Mesh } from '@babylonjs/core/Meshes/mesh';
import type { BaseTexture } from '@babylonjs/core/Materials/Textures/baseTexture';
import type { Scene } from '@babylonjs/core/scene';

const SIZE = 256;
const EYE = 1.3;
const AT_Y = 60;

interface Band { radius: number; bottom: number; top: number; color: [number, number, number] }
/** Rings around the eye, nearest first: a pale road apron's far edge, low hedges and houses, then the tree line. */
const BANDS: Band[] = [
  { radius: 46, bottom: -EYE, top: 2.4, color: [0.2, 0.22, 0.17] },
  { radius: 78, bottom: -EYE, top: 7.5, color: [0.1, 0.13, 0.08] },
  { radius: 120, bottom: -EYE, top: 21, color: [0.045, 0.07, 0.04] },
];

export class CarEnv {
  private readonly probe: ReflectionProbe;
  private readonly props: Mesh[] = [];
  private readonly mats: StandardMaterial[] = [];

  constructor(scene: Scene, sky: Mesh) {
    const probe = new ReflectionProbe('car-env', SIZE, scene, true, true);
    probe.refreshRate = 0;
    probe.position.set(0, AT_Y, 0);
    this.probe = probe;
    const list = probe.renderList!;
    list.push(sky);

    const flat = (name: string, color: [number, number, number]) => {
      const m = new StandardMaterial(name, scene);
      m.diffuseColor = new Color3(color[0], color[1], color[2]);
      m.specularColor = new Color3(0, 0, 0);
      m.backFaceCulling = false;
      m.fogEnabled = false;
      this.mats.push(m);
      return m;
    };
    const add = (mesh: Mesh, mat: StandardMaterial) => {
      mesh.material = mat;
      mesh.isPickable = false;
      mesh.receiveShadows = false;
      mesh.applyFog = false;
      mesh.alwaysSelectAsActiveMesh = true;
      mesh.setEnabled(false);
      this.props.push(mesh);
      list.push(mesh);
    };

    const ground = CreateDisc('car-env-ground', { radius: 400, tessellation: 48 }, scene);
    ground.rotation.x = Math.PI / 2;
    ground.position.set(0, AT_Y - EYE, 0);
    add(ground, flat('car-env-grass', [0.13, 0.17, 0.1]));

    const apron = CreateDisc('car-env-apron', { radius: 18, tessellation: 40 }, scene);
    apron.rotation.x = Math.PI / 2;
    apron.position.set(0, AT_Y - EYE + 0.02, 0);
    add(apron, flat('car-env-road', [0.22, 0.22, 0.21]));

    BANDS.forEach((b, i) => {
      const ring = CreateCylinder(`car-env-band-${i}`, { height: b.top - b.bottom, diameter: b.radius * 2, tessellation: 56, cap: Mesh.NO_CAP, sideOrientation: Mesh.DOUBLESIDE }, scene);
      ring.position.set(0, AT_Y + (b.top + b.bottom) / 2, 0);
      add(ring, flat(`car-env-band-${i}`, b.color));
    });

    const cube = probe.cubeTexture;
    cube.onBeforeBindObservable.add(() => { for (const p of this.props) p.setEnabled(true); });
    cube.onAfterUnbindObservable.add(() => { for (const p of this.props) p.setEnabled(false); });
  }

  get texture(): BaseTexture { return this.probe.cubeTexture; }

  /** Draws the cube again on the next frame (the sun or the night has moved). */
  refresh(): void { this.probe.cubeTexture.resetRefreshCounter(); }

  dispose(): void {
    this.probe.dispose();
    for (const p of this.props) p.dispose(false, false);
    for (const m of this.mats) m.dispose();
    this.props.length = 0;
    this.mats.length = 0;
  }
}

let current: CarEnv | null = null;

/** Starts the vehicle reflection cube from the world's sky dome. */
export function bakeCarEnv(scene: Scene, sky: Mesh): void {
  current?.dispose();
  current = new CarEnv(scene, sky);
}

export function refreshCarEnv(): void { current?.refresh(); }

export function disposeCarEnv(): void { current?.dispose(); current = null; }

/** The cube vehicle materials reflect, or null before the sky has been baked (they then use the scene's own). */
export function carEnvTexture(): BaseTexture | null { return current?.texture ?? null; }
