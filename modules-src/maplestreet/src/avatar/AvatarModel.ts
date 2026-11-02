/**
 * One scanned body in the world: a skeleton clone sharing the body's geometry,
 * its own wardrobe material, extra hair/hat meshes on the head bone, and a
 * procedural pose (walk cycle, idle breathing, seated at the wheel).
 */
import * as THREE from 'three/webgpu';
import { clone as cloneSkinned } from 'three/addons/utils/SkeletonUtils.js';
import { WARDROBE_BY_ID, type Body, type Look } from '../../shared/Wardrobe';
import type { BodyAsset } from './AvatarAssets';
import { AvatarMaterial } from './AvatarMaterial';
import { dressHead, type HatKind, type HeadDressing } from './HairAndHats';

const SIDES = ['L', 'R'] as const;

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
    this.mesh.castShadow = true;
    this.mesh.receiveShadow = true;
    this.mesh.frustumCulled = false;
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
    if (this.body === 'female' || look.hair === 'natural') this.mesh.geometry = A.geometry;
    else if (look.hair === 'bun' && this.body === 'male' && !hat) this.mesh.geometry = A.geometry;
    else this.mesh.geometry = A.flatGeometry;

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
    const amp = Math.min(0.7, speed * 0.21);
    this.phase += dt * (2 + speed * 2.1);
    const s = Math.sin(this.phase);
    const swing = s * amp;
    B.upperLegL.rotation.set(-swing, 0, 0);
    B.upperLegR.rotation.set(swing, 0, 0);
    B.lowerLegL.rotation.set(Math.max(0, Math.sin(this.phase + 0.9)) * amp * 1.35 + amp * 0.08, 0, 0);
    B.lowerLegR.rotation.set(Math.max(0, Math.sin(this.phase + Math.PI + 0.9)) * amp * 1.35 + amp * 0.08, 0, 0);
    B.footL.rotation.set(0, 0, 0); B.footR.rotation.set(0, 0, 0);
    const armIdle = Math.sin(this.t * 0.9) * 0.015;
    B.upperArmL.rotation.set(swing * 0.75, 0, -this.armDown + armIdle);
    B.upperArmR.rotation.set(-swing * 0.75, 0, this.armDown - armIdle);
    B.lowerArmL.rotation.set(-0.12 - amp * 0.35 - Math.max(0, swing) * 0.3, 0, 0);
    B.lowerArmR.rotation.set(-0.12 - amp * 0.35 - Math.max(0, -swing) * 0.3, 0, 0);
    B.hips.rotation.set(0, swing * 0.12, 0);
    B.spine.rotation.set(amp * 0.06, 0, 0);
    B.chest.rotation.set(breathe, -swing * 0.2, 0);
    B.head.rotation.set(-amp * 0.04, swing * 0.06, 0);
    B.hips.position.y = this.asset.joints.hips.y + Math.abs(Math.cos(this.phase)) * amp * 0.035 - amp * 0.02;
  }

  dispose() {
    this.root.removeFromParent();
    this.material.dispose();
    if (this.dressing) for (const m of [this.dressing.hairMat, this.dressing.hatMat, this.dressing.hatAccent]) m.dispose();
  }
}
