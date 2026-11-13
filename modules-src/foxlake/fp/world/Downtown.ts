/**
 * Downtown, the civic block, the gas station, Maple Body & Wheel, the freight
 * depot and the Maple Commons square, from the shared layout. Buildings are
 * boxes wrapped in window-grid facades (glass curtain walls for offices,
 * brick for apartments and hotels, painted storefronts elsewhere) whose
 * windows light up after dark; shops add a glass storefront, an awning and a
 * lit sign. Glowing rings mark every shop door and pump, as in Fox Plains.
 */
import { TransformNode } from '@babylonjs/core/Meshes/transformNode';
import { Color3 } from '@babylonjs/core/Maths/math.color';
import { PBRMaterial } from '@babylonjs/core/Materials/PBR/pbrMaterial';
import { Constants } from '@babylonjs/core/Engines/constants';
import { ChunkedBuilders, MeshBuilder, hostRoot, hexRGB, mixRGB, finishMesh, scaleRGB, type RGB } from '../core/Geo';
import { lin3, pbr, ruledRoughness, type Mats } from '../core/Tex';
import type { Physics } from '../physics/Physics';
import { BUILDINGS, CIVIC, DEPOT, GAS_STATION, SHOP_DOORS, TOWN_SQUARE_RECT, isShopKind, type Building } from '../../../maplestreet/shared/WorldLayout';
import { BODY_SHOP, BODY_SHOP_BAYS } from '../../../maplestreet/shared/BodyShop';

const SIGN_W = 512, SIGN_H = 80, SIGN_COLS = 4;

/** Every storefront's name board painted into one canvas, so all the signs in town are one material and one draw. */
class SignAtlas {
  readonly canvas = document.createElement('canvas');
  private g: CanvasRenderingContext2D;
  private n = 0;
  constructor(count: number) {
    this.canvas.width = SIGN_W * SIGN_COLS;
    this.canvas.height = Math.max(SIGN_H, Math.ceil(count / SIGN_COLS) * SIGN_H);
    this.g = this.canvas.getContext('2d')!;
  }
  /** Paints one board and returns its UV rectangle (u0, v0, u1, v1). */
  add(text: string, bg: string, fg: string): [number, number, number, number] {
    const k = this.n++, x = (k % SIGN_COLS) * SIGN_W, y = Math.floor(k / SIGN_COLS) * SIGN_H, g = this.g;
    g.fillStyle = bg; g.fillRect(x, y, SIGN_W, SIGN_H);
    g.fillStyle = fg; g.textAlign = 'center'; g.textBaseline = 'middle';
    let size = 46;
    do { g.font = `700 ${size}px Georgia, 'Times New Roman', serif`; size -= 2; } while (g.measureText(text).width > SIGN_W - 32 && size > 15);
    g.fillText(text, x + SIGN_W / 2, y + SIGN_H / 2 + 2);
    const W = this.canvas.width, H = this.canvas.height;
    return [(x + 2) / W, (y + 2) / H, (x + SIGN_W - 2) / W, (y + SIGN_H - 2) / H];
  }
}

const AWNINGS = [0x9b2f2a, 0x2f5d4a, 0x24466e, 0x8a6a2a, 0x5a3a6a, 0x2f2f33];

export class Downtown {
  readonly root: TransformNode;
  private chunks = new ChunkedBuilders(256);
  private signs: SignAtlas;
  private signMesh = new MeshBuilder();

