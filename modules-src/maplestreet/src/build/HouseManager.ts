/**
 * Owns the client's mirror of WorldState and keeps per-lot meshes +
 * colliders in sync with it. Only the lot touched by an op is rebuilt.
 */
import * as THREE from 'three/webgpu';
import { applyOp, BuildOp, WorldState } from '../../shared/BuildRules';
import { Physics } from '../physics/Physics';
import { MeshOptions, StructureMesher } from './Mesher';

export class HouseManager {
  world: WorldState | null = null;
  private groups = new Map<string, THREE.Group>();
  private view: MeshOptions = { cutLevel: null, cutHeight: 1.0, showRoofs: true };
  private nightGlass: THREE.Material[] = [];

  constructor(private scene: THREE.Scene, private physics: Physics, private mesher: StructureMesher) {}

  setWorld(world: WorldState) {
    this.world = world;
    for (const id in world.lots) this.rebuildLot(id);
  }

  /** Apply an authority-confirmed op and rebuild the affected lot. */
  apply(op: BuildOp, actorKey: string, actorName: string) {
    if (!this.world) return;
    applyOp(this.world, op, actorKey, actorName);
    this.rebuildLot((op as { lotId: string }).lotId);
  }

  setView(v: Partial<MeshOptions>) {
    const next = { ...this.view, ...v };
    if (next.cutLevel === this.view.cutLevel && next.showRoofs === this.view.showRoofs && next.cutHeight === this.view.cutHeight) return;
    this.view = next;
    if (this.world) for (const id in this.world.lots) this.rebuildLot(id, false);
  }

  rebuildLot(lotId: string, withColliders = true) {
    if (!this.world) return;
    const lot = this.world.lots[lotId], b = this.world.builds[lotId];
    const old = this.groups.get(lotId);
    if (old) {
      this.scene.remove(old);
      old.traverse(o => { const m = o as THREE.Mesh; if (m.isMesh) m.geometry.dispose(); });
    }
    const { group, colliders } = this.mesher.build(lot, b, this.view);
    this.scene.add(group);
    this.groups.set(lotId, group);
    if (withColliders) this.physics.setLotColliders(lotId, colliders);
  }

  get viewOptions() { return this.view; }
  get glowMaterials() { return this.nightGlass; }
}
