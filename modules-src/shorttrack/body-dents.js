/**
 * Smooth body dents. Each impact adds a smooth bump (1 - d²/r²)³ to a displacement field kept per vertex, with a broad,
 * spatially coherent fold for the crease instead of per-vertex noise, and the total is eased toward its cap (tanh)
 * rather than clipped, so panels cave in as rounded dents with no pits or plateaus. Normals are the file's own normals
 * turned by how far the dent tilted the surface, worked out on welded vertices so UV and hard-edge seams stay closed.
 * The field depends only on each vertex's position, so the decals over the body dent with it.
 */
const TOPO = new Map();

/** Area-weighted face normals summed per welded vertex, normalised. */
export function weldedNormals(pos, idx, count, wid, nW) {
  const acc = new Float32Array(nW * 3), T = idx ? idx.length : count;
  for (let t = 0; t < T; t += 3) {
    const ia = idx ? idx[t] : t, ib = idx ? idx[t + 1] : t + 1, ic = idx ? idx[t + 2] : t + 2, a = ia * 3, b = ib * 3, c = ic * 3;
    const ux = pos[b] - pos[a], uy = pos[b + 1] - pos[a + 1], uz = pos[b + 2] - pos[a + 2];
    const vx = pos[c] - pos[a], vy = pos[c + 1] - pos[a + 1], vz = pos[c + 2] - pos[a + 2];
    const nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
    for (const v of [ia, ib, ic]) { const k = wid[v] * 3; acc[k] += nx; acc[k + 1] += ny; acc[k + 2] += nz; }
  }
  for (let k = 0; k < acc.length; k += 3) {
    const l = Math.hypot(acc[k], acc[k + 1], acc[k + 2]);
    if (l > 1e-12) { acc[k] /= l; acc[k + 1] /= l; acc[k + 2] /= l; } else acc[k] = acc[k + 1] = acc[k + 2] = 0;
  }
  return acc;
}

/** Welded vertex ids, the undented welded normals and the file normals for one deformable part (shared by identical parts). */
export function dentTopology(part) {
  if (part.topo) return part.topo;
  const g = part.geo, o = part.orig, n = g.attributes.position.count, idx = g.index ? g.index.array : null;
  const key = `${n}|${idx ? idx.length : 0}|${o[0]},${o[1]},${o[2]}|${o[n * 3 - 3]},${o[n * 3 - 1]}`;
  let t = TOPO.get(key);
  if (!t) {
    const map = new Map(), wid = new Int32Array(n);
    let nW = 0;
    for (let i = 0; i < n; i++) {
      const k = `${Math.round(o[i * 3] * 4000)},${Math.round(o[i * 3 + 1] * 4000)},${Math.round(o[i * 3 + 2] * 4000)}`;
      let w = map.get(k);
      if (w === undefined) { w = nW++; map.set(k, w); }
      wid[i] = w;
    }
    const na = g.attributes.normal;
    t = { wid, nW, a0: weldedNormals(o, idx, n, wid, nW), n0: na ? Float32Array.from(na.array) : null };
    TOPO.set(key, t);
  }
  part.topo = t;
  return t;
}

/** Turns each file normal by the change in its welded normal. */
export function dentNormals(g, t) {
  const na = g.attributes.normal;
  if (!na || !t.n0 || t.n0.length !== na.array.length) { g.computeVertexNormals(); return; }
  const acc = weldedNormals(g.attributes.position.array, g.index ? g.index.array : null, na.count, t.wid, t.nW);
  const a0 = t.a0, n0 = t.n0, N = na.array, wid = t.wid;
  for (let i = 0; i < na.count; i++) {
    const w = wid[i] * 3, i3 = i * 3;
    const ok = acc[w] || acc[w + 1] || acc[w + 2];
    const nx = n0[i3] + (ok ? acc[w] - a0[w] : 0), ny = n0[i3 + 1] + (ok ? acc[w + 1] - a0[w + 1] : 0), nz = n0[i3 + 2] + (ok ? acc[w + 2] - a0[w + 2] : 0);
    const l = Math.hypot(nx, ny, nz) || 1;
    N[i3] = nx / l; N[i3 + 1] = ny / l; N[i3 + 2] = nz / l;
  }
  na.needsUpdate = true;
}

/**
 * One impact on every deformable part. `L` and `D` are the impact point and direction in model space, `s` the model
 * scale (model units to metres), `v` the visible damage amount. Returns how many vertices moved.
 */
export function dentParts(parts, L, D, s, v) {
  const r = (0.85 + Math.min(1.35, v * 0.042)) / s, push = Math.min(0.5, v * 0.02) / s, cap = 0.62 / s, crease = Math.min(1, v / 14);
  const r2 = r * r, scuff = Math.min(1.4, 0.6 + v / 20);
  let moved = 0;
  for (const part of parts) {
    const g = part.geo, pa = g.attributes.position, P = pa.array, o = part.orig, ca = part.scuff ? g.attributes.color : null;
    const t = dentTopology(part);
    if (!part.raw || part.raw.length !== P.length) part.raw = new Float32Array(P.length);
    const raw = part.raw;
    let hit = 0;
    for (let i = 0; i < pa.count; i++) {
      const i3 = i * 3, dx = P[i3] - L[0], dy = (P[i3 + 1] - L[1]) * 0.6, dz = P[i3 + 2] - L[2], d2 = dx * dx + dy * dy + dz * dz;
      if (d2 >= r2) continue;
      hit++;
      const q = 1 - d2 / r2, k = q * q * q, ox = o[i3], oy = o[i3 + 1], oz = o[i3 + 2];
      const mx = ox * s, my = oy * s, mz = oz * s;
      const fold = Math.sin(mx * 7.3 + mz * 5.1 + 1.3) * Math.sin(my * 9.7 + mx * 2.3) * crease;
      const pk = push * k * (1 + fold * 0.4);
      raw[i3] += D[0] * pk; raw[i3 + 1] -= push * k * (0.28 + fold * 0.12); raw[i3 + 2] += D[2] * pk;
      let ex = raw[i3], ey = raw[i3 + 1], ez = raw[i3 + 2];
      const el = Math.hypot(ex, ey, ez);
      if (el > 1e-9) { const f = cap * Math.tanh(el / cap) / el; ex *= f; ey *= f; ez *= f; }
      P[i3] = ox + ex; P[i3 + 1] = oy + ey; P[i3 + 2] = oz + ez;
      if (ca) {
        const grain = 0.75 + 0.25 * Math.sin(mx * 11.3 + my * 6.1) * Math.sin(mz * 13.7 - my * 4.3);
        const cv = Math.max(0.22, ca.getX(i) - 0.5 * k * grain * scuff);
        ca.setXYZ(i, cv, cv * 0.96, cv * 0.92);
      }
    }
    if (!hit) continue;
    moved += hit;
    pa.needsUpdate = true;
    if (ca) ca.needsUpdate = true;
    dentNormals(g, t);
    g.computeBoundingSphere();
  }
  return moved;
}
