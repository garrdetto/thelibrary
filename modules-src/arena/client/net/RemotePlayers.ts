import type { Scene } from '@babylonjs/core/scene'
import { MeshBuilder } from '@babylonjs/core/Meshes/meshBuilder'
import type { Mesh } from '@babylonjs/core/Meshes/mesh'
import type { ShadowGenerator } from '@babylonjs/core/Lights/Shadows/shadowGenerator'
import { Vector3 } from '@babylonjs/core/Maths/math.vector'
import type { ArenaPlayer } from '../../shared/protocol.mjs'
import type { ArenaMaterials } from '../scene/Materials'

const BODY_HEIGHT = 1.8

interface Remote {
  mesh: Mesh
  gun: Mesh
  target: Vector3
  yaw: number
  pitch: number
  alive: boolean
  team: 0 | 1
}

export class RemotePlayers {
  private readonly remotes = new Map<string, Remote>()

  constructor(private readonly scene: Scene, private readonly materials: ArenaMaterials, private readonly shadows: ShadowGenerator) {}

  sync(list: ArenaPlayer[]): void {
    const seen = new Set<string>()
    for (const player of list) {
      seen.add(player.id)
      let remote = this.remotes.get(player.id)
      if (!remote) {
        const mesh = MeshBuilder.CreateCapsule(`remote-${player.id}`, { radius: 0.45, height: BODY_HEIGHT }, this.scene)
        mesh.material = player.team === 0 ? this.materials.energyBlue : this.materials.energyRed
        mesh.position.set(player.x, player.y + BODY_HEIGHT / 2, player.z)
        const gun = MeshBuilder.CreateBox(`remote-${player.id}-gun`, { width: 0.1, height: 0.14, depth: 0.8 }, this.scene)
        gun.material = this.materials.trim
        gun.parent = mesh
        gun.position.set(0.3, 0.55, 0.35)
        gun.isPickable = false
        this.shadows.addShadowCaster(mesh, true)
        remote = { mesh, gun, target: new Vector3(), yaw: player.yaw, pitch: player.pitch, alive: player.alive, team: player.team }
        this.remotes.set(player.id, remote)
      }
      remote.target.set(player.x, player.y + BODY_HEIGHT / 2, player.z)
      remote.yaw = player.yaw
      remote.pitch = player.pitch ?? 0
      remote.team = player.team
      this.setAlive(player.id, player.alive)
      remote.mesh.metadata = { playerId: player.id, team: player.team, feet: remote.mesh.position.y - BODY_HEIGHT / 2 }
    }
    for (const id of [...this.remotes.keys()]) if (!seen.has(id)) this.remove(id)
  }

  setAlive(id: string, alive: boolean): void {
    const remote = this.remotes.get(id)
    if (!remote || remote.alive === alive) return
    remote.alive = alive
    remote.mesh.setEnabled(alive)
  }

  teleport(id: string, position: Vector3): void {
    const remote = this.remotes.get(id)
    if (!remote) return
    remote.target.set(position.x, position.y + BODY_HEIGHT / 2, position.z)
    remote.mesh.position.copyFrom(remote.target)
  }

  remove(id: string): void {
    const remote = this.remotes.get(id)
    if (!remote) return
    this.shadows.removeShadowCaster(remote.mesh, true)
    remote.mesh.dispose()
    this.remotes.delete(id)
  }

  update(dt: number): void {
    const blend = Math.min(1, dt * 12)
    for (const remote of this.remotes.values()) {
      Vector3.LerpToRef(remote.mesh.position, remote.target, blend, remote.mesh.position)
      remote.mesh.rotation.y = remote.yaw
      remote.gun.rotation.x = remote.pitch
      const meta = remote.mesh.metadata as { feet?: number } | null
      if (meta) meta.feet = remote.mesh.position.y - BODY_HEIGHT / 2
    }
  }
}
