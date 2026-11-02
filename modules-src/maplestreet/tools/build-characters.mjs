// Turns the two Meshy character scans into game-ready, skinned Maple Street avatars:
// simplified mesh, feet at y=0 facing +Z, a procedural skeleton with automatic skin
// weights, a ponytail bone, a lossless clothing-region mask texture and region stats.
//
//   node build-characters.mjs <male.glb> <female.glb> <outDir>
import { Document, NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { dedup, prune, simplify, textureCompress, weld } from '@gltf-transform/functions';
import { MeshoptSimplifier } from 'meshoptimizer';
import sharp from 'sharp';
import fs from 'node:fs';
import path from 'node:path';

const [, , maleIn, femaleIn, outDir] = process.argv;
fs.mkdirSync(outDir, { recursive: true });
const io = new NodeIO().registerExtensions(ALL_EXTENSIONS);
await MeshoptSimplifier.ready;

/** Hand-measured landmarks in the scans' raw units (A-pose, facing +Z, 1.9 units tall). */
const SPECS = {
  male: {
    src: maleIn, ratio: 0.6, height: 1.8,
    hip: [0.1, -0.03], knee: [0.165, -0.47], ankle: [0.19, -0.86], toe: [0.2, -0.93, 0.13],
    waist: -0.0, chest: 0.36, neck: 0.62, head: 0.72, top: 0.95,
    shoulder: [0.2, 0.53], tip: [0.636, -0.06], belt: 0.97,
  },
  female: {
    src: femaleIn, ratio: 0.03, height: 1.7,
    hip: [0.1, -0.07], knee: [0.165, -0.48], ankle: [0.2, -0.86], toe: [0.21, -0.93, 0.13],
    waist: -0.03, chest: 0.34, neck: 0.6, head: 0.7, top: 0.95,
    shoulder: [0.17, 0.5], tip: [0.477, -0.117], belt: 1.0,
    ponytail: true,
  },
};

const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const add = (a, b) => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
const mul = (a, s) => [a[0] * s, a[1] * s, a[2] * s];
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const len = a => Math.hypot(a[0], a[1], a[2]);
function segDist(p, a, b) {
  const ab = sub(b, a), t = Math.max(0, Math.min(1, dot(sub(p, a), ab) / dot(ab, ab)));
  return { d: len(sub(p, add(a, mul(ab, t)))), t };
}

async function buildOne(kind) {
  const S = SPECS[kind];
  const doc = await io.read(S.src);
  await doc.transform(weld(), simplify({ simplifier: MeshoptSimplifier, ratio: S.ratio, error: 0.0015, lockBorder: false }));
  const mesh = doc.getRoot().listMeshes()[0];
  const prim = mesh.listPrimitives()[0];
  const posAcc = prim.getAttribute('POSITION');
  const P = posAcc.getArray().slice();
  const n = P.length / 3;
  let minY = Infinity, maxY = -Infinity;
  for (let i = 0; i < n; i++) { minY = Math.min(minY, P[i * 3 + 1]); maxY = Math.max(maxY, P[i * 3 + 1]); }
  const k = S.height / (maxY - minY);
  const N = v => [v[0] * k, (v[1] - minY) * k, (v[2] ?? 0) * k];
  for (let i = 0; i < n; i++) { P[i * 3] *= k; P[i * 3 + 1] = (P[i * 3 + 1] - minY) * k; P[i * 3 + 2] *= k; }
  posAcc.setArray(P);

  // Refine each joint's depth (and limb joints' x) to the centroid of nearby vertices.
  const refine = (j, r, xToo) => {
    let sx = 0, sz = 0, c = 0;
    for (let i = 0; i < n; i++) {
      const dy = P[i * 3 + 1] - j[1];
      if (Math.abs(dy) > r * 0.5) continue;
      const dx = P[i * 3] - j[0];
      if (Math.hypot(dx, P[i * 3 + 2] - j[2]) > r) continue;
      sx += P[i * 3]; sz += P[i * 3 + 2]; c++;
    }
    return c ? [xToo ? sx / c : j[0], j[1], sz / c] : j;
  };
  const J = {};
  J.hips = refine(N([0, S.hip[1]]), 0.2);
  J.spine = refine(N([0, S.waist]), 0.2);
  J.chest = refine(N([0, S.chest]), 0.2);
  J.neck = refine(N([0, S.neck]), 0.09);
  J.head = refine(N([0, S.head]), 0.12);
  J.headTop = N([0, S.top]); J.headTop[2] = J.head[2];
  for (const [side, sx] of [['L', 1], ['R', -1]]) {
    J[`upperLeg${side}`] = refine(N([S.hip[0] * sx, S.hip[1] - 0.03]), 0.12, true);
    J[`lowerLeg${side}`] = refine(N([S.knee[0] * sx, S.knee[1]]), 0.09, true);
    J[`foot${side}`] = refine(N([S.ankle[0] * sx, S.ankle[1]]), 0.08, true);
    J[`toe${side}`] = N([S.toe[0] * sx, S.toe[1], S.toe[2]]);
    J[`toe${side}`][2] += J[`foot${side}`][2];
    const sh = refine(N([S.shoulder[0] * sx, S.shoulder[1]]), 0.09);
    const tip = N([S.tip[0] * sx, S.tip[1]]);
    tip[2] = sh[2] + 0.03;
    const dir = sub(tip, sh), L = len(dir);
    J[`upperArm${side}`] = sh;
    J[`lowerArm${side}`] = add(sh, mul(dir, 0.41));
    J[`hand${side}`] = add(sh, mul(dir, 0.76));
    J[`handTip${side}`] = tip;
  }

  // Bone list: name, parent, head joint, tail joint, soft radius.
  const B = [
    ['hips', null, 'hips', 'spine', 0.13],
    ['spine', 'hips', 'spine', 'chest', 0.13],
    ['chest', 'spine', 'chest', 'neck', 0.14],
    ['neck', 'chest', 'neck', 'head', 0.05],
    ['head', 'neck', 'head', 'headTop', 0.09],
  ];
  for (const s of ['L', 'R']) B.push(
    [`upperLeg${s}`, 'hips', `upperLeg${s}`, `lowerLeg${s}`, 0.08],
    [`lowerLeg${s}`, `upperLeg${s}`, `lowerLeg${s}`, `foot${s}`, 0.055],
    [`foot${s}`, `lowerLeg${s}`, `foot${s}`, `toe${s}`, 0.04],
    [`upperArm${s}`, 'chest', `upperArm${s}`, `lowerArm${s}`, 0.045],
    [`lowerArm${s}`, `upperArm${s}`, `lowerArm${s}`, `hand${s}`, 0.035],
    [`hand${s}`, `lowerArm${s}`, `hand${s}`, `handTip${s}`, 0.03],
  );
  let ponyIndex = -1;
  if (S.ponytail) {
    J.ponytail = [0, J.head[1] + 0.07, J.head[2] - 0.075];
    J.ponyEnd = [0, J.head[1] - 0.2, J.head[2] - 0.13];
    ponyIndex = B.length;
    B.push(['ponytail', 'head', 'ponytail', 'ponyEnd', 0.04]);
  }
  const boneIndex = Object.fromEntries(B.map((b, i) => [b[0], i]));

  const crotchY = J.hips[1] - 0.02 * k / 0.95;
  const joints = new Uint16Array(n * 4), weights = new Float32Array(n * 4);
  const ponyVerts = new Uint8Array(n);
  for (let i = 0; i < n; i++) {
    const p = [P[i * 3], P[i * 3 + 1], P[i * 3 + 2]];
    const side = p[0] >= 0 ? 'L' : 'R';
    const cand = [];
    for (let b = 0; b < B.length; b++) {
      const [name, , h, t, r] = B[b];
      if (name === 'ponytail') continue;
      const isLeg = /Leg|foot/.test(name), isArm = /Arm|hand/.test(name);
      if ((isLeg || isArm) && !name.endsWith(side)) continue;
      if (isLeg && p[1] > J.hips[1] + 0.06) continue;
      const { d } = segDist(p, J[h], J[t]);
      let eff = Math.max(d - r, 0.004);
      if (!isLeg && p[1] < crotchY - 0.04 && !isArm) eff *= 3;
      cand.push([b, eff]);
    }
    // Ponytail: hair behind and below the back of the head.
    if (ponyIndex >= 0) {
      const rel = sub(p, J.head);
      if (rel[2] < -0.085 && Math.abs(rel[0]) < 0.085 && p[1] < J.head[1] + 0.12 && p[1] > J.neck[1] - 0.12 && rel[2] < -0.085 - Math.max(0, (J.head[1] - p[1])) * 0.25) {
        ponyVerts[i] = 1;
      }
    }
    if (ponyVerts[i]) { joints[i * 4] = ponyIndex; weights[i * 4] = 1; continue; }
    cand.sort((a, b) => a[1] - b[1]);
    const top = cand.slice(0, 4);
    let sum = 0;
    const w = top.map(([, d]) => { const v = 1 / Math.pow(d, 4); sum += v; return v; });
    for (let c = 0; c < top.length; c++) { joints[i * 4 + c] = top[c][0]; weights[i * 4 + c] = w[c] / sum; }
  }
  // Clean tiny weights.
  for (let i = 0; i < n; i++) {
    let s = 0;
    for (let c = 0; c < 4; c++) { if (weights[i * 4 + c] < 0.02) weights[i * 4 + c] = 0; s += weights[i * 4 + c]; }
    for (let c = 0; c < 4; c++) weights[i * 4 + c] /= s;
  }

  // ------------------------------------------------------------ region mask
  const mat = prim.getMaterial();
  const baseTex = mat.getBaseColorTexture();
  const albedo = await sharp(Buffer.from(baseTex.getImage())).resize(1024, 1024).removeAlpha().raw().toBuffer();
  const UV = prim.getAttribute('TEXCOORD_0').getArray();
  const NRM = prim.getAttribute('NORMAL').getArray();
  const IDX = prim.getIndices().getArray();
  const M = 1024;
  const region = new Uint8Array(M * M);         // 0 = none
  const regionNames = ['none', 'skin', 'hair', 'jacket', 'tee', 'pants', 'shoes', 'soles', 'eyes'];
  const R = Object.fromEntries(regionNames.map((r, i) => [r, i]));
  const lum = c => 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
  const hsv = c => {
    const [r, g, b] = c.map(v => v / 255), mx = Math.max(r, g, b), mn = Math.min(r, g, b), d = mx - mn;
    let h = 0;
    if (d > 1e-5) h = mx === r ? ((g - b) / d) % 6 : mx === g ? (b - r) / d + 2 : (r - g) / d + 4;
    return [(h * 60 + 360) % 360, mx ? d / mx : 0, mx];
  };
  const classify = (p, nz, c) => {
    const [h, s, v] = hsv(c);
    const skinLike = (h < 32 || h > 345) && s > 0.2 && s < 0.68 && v > 0.32 && c[0] > c[1] && c[1] > c[2];
    const rel = sub(p, J.head), flat = Math.hypot(rel[0], rel[2]);
    const armX = Math.abs(p[0]) - Math.abs(J.upperArmL[0]) + 0.02;
    if (p[1] < J.footL[1] + 0.035) return v > 0.55 && p[1] < 0.03 ? R.soles : R.shoes;
    if (p[1] < J.footL[1] + 0.075) {
      const olive = h > 40 && h < 110 && s > 0.12 && v < 0.6;
      return olive ? R.pants : R.shoes;
    }
    const neutralDark = s < 0.14 && v < 0.26;
    if (S.ponytail && rel[2] < -0.075 && Math.abs(rel[0]) < 0.1 && p[1] > J.neck[1] - 0.14 && p[1] < J.head[1] + 0.1 && !neutralDark && !skinLike) return R.hair;
    const onHead = p[1] > J.neck[1] + 0.02 && (p[1] > J.head[1] - 0.045 || flat < 0.095);
    if (onHead) {
      for (const e of [J.eyeL, J.eyeR]) if (e && len(sub(p, e)) < 0.0105 && !skinLike && v < 0.62) return R.eyes;
      if (skinLike) return R.skin;
      if (p[1] < J.eyeL[1] - 0.03 && s < 0.15 && rel[2] > -0.06) return R.jacket;
      if (p[1] < J.neck[1] + 0.07 && rel[2] > -0.06 && flat > 0.07) return R.jacket;
      if (p[1] < J.eyeL[1] && flat > 0.105 && rel[2] > -0.07) return R.jacket;
      if (p[1] < J.head[1] - 0.02 && rel[2] < -0.02 && flat > 0.08 && s < 0.14) return R.jacket;
      return R.hair;
    }
    if (skinLike && (armX > 0.1 || p[1] > J.chest[1] + 0.05)) return R.skin;
    const lowY = J.hips[1] + 0.02, highY = lowY + 0.16;
    if (p[1] < lowY && armX < 0.12) return R.pants;
    const dark = v < 0.2 || (s < 0.2 && v < 0.24);
    const olive = h > 28 && h < 95 && s >= 0.13 && v > 0.16;
    if (p[1] < highY && armX < 0.08) {
      if (p[1] < S.belt) return dark && (Math.abs(p[0]) > 0.085 || nz < 0) && p[1] > lowY + 0.03 ? R.jacket : R.pants;
      if (olive) return R.pants;
      if (dark) return R.jacket;
      return Math.abs(p[0]) < 0.11 && nz > 0.2 ? R.tee : R.jacket;
    }
    if (armX > 0.03) return R.jacket;
    if (!dark && Math.abs(p[0]) < 0.11 && nz > 0.25 && p[1] < J.neck[1] + 0.02) return R.tee;
    return R.jacket;
  };
  const sample = (u, v) => {
    const x = Math.min(M - 1, Math.max(0, Math.floor(u * M))), y = Math.min(M - 1, Math.max(0, Math.floor(v * M)));
    const o = (y * M + x) * 3;
    return [albedo[o], albedo[o + 1], albedo[o + 2]];
  };
  const tpos = new Float32Array(M * M * 3), tnz = new Float32Array(M * M), covered = new Uint8Array(M * M);
  for (let t = 0; t < IDX.length; t += 3) {
    const ia = IDX[t], ib = IDX[t + 1], ic = IDX[t + 2];
    const ua = [UV[ia * 2] * M, UV[ia * 2 + 1] * M], ub = [UV[ib * 2] * M, UV[ib * 2 + 1] * M], uc = [UV[ic * 2] * M, UV[ic * 2 + 1] * M];
    const x0 = Math.max(0, Math.floor(Math.min(ua[0], ub[0], uc[0])) - 1), x1 = Math.min(M - 1, Math.ceil(Math.max(ua[0], ub[0], uc[0])) + 1);
    const y0 = Math.max(0, Math.floor(Math.min(ua[1], ub[1], uc[1])) - 1), y1 = Math.min(M - 1, Math.ceil(Math.max(ua[1], ub[1], uc[1])) + 1);
    const den = (ub[1] - uc[1]) * (ua[0] - uc[0]) + (uc[0] - ub[0]) * (ua[1] - uc[1]);
    if (Math.abs(den) < 1e-9) continue;
    for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) {
      const px = x + 0.5, py = y + 0.5;
      const a = ((ub[1] - uc[1]) * (px - uc[0]) + (uc[0] - ub[0]) * (py - uc[1])) / den;
      const b = ((uc[1] - ua[1]) * (px - uc[0]) + (ua[0] - uc[0]) * (py - uc[1])) / den;
      const c = 1 - a - b;
      if (a < -0.02 || b < -0.02 || c < -0.02) continue;
      const i = y * M + x;
      for (let d = 0; d < 3; d++) tpos[i * 3 + d] = P[ia * 3 + d] * a + P[ib * 3 + d] * b + P[ic * 3 + d] * c;
      tnz[i] = NRM[ia * 3 + 2] * a + NRM[ib * 3 + 2] * b + NRM[ic * 3 + 2] * c;
      covered[i] = 1;
    }
  }
  // Find the eyes: whitish, unsaturated texels on the front of the face.
  const eyeAcc = { L: [0, 0, 0, 0], R: [0, 0, 0, 0] };
  for (let i = 0; i < M * M; i++) {
    if (!covered[i]) continue;
    const p = [tpos[i * 3], tpos[i * 3 + 1], tpos[i * 3 + 2]], rel = sub(p, J.head);
    if (rel[1] < 0 || rel[1] > 0.1 || rel[2] < 0.04 || Math.abs(rel[0]) < 0.01 || Math.abs(rel[0]) > 0.06) continue;
    const c = [albedo[i * 3], albedo[i * 3 + 1], albedo[i * 3 + 2]], [, s, v] = hsv(c);
    if (s < 0.22 && v > 0.62) { const e = eyeAcc[p[0] > 0 ? 'L' : 'R']; e[0] += p[0]; e[1] += p[1]; e[2] += p[2]; e[3]++; }
  }
  const eyes = Object.fromEntries(Object.entries(eyeAcc).map(([k2, e]) => [k2, e[3] ? [e[0] / e[3], e[1] / e[3], e[2] / e[3]] : null]));
  console.log(kind, 'eyes', JSON.stringify(eyes), eyeAcc.L[3], eyeAcc.R[3]);
  const ex = (Math.abs(eyes.L[0]) + Math.abs(eyes.R[0])) / 2, ey = (eyes.L[1] + eyes.R[1]) / 2, ez = (eyes.L[2] + eyes.R[2]) / 2;
  J.eyeL = [ex, ey, ez]; J.eyeR = [-ex, ey, ez];
  for (let i = 0; i < M * M; i++) {
    if (!covered[i]) continue;
    const p = [tpos[i * 3], tpos[i * 3 + 1], tpos[i * 3 + 2]];
    region[i] = classify(p, tnz[i], [albedo[i * 3], albedo[i * 3 + 1], albedo[i * 3 + 2]]);
  }
  // Majority filter to remove speckles, then dilate into empty texels.
  const filt = region.slice();
  for (let y = 1; y < M - 1; y++) for (let x = 1; x < M - 1; x++) {
    const i = y * M + x; if (!region[i]) continue;
    const cnt = new Uint8Array(regionNames.length);
    for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) cnt[region[i + dy * M + dx]]++;
    let best = region[i];
    for (let r = 1; r < cnt.length; r++) if (cnt[r] > cnt[best] && cnt[r] >= 6 && region[i] !== R.eyes) best = r;
    filt[i] = best;
  }
  for (let pass = 0; pass < 4; pass++) {
    const src = filt.slice();
    for (let y = 1; y < M - 1; y++) for (let x = 1; x < M - 1; x++) {
      const i = y * M + x; if (src[i]) continue;
      const nb = src[i - 1] || src[i + 1] || src[i - M] || src[i + M];
      if (nb) filt[i] = nb;
    }
  }
  // Mean albedo per region: the shader recolors relative to this.
  const sums = regionNames.map(() => [0, 0, 0, 0]);
  for (let i = 0; i < M * M; i++) { const r = filt[i]; if (!r) continue; const o = i * 3; sums[r][0] += albedo[o]; sums[r][1] += albedo[o + 1]; sums[r][2] += albedo[o + 2]; sums[r][3]++; }
  const mean = Object.fromEntries(regionNames.map((nm, r) => [nm, sums[r][3] ? sums[r].slice(0, 3).map(v => +(v / sums[r][3] / 255).toFixed(4)) : [0, 0, 0]]));
  const maskRGB = Buffer.alloc(M * M);
  for (let i = 0; i < M * M; i++) maskRGB[i] = filt[i] * 28;
  await sharp(maskRGB, { raw: { width: M, height: M, channels: 1 } }).png({ compressionLevel: 9, palette: false }).toFile(path.join(outDir, `${kind}-mask.png`));
  const dbgCols = [[0, 0, 0], [240, 190, 150], [120, 60, 20], [30, 30, 220], [230, 230, 40], [40, 180, 60], [220, 40, 40], [255, 255, 255], [255, 0, 255]];
  const dbg = Buffer.alloc(M * M * 3);
  for (let i = 0; i < M * M; i++) { const c = dbgCols[filt[i]]; dbg[i * 3] = c[0]; dbg[i * 3 + 1] = c[1]; dbg[i * 3 + 2] = c[2]; }
  await sharp(dbg, { raw: { width: M, height: M, channels: 3 } }).png().toFile(path.join('/home/claude/tools/out', `${kind}-mask-debug.png`));

  // ------------------------------------------------------------ skin + export
  const buffer = doc.getRoot().listBuffers()[0];
  const nodes = B.map(([name]) => doc.createNode(name));
  B.forEach(([name, parent, h], i) => {
    const pj = parent ? J[B[boneIndex[parent]][2]] : [0, 0, 0];
    nodes[i].setTranslation(sub(J[h], pj));
    if (parent) nodes[boneIndex[parent]].addChild(nodes[i]);
  });
  const ibm = new Float32Array(B.length * 16);
  B.forEach(([, , h], i) => { const m = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, -J[h][0], -J[h][1], -J[h][2], 1]; ibm.set(m, i * 16); });
  const skin = doc.createSkin('body').setSkeleton(nodes[0]).setInverseBindMatrices(doc.createAccessor().setType('MAT4').setArray(ibm).setBuffer(buffer));
  for (const nd of nodes) skin.addJoint(nd);
  prim.setAttribute('JOINTS_0', doc.createAccessor().setType('VEC4').setArray(joints).setBuffer(buffer));
  prim.setAttribute('WEIGHTS_0', doc.createAccessor().setType('VEC4').setArray(weights).setBuffer(buffer));
  const scene = doc.getRoot().listScenes()[0];
  const meshNode = doc.getRoot().listNodes().find(nd => nd.getMesh() === mesh);
  meshNode.setName(`${kind}-body`).setSkin(skin).setTranslation([0, 0, 0]).setScale([1, 1, 1]).setRotation([0, 0, 0, 1]);
  scene.addChild(nodes[0]);

  mat.setMetallicRoughnessTexture(null).setNormalTexture(null).setMetallicFactor(0).setRoughnessFactor(0.82).setDoubleSided(false).setName(`${kind}-skin`);
  await doc.transform(prune({ keepAttributes: true }), dedup(), textureCompress({ encoder: sharp, targetFormat: 'jpeg', resize: [1024, 1024], quality: 88 }));
  await io.write(path.join(outDir, `${kind}.glb`), doc);

  const hb = { min: [Infinity, Infinity, Infinity], max: [-Infinity, -Infinity, -Infinity] };
  for (let i = 0; i < n; i++) {
    if (ponyVerts[i] || P[i * 3 + 1] < J.head[1] - 0.04 || Math.abs(P[i * 3]) > 0.15) continue;
    for (let d = 0; d < 3; d++) { hb.min[d] = Math.min(hb.min[d], P[i * 3 + d]); hb.max[d] = Math.max(hb.max[d], P[i * 3 + d]); }
  }
  const meta = {
    headBox: { min: hb.min.map(v => +v.toFixed(4)), max: hb.max.map(v => +v.toFixed(4)) },
    height: S.height, joints: Object.fromEntries(Object.entries(J).map(([nm, v]) => [nm, v.map(x => +x.toFixed(4))])),
  };
  fs.writeFileSync(path.join('/home/claude/tools/out', `${kind}.json`), JSON.stringify(meta, null, 1));
  return meta;
}

const metas = {};
for (const kind of ['male', 'female']) metas[kind] = await buildOne(kind);
fs.writeFileSync(path.join(outDir, 'characters.json'), JSON.stringify(Object.fromEntries(Object.entries(metas).map(([k, m]) => [k, { height: m.height, joints: m.joints, mean: m.mean, headBox: m.headBox }]))));
