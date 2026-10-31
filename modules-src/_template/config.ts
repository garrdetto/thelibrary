/** Every tunable for this learning module: engine overrides, key bindings, colors, sizes and physics constants. */
import { ENGINE_DEFAULTS, type ActionBindings, type EngineConfig } from '../../engine'
import moduleJson from './module.json'

export type Action = 'forward' | 'back' | 'left' | 'right' | 'jump' | 'debug'

export interface ModuleMeta {
  id: string
  title: string
  accent: string
  modes: readonly ('solo' | 'online')[]
}

export interface ModuleConfig {
  meta: ModuleMeta
  engine: EngineConfig
  bindings: ActionBindings<Action>
  ground: { size: number; thickness: number; color: string; roughness: number; metalness: number }
  crate: { size: number; color: string; roughness: number; metalness: number; mass: number; spawn: readonly [number, number, number]; respawnBelow: number }
  control: { pushImpulse: number; jumpImpulse: number; linearDamping: number; angularDamping: number }
  hud: { controlsHint: string }
}

export const config: ModuleConfig = {
  meta: moduleJson as ModuleMeta,
  engine: {
    ...ENGINE_DEFAULTS,
    renderer: { ...ENGINE_DEFAULTS.renderer },
    environment: { ...ENGINE_DEFAULTS.environment, background: '#0d1326', fogColor: '#0d1326' },
  },
  bindings: {
    forward: [{ kind: 'key', code: 'KeyW' }, { kind: 'key', code: 'ArrowUp' }, { kind: 'axis', axis: 1, direction: -1 }, { kind: 'touch', region: [0, 0, 1, 0.33] }],
    back: [{ kind: 'key', code: 'KeyS' }, { kind: 'key', code: 'ArrowDown' }, { kind: 'axis', axis: 1, direction: 1 }, { kind: 'touch', region: [0, 0.67, 1, 1] }],
    left: [{ kind: 'key', code: 'KeyA' }, { kind: 'key', code: 'ArrowLeft' }, { kind: 'axis', axis: 0, direction: -1 }, { kind: 'touch', region: [0, 0.33, 0.33, 0.67] }],
    right: [{ kind: 'key', code: 'KeyD' }, { kind: 'key', code: 'ArrowRight' }, { kind: 'axis', axis: 0, direction: 1 }, { kind: 'touch', region: [0.67, 0.33, 1, 0.67] }],
    jump: [{ kind: 'key', code: 'Space' }, { kind: 'pad', button: 0 }, { kind: 'touch', region: [0.33, 0.33, 0.67, 0.67] }],
    debug: [{ kind: 'key', code: 'KeyP' }, { kind: 'pad', button: 3 }],
  },
  ground: { size: 24, thickness: 0.5, color: '#1d2a44', roughness: 0.9, metalness: 0 },
  crate: { size: 1, color: '#39d0ff', roughness: 0.45, metalness: 0.1, mass: 1, spawn: [0, 4, 0], respawnBelow: -10 },
  control: { pushImpulse: 0.18, jumpImpulse: 5, linearDamping: 0.4, angularDamping: 0.6 },
  hud: { controlsHint: 'WASD or arrows to push, Space to hop, P for physics outlines' },
}
