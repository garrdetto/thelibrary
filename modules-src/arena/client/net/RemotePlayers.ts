import type { Scene } from '@babylonjs/core/scene'
import { MeshBuilder } from '@babylonjs/core/Meshes/meshBuilder'
import type { Mesh } from '@babylonjs/core/Meshes/mesh'
import type { ShadowGenerator } from '@babylonjs/core/Lights/Shadows/shadowGenerator'
import { Vector3 } from '@babylonjs/core/Maths/math.vector'
import type { ArenaAction, ArenaPlayer } from '../../../../server/arena/protocol.mjs'
import type { ArenaMaterials } from '../scene/Materials'
import { createSoldier, disposeSoldier, type Soldier } from './Soldier'

const BODY_HEIGHT = 1.8

interface Remote {
  hitbox: Mesh
  soldier: Soldier
  target: Vector3
  previous: Vector3
  yaw: number
  pitch: number
  alive: boolean
  team: 0 | 1
  action: ArenaAction
  speed: number
  stride: number
  noisyFor: number
}

export interface TrackerContact {
  x: number
  z: number
  team: 0 | 1
  noisy: boolean
}

export class RemotePlayers {
  private readonly remotes = new Map<string, Remote>()

  constructor(private readonly scene: Scene, private readonly materials: ArenaMaterials, private readonly shadows: ShadowGenerator) {}

  sync(list: ArenaPlayer[]): void {
    const seen = new Set<string>()
    for (const player of list) {
      seen.add(player.id)
      let remote = this.remotes.get(player.id)
      if (!remote || remote.team !== player.team) {
        if (remote) this.remove(player.id)
        const hitbox = MeshBuilder.CreateCapsule(`remote-${player.id}`, { radius: 0.45, height: BODY_HEIGHT }, this.scene)
        hitbox.visibility = 0
        hitbox.position.set(player.x, player.y + BODY_HEIGHT / 2, player.z)
        const soldier = createSoldier(this.scene, player.id, player.team, this.materials, this.shadows)
        soldier.root.parent = hitbox
        soldier.root.position.y = -BODY_HEIGHT / 2
        remote = {
          hitbox,
          soldier,
          target: new Vector3(),
          previous: hitbox.position.clone(),
          yaw: player.yaw,
          pitch: player.pitch,
          alive: true,
          team: player.team,
          action: player.action,
          speed: 0,
          stride: 0,
          noisyFor: 0,
        }
        this.remotes.set(player.id, remote)
      }
      remote.target.set(player.x, player.y + BODY_HEIGHT / 2, player.z)
      remote.yaw = player.yaw
      remote.pitch = player.pitch ?? 0
      remote.action = player.action
      this.setAlive(player.id, player.alive)
      remote.hitbox.metadata = { playerId: player.id, team: player.team, feet: remote.hitbox.position.y - BODY_HEIGHT / 2 }
    }
    for (const id of [...this.remotes.keys()]) if (!seen.has(id)) this.remove(id)
  }

  setAlive(id: string, alive: boolean): void {
    const remote = this.remotes.get(id)
    if (!remote || remote.alive === alive) return
    remote.alive = alive
    remote.hitbox.setEnabled(alive)
  }

  teleport(id: string, position: Vector3): void {
    const remote = this.remotes.get(id)
    if (!remote) return
    remote.target.set(position.x, position.y + BODY_HEIGHT / 2, position.z)
    remote.hitbox.position.copyFrom(remote.target)
    remote.previous.copyFrom(remote.target)
  }

  remove(id: string): void {
    const remote = this.remotes.get(id)
    if (!remote) return
    disposeSoldier(remote.soldier, this.shadows)
    remote.hitbox.dispose()
    this.remotes.delete(id)
  }

  contacts(): TrackerContact[] {
    const list: TrackerContact[] = []
    for (const remote of this.remotes.values()) {
      if (!remote.alive) continue
      list.push({ x: remote.hitbox.position.x, z: remote.hitbox.position.z, team: remote.team, noisy: remote.noisyFor > 0 })
    }
    return list
  }

  update(dt: number): void {
    const blend = Math.min(1, dt * 12)
    for (const remote of this.remotes.values()) {
      const position = remote.hitbox.position
      Vector3.LerpToRef(position, remote.target, blend, position)
      const moved = Math.hypot(position.x - remote.previous.x, position.z - remote.previous.z)
      remote.previous.copyFrom(position)
      const speed = dt > 0 ? moved / dt : 0
      remote.speed += (speed - remote.speed) * Math.min(1, dt * 8)
      remote.noisyFor = remote.speed > 3.5 || remote.action === 'firing' ? 0.6 : Math.max(0, remote.noisyFor - dt)
      remote.stride += remote.speed * dt * 1.6
      const swing = Math.sin(remote.stride) * Math.min(1, remote.speed / 6) * 0.65
      const { soldier } = remote
      remote.hitbox.rotation.y = remote.yaw
      soldier.leftLeg.rotation.x = swing
      soldier.rightLeg.rotation.x = -swing
      soldier.leftArm.rotation.set(-0.9 + remote.pitch * 0.8, 0.45, 0)
      soldier.rightArm.rotation.set(-0.9 + remote.pitch * 0.8, -0.15, 0)
      soldier.upper.rotation.x = remote.pitch * 0.6
      const meta = remote.hitbox.metadata as { feet?: number } | null
      if (meta) meta.feet = position.y - BODY_HEIGHT / 2
    }
  }
}
