/**
 * Owns the client's mirror of WorldState and keeps per-lot meshes +
 * colliders in sync with it. Only the lot touched by an op is rebuilt.
 */
import * as THREE from 'three/webgpu';
import { mergeCopies, mergeStatic } from '../core/Merge';
import { applyOp, BuildOp, normalizeBuild, WorldState } from '../../shared/BuildRules';
import { Physics } from '../physics/Physics';
import { CHUNK_SIZE, tierFor, type WorldChunks } from '../world/WorldChunks';
import { MeshOptions, StructureMesher } from './Mesher';

const cellOf = (l: { x: number; z: number; w: number; d: number }) => `${Math.floor((l.x + l.w / 2) / CHUNK_SIZE)},${Math.floor((l.z + l.d / 2) / CHUNK_SIZE)}`;
const isAncestor = (a: THREE.Object3D, o: THREE.Object3D) => { for (let x = o.parent; x; x = x.parent) if (x === a) return true; return false; };
const _sphere = new THREE.Sphere();
/** The view distance a piece would have had on its own (see WorldChunks), so small things still drop out early. */
function viewFor(mesh: THREE.Mesh) {
  const g = mesh.geometry;
  if (!g.boundingSphere) g.computeBoundingSphere();
  _sphere.copy(g.boundingSphere!).applyMatrix4(mesh.matrixWorld);
  return tierFor(_sphere.radius);
}
/** Frees geometry under `root`; `all` also frees merged batches (sources share nothing with them). */
function disposeTree(root: THREE.Object3D, all = false) {
  root.traverse(o => { const m = o as THREE.Mesh; if (m.isMesh && (all || !m.userData.keep)) m.geometry.dispose(); });
}

export class HouseManager {
  world: WorldState | null = null;
  private groups = new Map<string, THREE.Group>();
  /** Per lot: subtrees that are drawn as they are instead of joining the cell batch. */
  private kept = new Map<string, THREE.Object3D[]>();
  private dirtyCells = new Set<string>();
  private flushQueued = false;
  private view: MeshOptions = { cutLevel: null, cutHeight: 1.0, showRoofs: true };
  private nightGlass: THREE.Material[] = [];

  /** With `chunks`, each lot's meshes go into the distance-based grid instead of straight into the scene. */
  constructor(private scene: THREE.Scene, private physics: Physics, private mesher: StructureMesher, private chunks: WorldChunks | null = null) {}

  setWorld(world: WorldState) {
    this.world = world;
    for (const id in world.builds) normalizeBuild(world.builds[id]);
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
      disposeTree(old);
    }
    for (const o of this.kept.get(lotId) ?? []) { o.removeFromParent(); disposeTree(o, true); }
    this.kept.delete(lotId);
    const { group, colliders } = this.mesher.build(lot, b, this.view);
    this.groups.set(lotId, group);
    if (withColliders) this.physics.setLotColliders(lotId, colliders);
    if (!this.chunks) {
      // A house is static until its next rebuild: one draw per material instead of one per wall,
      // window and chair (custom models that are still loading are kept as they are).
      mergeStatic(group, { flatten: () => true });
      this.scene.add(group);
      return;
    }
    // Chunked: the lot's own meshes stay out of the scene as the source for its cell's batch.
    // Pieces that change on their own (custom models filling in) are drawn as they are.
    group.updateMatrixWorld(true);
    const kept: THREE.Object3D[] = [];
    group.traverse(o => { if (o !== group && o.userData.keep && !kept.some(k => isAncestor(k, o))) kept.push(o); });
    this.kept.set(lotId, kept);
    this.dirtyCells.add(cellOf(lot));
    if (!this.flushQueued) { this.flushQueued = true; queueMicrotask(() => this.flushCells()); }
  }

  /**
   * Every lot whose center falls in one CHUNK_SIZE cell is drawn as one batch per
   * (material, view distance): a street of houses is a few dozen draws instead of
   * thousands. A cell is re-batched (once per burst of edits) when one of its lots changes.
   */
  private flushCells() {
    this.flushQueued = false;
    if (!this.world || !this.chunks) return;
    for (const cell of this.dirtyCells) {
      const key = `cell:${cell}`;
      for (const o of this.chunks.untrack(key)) if (!o.userData.keep) disposeTree(o, true);
      const lots = Object.values(this.world.lots).filter(l => cellOf(l) === cell);
      const glow = new Set(this.nightGlass);
      const batch = mergeCopies(lots.map(l => this.groups.get(l.id)).filter((g): g is THREE.Group => !!g), { viewDistance: viewFor, flatten: m => !glow.has(m) });
      for (const l of lots) for (const o of this.kept.get(l.id) ?? []) batch.attach(o);
      this.chunks.track(key, batch);
    }
    this.dirtyCells.clear();
  }
  get viewOptions() { return this.view; }
  get glowMaterials() { return this.nightGlass; }
}
