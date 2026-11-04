/**
 * One scanned body in the world: a skeleton clone sharing the body's geometry,
 * its own wardrobe material, extra hair/hat meshes on the head bone, and a
 * procedural pose (walk and run cycles from ./Gait, idle breathing, seated at the wheel).
 */
import * as THREE from 'three/webgpu';
import { clone as cloneSkinned } from 'three/addons/utils/SkeletonUtils.js';
import { lods, simplifiedGeometry, swapGeometry, type LodEntry } from '../core/Lod';
import { WARDROBE_BY_ID, type Body, type Look } from '../../shared/Wardrobe';
import type { BodyAsset } from './AvatarAssets';
import { AvatarMaterial } from './AvatarMaterial';
import { dressHead, type HatKind, type HeadDressing } from './HairAndHats';
import { gaitFrequency, gaitPose, runBlend } from './Gait';

const SIDES = ['L', 'R'] as const;
/** Camera distances (m) where an avatar drops to the next level, and the triangle budgets of levels 1 and 2. */
export const AVATAR_LOD_DISTANCES = [12, 35] as const;
const AVATAR_LOD_TRIANGLES = [6000, 1500] as const;

export class AvatarModel {
  readonly root: THREE.Object3D;
  readonly body: Body;
  readonly hipY: number;
  private bones: Record<string, THREE.Bone> = {};
  private mesh!: THREE.SkinnedMesh;
  private material: AvatarMaterial;
  private dressing: HeadDressing | null = null;
  private dressKey = '';
  private armDown: number;
  private phase = 0;
  private t = Math.random() * 10;
  private headRest: THREE.Vector3;

  constructor(private asset: BodyAsset, look: Look) {
    this.body = asset.body;
    this.root = cloneSkinned(asset.scene);
    this.root.traverse(o => {
      if ((o as THREE.Bone).isBone) this.bones[o.name] = o as THREE.Bone;
      if ((o as THREE.SkinnedMesh).isSkinnedMesh) this.mesh = o as THREE.SkinnedMesh;
    });
    this.material = new AvatarMaterial(asset);
    this.mesh.material = this.material.material;
    this.material.attach(this.mesh);
    this.mesh.castShadow = true;
    this.mesh.receiveShadow = true;
    // Strict frustum culling for skinned bodies: three.js would otherwise skin every vertex to
    // find bounds, so the mesh gets a fixed sphere that holds any pose (standing, walking, seated).
    this.mesh.frustumCulled = true;
    this.mesh.boundingSphere = new THREE.Sphere(new THREE.Vector3(0, asset.joints.upperLegL.y, 0), 1.35);
    const J = asset.joints;
    this.hipY = J.upperLegL.y;
    this.headRest = J.head.clone();
    const arm = J.lowerArmL.clone().sub(J.upperArmL);
    this.armDown = Math.max(0, Math.atan2(Math.abs(arm.x), -arm.y) - 0.13);
    this.setLook(look);
  }

  setLook(look: Look) {
    this.material.setLook(look);
    const hat = (WARDROBE_BY_ID[look.hat]?.hat ?? null) as HatKind | null;
    const A = this.asset;
    const base = this.body === 'female' || look.hair === 'natural' || (look.hair === 'bun' && this.body === 'male' && !hat) ? A.geometry : A.flatGeometry;
    if (base !== this.levels[0]) this.setBase(base);

    const key = `${look.hair}|${hat}`;
    if (key !== this.dressKey) {
      this.dressKey = key;
      if (this.dressing) {
        this.dressing.group.removeFromParent();
        for (const m of [this.dressing.hairMat, this.dressing.hatMat, this.dressing.hatAccent]) m.dispose();
        this.dressing = null;
      }
      if (look.hair === 'long' || look.hair === 'bun' || hat) {
        this.dressing = dressHead(this.body, look.hair, hat, look.hairColor, look.hatColor, look.hatColor2);
        this.dressing.group.position.copy(this.headRest).negate();
        this.bones.head.add(this.dressing.group);
      }
    }
    if (this.dressing) {
      this.dressing.hairMat.color.set(look.hairColor);
      this.dressing.hatMat.color.set(look.hatColor);
      this.dressing.hatAccent.color.set(look.hatColor2);
    }
  }

