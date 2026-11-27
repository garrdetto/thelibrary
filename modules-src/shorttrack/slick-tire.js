/**
 * The stock Super Late Model's wheels (`shorttrack-car.bin`) were decimated with the tyre and rim in one mesh: the tyre
 * came out full of holes and a few rim triangles stretch out to the tread, so bright metal and the sky showed through
 * the rubber as white slivers. `slickWheel` keeps the rim triangles that stay inside the rim lip and replaces the tyre
 * with a closed, lathe-turned racing slick sized to the original one (smooth tread, rounded shoulders, sidewall band).
 * The wheel turns about its local z axis; group material indices are kept (tyre 3, rim 4).
 */
export const TIRE_SHADE = { tread: 0.78, shoulder: 0.66, wall: 0.58, band: 0.95, bead: 0.4 };
const SEGMENTS = 56;

function radial(pos, v) { return Math.hypot(pos[v * 3], pos[v * 3 + 1]); }

/** Measures the original tyre and rim: outer radius, half width and the rim lip radius. */
export function measureWheel(geo, tireIndex = 3, rimIndex = 4) {
  const pos = geo.attributes.position.array, idx = geo.index.array;
  let outer = 0, half = 0;
  const rimR = [];
  for (const g of geo.groups) for (let t = g.start; t < g.start + g.count; t++) {
    const v = idx[t], r = radial(pos, v);
    if (g.materialIndex === tireIndex) { outer = Math.max(outer, r); half = Math.max(half, Math.abs(pos[v * 3 + 2])); }
    else if (g.materialIndex === rimIndex) rimR.push(r);
  }
  rimR.sort((a, b) => a - b);
  const lip = rimR.length ? rimR[Math.floor(rimR.length * 0.97)] : outer * 0.62;
  return { outer, half, lip: Math.min(lip, outer * 0.72) };
}

function profile(R, hw, rb) {
  const s = R - rb;
  const side = [[rb, 0.86], [rb + s * 0.22, 0.95], [rb + s * 0.5, 0.995], [rb + s * 0.6, 0.999], [rb + s * 0.72, 1], [rb + s * 0.86, 0.975], [R - 0.022, 0.9], [R - 0.008, 0.78], [R, 0.6]];
  const pts = side.map(([r, z]) => [r, -z * hw]);
  for (let i = side.length - 1; i >= 0; i--) pts.push([side[i][0], side[i][1] * hw]);
  return pts;
}

function shadeAt(r, R, rb, hw, z) {
  if (r >= R - 0.0005 && Math.abs(z) <= 0.61 * hw) return TIRE_SHADE.tread;
  if (r >= R - 0.023) return TIRE_SHADE.shoulder;
  const f = (r - rb) / (R - rb);
  if (f > 0.57 && f < 0.63) return TIRE_SHADE.band;
  return f < 0.08 ? TIRE_SHADE.bead : TIRE_SHADE.wall;
}

/** A closed slick: the outer lathe plus an inner liner at the bead, as flat arrays (axis z). */
export function slickArrays(THREE, R, hw, rb) {
  const pts = profile(R, hw, rb);
  const outer = new THREE.LatheGeometry(pts.map(([r, z]) => new THREE.Vector2(r, z)), SEGMENTS).rotateX(Math.PI / 2);
  const liner = new THREE.LatheGeometry([new THREE.Vector2(rb, 0.86 * hw), new THREE.Vector2(rb, -0.86 * hw)], SEGMENTS).rotateX(Math.PI / 2);
  const pos = [], nor = [], col = [], idx = [];
  for (const [lathe, inner] of [[outer, false], [liner, true]]) {
    const base = pos.length / 3, p = lathe.attributes.position.array, n = lathe.attributes.normal.array;
    for (let i = 0; i < p.length; i += 3) {
      pos.push(p[i], p[i + 1], p[i + 2]); nor.push(n[i], n[i + 1], n[i + 2]);
      col.push(inner ? TIRE_SHADE.bead : shadeAt(Math.hypot(p[i], p[i + 1]), R, rb, hw, p[i + 2]));
    }
    for (const v of lathe.index.array) idx.push(base + v);
    lathe.dispose();
  }
  return { pos, nor, col, idx };
}

/** Rebuilds one wheel part: rim triangles inside the lip, then the new slick. */
export function slickWheel(THREE, geo, tireIndex = 3, rimIndex = 4) {
  const { outer, half, lip } = measureWheel(geo, tireIndex, rimIndex);
  if (!(outer > 0 && half > 0)) return geo;
  const pos = geo.attributes.position.array, nor = geo.attributes.normal.array, col = geo.attributes.color ? geo.attributes.color.array : null, uv = geo.attributes.uv ? geo.attributes.uv.array : null, idx = geo.index.array;
  const keepR = lip * 1.04, rb = lip * 0.97;
  const P = [], N = [], C = [], U = [], I = [], remap = new Map(), groups = [];
  const take = v => {
    let o = remap.get(v);
    if (o === undefined) {
      o = P.length / 3; remap.set(v, o);
      P.push(pos[v * 3], pos[v * 3 + 1], pos[v * 3 + 2]); N.push(nor[v * 3], nor[v * 3 + 1], nor[v * 3 + 2]);
      const c = col ? col[v * 3] : 1; C.push(c, c, c); if (uv) U.push(uv[v * 2], uv[v * 2 + 1]);
    }
    return o;
  };
  for (const g of geo.groups) {
    if (g.materialIndex === tireIndex) continue;
    const st = I.length;
    for (let t = g.start; t < g.start + g.count; t += 3) {
      const a = idx[t], b = idx[t + 1], c = idx[t + 2];
      if (g.materialIndex === rimIndex && Math.max(radial(pos, a), radial(pos, b), radial(pos, c)) > keepR) continue;
      I.push(take(a), take(b), take(c));
    }
    if (I.length > st) groups.push([st, I.length - st, g.materialIndex]);
  }
  const s = slickArrays(THREE, outer, half, rb), base = P.length / 3, st = I.length;
  for (let i = 0; i < s.pos.length / 3; i++) {
    P.push(s.pos[i * 3], s.pos[i * 3 + 1], s.pos[i * 3 + 2]); N.push(s.nor[i * 3], s.nor[i * 3 + 1], s.nor[i * 3 + 2]);
    C.push(s.col[i], s.col[i], s.col[i]); if (uv) U.push(0, 0);
  }
  for (const v of s.idx) I.push(base + v);
  groups.push([st, I.length - st, tireIndex]);
  const out = new THREE.BufferGeometry();
  out.setAttribute('position', new THREE.BufferAttribute(new Float32Array(P), 3));
  out.setAttribute('normal', new THREE.BufferAttribute(new Float32Array(N), 3));
  out.setAttribute('color', new THREE.BufferAttribute(new Float32Array(C), 3));
  if (uv) out.setAttribute('uv', new THREE.BufferAttribute(new Float32Array(U), 2));
  out.setIndex(new THREE.BufferAttribute(new Uint32Array(I), 1));
  for (const [a, b, m] of groups) out.addGroup(a, b, m);
  out.userData.slick = { outer, half, lip: rb };
  geo.dispose();
  return out;
}

/** Matte rubber: no gloss and no specular highlight (the site's gloss rule), shaded by the slick's vertex colours. */
export function slickMaterial(THREE) {
  return new THREE.MeshPhysicalMaterial({ name: 'slick', color: 0x2a2a2b, vertexColors: true, roughness: 1, metalness: 0, specularIntensity: 0, envMapIntensity: 0.6 });
}
