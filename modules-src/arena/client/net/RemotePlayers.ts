import type { Scene } from '@babylonjs/core/scene'
import { MeshBuilder } from '@babylonjs/core/Meshes/meshBuilder'
import type { Mesh } from '@babylonjs/core/Meshes/mesh'
import type { ShadowGenerator } from '@babylonjs/core/Lights/Shadows/shadowGenerator'
import { Vector3 } from '@babylonjs/core/Maths/math.vector'
import type { ArenaPlayer } from '../../shared/protocol.mjs'
import type { ArenaMaterials } from '../scene/Materials'

interface Remote {
  mesh: Mesh
  target: Vector3
  yaw: number
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
        const mesh = MeshBuilder.CreateCapsule(`remote-${player.id}`, { radius: 0.45, height: 1.8 }, this.scene)
        mesh.material = player.team === 0 ? this.materials.energyBlue : this.materials.energyRed
        mesh.position.set(player.x, player.y + 0.9, player.z)
        this.shadows.addShadowCaster(mesh)
        remote = { mesh, target: new Vector3(), yaw: player.yaw }
        this.remotes.set(player.id, remote)
      }
      remote.target.set(player.x, player.y + 0.9, player.z)
      remote.yaw = player.yaw
    }
    for (const id of [...this.remotes.keys()]) if (!seen.has(id)) this.remove(id)
  }

  remove(id: string): void {
    const remote = this.remotes.get(id)
    if (!remote) return
    this.shadows.removeShadowCaster(remote.mesh)
    remote.mesh.dispose()
    this.remotes.delete(id)
  }

  update(dt: number): void {
    const blend = Math.min(1, dt * 12)
    for (const remote of this.remotes.values()) {
      Vector3.LerpToRef(remote.mesh.position, remote.target, blend, remote.mesh.position)
      remote.mesh.rotation.y = remote.yaw
    }
  }
}