  pose(dt: number, speed: number, seated: boolean, straddle: boolean) {
    const B = this.bones;
    this.t += dt;
    const breathe = Math.sin(this.t * 1.7) * 0.012;
    if (seated) {
      for (const s of SIDES) {
        const sign = s === 'L' ? 1 : -1;
        B[`upperLeg${s}`].rotation.set(straddle ? -1.1 : -1.45, 0, sign * (straddle ? 0.3 : 0.06));
        B[`lowerLeg${s}`].rotation.set(straddle ? 1.25 : 1.4, 0, 0);
        B[`foot${s}`].rotation.set(straddle ? -0.1 : 0.1, 0, 0);
        B[`upperArm${s}`].rotation.set(-0.95, 0, -sign * this.armDown * 0.72);
        B[`lowerArm${s}`].rotation.set(-0.55, 0, 0);
      }
      B.spine.rotation.set(-0.06, 0, 0);
      B.chest.rotation.set(breathe, 0, 0);
      B.hips.rotation.set(0, 0, 0);
      B.hips.position.y = this.asset.joints.hips.y;
      return;
    }
    this.phase = (this.phase + dt * gaitFrequency(speed)) % 1;
    const g = gaitPose(this.phase, speed);
    const run = runBlend(speed);
    for (const s of SIDES) {
      const sign = s === 'L' ? 1 : -1;
      const L = s === 'L' ? g.legL : g.legR, A = s === 'L' ? g.armL : g.armR;
      B[`upperLeg${s}`].rotation.set(-L.hip, 0, 0);
      B[`lowerLeg${s}`].rotation.set(L.knee, 0, 0);
      B[`foot${s}`].rotation.set(L.ankle, 0, 0);
      const armIdle = Math.sin(this.t * 0.9) * 0.015;
      B[`upperArm${s}`].rotation.set(A.arm, 0, -sign * (this.armDown * (1 - run * 0.25) - armIdle));
      B[`lowerArm${s}`].rotation.set(-A.elbow, 0, 0);
      B[`hand${s}`]?.rotation.set(0, 0, 0);
    }
    B.hips.rotation.set(0, g.twist * 0.5, 0);
    B.spine.rotation.set(g.lean, 0, 0);
    B.chest.rotation.set(breathe + g.lean * 0.3, -g.twist, 0);
    B.neck?.rotation.set(0, 0, 0);
    B.head.rotation.set(g.headPitch, g.twist * 0.3, 0);
    B.hips.position.y = this.asset.joints.hips.y + g.hipBob;
  }

  /**
   * Level of detail: the same skinned mesh, skeleton and material at every
   * level; farther away it draws a simplified index buffer over the same
   * vertices (AVATAR_LOD_TRIANGLES), so poses and the wardrobe shader carry over.
   */
  private levels: (THREE.BufferGeometry | null)[] = [];
  private lod: LodEntry | null = null;
  private setBase(base: THREE.BufferGeometry) {
    const levels: (THREE.BufferGeometry | null)[] = [base, null, null];
    this.levels = levels;
    this.mesh.geometry = base;
    this.lod ??= lods.add(this.root, AVATAR_LOD_DISTANCES, level => swapGeometry(this.mesh, this.levels)(level));
    AVATAR_LOD_TRIANGLES.forEach((target, i) => void simplifiedGeometry(base, target).then(g => {
      if (this.levels !== levels) return;
      levels[i + 1] = g;
      if (this.lod && this.lod.level >= 0) swapGeometry(this.mesh, levels)(this.lod.level);
    }));
  }

  dispose() {
    lods.remove(this.lod);
    this.lod = null;
    this.root.removeFromParent();
    this.material.dispose();
    if (this.dressing) for (const m of [this.dressing.hairMat, this.dressing.hatMat, this.dressing.hatAccent]) m.dispose();
  }
}
