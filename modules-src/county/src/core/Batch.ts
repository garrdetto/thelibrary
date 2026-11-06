/**
 * One MeshBuilder per finish (or glow material) for a piece of the world;
 * `build` turns them into one render entity, so a whole house, hangar or
 * helicopter body costs one draw per finish.
 */
import * as pc from 'playcanvas';
import { MeshBuilder, meshEntity } from '../../../foxplains2/src/core/Geo';
import type { Kit, Finish } from '../style/Kit';
import { contactShade } from './Shapes';

export class Batch {
  private parts = new Map<pc.Material, MeshBuilder>();
  constructor(readonly kit: Kit) {}

  get(f: Finish | pc.Material) {
    const m = typeof f === 'string' ? this.kit.finish[f] : f;
    let b = this.parts.get(m);
    if (!b) this.parts.set(m, (b = new MeshBuilder()));
    return b;
  }

  /** Vertex counts per builder, so `contact` can shade only what was added after it. */
  mark() { return new Map([...this.parts.values()].map(b => [b, b.vertexCount])); }

  /** Soft contact shading on everything added since `mark`. */
  contact(mark: Map<MeshBuilder, number>, baseY = 0, reach = 0.5, strength = 0.28) {
    for (const b of this.parts.values()) contactShade(b, mark.get(b) ?? 0, baseY, reach, strength);
  }

  /** Moves everything added since `mark` by `m` (for props modelled at the origin and set down anywhere). */
  move(mark: Map<MeshBuilder, number>, m: pc.Mat4) {
    const p = new pc.Vec3(), n = new pc.Vec3(), nm = new pc.Mat3().invertMat4(m).transpose();
    for (const b of this.parts.values()) {
      for (let i = (mark.get(b) ?? 0) * 3; i < b.pos.length; i += 3) {
        m.transformPoint(p.set(b.pos[i], b.pos[i + 1], b.pos[i + 2]), p);
        nm.transformVector(n.set(b.nrm[i], b.nrm[i + 1], b.nrm[i + 2]), n).normalize();
        b.pos[i] = p.x; b.pos[i + 1] = p.y; b.pos[i + 2] = p.z;
        b.nrm[i] = n.x; b.nrm[i + 1] = n.y; b.nrm[i + 2] = n.z;
      }
    }
  }

  get triangles() { let n = 0; for (const b of this.parts.values()) n += b.idx.length / 3; return n; }

  /** Every builder's triangles as one position/index soup, for a collider. */
  soup(skip: pc.Material[] = []) {
    const pos: number[] = [], idx: number[] = [];
    for (const [m, b] of this.parts) {
      if (skip.includes(m)) continue;
      const base = pos.length / 3;
      for (const v of b.pos) pos.push(v);
      for (const i of b.idx) idx.push(i + base);
    }
    return { pos: new Float32Array(pos), idx: new Uint32Array(idx) };
  }

  meshes(device: pc.GraphicsDevice) {
    const parts: { mesh: pc.Mesh; material: pc.Material }[] = [];
    for (const [material, b] of this.parts) if (!b.empty) parts.push({ mesh: b.toMesh(device, true), material });
    this.parts.clear();
    return parts;
  }

  build(device: pc.GraphicsDevice, name: string, opts: { cast?: boolean; receive?: boolean } = {}) {
    return meshEntity(name, this.meshes(device), opts);
  }
}
