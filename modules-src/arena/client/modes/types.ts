import type { Engine } from '@babylonjs/core/Engines/engine'
import type { Scene } from '@babylonjs/core/scene'
import type { ShadowGenerator } from '@babylonjs/core/Lights/Shadows/shadowGenerator'
import type { ArenaMap } from '../scene/Arena'
import type { ArenaMaterials } from '../scene/Materials'
import type { FirstPersonPlayer } from '../player/FirstPerson'
import type { WeaponSystem } from '../weapons/WeaponSystem'
import type { Hud } from '../ui/Hud'
import type { Banner } from '../ui/Banner'
import type { Results } from '../ui/Results'
import type { TrackerContact } from '../net/RemotePlayers'

export type PlayModeId = 'open' | 'duel' | 'squads' | 'range' | 'horde' | 'practice'

export interface ModeRequest {
  mode: PlayModeId
  code?: string | null
}

export interface ModeContext {
  engine: Engine
  scene: Scene
  canvas: HTMLCanvasElement
  materials: ArenaMaterials
  shadows: ShadowGenerator
  arena: ArenaMap
  player: FirstPersonPlayer
  weapons: WeaponSystem
  hud: Hud
  banner: Banner
  results: Results
  playerName: string
  setStatus(text: string): void
  openMenu(): void
  restart(): void
}

export interface ActiveMode {
  readonly id: PlayModeId
  update(dt: number): void
  contacts(): TrackerContact[]
  team(): 0 | 1 | null
  hostCode?(): Promise<string | null>
  dispose(): void
}
