export const NUM_FONTS = [
  { id: 'classic', name: 'Classic', family: 'Arial Black', weight: 900, system: true },
  { id: 'racing', name: 'Racing', family: 'Racing Sans One', weight: 400 },
  { id: 'tall', name: 'Tall', family: 'Bebas Neue', weight: 400 },
  { id: 'square', name: 'Square', family: 'Russo One', weight: 400 },
  { id: 'block', name: 'Block', family: 'Bungee', weight: 400 },
  { id: 'inline', name: 'Inline', family: 'Bungee Inline', weight: 400 },
  { id: 'stencil', name: 'Stencil', family: 'Black Ops One', weight: 400 },
  { id: 'future', name: 'Future', family: 'Orbitron', weight: 900 },
  { id: 'jersey', name: 'Jersey', family: 'Graduate', weight: 400 },
  { id: 'slab', name: 'Slab', family: 'Alfa Slab One', weight: 400 },
  { id: 'speed', name: 'Speed', family: 'Faster One', weight: 400 },
  { id: 'wide', name: 'Wide', family: 'Michroma', weight: 400 },
  { id: 'sport', name: 'Sport', family: 'Kanit', weight: 900, italic: true },
  { id: 'marker', name: 'Marker', family: 'Permanent Marker', weight: 400 },
  { id: 'condensed', name: 'Condensed', family: 'Teko', weight: 600 },
  { id: 'techno', name: 'Techno', family: 'Audiowide', weight: 400 },
  { id: 'poster', name: 'Poster', family: 'Anton', weight: 400 },
  { id: 'pixel', name: 'Pixel', family: 'Press Start 2P', weight: 400 },
  { id: 'western', name: 'Western', family: 'Rye', weight: 400 },
  { id: 'bubble', name: 'Bubble', family: 'Fredoka', weight: 700 },
];

export const NUM_STYLES = [
  { id: 'block', name: 'Classic', roles: 'Fill colors the digits and Outline their thin edge.' },
  { id: 'solid', name: 'Solid', roles: 'Fill colors the digits. Nothing else is drawn.' },
  { id: 'outline', name: 'Heavy', roles: 'Fill colors the digits and Outline the thick ring around them.' },
  { id: 'double', name: 'Double', roles: 'Fill colors the digits, Accent the inner ring and Outline the outer ring.' },
  { id: 'shadow', name: 'Drop shadow', roles: 'Fill colors the digits and Outline their edge, over a soft dark shadow.' },
  { id: 'block3d', name: '3D block', roles: 'Fill colors the face, Accent its edge and Outline the extruded side.' },
  { id: 'plate', name: 'Plate', roles: 'Fill colors the plate, Outline the digits and Accent the pinstripe.' },
  { id: 'fade', name: 'Fade', roles: 'The digits fade from Fill at the top to Accent at the bottom, edged in Outline.' },
  { id: 'split', name: 'Split', roles: 'The top half is Fill, the bottom half Accent, edged in Outline.' },
  { id: 'hollow', name: 'Hollow', roles: 'Fill colors the line and Outline its outer edge; the paint shows through.' },
  { id: 'neon', name: 'Neon', roles: 'Fill colors the digits, which glow in Accent.' },
];

export const NUM_PRESETS = [
  { id: 'classic', name: 'White, black and gold', fill: '#ffffff', outline: '#111214', accent: '#d4a72c' },
  { id: 'gold', name: 'Gold, black and white', fill: '#f3c623', outline: '#111214', accent: '#ffffff' },
  { id: 'ink', name: 'Black, white and red', fill: '#111214', outline: '#ffffff', accent: '#c8242b' },
  { id: 'silver', name: 'Silver, navy and red', fill: '#dfe3e8', outline: '#14213d', accent: '#c8242b' },
  { id: 'neon', name: 'Lime, black and white', fill: '#c8ff2e', outline: '#0b0b0c', accent: '#ffffff' },
];

export const NUM_SPOTS = {
  door: { base: 0.33, maxW: 1.8, maxH: 0.74, x: 0.05, y: 0.67 },
  roof: { base: 0.4, maxW: 1.3, maxH: 0.74, x: -0.165 },
  tail: { base: 0.2, maxW: 1.25, maxH: 0.5, y: 0.72 },
};