  constructor(private physics: Physics, private mats: Mats) {
    this.root = new TransformNode('downtown', mats.scene);
    this.root.parent = hostRoot();
    this.signs = new SignAtlas([...BUILDINGS, ...CIVIC].filter(b => !b.lite || isShopKind(b.kind)).length + 4);
    [...BUILDINGS, ...CIVIC].forEach((b, i) => this.building(b, i));
    this.gasStation();
    this.bodyShop();
    this.depot();
    this.townSquare();
    this.chunks.flush(this.root, 'downtown');
    const sm = pbr('shop-signs', mats.scene);
    const tex = mats.canvasTexture('shop-signs', this.signs.canvas);
    sm.albedoTexture = tex; sm.emissiveTexture = tex; sm.emissiveColor = new Color3(1, 1, 1); sm.emissiveIntensity = 0.15; sm.roughness = ruledRoughness(0.42);
    mats.nightGlow.push({ m: sm, k: 1.4 });
    const signs = this.signMesh.toMesh('shop-signs');
    signs.parent = this.root;
    finishMesh(signs, sm, { cast: false, static: true });
    this.rings();
  }

  private facadeFor(b: Building) {
    if (b.kind === 'office' || b.kind === 'hotel' && b.h > 20) return this.mats.facade('office');
    if (b.kind === 'apartments' || b.kind === 'hotel' || b.kind === 'library' || b.kind === 'townhall' || b.kind === 'fire') return this.mats.facade('brick');
    return this.mats.facade('store');
  }

  private building(b: Building, i: number) {
    const x0 = b.x - b.w / 2, x1 = b.x + b.w / 2, z0 = b.z - b.d / 2, z1 = b.z + b.d / 2;
    const col = hexRGB(b.color);
    const facade = this.facadeFor(b);
    const tint = b.kind === 'office' ? mixRGB(col, [1, 1, 1], 0.35) : col;
    const walls = this.chunks.get(b.x, b.z, facade, { colors: true });
    walls.box(x0, 0, z0, x1, b.h, z1, { color: tint, skipBottom: true, skipTop: true });
    const roof = this.chunks.get(b.x, b.z, this.mats.textured('roof-flat', 'roofFlat'));
    roof.flat(x0 + 0.3, z0 + 0.3, x1 - 0.3, z1 - 0.3, b.h - 0.05);
    const trim = this.chunks.get(b.x, b.z, this.mats.plain('parapet', { vcolor: true, gloss: 0.25 }), { colors: true });
    const pc0 = scaleRGB(col, 0.82);
    trim.color = pc0;
    trim.box(x0 - 0.05, b.h, z0 - 0.05, x1 + 0.05, b.h + 0.7, z0 + 0.3);
    trim.box(x0 - 0.05, b.h, z1 - 0.3, x1 + 0.05, b.h + 0.7, z1 + 0.05);
    trim.box(x0 - 0.05, b.h, z0 + 0.3, x0 + 0.3, b.h + 0.7, z1 - 0.3);
    trim.box(x1 - 0.3, b.h, z0 + 0.3, x1 + 0.05, b.h + 0.7, z1 - 0.3);
    trim.box(x0 - 0.06, 0, z0 - 0.06, x1 + 0.06, 0.5, z1 + 0.06, { color: scaleRGB(col, 0.6) });
    if (b.h > 9) {
      const units = this.chunks.get(b.x, b.z, this.mats.textured('hvac', 'metal', { color: 0xb4b8bc }));
      const n = Math.max(1, Math.floor(b.w / 9));
      for (let k = 0; k < n; k++) { const ux = x0 + (k + 0.5) * (b.w / n); units.box(ux - 1.2, b.h, b.z - 1, ux + 1.2, b.h + 1.6, b.z + 1); }
    }
    this.physics.addStaticAABB(x0, 0, z0, x1, b.h, z1);

    if (!b.lite || isShopKind(b.kind)) this.storefront(b, i);
  }

