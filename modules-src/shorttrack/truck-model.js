// The owner's race-truck design as a procedural model, shared by render-three/main.js and the Phase 5
// export script (scripts/shorttrack-truck-export.mjs) that hands it to Blender for LODs.
export const TM=(()=>{
// Procedural model of the FOX race truck from the design sheet.
// Units: metres. +X = forward, +Y = up, +Z = passenger (right) side.
// The body and greenhouse are lofted shells: a rounded cross-section is swept along the
// length, so the sides carry tumblehome, rolled shoulders, fender bulges and wrapped corners.
// buildTruck(THREE, { grilleTexture }) returns { group, materials }.

// ---------------------------------------------------------------- shape math (no THREE)
const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
const smooth = (a, b, x) => { const t = clamp((x - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); };
const lerp = (a, b, t) => a + (b - a) * t;
const softmin = (a, b, k) => -k * Math.log(Math.exp(-a / k) + Math.exp(-b / k));
// Spreads samples evenly over a superellipse of exponent 2k instead of bunching them at the corners
const spread = (a, k) => { const p = a ** k, q = (1 - a) ** k; return p / (p + q); };

const VALANCE = { x: 2.1, top: 0.2 };
const DIM = {
  xr: -2.85, xf: 2.665,               // tail and nose faces
  RA: -1.55, FA: 1.62,                // axles
  AR: 0.45, AY: 0.38, wheelR: 0.38,   // wheel-arch radius/centre height, tyre radius
  noseR: 0.1, tailR: 0.035,           // plan-view corner radii
  hoodR: 0.15, deckR: 0.03,           // side-view radii at the hood lip and tailgate
  cowlX: 1.0,
};

function archY(x) {
  for (const ax of [DIM.RA, DIM.FA]) {
    const d = x - ax;
    if (Math.abs(d) < DIM.AR) return DIM.AY + Math.sqrt(DIM.AR * DIM.AR - d * d);
  }
  return -Infinity;
}

// Cross-section parameters at a station along the length
function station(x) {
  const yb = 0.13 + 0.17 * smooth(-2.3, DIM.xr, x);
  const hx0 = Math.max(0, x - DIM.cowlX);
  let yt = 1.21 - 0.06 * hx0 - 0.025 * hx0 * hx0;   // hood falls away toward the nose
  const hx = DIM.xf - DIM.hoodR;
  if (x > hx) { const d = x - hx; yt -= DIM.hoodR - Math.sqrt(Math.max(0, DIM.hoodR ** 2 - d * d)); }
  const dx = DIM.xr + DIM.deckR;
  if (x < dx) { const d = dx - x; yt -= DIM.deckR - Math.sqrt(Math.max(0, DIM.deckR ** 2 - d * d)); }

  let w = 0.95 + 0.055 * Math.exp(-(((x - DIM.FA) / 0.5) ** 2)) + 0.055 * Math.exp(-(((x - DIM.RA) / 0.55) ** 2));
  const nx = DIM.xf - DIM.noseR;
  if (x > nx) { const d = x - nx; w -= DIM.noseR - Math.sqrt(Math.max(0, DIM.noseR ** 2 - d * d)); }
  const tx = DIM.xr + DIM.tailR;
  if (x < tx) { const d = tx - x; w -= DIM.tailR - Math.sqrt(Math.max(0, DIM.tailR ** 2 - d * d)); }

  const yc = yb + (yt - yb) * 0.6;
  const ends = smooth(DIM.xr + 0.08, DIM.xr + 0.3, x) * (1 - smooth(2.35, 2.55, x));
  const tail = smooth(-2.2, -2.65, x);              // rear quarters square off toward the tailgate
  return {
    x, yb, yt, yc, hu: yt - yc, hl: yc - yb, w,
    nU: lerp(lerp(lerp(5.5, 4.5, smooth(0.95, 1.3, x)), 6, smooth(2.2, 2.5, x)), 9, tail),
    nL: lerp(lerp(4, 12, smooth(2.08, 2.4, x)), 8, tail),   // bumper corners square off down to the splitter
    tumble: lerp(lerp(0.07, 0.03, smooth(2.2, 2.5, x)), 0.02, tail),
    tuck: 0.06,
    shoulderY: yt - 0.11, shoulder: 0.012 * ends,   // crease that follows the hood and beltline
    lowerY: 0.65, lower: 0.008 * ends,              // reflection line low on the doors
  };
}

function widthFactor(st, y) {
  let f = y > st.yc
    ? 1 - st.tumble * Math.pow((y - st.yc) / st.hu, 1.5)
    : 1 - st.tuck * ((st.yc - y) / st.hl) ** 2;
  return f * (1 + st.shoulder * Math.exp(-(((y - st.shoulderY) / 0.02) ** 2)) + st.lower * Math.exp(-(((y - st.lowerY) / 0.025) ** 2)));
}

// Hood sculpting: power dome, a second step on the dome, and the two character creases
function hoodDisp(x, z) {
  if (x < 1.02 || x > 2.62) return 0;
  const az = Math.abs(z);
  const zc = 0.42 + 0.16 * (x - 1.02) / 1.55;                     // creases fan out toward the headlights
  const crease = 0.014 * smooth(1.02, 1.15, x) * (1 - smooth(2.45, 2.6, x)) * Math.exp(-(((az - zc) / 0.022) ** 2));
  const dome = 0.03 * smooth(1.02, 1.2, x) * (1 - smooth(2.35, 2.55, x)) * (1 - smooth(zc - 0.13, zc - 0.03, az));
  const ridge = 0.008 * smooth(1.05, 1.2, x) * (1 - smooth(2.2, 2.45, x)) * Math.exp(-((az / 0.035) ** 2));
  return dome + crease + ridge;
}

function bodyPoint(st, th) {
  const s = Math.sin(th), c = Math.max(0, Math.cos(th));
  const up = s >= 0, n = up ? st.nU : st.nL, h = up ? st.hu : st.hl;
  let y = st.yc + h * Math.sign(s) * Math.pow(Math.abs(s), 2 / n);
  const z = st.w * Math.pow(c, 2 / n) * widthFactor(st, y);
  if (y > st.yc) y += hoodDisp(st.x, z) * Math.pow((y - st.yc) / st.hu, 3);
  return [Math.max(y, archY(st.x)), z];
}

// Half-width of the body side at height y (ignores arch cut-outs)
function sideZ(x, y) {
  const st = station(x);
  const up = y >= st.yc, n = up ? st.nU : st.nL, h = up ? st.hu : st.hl;
  const t = Math.abs(y - st.yc) / h;
  if (t >= 1) return 0;
  return st.w * Math.pow(1 - Math.pow(t, n), 1 / n) * widthFactor(st, y);
}

// Height of the upper body surface at (x, z)
function topY(x, z) {
  const st = station(x), az = Math.abs(z);
  let y = st.yt;
  for (let i = 0; i < 10; i++) {
    const r = Math.min(1, az / (st.w * widthFactor(st, y)));
    y = st.yc + st.hu * Math.pow(1 - Math.pow(r, st.nU), 1 / st.nU);
  }
  return y + hoodDisp(x, az) * Math.pow((y - st.yc) / st.hu, 3);
}

// Greenhouse: rounded arch section with strong tumblehome
const CAB = { yb: 1.08, wb: 0.85, n: 10, tb: 0.1, x0: 1.0, x1: -0.67, roofX: 0.29, cPillarX: -0.4, corner: 0.8 };
function cabTop(x) {
  const wind = 1.195 + (CAB.x0 - x) * 0.68;
  const roof = 1.69 - 0.08 * (x + 0.2) ** 2;
  let y = softmin(wind, roof, 0.015);
  const r = 0.11, x2 = -0.56;
  if (x < x2) { const d = x2 - x; y -= r - Math.sqrt(Math.max(0, r * r - d * d)); }
  return y;
}
function cabPoint(x, phi) {
  const h = cabTop(x) - CAB.yb;
  const y = CAB.yb + h * Math.pow(Math.max(0, Math.sin(phi)), 2 / CAB.n);
  const z = CAB.wb * Math.pow(Math.max(0, Math.cos(phi)), 2 / CAB.n) * (1 - CAB.tb * (y - CAB.yb) / 0.5);
  return [y, z];
}
function cabZ(x, y) {
  const h = cabTop(x) - CAB.yb, t = clamp((y - CAB.yb) / h, 0, 1);
  const sinp = Math.pow(t, CAB.n / 2), cosp = Math.sqrt(Math.max(0, 1 - sinp * sinp));
  return CAB.wb * Math.pow(cosp, 2 / CAB.n) * (1 - CAB.tb * (y - CAB.yb) / 0.5);
}

// ---- loft builders: plain arrays, so they can be previewed without a renderer
function bodyMesh() {
  const xs = new Set([DIM.xr, DIM.xf]);
  for (let x = DIM.xr; x < DIM.xf; x += 0.045) xs.add(+x.toFixed(5));
  for (let i = 0; i <= 10; i++) {
    xs.add(+(DIM.xf - 0.22 * (i / 10) ** 2).toFixed(5));
    xs.add(+(DIM.xr + 0.16 * (i / 10) ** 2).toFixed(5));
  }
  for (const ax of [DIM.RA, DIM.FA]) for (const s of [-1, 1]) {
    for (let i = 0; i <= 8; i++) xs.add(+(ax + s * (DIM.AR - 0.0006 - 0.08 * (i / 8) ** 2)).toFixed(5));
    xs.add(+(ax + s * (DIM.AR + 0.0006)).toFixed(5));
  }
  const X = [...xs].filter(x => x >= DIM.xr && x <= DIM.xf).sort((a, b) => a - b);
  const Mh = 30, R = 2 * Mh;
  const pos = [], idx = [], valance = [];
  const rings = [];
  for (const x of X) {
    const st = station(x), ring = [];
    for (let j = 0; j <= Mh; j++) {
      const u = -1 + 2 * j / Mh, k = (u >= 0 ? st.nU : st.nL) / 2;
      ring.push(bodyPoint(st, Math.sign(u) * Math.PI / 2 * spread(Math.abs(u), k)));
    }
    for (let j = Mh - 1; j >= 1; j--) { const [y, z] = ring[j]; ring.push([y, -z]); }
    rings.push(ring);
    for (const [y, z] of ring) pos.push(x, y, z);
  }
  for (let i = 0; i < X.length - 1; i++) for (let j = 0; j < R; j++) {
    const a = i * R + j, b = i * R + (j + 1) % R, c = (i + 1) * R + j, d = (i + 1) * R + (j + 1) % R;
    const xm = (X[i] + X[i + 1]) / 2, ym = (pos[a * 3 + 1] + pos[d * 3 + 1]) / 2;
    (xm > VALANCE.x && ym < VALANCE.top ? valance : idx).push(a, c, b, b, c, d);
  }
  // end caps with their own vertices so they shade flat
  const cap = (ri, sign) => {
    const ring = rings[ri], x = X[ri], base = pos.length / 3;
    const st = station(x);
    pos.push(x, st.yc, 0);
    for (const [y, z] of ring) pos.push(x, y, z);
    for (let j = 0; j < R; j++) {
      const p = base + 1 + j, q = base + 1 + (j + 1) % R;
      if (sign > 0) idx.push(base, q, p); else idx.push(base, p, q);
    }
  };
  cap(X.length - 1, 1); cap(0, -1);
  return { pos, idx, valance };
}

function cabMesh() {
  const xs = new Set([CAB.x1, CAB.x0, CAB.cPillarX, CAB.roofX]);
  for (let x = CAB.x1; x < CAB.x0; x += 0.04) xs.add(+x.toFixed(5));
  for (let i = 0; i <= 12; i++) xs.add(+(CAB.x1 + 0.11 * (i / 12) ** 1.5).toFixed(5));
  const X = [...xs].sort((a, b) => a - b);
  const Mc = 18, R = 2 * Mc + 1;
  const phiAt = j => spread((j <= Mc ? j : 2 * Mc - j) / Mc, CAB.n / 2) * Math.PI / 2;
  const pos = [], paint = [], glass = [];
  for (const x of X) for (let j = 0; j < R; j++) {
    const [y, z] = cabPoint(x, phiAt(j));
    pos.push(x, y, j <= Mc ? z : -z);
  }
  for (let i = 0; i < X.length - 1; i++) for (let j = 0; j < R - 1; j++) {
    const a = i * R + j, b = i * R + j + 1, c = (i + 1) * R + j, d = (i + 1) * R + j + 1;
    const xm = (X[i] + X[i + 1]) / 2, phm = (phiAt(j) + phiAt(j + 1)) / 2;
    const ym = (pos[a * 3 + 1] + pos[d * 3 + 1]) / 2;
    const isPaint = ym < 1.22 || (xm < CAB.roofX && phm > CAB.corner) || xm < CAB.cPillarX;
    (isPaint ? paint : glass).push(a, c, b, b, c, d);
  }
  // back wall of the cab
  const base = pos.length / 3, x = X[0], h = cabTop(x) - CAB.yb;
  pos.push(x, CAB.yb + h * 0.35, 0);
  for (let j = 0; j < R; j++) pos.push(pos[j * 3], pos[j * 3 + 1], pos[j * 3 + 2]);
  for (let j = 0; j < R; j++) paint.push(base, base + 1 + j, base + 1 + (j + 1) % R);
  return { pos, paint, glass };
}

// ---------------------------------------------------------------- THREE scene
function buildTruck(THREE, opts = {}) {
  const g = new THREE.Group();
  g.name = 'FOX_Race_Truck';

  const M = {
    paint: new THREE.MeshPhysicalMaterial({ name: 'Paint', color: 0x7a1518, metalness: 0.55, roughness: 0.32, clearcoat: 1, clearcoatRoughness: 0.08 }),
    trim: new THREE.MeshStandardMaterial({ name: 'BlackTrim', color: 0x151517, metalness: 0.2, roughness: 0.55 }),
    carbon: new THREE.MeshStandardMaterial({ name: 'Carbon', color: 0x1c1c20, metalness: 0.35, roughness: 0.4 }),
    glass: new THREE.MeshPhysicalMaterial({ name: 'Glass', color: 0x9cc0e0, metalness: 0, roughness: 0.04, transparent: true, opacity: 0.28, depthWrite: false, side: THREE.DoubleSide }),
    cage: new THREE.MeshStandardMaterial({ name: 'RollCage', color: 0x5f7396, metalness: 0.6, roughness: 0.35 }),
    tire: new THREE.MeshStandardMaterial({ name: 'Tire', color: 0x0e0e10, metalness: 0, roughness: 0.92 }),
    rim: new THREE.MeshStandardMaterial({ name: 'Rim', color: 0x1a1a1e, metalness: 0.75, roughness: 0.3 }),
    smoke: new THREE.MeshPhysicalMaterial({ name: 'SmokedLens', color: 0x222428, metalness: 0.3, roughness: 0.08, clearcoat: 1 }),
    led: new THREE.MeshStandardMaterial({ name: 'LED', color: 0xdfe8ff, emissive: 0xbfd2ff, emissiveIntensity: 1.4 }),
    tail: new THREE.MeshStandardMaterial({ name: 'TailLight', color: 0xa0141a, emissive: 0x5a0508, emissiveIntensity: 0.8, roughness: 0.2 }),
    bed: new THREE.MeshStandardMaterial({ name: 'BedFloor', color: 0x4a1215, metalness: 0.35, roughness: 0.55 }),
    net: new THREE.LineBasicMaterial({ name: 'WindowNet', color: 0x111111 }),
    badge: new THREE.MeshPhysicalMaterial({ name: 'Badge', color: 0x34353b, metalness: 0.75, roughness: 0.28, clearcoat: 0.6 }),
    lens: new THREE.MeshPhysicalMaterial({ name: 'ProjectorLens', color: 0xcfd8e6, emissive: 0x6d7b96, emissiveIntensity: 0.35, metalness: 0.1, roughness: 0.02, clearcoat: 1 }),
  };
  const grilleMat = opts.grilleTexture
    ? new THREE.MeshStandardMaterial({ name: 'Grille', map: opts.grilleTexture, metalness: 0.4, roughness: 0.5 })
    : new THREE.MeshStandardMaterial({ name: 'Grille', color: 0x202024, metalness: 0.4, roughness: 0.5 });

  let target = g;
  const add = (mesh, name, parent = target) => { mesh.name = name; mesh.castShadow = true; mesh.receiveShadow = true; parent.add(mesh); return mesh; };
  const box = (sx, sy, sz, mat, x, y, z, name, parent) => {
    const m = new THREE.Mesh(new THREE.BoxGeometry(sx, sy, sz), mat);
    m.position.set(x, y, z); return add(m, name, parent);
  };
  const tube = (a, b, r, mat, name) => {
    const A = new THREE.Vector3(...a), B = new THREE.Vector3(...b);
    const m = new THREE.Mesh(new THREE.CylinderGeometry(r, r, A.distanceTo(B), 12), mat);
    m.position.copy(A).add(B).multiplyScalar(0.5);
    m.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), B.clone().sub(A).normalize());
    return add(m, name);
  };
  const pathTube = (pts, r, mat, name) => {
    const curve = new THREE.CatmullRomCurve3(pts.map(p => new THREE.Vector3(...p)));
    return add(new THREE.Mesh(new THREE.TubeGeometry(curve, Math.max(16, pts.length * 4), r, 8, false), mat), name);
  };
  const fromArrays = (pos, groups) => {
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    const all = []; let start = 0;
    groups.forEach((list, mi) => { for (const v of list) all.push(v); geo.addGroup(start, list.length, mi); start += list.length; });
    geo.setIndex(all);
    geo.computeVertexNormals();
    return geo;
  };

  // ---------- Body shell and greenhouse
  {
    const b = bodyMesh();
    add(new THREE.Mesh(fromArrays(b.pos, [b.idx, b.valance]), [M.paint, M.carbon]), 'Body');
    const c = cabMesh();
    add(new THREE.Mesh(fromArrays(c.pos, [c.paint, c.glass]), [M.paint, M.glass]), 'Cab');
  }

  // A-pillars follow the corner of the greenhouse section
  for (const s of [-1, 1]) {
    const pts = [];
    for (let x = 0.97; x >= CAB.roofX; x -= 0.03) { const [y, z] = cabPoint(x, CAB.corner); pts.push([x, y + 0.006, s * (z + 0.008)]); }
    pathTube(pts, 0.032, M.paint, 'APillar');
  }

  // Fender lips around each arch, riding on the body side
  for (const ax of [DIM.RA, DIM.FA]) for (const s of [-1, 1]) {
    const pts = [];
    for (let i = 0; i <= 24; i++) {
      const a = Math.PI * i / 24, r = DIM.AR + 0.012;
      const x = ax + r * Math.cos(a), y = DIM.AY + r * Math.sin(a);
      pts.push([x, y, s * (sideZ(x, y) - 0.012)]);
    }
    pathTube(pts, 0.024, M.paint, 'FenderLip');
  }

  // ---------- Hood hardware placed on the sculpted surface
  const up = new THREE.Vector3(0, 1, 0);
  const surfNormal = (x, z) => {
    const e = 0.01;
    return new THREE.Vector3(-(topY(x + e, z) - topY(x - e, z)) / (2 * e), 1, -(topY(x, z + e) - topY(x, z - e)) / (2 * e)).normalize();
  };
  const onSurface = (obj, x, z, lift = 0) => {
    obj.position.set(x, topY(x, z) + lift, z);
    obj.quaternion.setFromUnitVectors(up, surfNormal(x, z));
    g.add(obj); return obj;
  };
  for (const s of [-1, 1]) {
    // Louvred heat-extractor vent between the dome and the crease
    const vent = new THREE.Group(); vent.name = 'HoodVent';
    box(0.34, 0.012, 0.19, M.trim, 0, 0, 0, 'HoodVentWell', vent);
    for (const dz of [-0.1, 0.1]) box(0.36, 0.016, 0.012, M.carbon, 0, 0.004, dz, 'HoodVentFrame', vent);
    for (const dx of [-0.176, 0.176]) box(0.012, 0.016, 0.21, M.carbon, dx, 0.004, 0, 'HoodVentFrame', vent);
    for (let i = 0; i < 6; i++) box(0.045, 0.006, 0.18, M.paint, -0.135 + i * 0.054, 0.01, 0, 'HoodLouver', vent).rotation.z = 0.55;
    onSurface(vent, 2.12, s * 0.74);
    vent.rotateY(s * 0.12);

    // Hood pins
    const pin = new THREE.Group(); pin.name = 'HoodPin';
    add(new THREE.Mesh(new THREE.CylinderGeometry(0.02, 0.022, 0.01, 18), M.rim), 'HoodPinBase', pin);
    const clip = add(new THREE.Mesh(new THREE.TorusGeometry(0.014, 0.003, 6, 16), M.rim), 'HoodPinClip', pin);
    clip.position.y = 0.012; clip.rotation.y = Math.PI / 2;
    onSurface(pin, 2.47, s * 0.42, 0.002);

    // Shut lines between hood and fenders
    const shut = [];
    for (let x = 1.02; x <= 2.55; x += 0.06) shut.push([x, topY(x, 0.86) + 0.0015, s * 0.86]);
    pathTube(shut, 0.0035, M.trim, 'HoodShutLine');
  }
  {
    const lead = [], cowl = [];
    for (let z = -0.86; z <= 0.861; z += 0.06) {
      lead.push([2.555, topY(2.555, z) + 0.0015, z]);
      cowl.push([0.985, topY(0.985, z) + 0.006, z * 0.95]);
    }
    pathTube(lead, 0.0035, M.trim, 'HoodShutLine');
    pathTube(cowl, 0.02, M.trim, 'Cowl');
  }

  // ---------- Roll cage, sized to the greenhouse
  {
    const cz = (x, y, inset) => Math.max(0.18, cabZ(x, y) - inset);
    const hx = -0.5, fx = 0.2, yt = 1.6, yf = 1.6;
    for (const s of [-1, 1]) {
      tube([hx, 0.5, s * 0.7], [hx, 1.1, s * cz(hx, 1.1, 0.1)], 0.025, M.cage, 'CageHoop');
      tube([hx, 1.1, s * cz(hx, 1.1, 0.1)], [hx, yt, s * cz(hx, yt, 0.08)], 0.025, M.cage, 'CageHoop');
      tube([hx, yt, s * cz(hx, yt, 0.08)], [fx, yf, s * cz(fx, yf, 0.08)], 0.025, M.cage, 'CageRoofBar');
      tube([fx, yf, s * cz(fx, yf, 0.08)], [0.85, 0.98, s * 0.7], 0.025, M.cage, 'CageAPillar');
      tube([hx, 0.8, s * 0.72], [0.8, 0.8, s * 0.72], 0.022, M.cage, 'CageDoorBar');
      tube([hx, 1.0, s * 0.7], [0.75, 1.0, s * 0.7], 0.02, M.cage, 'CageDoorBar');
      // rear stays run back over the bed, as on the design sheet
      tube([hx, yt, s * cz(hx, yt, 0.08)], [-1.45, topY(-1.45, 0.55) + 0.01, s * 0.55], 0.022, M.cage, 'CageRearStay');
    }
    const ht = cz(hx, yt, 0.08), ft = cz(fx, yf, 0.08);
    tube([hx, yt, -ht], [hx, yt, ht], 0.025, M.cage, 'CageCross');
    tube([fx, yf, -ft], [fx, yf, ft], 0.025, M.cage, 'CageCross');
    tube([hx, yt, -ht], [hx, 0.6, 0.7], 0.02, M.cage, 'CageDiagonal');
    tube([hx, yt, -ht], [fx, yf, ft], 0.02, M.cage, 'CageRoofX');
    tube([hx, yt, ht], [fx, yf, -ft], 0.02, M.cage, 'CageRoofX');
  }

  // Driver-side window net (left = -Z), bent to the side glass
  {
    const pts = [], x0 = -0.36, y0 = 1.25, y1 = 1.56;
    const xEnd = y => 0.75 - (y - y0) * 1.4;
    const at = (x, y) => [x, y, -(cabZ(x, y) + 0.008)];
    const n = 8;
    for (let i = 0; i <= n; i++) {
      const y = y0 + (y1 - y0) * i / n, xe = xEnd(y);
      for (let k = 0; k < 8; k++) pts.push(...at(x0 + (xe - x0) * k / 8, y), ...at(x0 + (xe - x0) * (k + 1) / 8, y));
    }
    for (let i = 0; i <= 9; i++) {
      const x = x0 + (xEnd(y0) - x0) * i / 9;
      let yTop = y1; if (x > xEnd(y1)) yTop = y0 + (0.75 - x) / 1.4;
      for (let k = 0; k < 6; k++) pts.push(...at(x, y0 + (yTop - y0) * k / 6), ...at(x, y0 + (yTop - y0) * (k + 1) / 6));
    }
    const geo = new THREE.BufferGeometry(); geo.setAttribute('position', new THREE.Float32BufferAttribute(pts, 3));
    const net = new THREE.LineSegments(geo, M.net); net.name = 'WindowNet'; g.add(net);
    const frame = []; for (let y = y0; y <= y1 + 1e-6; y += 0.03) frame.push(at(x0, y));
    pathTube(frame, 0.01, M.trim, 'NetFrame');
  }

  // Cab rear window
  box(0.02, 0.13, 0.9, M.smoke, CAB.x1 - 0.006, 1.39, 0, 'RearWindow');

  // ---------- Front fascia
  const F = DIM.xf + 0.005;
  const toV = ([z, y]) => new THREE.Vector2(-z, y);
  function opposite(hole, outer) {
    return THREE.ShapeUtils.isClockWise(hole) === THREE.ShapeUtils.isClockWise(outer) ? hole.slice().reverse() : hole;
  }
  // Outline given as [z, y] seen from the front, pushed out toward +X with its face at xFront
  const nosePart = (pts, depth, mat, xFront, name, holes = [], bevel = 0) => {
    const outer = pts.map(toV), sh = new THREE.Shape(outer);
    for (const h of holes) sh.holes.push(new THREE.Path(opposite(h.map(toV), outer)));
    const geo = new THREE.ExtrudeGeometry(sh, { depth: depth - bevel * 2, bevelEnabled: bevel > 0, bevelThickness: bevel, bevelSize: bevel, bevelSegments: 3, curveSegments: 12 });
    const m = new THREE.Mesh(geo, mat);
    m.rotation.y = Math.PI / 2; m.position.x = xFront - depth + bevel;
    return add(m, name);
  };
  // Same idea at the tail, pushed toward -X with its face at xRear
  const tailPart = (pts, depth, mat, xRear, name) => {
    const sh = new THREE.Shape(pts.map(([z, y]) => new THREE.Vector2(z, y)));
    const m = new THREE.Mesh(new THREE.ExtrudeGeometry(sh, { depth, bevelEnabled: false }), mat);
    m.rotation.y = -Math.PI / 2; m.position.x = xRear + depth;
    return add(m, name);
  };
  const mirrorZ = (pts, s) => pts.map(([z, y]) => [z * s, y]);
  const meshPanel = (w, h, x, y, z, rep, name) => {
    let mat = grilleMat;
    if (opts.grilleTexture) {
      const t = opts.grilleTexture.clone(); t.needsUpdate = true;
      t.wrapS = t.wrapT = THREE.RepeatWrapping; t.repeat.set(rep[0], rep[1]);
      mat = new THREE.MeshStandardMaterial({ name: 'Mesh', map: t, metalness: 0.4, roughness: 0.5 });
    }
    const p = new THREE.Mesh(new THREE.PlaneGeometry(w, h), mat);
    p.rotation.y = Math.PI / 2; p.position.set(x, y, z);
    return add(p, name);
  };

  // Fascia group: lets the whole front end be scaled about the bottom of the nose if the nose height changes
  const fascia = new THREE.Group(); fascia.name = 'Fascia';
  fascia.position.y = 0.17; fascia.scale.y = 1.0; g.add(fascia);
  const fasciaInner = new THREE.Group(); fasciaInner.position.y = -0.17; fascia.add(fasciaInner);
  target = fasciaInner;

  // Grille: wide, chamfered lower corners, honeycomb insert, raised FOX letters
  const gOuter = [[-0.56, 0.86], [0.56, 0.86], [0.55, 0.64], [0.5, 0.595], [-0.5, 0.595], [-0.55, 0.64]];
  const gInner = [[-0.52, 0.825], [0.52, 0.825], [0.512, 0.655], [0.475, 0.628], [-0.475, 0.628], [-0.512, 0.655]];
  nosePart(gOuter, 0.13, M.trim, F + 0.05, 'GrilleSurround', [gInner], 0.008);
  meshPanel(1.06, 0.27, F + 0.004, 0.726, 0, [0.9, 0.9], 'GrilleMesh');
  {
    const h = 0.15, t = 0.042, y0 = 0.652, V = (a, b) => new THREE.Vector2(a, b);
    const letters = [];
    let x = -0.3, w = 0.15;
    letters.push(new THREE.Shape([
      [x, y0], [x + t, y0], [x + t, y0 + h * 0.4], [x + w * 0.82, y0 + h * 0.4], [x + w * 0.82, y0 + h * 0.4 + t * 0.85],
      [x + t, y0 + h * 0.4 + t * 0.85], [x + t, y0 + h - t], [x + w, y0 + h - t], [x + w, y0 + h], [x, y0 + h],
    ].map(([a, b]) => V(a, b))));
    const oct = (x0, yb, ww, hh, c) => [[x0 + c, yb], [x0 + ww - c, yb], [x0 + ww, yb + c], [x0 + ww, yb + hh - c], [x0 + ww - c, yb + hh], [x0 + c, yb + hh], [x0, yb + hh - c], [x0, yb + c]].map(([a, b]) => V(a, b));
    x = -0.105; w = 0.19;
    const oOuter = oct(x, y0, w, h, 0.036), O = new THREE.Shape(oOuter);
    O.holes.push(new THREE.Path(opposite(oct(x + t, y0 + t * 0.8, w - 2 * t, h - 1.6 * t, 0.013), oOuter)));
    letters.push(O);
    x = 0.11;
    const a = 0.052, d = 0.025, e = 0.029;
    letters.push(new THREE.Shape([
      [x, y0], [x + a, y0], [x + w / 2, y0 + h / 2 - d], [x + w - a, y0], [x + w, y0], [x + w / 2 + e, y0 + h / 2],
      [x + w, y0 + h], [x + w - a, y0 + h], [x + w / 2, y0 + h / 2 + d], [x + a, y0 + h], [x, y0 + h], [x + w / 2 - e, y0 + h / 2],
    ].map(([p, q]) => V(p, q))));
    for (const sh of letters) {
      const geo = new THREE.ExtrudeGeometry(sh, { depth: 0.018, bevelEnabled: true, bevelThickness: 0.004, bevelSize: 0.004, bevelSegments: 2 });
      const m = new THREE.Mesh(geo, M.badge);
      m.rotation.y = Math.PI / 2; m.position.x = F + 0.008;
      add(m, 'GrilleLetter');
    }
  }

  for (const s of [-1, 1]) {
    // Headlights: as tall as the grille, stepping down toward the wrapped corners
    nosePart(mirrorZ([[0.575, 0.86], [0.775, 0.835], [0.805, 0.66], [0.75, 0.63], [0.585, 0.66]], s), 0.12, M.smoke, F + 0.035, 'Headlight', [], 0.006);
    nosePart(mirrorZ([[0.57, 0.875], [0.745, 0.85], [0.755, 0.837], [0.575, 0.862]], s), 0.13, M.trim, F + 0.04, 'HeadlightBezel');
    nosePart(mirrorZ([[0.6, 0.848], [0.79, 0.826], [0.79, 0.815], [0.6, 0.837]], s), 0.02, M.led, F + 0.04, 'HeadlightDRL');
    nosePart(mirrorZ([[0.78, 0.826], [0.792, 0.824], [0.8, 0.69], [0.788, 0.688]], s), 0.02, M.led, F + 0.04, 'HeadlightDRL');
    nosePart(mirrorZ([[0.72, 0.655], [0.8, 0.69], [0.8, 0.702], [0.716, 0.667]], s), 0.02, M.led, F + 0.04, 'HeadlightDRL');
    for (let i = 0; i < 3; i++) {
      const z = 0.72 + i * 0.022;
      nosePart(mirrorZ([[z, 0.8], [z + 0.009, 0.8], [z + 0.009, 0.71], [z, 0.71]], s), 0.02, M.led, F + 0.038, 'HeadlightLEDBar');
    }
    for (const pz of [0.625, 0.685]) {
      const lens = new THREE.Mesh(new THREE.CylinderGeometry(0.026, 0.026, 0.02, 24), M.lens);
      lens.rotation.z = Math.PI / 2; lens.position.set(F + 0.036, 0.755, s * pz); add(lens, 'ProjectorLens');
      const ring = new THREE.Mesh(new THREE.TorusGeometry(0.029, 0.005, 8, 24), M.rim);
      ring.rotation.y = Math.PI / 2; ring.position.set(F + 0.04, 0.755, s * pz); add(ring, 'ProjectorRing');
    }

    // Brake ducts beside the lower intake, plus slim vertical slots at the corners
    const duct = mirrorZ([[0.6, 0.47], [0.74, 0.475], [0.72, 0.24], [0.63, 0.23]], s);
    const ductIn = mirrorZ([[0.615, 0.455], [0.725, 0.458], [0.706, 0.255], [0.643, 0.248]], s);
    nosePart(duct, 0.18, M.trim, F + 0.02, 'BrakeDuct', [ductIn], 0.006);
    nosePart(ductIn, 0.14, M.carbon, F - 0.03, 'BrakeDuctBack');
    for (const y of [0.31, 0.38]) box(0.03, 0.01, 0.12, M.trim, F - 0.01, y, s * 0.672, 'BrakeDuctSlat');
    nosePart(mirrorZ([[0.775, 0.52], [0.81, 0.52], [0.805, 0.3], [0.78, 0.3]], s), 0.1, M.trim, F + 0.006, 'CornerSlot');

    // Stacked dive planes on the wrapped corners
    for (const [y, len] of [[0.3, 0.2], [0.41, 0.15]]) {
      const c = box(len, 0.012, 0.14, M.carbon, DIM.xf - 0.05, y, s * 0.93, 'Canard');
      c.rotation.z = 0.28; c.rotation.y = s * 0.25;
    }
  }

  // Lower bumper: wide trapezoid intake with honeycomb
  box(0.04, 0.008, 1.0, M.trim, F + 0.015, 0.592, 0, 'GrilleShutLine');
  const liOuter = [[-0.52, 0.45], [0.52, 0.45], [0.58, 0.22], [-0.58, 0.22]];
  const liInner = [[-0.49, 0.425], [0.49, 0.425], [0.548, 0.245], [-0.548, 0.245]];
  nosePart(liOuter, 0.18, M.trim, F + 0.03, 'LowerIntakeSurround', [liInner], 0.006);
  meshPanel(1.12, 0.19, F - 0.005, 0.335, 0, [1.0, 0.65], 'LowerIntakeMesh');
  target = g;

  // Valance across the nose face: the bottom of the front cap, traced from the body section
  {
    const st = station(DIM.xf), half = [];
    for (let j = 0; j <= 48; j++) {
      const u = -1 + j / 48;                                    // bottom centre up to the widest point
      const [y, z] = bodyPoint(st, -Math.PI / 2 * spread(-u, st.nL / 2));
      if (y <= VALANCE.top) half.push([z, y]);
      else { const [z0, y0] = half[half.length - 1], t = (VALANCE.top - y0) / (y - y0); half.push([z0 + (z - z0) * t, VALANCE.top]); break; }
    }
    const outline = [...half.map(([z, y]) => [-z, y]).reverse(), ...half.slice(1)];
    nosePart(outline, 0.01, M.carbon, F + 0.001, 'FrontValance');
  }

  // Splitter: follows the bumper outline in plan view and sits directly under it,
  // standing about 10 cm proud at the nose and tapering to a couple of centimetres at the wheels
  {
    const yS = 0.16, side = [];
    for (let x = 2.12; x < DIM.xf - 0.12; x += 0.02) side.push([x, sideZ(x, yS)]);
    for (let i = 0; i <= 24; i++) { const x = DIM.xf - 0.12 * (1 - i / 24) ** 2; side.push([x, sideZ(x, yS)]); }
    side.push([DIM.xf, side[side.length - 1][1] * 0.5], [DIM.xf, 0]);
    const off = side.map((p, i) => {
      const a = side[Math.max(0, i - 1)], b = side[Math.min(side.length - 1, i + 1)];
      let tx = b[0] - a[0], tz = b[1] - a[1]; const l = Math.hypot(tx, tz) || 1; tx /= l; tz /= l;
      const d = 0.025 + 0.075 * smooth(2.4, DIM.xf, p[0]);
      return [p[0] - tz * d, p[1] + tx * d];
    });
    off[off.length - 1][1] = 0;
    const ring = [...off, ...off.slice(0, -1).reverse().map(([x, z]) => [x, -z])];
    const sh = new THREE.Shape(ring.map(([x, z]) => new THREE.Vector2(x, -z)));
    const geo = new THREE.ExtrudeGeometry(sh, { depth: 0.012, bevelEnabled: true, bevelThickness: 0.004, bevelSize: 0.004, bevelSegments: 2, curveSegments: 4 });
    const m = add(new THREE.Mesh(geo, M.carbon), 'Splitter');
    m.rotation.x = -Math.PI / 2; m.position.y = 0.113;
  }

  // ---------- Sides
  for (const s of [-1, 1]) {
    const zs = sideZ(0, 0.18);
    box(2.2, 0.07, 0.05, M.carbon, 0.035, 0.175, s * (zs + 0.008), 'SideSkirt');
    const hz = sideZ(0.5, 1.06);
    box(0.2, 0.025, 0.012, M.trim, 0.5, 1.06, s * (hz + 0.004), 'DoorHandle');
  }
  tube([0.82, 1.25, -cabZ(0.82, 1.25)], [0.8, 1.29, -1.0], 0.012, M.trim, 'MirrorArm');
  box(0.08, 0.06, 0.12, M.trim, 0.79, 1.3, -1.03, 'Mirror');
  // Side exhaust exit ahead of the rear wheel (passenger side)
  {
    const ez = sideZ(-0.62, 0.24);
    box(0.26, 0.08, 0.06, M.carbon, -0.62, 0.24, ez + 0.01, 'ExhaustShield');
    tube([-0.62, 0.235, ez - 0.1], [-0.62, 0.235, ez + 0.05], 0.03, M.rim, 'Exhaust');
  }

  // ---------- Bed: floor that follows the deck, rails along each side
  {
    const nx = 50, nz = 22, x0 = -2.76, x1 = -0.71, zW = 0.74;
    const pos = [], idx = [];
    for (let i = 0; i <= nx; i++) for (let k = 0; k <= nz; k++) {
      const x = x0 + (x1 - x0) * i / nx, z = -zW + 2 * zW * k / nz;
      pos.push(x, topY(x, z) + 0.004, z);
    }
    for (let i = 0; i < nx; i++) for (let k = 0; k < nz; k++) {
      const a = i * (nz + 1) + k, b = a + 1, c = a + nz + 1, d = c + 1;
      idx.push(a, b, c, b, d, c);
    }
    add(new THREE.Mesh(fromArrays(pos, [idx]), M.bed), 'BedFloor');
    for (const s of [-1, 1]) {
      const rail = [];
      for (let x = x0; x <= x1 + 1e-6; x += 0.08) rail.push([x, topY(x, 0.8) + 0.01, s * 0.8]);
      pathTube(rail, 0.02, M.paint, 'BedRail');
    }
  }

  // ---------- Rear spoiler: blade whose foot follows the deck, endplates and braces
  {
    const sx = -2.72, base = topY(sx, 0), top = 0.2, half = 0.8;
    const pivot = new THREE.Group(); pivot.name = 'RearSpoiler';
    pivot.position.set(sx, base, 0); pivot.rotation.z = 0.12; g.add(pivot);
    const outline = [[-half, top], [half, top]];
    for (let k = 0; k <= 24; k++) { const z = half - 2 * half * k / 24; outline.push([z, topY(sx, z) - base - 0.012]); }
    const blade = new THREE.ExtrudeGeometry(new THREE.Shape(outline.map(([z, y]) => new THREE.Vector2(-z, y))), { depth: 0.025, bevelEnabled: false });
    blade.translate(0, 0, -0.0125);
    const bm = add(new THREE.Mesh(blade, M.carbon), 'SpoilerBlade', pivot);
    bm.rotation.y = Math.PI / 2;
    for (const s of [-1, 1]) {
      const ez = 0.81, by = dx => topY(sx + dx, ez) - base - 0.01;
      const ep = new THREE.Shape([[-0.07, by(-0.07)], [0.28, by(0.28)], [0.28, by(0.28) + 0.03], [0, top + 0.005], [-0.045, top + 0.005]].map(([p, q]) => new THREE.Vector2(p, q)));
      const m = add(new THREE.Mesh(new THREE.ExtrudeGeometry(ep, { depth: 0.012, bevelEnabled: false }), M.carbon), 'SpoilerEndplate');
      m.position.set(sx, base, s * ez - 0.006);
      tube([sx + 0.24, topY(sx + 0.24, 0.45) + 0.005, s * 0.45], [sx - 0.012, base + top * 0.6, s * 0.45], 0.01, M.carbon, 'SpoilerBrace');
    }
  }

  // ---------- Tail
  const rx = DIM.xr;
  for (const s of [-1, 1]) {
    tailPart(mirrorZ([[0.76, 1.12], [0.87, 1.12], [0.88, 0.8], [0.77, 0.8]], s), 0.1, M.tail, rx - 0.012, 'TailLight');
    tailPart(mirrorZ([[0.762, 1.118], [0.868, 1.118], [0.869, 1.08], [0.763, 1.08]], s), 0.1, M.smoke, rx - 0.014, 'TailLightClear');
  }
  box(0.03, 0.022, 1.36, M.trim, rx - 0.004, 1.14, 0, 'TailgateLip');
  box(0.02, 0.035, 0.24, M.trim, rx - 0.008, 1.04, 0, 'TailgateHandle');
  box(0.1, 0.1, 1.6, M.carbon, rx + 0.03, 0.36, 0, 'RearBumper');
  for (let i = -2; i <= 2; i++) box(0.45, 0.1, 0.012, M.carbon, rx + 0.3, 0.24, i * 0.25, 'DiffuserFin');
  box(0.5, 0.012, 1.4, M.carbon, rx + 0.3, 0.19, 0, 'DiffuserPlate');

  // ---------- Underbody
  box(4.6, 0.03, 1.2, M.carbon, 0, 0.13, 0, 'Underbody');

  // ---------- Wheels
  const wheel = (x, z, name) => {
    const w = new THREE.Group(); w.name = name;
    const side = Math.sign(z);
    const tire = new THREE.Mesh(new THREE.CylinderGeometry(DIM.wheelR, DIM.wheelR, 0.3, 28), M.tire); tire.rotation.x = Math.PI / 2; w.add(tire);
    const wall = new THREE.Mesh(new THREE.TorusGeometry(DIM.wheelR - 0.045, 0.055, 8, 28), M.tire); wall.position.z = side * 0.13; w.add(wall);
    const rim = new THREE.Mesh(new THREE.CylinderGeometry(0.27, 0.27, 0.04, 40), M.rim); rim.rotation.x = Math.PI / 2; rim.position.z = side * 0.135; w.add(rim);
    for (let i = 0; i < 5; i++) {
      const a = i / 5 * Math.PI * 2;
      const spoke = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.19, 0.03), M.trim);
      spoke.position.set(Math.cos(a) * 0.15, Math.sin(a) * 0.15, side * 0.16); spoke.rotation.z = a - Math.PI / 2; w.add(spoke);
    }
    const hub = new THREE.Mesh(new THREE.CylinderGeometry(0.055, 0.055, 0.06, 16), M.rim); hub.rotation.x = Math.PI / 2; hub.position.z = side * 0.17; w.add(hub);
    const lug = new THREE.Mesh(new THREE.CylinderGeometry(0.025, 0.025, 0.05, 6), new THREE.MeshStandardMaterial({ color: 0x8a8f99, metalness: 0.8, roughness: 0.3 }));
    lug.rotation.x = Math.PI / 2; lug.position.z = side * 0.2; w.add(lug);
    w.position.set(x, DIM.wheelR, z);
    w.traverse(o => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; } });
    g.add(w);
  };
  wheel(DIM.FA, 0.83, 'Wheel_FR'); wheel(DIM.FA, -0.83, 'Wheel_FL');
  wheel(DIM.RA, 0.83, 'Wheel_RR'); wheel(DIM.RA, -0.83, 'Wheel_RL');

  return { group: g, materials: M };
}

// Honeycomb mesh texture for the grille and intakes, browser only.
function makeGrilleTexture(THREE) {
  const cv = document.createElement('canvas'); cv.width = 1024; cv.height = 260;
  const x = cv.getContext('2d');
  x.fillStyle = '#0c0c0e'; x.fillRect(0, 0, cv.width, cv.height);
  x.strokeStyle = '#3a3a41'; x.lineWidth = 4;
  const r = 14, h = r * Math.sqrt(3);
  for (let row = -1; row < cv.height / (h / 2) + 1; row++) for (let col = -1; col < cv.width / (r * 3) + 1; col++) {
    const cx = col * r * 3 + (row % 2 ? r * 1.5 : 0), cy = row * h / 2;
    x.beginPath();
    for (let k = 0; k < 6; k++) { const a = Math.PI / 3 * k; x.lineTo(cx + r * Math.cos(a), cy + r * Math.sin(a)); }
    x.closePath(); x.stroke();
  }
  const t = new THREE.CanvasTexture(cv);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

return {buildTruck,makeGrilleTexture,archY,sideZ,topY,cabTop,station,DIM,CAB};
})();