export const NUM_FONT_IDS = NUM_FONTS.map(f => f.id);
export const NUM_STYLE_IDS = NUM_STYLES.map(s => s.id);
export const numFontOf = id => NUM_FONTS.find(f => f.id === id) || NUM_FONTS[0];
export const numFamily = f => `"${f.family}", "Arial Black", Impact, sans-serif`;
export const numCssFont = (f, px) => `${f.italic ? 'italic ' : ''}${f.weight} ${px}px ${numFamily(f)}`;

const sheetLink = typeof document !== 'undefined' ? document.querySelector('link[data-num-fonts]') : null;
const sheetReady = new Promise(resolve => {
  if (!sheetLink || sheetLink.sheet) { resolve(); return; }
  sheetLink.addEventListener('load', () => resolve(), { once: true });
  sheetLink.addEventListener('error', () => resolve(), { once: true });
  setTimeout(resolve, 8000);
});
const settled = new Set();
const pending = new Map();

export const numFontReady = id => !!numFontOf(id).system || settled.has(numFontOf(id).id);

export function loadNumFont(id) {
  const f = numFontOf(id);
  if (f.system) return Promise.resolve();
  if (!pending.has(f.id)) {
    const p = sheetReady
      .then(() => document.fonts && document.fonts.load ? document.fonts.load(numCssFont(f, 100), '0123456789') : null)
      .catch(() => null)
      .then(() => { settled.add(f.id); });
    pending.set(f.id, p);
  }
  return pending.get(f.id);
}

const SLANT = 0.22;
const scratch = typeof document !== 'undefined' ? document.createElement('canvas') : null;
const shade = typeof document !== 'undefined' ? document.createElement('canvas') : null;