  /** Street side of a shop or civic building: glass storefront, awning and a lit sign with its name. */
  private storefront(b: Building, i: number) {
    const dir = b.facing === '+z' ? 1 : -1;
    const face = b.facing === '+z' ? b.z + b.d / 2 : b.z - b.d / 2;
    const x0 = b.x - b.w / 2 + 1, x1 = b.x + b.w / 2 - 1;
    const glass = this.chunks.get(b.x, b.z, this.mats.glass('storefront', 0x9db8c6, 0.55), { cast: false });
    glass.box(x0, 0.5, face, x1, 3.2, face + dir * 0.06);
    const frame = this.chunks.get(b.x, b.z, this.mats.plain('frame', { color: 0x1f2226, gloss: 0.5, metal: 0.6 }));
    for (let x = x0; x <= x1 + 0.01; x += (x1 - x0) / Math.max(2, Math.round((x1 - x0) / 3))) frame.box(x - 0.05, 0.5, face, x + 0.05, 3.2, face + dir * 0.1);
    frame.box(x0, 3.2, face, x1, 3.35, face + dir * 0.1);
    frame.box(x0, 0.45, face, x1, 0.55, face + dir * 0.1);
    if (isShopKind(b.kind)) {
      const aw = this.chunks.get(b.x, b.z, this.mats.textured('awning', 'stripe', { vcolor: true, tile: 1.2, gloss: 0.2 }), { colors: true });
      aw.color = hexRGB(AWNINGS[i % AWNINGS.length]);
      const out = face + dir * 1.6;
      aw.face([x0, 3.5, face], [x1, 3.5, face], [x1, 3.05, out], [x0, 3.05, out], [[0, 0], [x1 - x0, 0], [x1 - x0, 1.6], [0, 1.6]]);
      aw.face([x1, 3.5, face], [x0, 3.5, face], [x0, 3.05, out], [x1, 3.05, out], [[0, 0], [x1 - x0, 0], [x1 - x0, 1.6], [0, 1.6]]);
    }
    // Sign: a lit board centered above the storefront.
    const w = Math.min(b.w - 2, Math.max(6, b.name.length * 0.55)), h = w / 6.4;
    const dark = ['#1d2a2a', '#2b1d1d', '#1b2233', '#2a2416'][i % 4];
    const [u0, v0, u1, v1] = this.signs.add(b.name, dark, '#f6e7c4');
    const y0 = Math.min(b.h - h - 0.4, 3.9), sx0 = b.x - w / 2, sx1 = b.x + w / 2, z = face + dir * 0.12;
    const mb = this.signMesh;
    const uv = [[u0, v1], [u1, v1], [u1, v0], [u0, v0]];
    if (dir > 0) mb.quad([[sx0, y0, z], [sx1, y0, z], [sx1, y0 + h, z], [sx0, y0 + h, z]], [0, 0, 1], uv);
    else mb.quad([[sx1, y0, z], [sx0, y0, z], [sx0, y0 + h, z], [sx1, y0 + h, z]], [0, 0, -1], uv);
  }

