/**
 * The avatar's skin shader. The scan's baked texture stays the source of all
 * detail (folds, seams, stitching, faces); the region mask says which part a
 * texel belongs to, and each part is recolored by keeping its shading
 * (luminance relative to the part's average) and swapping the hue. Clothing
 * patterns are painted in rest-pose model space, so they stay level and sized
 * in real centimetres on both bodies.
 */
import * as THREE from 'three/webgpu';
import {
  abs, attribute, clamp, dot, float, floor, Fn, fract, max, mix, mod, mx_noise_float, select, smoothstep, step, texture, uniform, uv, vec3,
} from 'three/tsl';
import { PATTERNS, WARDROBE_BY_ID, type Look, type Pattern } from '../../shared/Wardrobe';
import type { BodyAsset } from './AvatarAssets';
import { MASK_STEP, REGIONS, RIG } from './RigData';

const LUMA = vec3(0.2126, 0.7152, 0.0722);
type Node = ReturnType<typeof vec3>;

function linear(rgb: [number, number, number]) {
  return new THREE.Color().setRGB(rgb[0], rgb[1], rgb[2], THREE.SRGBColorSpace);
}

export class AvatarMaterial {
  readonly material: THREE.MeshStandardNodeMaterial;
  private u = {
    skin: uniform(new THREE.Color()), hair: uniform(new THREE.Color()), eyes: uniform(new THREE.Color()), tee: uniform(new THREE.Color()),
    top1: uniform(new THREE.Color()), top2: uniform(new THREE.Color()), topPattern: uniform(0),
    pants1: uniform(new THREE.Color()), pants2: uniform(new THREE.Color()), pantsPattern: uniform(0),
    shoes1: uniform(new THREE.Color()), shoes2: uniform(new THREE.Color()), shoesPattern: uniform(0),
  };