export function drawNumberArt(canvas, o, glyphPx = 320) {
  const text = String(o.text || '');
  if (!text) { canvas.width = canvas.height = 1; return null; }
  const f = numFontOf(o.font), style = o.style;
  let ctx = canvas.getContext('2d');
  ctx.font = numCssFont(f, 100);
  const m0 = ctx.measureText(text);
  const h0 = (m0.actualBoundingBoxAscent + m0.actualBoundingBoxDescent) || 72;
  const px = 100 * glyphPx / h0;
  ctx.font = numCssFont(f, px);
  const m = ctx.measureText(text);
  const L = m.actualBoundingBoxLeft, A = m.actualBoundingBoxAscent, D = m.actualBoundingBoxDescent;
  const gw = L + m.actualBoundingBoxRight, gh = A + D, H = gh;

  const sh = o.slant ? SLANT : 0;
  const thin = 0.05 * H, heavy = 0.12 * H, inner = 0.075 * H, outer = 0.14 * H;
  const plateM = 0.17 * H, plateB = 0.032 * H;
  const glow = 0.16 * H;
  const reach = { solid: 0, block: thin, outline: heavy, double: outer, shadow: thin, block3d: 0.04 * H, plate: plateM,
    fade: 0.045 * H, split: thin, hollow: 0.055 * H, neon: 0.035 * H + glow * 1.5 }[style] ?? thin;
  const drop = style === 'block3d' ? Math.round(0.085 * H) : style === 'shadow' ? Math.round(0.08 * H) : 0;
  const e = reach + 0.03 * H;

  canvas.width = Math.ceil(gw + 2 * e + sh * (gh + 2 * e) + drop);
  canvas.height = Math.ceil(gh + 2 * e + drop);
  ctx = canvas.getContext('2d');
  const tx = e + L + sh * (D + e), ty = e + A;
  const at = (c, dx = 0, dy = 0) => c.setTransform(1, 0, -sh, 1, tx + dx, ty + dy);
  const prep = c => { c.font = numCssFont(f, px); c.textBaseline = 'alphabetic'; c.textAlign = 'left'; c.lineJoin = 'round'; c.lineCap = 'round'; };
  prep(ctx);
  const fill = (s, c = ctx) => { c.fillStyle = s; c.fillText(text, 0, 0); };
  const ring = (s, w, c = ctx) => { c.strokeStyle = s; c.lineWidth = 2 * w; c.strokeText(text, 0, 0); };
  at(ctx);

  switch (style) {
    case 'solid':
      fill(o.fill); break;
    case 'outline':
      ring(o.outline, heavy); fill(o.fill); break;
    case 'double':
      ring(o.outline, outer); ring(o.accent, inner); fill(o.fill); break;
    case 'shadow': {
      shade.width = canvas.width; shade.height = canvas.height;
      const s = shade.getContext('2d'); prep(s); at(s, drop, drop);
      ring('#000', thin, s); fill('#000', s);
      ctx.save(); ctx.setTransform(1, 0, 0, 1, 0, 0); ctx.globalAlpha = 0.55; ctx.drawImage(shade, 0, 0); ctx.restore();
      at(ctx); ring(o.outline, thin); fill(o.fill); break;
    }
    case 'block3d':
      for (let k = drop; k > 0; k--) { at(ctx, k, k); ring(o.outline, 0.04 * H); fill(o.outline); }
      at(ctx); ring(o.accent, 0.04 * H); fill(o.fill); break;
    case 'plate': {
      const x = -L - plateM, y = -A - plateM, w = gw + 2 * plateM, h = gh + 2 * plateM;
      const rr = (inset, r) => {
        const X = x + inset, Y = y + inset, W = w - 2 * inset, Hh = h - 2 * inset, R = Math.max(0, r - inset);
        ctx.beginPath(); ctx.moveTo(X + R, Y); ctx.arcTo(X + W, Y, X + W, Y + Hh, R); ctx.arcTo(X + W, Y + Hh, X, Y + Hh, R);
        ctx.arcTo(X, Y + Hh, X, Y, R); ctx.arcTo(X, Y, X + W, Y, R); ctx.closePath();
      };
      rr(0, 0.13 * H); ctx.fillStyle = o.fill; ctx.fill();
      rr(plateB * 1.6, 0.13 * H); ctx.strokeStyle = o.accent; ctx.lineWidth = plateB; ctx.stroke();
      fill(o.outline); break;
    }
    case 'fade': {
      const g = ctx.createLinearGradient(0, -A, 0, D);
      g.addColorStop(0, o.fill); g.addColorStop(0.45, o.fill); g.addColorStop(1, o.accent);
      ring(o.outline, 0.045 * H); fill(g); break;
    }
    case 'split': {
      const g = ctx.createLinearGradient(0, -A, 0, D);
      g.addColorStop(0, o.fill); g.addColorStop(0.52, o.fill); g.addColorStop(0.52, o.accent); g.addColorStop(1, o.accent);
      ring(o.outline, thin); fill(g); break;
    }
    case 'hollow':
      ring(o.outline, 0.055 * H); ring(o.fill, 0.032 * H);
      ctx.globalCompositeOperation = 'destination-out'; fill('#000');
      ctx.globalCompositeOperation = 'source-over'; break;
    case 'neon':
      ctx.shadowColor = o.accent; ctx.shadowBlur = glow;
      ring(o.accent, 0.035 * H); ring(o.accent, 0.035 * H);
      ctx.shadowBlur = 0; ctx.shadowColor = 'rgba(0,0,0,0)';
      ring(o.accent, 0.035 * H); fill(o.fill); break;
    default:
      ring(o.outline, thin); fill(o.fill);
  }
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  return { width: canvas.width, height: canvas.height, aspect: canvas.width / canvas.height, glyphFrac: gh / canvas.height };
}

export function drawNumberPreview(target, o, bg) {
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  const w = Math.round((target.clientWidth || 72) * dpr), h = Math.round((target.clientHeight || 34) * dpr);
  if (target.width !== w || target.height !== h) { target.width = w; target.height = h; }
  const ctx = target.getContext('2d');
  ctx.fillStyle = bg; ctx.fillRect(0, 0, w, h);
  const info = drawNumberArt(scratch, o, 120);
  if (!info) return;
  const k = Math.min((w * 0.86) / info.width, (h * 0.82) / info.height);
  const dw = info.width * k, dh = info.height * k;
  ctx.drawImage(scratch, (w - dw) / 2, (h - dh) / 2, dw, dh);
}

export function numberSize(spot, art, scale) {
  let h = spot.base * scale / art.glyphFrac, w = h * art.aspect;
  const k = Math.min(1, spot.maxW / w, spot.maxH / h);
  return [w * k, h * k];
}

export const numberCapped = (spot, art, scale) =>
  scale > Math.min(spot.maxW * art.glyphFrac / (spot.base * art.aspect), spot.maxH * art.glyphFrac / spot.base) + 1e-6;

function cabZ(TM, x, y) {
  const C = TM.CAB, h = TM.cabTop(x) - C.yb, t = Math.min(1, Math.max(0, (y - C.yb) / h));
  const sinp = Math.pow(t, C.n / 2), cosp = Math.sqrt(Math.max(0, 1 - sinp * sinp));
  return C.wb * Math.pow(cosp, 2 / C.n) * (1 - C.tb * (y - C.yb) / 0.5);
}

