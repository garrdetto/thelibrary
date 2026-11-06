/**
 * Instanced trees: each species is modelled a few times at the origin, 10 m
 * tall, at two levels of detail (`near`, many fine clumps; `mid`, a few
 * coarse ones), and every placed tree is one instance matrix. A chunk's trees
 * draw in one call per variant and finish.
 */
import * as pc from 'playcanvas';
import { Batch } from '../core/Batch';
import type { Kit } from '../style/Kit';
import { broadleaf, MAPLE, OAK, spruce } from '../models/Trees';

export type TreeKind = 'maple' | 'oak' | 'spruce';
export type TreeLod = 'near' | 'mid';
export interface TreePlace { kind: TreeKind; x: number; y: number; z: number; h: number; yaw: number; v: number }

export const VARIANTS = 3;
const MODEL_H = 10;
const LOD_DETAIL: Record<TreeLod, number> = { near: 0.8, mid: 0.32 };

export class TreeKit {
  private parts = new Map<string, { mesh: pc.Mesh; material: pc.Material }[]>();

  constructor(private device: pc.GraphicsDevice, kit: Kit) {
    for (const lod of ['near', 'mid'] as const) for (const kind of ['maple', 'oak', 'spruce'] as const) for (let v = 0; v < VARIANTS; v++) {
      const B = new Batch(kit), seed = 501 + v * 37 + kind.length * 11;
      if (kind === 'spruce') spruce(B, 0, 0, MODEL_H, seed);
      else broadleaf(B, 0, 0, MODEL_H, seed, kind === 'oak' ? OAK : MAPLE, LOD_DETAIL[lod]);
      this.parts.set(`${lod}|${kind}|${v}`, B.meshes(device));
    }
  }

  /** Meshes of one variant at one level of detail. */
  variant(key: string) { return this.parts.get(key)!; }

  /** One entity drawing `trees` at `lod`, or null when there are none. */
  instance(trees: readonly TreePlace[], lod: TreeLod, name: string) {
    if (!trees.length) return null;
    const groups = new Map<string, TreePlace[]>();
    for (const t of trees) { const k = `${lod}|${t.kind}|${t.v % VARIANTS}`; let l = groups.get(k); if (!l) groups.set(k, (l = [])); l.push(t); }
    const root = new pc.Entity(name);
    const m = new pc.Mat4(), q = new pc.Quat(), p = new pc.Vec3(), s = new pc.Vec3();
    const fmt = pc.VertexFormat.getDefaultInstancingFormat(this.device);
    for (const [key, list] of groups) {
      const data = new Float32Array(list.length * 16);
      let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity, z0 = Infinity, z1 = -Infinity;
      list.forEach((t, i) => {
        const k = t.h / MODEL_H;
        m.setTRS(p.set(t.x, t.y, t.z), q.setFromEulerAngles(0, t.yaw, 0), s.set(k, k * (0.92 + (i % 4) * 0.04), k));
        data.set(m.data, i * 16);
        x0 = Math.min(x0, t.x); x1 = Math.max(x1, t.x); z0 = Math.min(z0, t.z); z1 = Math.max(z1, t.z);
        y0 = Math.min(y0, t.y); y1 = Math.max(y1, t.y + t.h);
      });
      const vb = new pc.VertexBuffer(this.device, fmt, list.length, { data });
      const mis = this.parts.get(key)!.map(part => { const mi = new pc.MeshInstance(part.mesh, part.material); mi.setInstancing(vb, true); return mi; });
      const e = new pc.Entity(`${name}-${key}`);
      e.addComponent('render', { meshInstances: mis, castShadows: lod === 'near', receiveShadows: true });
      e.render!.customAabb = new pc.BoundingBox(new pc.Vec3((x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2), new pc.Vec3((x1 - x0) / 2 + 6, (y1 - y0) / 2 + 2, (z1 - z0) / 2 + 6));
      root.addChild(e);
    }
    return root;
  }
}

/**
 * Every loaded chunk's trees in one instanced draw per variant and level of
 * detail: chunks hand in their lists with `set`, and `flush` rebuilds the
 * instance buffers of the variants that changed.
 */
export class TreeField {
  readonly root = new pc.Entity('trees');
  private lists = new Map<string, TreePlace[]>();
  private groups = new Map<string, { e: pc.Entity; vb: pc.VertexBuffer | null }>();
  private dirty = new Set<TreeLod>();

  constructor(private kit: TreeKit, private device: pc.GraphicsDevice) {}

  set(chunk: string, lod: TreeLod, trees: readonly TreePlace[] | null) {
    const k = `${lod}#${chunk}`;
    if (trees && trees.length) this.lists.set(k, trees as TreePlace[]); else if (!this.lists.delete(k)) return;
    this.dirty.add(lod);
  }

  flush() {
    if (!this.dirty.size) return;
    const m = new pc.Mat4(), q = new pc.Quat(), p = new pc.Vec3(), s = new pc.Vec3();
    const fmt = pc.VertexFormat.getDefaultInstancingFormat(this.device);
    for (const lod of this.dirty) {
      const byKey = new Map<string, TreePlace[]>();
      for (const [k, list] of this.lists) {
        if (!k.startsWith(`${lod}#`)) continue;
        for (const t of list) { const g = `${lod}|${t.kind}|${t.v % VARIANTS}`; let l = byKey.get(g); if (!l) byKey.set(g, (l = [])); l.push(t); }
      }
      for (const kind of ['maple', 'oak', 'spruce'] as const) for (let v = 0; v < VARIANTS; v++) {
        const key = `${lod}|${kind}|${v}`, list = byKey.get(key) ?? [];
        let g = this.groups.get(key);
        if (!g) {
          const e = new pc.Entity(`trees-${key}`);
          e.addComponent('render', { meshInstances: this.kit.variant(key).map(part => new pc.MeshInstance(part.mesh, part.material)), castShadows: lod === 'near', receiveShadows: true });
          this.root.addChild(e);
          this.groups.set(key, (g = { e, vb: null }));
        }
        g.vb?.destroy();
        g.vb = null;
        g.e.enabled = list.length > 0;
        if (!list.length) continue;
        const data = new Float32Array(list.length * 16);
        let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity, z0 = Infinity, z1 = -Infinity;
        list.forEach((t, i) => {
          const k = t.h / MODEL_H;
          m.setTRS(p.set(t.x, t.y, t.z), q.setFromEulerAngles(0, t.yaw, 0), s.set(k, k * (0.92 + (i % 4) * 0.04), k));
          data.set(m.data, i * 16);
          x0 = Math.min(x0, t.x); x1 = Math.max(x1, t.x); z0 = Math.min(z0, t.z); z1 = Math.max(z1, t.z); y0 = Math.min(y0, t.y); y1 = Math.max(y1, t.y + t.h);
        });
        g.vb = new pc.VertexBuffer(this.device, fmt, list.length, { data });
        for (const mi of g.e.render!.meshInstances) mi.setInstancing(g.vb, true);
        g.e.render!.customAabb = new pc.BoundingBox(new pc.Vec3((x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2), new pc.Vec3((x1 - x0) / 2 + 6, (y1 - y0) / 2 + 2, (z1 - z0) / 2 + 6));
      }
    }
    this.dirty.clear();
  }
}