  private gasStation() {
    const g = GAS_STATION, c = g.canopy;
    const white = this.mats.plain('canopy', { color: 0xf1f1ee, gloss: 0.5 });
    const red = this.mats.plain('canopy-red', { color: 0xb3262a, gloss: 0.55 });
    const b = this.chunks.get(c.x, c.z, white);
    b.box(c.x - c.w / 2, 5.4, c.z - c.d / 2, c.x + c.w / 2, 6.1, c.z + c.d / 2);
    this.chunks.get(c.x, c.z, red).box(c.x - c.w / 2 - 0.05, 5.75, c.z - c.d / 2 - 0.05, c.x + c.w / 2 + 0.05, 6.15, c.z + c.d / 2 + 0.05, { skipBottom: true });
    for (const sx of [-1, 1]) for (const sz of [-1, 1]) {
      const px = c.x + sx * (c.w / 2 - 2), pz = c.z + sz * (c.d / 2 - 1.5);
      b.box(px - 0.25, 0, pz - 0.25, px + 0.25, 5.4, pz + 0.25);
      this.physics.addStaticAABB(px - 0.25, 0, pz - 0.25, px + 0.25, 5.4, pz + 0.25);
    }
    const glowPanel = this.mats.glow('canopy-light', 0xfff4e0, 3);
    this.chunks.get(c.x, c.z, glowPanel, { cast: false }).box(c.x - c.w / 2 + 1, 5.36, c.z - c.d / 2 + 1, c.x + c.w / 2 - 1, 5.4, c.z + c.d / 2 - 1);
    const island = this.chunks.get(c.x, c.z, this.mats.textured('curb', 'curb'));
    const pump = this.chunks.get(c.x, c.z, this.mats.plain('pump', { color: 0xe6e6e2, gloss: 0.45 }));
    const pumpTop = this.chunks.get(c.x, c.z, red);
    for (const p of g.pumps) {
      island.box(p.x - 0.7, 0, p.z - 1.6, p.x + 0.7, 0.16, p.z + 1.6);
      pump.box(p.x - 0.35, 0.16, p.z - 0.5, p.x + 0.35, 1.75, p.z + 0.5);
      pumpTop.box(p.x - 0.38, 1.75, p.z - 0.53, p.x + 0.38, 2.0, p.z + 0.53);
      this.physics.addStaticAABB(p.x - 0.7, 0, p.z - 1.6, p.x + 0.7, 1.9, p.z + 1.6);
    }
    const s = g.store;
    const store: Building = { id: 'gasstore', name: g.name, kind: 'gas', x: s.x, z: s.z, w: s.w, d: s.d, h: 4.6, facing: '-z', color: '#e9e4d8' };
    this.building(store, 2);
  }

  private bodyShop() {
    const B = BODY_SHOP, x0 = B.x - B.w / 2, x1 = B.x + B.w / 2, z0 = B.z - B.d / 2, z1 = B.frontZ;
    const wallMat = this.mats.textured('shop-wall', 'metal', { color: 0x7c8a96, tile: 2.5 });
    const w = this.chunks.get(B.x, B.z, wallMat);
    const T = 0.3;
    const solid = (a: number, b: number, c: number, d: number, e: number, f: number) => { w.box(a, b, c, d, e, f); this.physics.addStaticAABB(a, b, c, d, e, f); };
    solid(x0, 0, z0, x1, B.h, z0 + T);
    solid(x0, 0, z0, x0 + T, B.h, z1);
    solid(x1 - T, 0, z0, x1, B.h, z1);
    const inner = B.w - 0.8, bayW = inner / 3;
    for (let i = 0; i <= 3; i++) {
      const px = x0 + 0.4 + bayW * i;
      solid(px - 0.35, 0, z1 - T, px + 0.35, B.h, z1);
    }
    w.box(x0, 4.4, z1 - T, x1, B.h, z1);
    this.chunks.get(B.x, B.z, this.mats.textured('roof-flat', 'roofFlat')).box(x0, B.h, z0, x1, B.h + 0.3, z1, { skipBottom: true });
    this.chunks.get(B.x, B.z, this.mats.textured('shop-floor', 'concrete', { tile: 4 }), { cast: false }).flat(x0 + T, z0 + T, x1 - T, z1, 0.03);
    const stripe = this.chunks.get(B.x, B.z, this.mats.plain('bay-line', { color: 0xe8c23a, gloss: 0.3 }), { cast: false });
    for (const bay of BODY_SHOP_BAYS) {
      stripe.flat(bay.x - bay.w / 2, bay.z - bay.d / 2, bay.x - bay.w / 2 + 0.12, bay.z + bay.d / 2, 0.04);
      stripe.flat(bay.x + bay.w / 2 - 0.12, bay.z - bay.d / 2, bay.x + bay.w / 2, bay.z + bay.d / 2, 0.04);
    }
    const glowPanel = this.mats.glow('shop-light', 0xf2f6ff, 2.5);
    this.chunks.get(B.x, B.z, glowPanel, { cast: false }).box(x0 + 2, B.h - 0.15, z0 + 2, x1 - 2, B.h - 0.1, z1 - 2);
    this.storefront({ id: 'bodyshop', name: B.name, kind: 'retail', x: B.x, z: B.z, w: B.w, d: B.d, h: B.h + 1.6, facing: '+z', color: '#7c8a96', lite: true }, 1);
  }