  constructor(asset: BodyAsset) {
    const rig = RIG[asset.body];
    const J = asset.joints;
    const shoulderX = Math.abs(J.upperArmL.x), shoulderY = J.upperArmL.y;
    const kneeY = J.lowerLegL.y, ankleY = J.footL.y;
    const u = this.u;
    const refLum = (r: (typeof REGIONS)[number]) => {
      const c = linear(rig.mean[r]);
      return Math.max(0.004, 0.2126 * c.r + 0.7152 * c.g + 0.0722 * c.b);
    };

    const colorNode = Fn(() => {
      const base = texture(asset.albedo, uv()).rgb;
      const id = floor(texture(asset.mask, uv()).r.mul(255 / MASK_STEP).add(0.5));
      const p = attribute('restPos', 'vec3');
      const lum = dot(base, LUMA);
      const detail = (r: (typeof REGIONS)[number], k = 1) => clamp(lum.div(refLum(r)), 0.05, 2.4).pow(k);
      const is = (r: (typeof REGIONS)[number]) => step(abs(id.sub(REGIONS.indexOf(r))), 0.5);
      const pick = (pat: ReturnType<typeof uniform>, name: Pattern) => step(abs(pat.sub(PATTERNS.indexOf(name))), 0.5);

      // Two-color patterns in rest space (metres).
      const sideways = p.x.add(p.z.mul(0.7));
      const stripes = step(0.5, fract(p.y.div(0.085)));
      const plaidA = step(0.5, fract(sideways.div(0.11))), plaidB = step(0.5, fract(p.y.div(0.11)));
      const overcheck = max(step(0.93, fract(sideways.div(0.11).add(0.25))), step(0.93, fract(p.y.div(0.11).add(0.25))));
      const camoN = mx_noise_float(p.mul(7.5)).add(mx_noise_float(p.mul(17).add(3.1)).mul(0.45));
      const camo = smoothstep(0.02, 0.08, camoN);
      const camoDark = smoothstep(0.32, 0.38, camoN);
      const sleeve = smoothstep(shoulderX - 0.01, shoulderX + 0.03, abs(p.x)).mul(step(p.y, shoulderY + 0.06));
      const twill = fract(p.x.add(p.y).add(p.z).mul(260)).sub(0.5).mul(0.16).add(mx_noise_float(p.mul(40)).mul(0.12)).add(1);
      const checker = mod(floor(p.x.div(0.022)).add(floor(p.y.div(0.022))).add(floor(p.z.div(0.022))), 2);

      const patterned = (pat: ReturnType<typeof uniform>, c1: Node, c2: Node) => {
        let col: Node = c1 as Node;
        col = mix(col, c2, pick(pat, 'stripes').mul(stripes)) as Node;
        const plaid = mix(mix(c1, c2, plaidA.add(plaidB).mul(0.5)), vec3(0.92, 0.9, 0.84), overcheck.mul(0.35));
        col = mix(col, plaid, pick(pat, 'plaid')) as Node;
        const camoCol = mix(mix(c1, mix(c1, c2, 0.5).mul(1.25), camo), c2, camoDark);
        col = mix(col, camoCol, pick(pat, 'camo')) as Node;
        col = mix(col, c2, pick(pat, 'sleeves').mul(sleeve)) as Node;
        col = mix(col, c1.mul(twill), pick(pat, 'denim')) as Node;
        col = mix(col, mix(c1, c2, checker), pick(pat, 'checker')) as Node;
        return col;
      };

      const skin = u.skin.mul(detail('skin', 0.85));
      const top = patterned(u.topPattern, u.top1, u.top2).mul(detail('jacket', 0.7));
      const tee = u.tee.mul(detail('tee', 0.85));
      const pantsCol = patterned(u.pantsPattern, u.pants1, u.pants2).mul(detail('pants', 0.8));
      const shoeUpper = patterned(u.shoesPattern, u.shoes1, u.shoes2).mul(detail('shoes', 0.75));
      // Shorts show bare shins; high-tops and boots climb over the jogger cuffs.
      const shorts = pick(u.pantsPattern, 'shorts').mul(step(p.y, kneeY - 0.035));
      const highTop = pick(u.shoesPattern, 'hightop').mul(step(p.y, ankleY + 0.075));
      const legSkin = u.skin.mul(detail('pants', 0.45)).mul(0.95);
      let pants: Node = mix(pantsCol, legSkin, shorts) as Node;
      pants = mix(pants, u.shoes1.mul(detail('pants', 0.7)), highTop.mul(float(1).sub(shorts))) as Node;
      const soles = mix(u.shoes2.mul(detail('soles', 0.6)), base, 0.15);

      let out: Node = base as Node;
      out = mix(out, skin, is('skin')) as Node;
      out = mix(out, u.hair.mul(detail('hair', 0.9)), is('hair')) as Node;
      out = mix(out, top, is('jacket')) as Node;
      out = mix(out, tee, is('tee')) as Node;
      out = mix(out, pants, is('pants')) as Node;
      out = mix(out, shoeUpper, is('shoes')) as Node;
      out = mix(out, soles, is('soles')) as Node;
      out = mix(out, u.eyes.mul(detail('eyes', 0.7)), is('eyes')) as Node;
      return select(id.lessThan(0.5), base, out);
    })();

    const m = new THREE.MeshStandardNodeMaterial({ roughness: 0.82, metalness: 0 });
    m.colorNode = colorNode;
    m.name = `avatar-${asset.body}`;
    this.material = m;
  }

  setLook(look: Look) {
    const u = this.u;
    const set = (un: ReturnType<typeof uniform>, hex: string) => (un.value as THREE.Color).set(hex);
    set(u.skin, look.skin); set(u.hair, look.hairColor); set(u.eyes, look.eyes); set(u.tee, look.tee);
    set(u.top1, look.topColor); set(u.top2, look.topColor2);
    set(u.pants1, look.pantsColor); set(u.pants2, look.pantsColor2);
    set(u.shoes1, look.shoesColor); set(u.shoes2, look.shoesColor2);
    u.topPattern.value = PATTERNS.indexOf(WARDROBE_BY_ID[look.top]?.pattern ?? 'solid');
    u.pantsPattern.value = PATTERNS.indexOf(WARDROBE_BY_ID[look.pants]?.pattern ?? 'solid');
    u.shoesPattern.value = PATTERNS.indexOf(WARDROBE_BY_ID[look.shoes]?.pattern ?? 'solid');
  }

  dispose() { this.material.dispose(); }
}
