/**
 * What a `TruckSession` needs from the world it runs in. The standalone page (`game/Standalone.ts`) is one host; a Life Sim
 * `GameExtension` can be another: its town root as `frameRoot` (right-handed, mirrored into Babylon's left-handed scene), its
 * town `Physics` wrapped as a `PhysicsHost`, Montello's places as a `HaulWorld`, Rack & Reel's key set and HUD root.
 */
import type { AbstractMesh } from '@babylonjs/core/Meshes/abstractMesh'
import type { TransformNode } from '@babylonjs/core/Meshes/transformNode'
import type { Scene } from '@babylonjs/core/scene'
import type { ProgressClient } from '../net/Progress'
import type { MaterialLibrary } from '../render/Materials'
import type { HaulWorld } from '../shared/HaulWorld'
import type { LotSpec } from '../shared/WorldLayout'
import type { PhysicsHost } from '../sim/PhysicsHost'

export type ToastKind = 'info' | 'good' | 'warn' | 'bad'

export interface TruckHost {
  readonly scene: Scene
  /** Parent of everything Truck Simulator draws, in the right-handed sim frame. */
  readonly frameRoot: TransformNode
  readonly physics: PhysicsHost
  readonly world: HaulWorld
  readonly mats: MaterialLibrary
  readonly progress: ProgressClient
  /** `KeyboardEvent.code` values held down right now (Life Sim's `GameHost.keys` is the same set). */
  readonly keys: ReadonlySet<string>
  /** Where the player's truck lot is, or null (no lot: spawn at `spawnPoint`). */
  lotFor(index: number | null): LotSpec | null
  spawnPoint(): { x: number; z: number; heading: number }
  addCaster(mesh: AbstractMesh): void
  removeCaster(mesh: AbstractMesh): void
  toast(text: string, kind?: ToastKind): void
  /** True while a menu or panel has the keyboard; the session ignores driving keys then. */
  paused(): boolean
}