  private depot() {
    const D = DEPOT;
    const b: Building = { id: 'depot', name: 'Fox Plains Freight Depot', kind: 'retail', x: D.x, z: D.z - 6, w: D.w + 8, d: D.d, h: 7.5, facing: '+z', color: '#8c6f52', lite: true };
    const x0 = b.x - b.w / 2, x1 = b.x + b.w / 2, z0 = b.z - b.d / 2, z1 = b.z + b.d / 2;
    this.chunks.get(b.x, b.z, this.mats.textured('depot-wall', 'metal', { color: 0x9c7a58, tile: 2 })).box(x0, 0, z0, x1, b.h, z1, { skipBottom: true });
    this.chunks.get(b.x, b.z, this.mats.textured('depot-door', 'garage', { color: 0xd8d4cc })).box(b.x - 3, 0.2, z1, b.x + 3, 4.6, z1 + 0.08);
    this.physics.addStaticAABB(x0, 0, z0, x1, b.h, z1);
    this.storefront({ ...b, h: b.h + 0.4 }, 3);
    const pad = this.chunks.get(D.padX, D.padZ, this.mats.plain('pad-line', { color: 0xf0c330, gloss: 0.3 }), { cast: false });
    const r = 4;
    pad.flat(D.padX - r, D.padZ - r, D.padX + r, D.padZ - r + 0.25, 0.04);
    pad.flat(D.padX - r, D.padZ + r - 0.25, D.padX + r, D.padZ + r, 0.04);
    pad.flat(D.padX - r, D.padZ - r, D.padX - r + 0.25, D.padZ + r, 0.04);
    pad.flat(D.padX + r - 0.25, D.padZ - r, D.padX + r, D.padZ + r, 0.04);
  }

  private townSquare() {
    const s = TOWN_SQUARE_RECT, x0 = s.cx - s.sx / 2, x1 = s.cx + s.sx / 2, z0 = s.cz - s.sz / 2, z1 = s.cz + s.sz / 2;
    const paving = this.chunks.get(s.cx, s.cz, this.mats.textured('plaza', 'patio', { tile: 2.4 }));
    paving.box(x0, 0, z0, x1, 0.12, z1, { skipBottom: true });
    this.physics.addStaticAABB(x0, -0.2, z0, x1, 0.12, z1);
    const lawn = this.chunks.get(s.cx, s.cz, this.mats.textured('lawn-square', 'lawn'), { cast: false });
    const qx = s.sx / 4, qz = s.sz / 4;
    for (const sx of [-1, 1]) for (const sz of [-1, 1]) lawn.box(s.cx + sx * qx - qx * 0.7, 0.12, s.cz + sz * qz - qz * 0.7, s.cx + sx * qx + qx * 0.7, 0.2, s.cz + sz * qz + qz * 0.7, { skipBottom: true });
    const stone = this.chunks.get(s.cx, s.cz, this.mats.textured('fountain', 'stone', { color: 0xd6d0c4 }));
    stone.cylinder(s.cx, 0.12, s.cz, 5, 5, 0.7, 28, false);
    stone.cylinder(s.cx, 0.12, s.cz, 4.6, 4.6, 0.7, 28, false);
    stone.cylinder(s.cx, 0.12, s.cz, 0.7, 0.5, 2.8, 16, true);
    stone.cylinder(s.cx, 2.9, s.cz, 1.8, 1.6, 0.25, 20, true);
    this.physics.addStaticCylinder(s.cx, 0.5, s.cz, 0.4, 5);
    const water = this.mats.plain('fountain-water', { keepGloss: true, color: 0x2b6f86, gloss: 0.95, metal: 0.1 });
    this.chunks.get(s.cx, s.cz, water, { cast: false }).cylinder(s.cx, 0.12, s.cz, 4.6, 4.6, 0.55, 28, true);
    const leaves = this.chunks.get(s.cx, s.cz, this.mats.plain('leaves', { vcolor: true, gloss: 0.18 }), { colors: true });
    const bark = this.chunks.get(s.cx, s.cz, this.mats.textured('bark', 'bark', { color: 0x6b5a48 }));
    for (const sx of [-1, 1]) for (const sz of [-1, 1]) {
      const tx = s.cx + sx * qx, tz = s.cz + sz * qz;
      bark.cylinder(tx, 0.2, tz, 0.3, 0.2, 3, 8, false);
      leaves.blob(tx, 4.4, tz, 3, 2.4, 3, (sx + 3) * (sz + 5), 0.15, hexRGB(0x4f7f32));
      this.physics.addStaticCylinder(tx, 1.5, tz, 1.5, 0.3);
    }
    const bench = this.chunks.get(s.cx, s.cz, this.mats.textured('bench', 'planks', { color: 0x9a6a3e, tile: 1.5 }));
    for (const [dx, dz, along] of [[0, -7.5, 1], [0, 7.5, 1], [-7.5, 0, 0], [7.5, 0, 0]] as const) {
      const bx = s.cx + dx, bz = s.cz + dz, hx = along ? 1.2 : 0.3, hz = along ? 0.3 : 1.2;
      bench.box(bx - hx, 0.55, bz - hz, bx + hx, 0.62, bz + hz);
      bench.box(bx - hx * 0.9, 0.12, bz - hz * 0.9, bx - hx * 0.9 + 0.08, 0.55, bz + hz * 0.9);
      bench.box(bx + hx * 0.9 - 0.08, 0.12, bz - hz * 0.9, bx + hx * 0.9, 0.55, bz + hz * 0.9);
    }
  }

