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

  get triangles() { let n = 0; for (const b of this.parts.values()) n += b.idx.length / 3; return n; }

  build(device: pc.GraphicsDevice, name: string, opts: { cast?: boolean; receive?: boolean } = {}) {
    const parts: { mesh: pc.Mesh; material: pc.Material }[] = [];
    for (const [material, b] of this.parts) if (!b.empty) parts.push({ mesh: b.toMesh(device, true), material });
    this.parts.clear();
    return meshEntity(name, parts, opts);
  }
}