export function cabY(TM, x, z) {
  const az = Math.abs(z);
  let lo = TM.CAB.yb, hi = TM.cabTop(x);
  if (az >= cabZ(TM, x, lo)) return lo;
  for (let i = 0; i < 40; i++) { const mid = (lo + hi) / 2; if (cabZ(TM, x, mid) > az) lo = mid; else hi = mid; }
  return (lo + hi) / 2;
}

export function numberDecalArrays(TM, kind, spot, w, h, o = {}) {
  const lift = o.lift ?? 0.01, du = o.du ?? 0.05, dv = o.dv ?? 0.03;
  const nu = Math.max(2, Math.ceil(w / du)), nv = Math.max(2, Math.ceil(h / dv));
  const place = (a, b) => {
    switch (kind) {
      case 'doorR': { const x = spot.x + a, y = spot.y + b; return [x, y, TM.sideZ(x, y) + lift]; }
      case 'doorL': { const x = spot.x - a, y = spot.y + b; return [x, y, -(TM.sideZ(x, y) + lift)]; }
      case 'roof': { const x = spot.x + b, z = a; return [x, cabY(TM, x, z) + lift, z]; }
      default: return [TM.DIM.xr - lift, spot.y + b, a];
    }
  };
  const pos = [], uv = [], idx = [];
  for (let j = 0; j <= nv; j++) for (let i = 0; i <= nu; i++) {
    const u = i / nu, v = j / nv;
    pos.push(...place((u - 0.5) * w, (v - 0.5) * h)); uv.push(u, v);
  }
  for (let j = 0; j < nv; j++) for (let i = 0; i < nu; i++) {
    const p = j * (nu + 1) + i, q = p + 1, r = p + nu + 1, s = r + 1;
    idx.push(p, q, r, q, s, r);
  }
  return { pos, uv, idx };
}

export const NUM_DECAL_FIT = {
  doorR: { spot: 'door', lift: 0.012, du: 0.05, dv: 0.03 },
  doorL: { spot: 'door', lift: 0.012, du: 0.05, dv: 0.03 },
  roof: { spot: 'roof', lift: 0.008, du: 0.06, dv: 0.06 },
  tail: { spot: 'tail', lift: 0.006, du: 0.08, dv: 0.08 },
};

export function buildNumberMeshes(THREE, TM, o) {
  const out = [];
  if (!o || !o.art || !o.material) return out;
  const kinds = [...(o.doors ? ['doorR', 'doorL'] : []), ...(o.roof ? ['roof'] : []), ...(o.tail ? ['tail'] : [])];
  for (const kind of kinds) {
    const fit = NUM_DECAL_FIT[kind], spot = NUM_SPOTS[fit.spot];
    const [w, h] = numberSize(spot, o.art, o.scale);
    const d = numberDecalArrays(TM, kind, spot, w, h, fit);
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(d.pos, 3));
    geo.setAttribute('uv', new THREE.Float32BufferAttribute(d.uv, 2));
    geo.setIndex(d.idx);
    geo.computeVertexNormals();
    const mesh = new THREE.Mesh(geo, o.material);
    mesh.name = 'RaceNumber_' + kind; mesh.renderOrder = 1;
    out.push(mesh);
  }
  return out;
}

const unpremultiply = shader => {
  shader.fragmentShader = shader.fragmentShader.replace('#include <map_fragment>', '#include <map_fragment>\n\tdiffuseColor.rgb /= max( diffuseColor.a, 1e-4 );');
};

export function makeNumberTexture(THREE, canvas) {
  const t = new THREE.CanvasTexture(canvas);
  t.colorSpace = THREE.SRGBColorSpace; t.premultiplyAlpha = true; t.anisotropy = 8;
  return t;
}

export function makeNumberMaterial(THREE, map) {
  const m = new THREE.MeshPhysicalMaterial({
    map, metalness: 0.05, roughness: 0.35, clearcoat: 1, clearcoatRoughness: 0.08,
    transparent: true, depthWrite: false, premultipliedAlpha: true, side: THREE.DoubleSide,
    polygonOffset: true, polygonOffsetFactor: -6, polygonOffsetUnits: -6,
  });
  m.onBeforeCompile = unpremultiply;
  return m;
}