  /** Soft glowing rings at every shop door and pump, so you can find them. */
  private rings() {
    const mk = (name: string, color: number, opacity: number) => {
      const m = pbr(name, this.mats.scene);
      m.albedoColor = new Color3(0, 0, 0); m.emissiveColor = lin3(color); m.emissiveIntensity = 1.6 * opacity;
      m.unlit = true; m.alpha = 0.999; m.transparencyMode = PBRMaterial.PBRMATERIAL_ALPHABLEND; m.alphaMode = Constants.ALPHA_ADD;
      m.disableDepthWrite = true; m.disableLighting = true;
      return m;
    };
    const ring = (b: MeshBuilder, x: number, z: number, r0: number, r1: number, y: number) => {
      const base = b.vertexCount, n = 40;
      for (let i = 0; i <= n; i++) { const a = (i / n) * Math.PI * 2, c = Math.cos(a), s = Math.sin(a); b.vertex(x + c * r0, y, z + s * r0, 0, 1, 0, 0, 0); b.vertex(x + c * r1, y, z + s * r1, 0, 1, 0, 1, 0); }
      for (let i = 0; i < n; i++) { const k = base + i * 2; b.idx.push(k, k + 3, k + 1, k, k + 2, k + 3); }
    };
    const doors = new MeshBuilder(), pumps = new MeshBuilder();
    for (const d of SHOP_DOORS) ring(doors, d.x, d.z, 1.1, 1.3, 0.16);
    for (const p of GAS_STATION.pumps) ring(pumps, p.x, p.z, 2.6, 2.8, 0.07);
    for (const [name, mb, mat] of [['door-rings', doors, mk('ring-door', 0xf2b544, 0.55)], ['pump-rings', pumps, mk('ring-pump', 0x5cd17a, 0.4)]] as const) {
      const mesh = mb.toMesh(name);
      mesh.parent = this.root;
      finishMesh(mesh, mat, { cast: false, receive: false, static: true });
    }
  }
}

export type { RGB };
