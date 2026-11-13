/**
 * The Hood's whole buy catalog as models (`public/models/foxlake/hood-furniture.glb`, exported from The Hood's own
 * furniture code by `tools/export-hood-furniture.mjs`): one node per catalog id, centred on its footprint with its
 * front toward -z, in The Hood's metres. Each clone shares the loaded geometry and materials; the materials The
 * Hood textured (wood grain, fabric, stone, leaves, bark) get Fox Lake's textures of that kind once, on load.
 * Clones skip the loader's handedness root, like the town's vehicles: the town's mirrored root already turns
 * authored coordinates into the scene's.
 */
import type { AssetContainer } from '@babylonjs/core/assetContainer'
import { AbstractMesh } from '@babylonjs/core/Meshes/abstractMesh'
import type { TransformNode } from '@babylonjs/core/Meshes/transformNode'
import type { PBRMaterial } from '@babylonjs/core/Materials/PBR/pbrMaterial'
import type { Assets } from '../fp/core/Assets'
import type { Mats } from '../fp/core/Tex'

export const HOOD_FURNITURE_URL = '/models/foxlake/hood-furniture.glb'

const TEXTURES: Record<string, Parameters<Mats['textured']>[1]> = { grain: 'grain', fabric: 'fabric', stone: 'stone', leaves: 'grass', bark: 'bark' }

export class HoodFurniture {
  private container: AssetContainer | null = null
  private nodes = new Map<string, TransformNode>()
  private loading: Promise<boolean> | null = null

  constructor(private readonly assets: Assets, private readonly mats: Mats) {}

  get ready(): boolean {
    return !!this.container
  }

  load(): Promise<boolean> {
    this.loading ??= this.assets.container(HOOD_FURNITURE_URL).then((c) => {
      if (!c) return false
      this.container = c
      for (const n of [...c.transformNodes, ...c.meshes]) if (n.parent?.name === '__root__') this.nodes.set(n.name, n as TransformNode)
      for (const m of c.materials) {
        const kind = TEXTURES[m.name]
        if (!kind) continue
        const src = this.mats.textured(`hdf-${m.name}`, kind, { tile: 1 }) as PBRMaterial
        const pbr = m as PBRMaterial
        pbr.albedoTexture = src.albedoTexture
        pbr.bumpTexture = src.bumpTexture
        if (pbr.bumpTexture) pbr.bumpTexture.level = 0.7
      }
      return true
    })
    return this.loading
  }

  /** A clone of catalog item `id` under `parent` (its own frame), or null when it isn't loaded or doesn't exist. */
  make(id: string, parent: TransformNode, shadows = false): TransformNode | null {
    const src = this.nodes.get(id)
    if (!src) return null
    const clone = src.instantiateHierarchy(parent, { doNotInstantiate: true }, (_from, made) => {
      if (made instanceof AbstractMesh) {
        made.isPickable = false
        made.receiveShadows = true
        ;(made as AbstractMesh & { __caster?: boolean }).__caster = shadows
      }
    })
    if (!clone) return null
    clone.position.setAll(0)
    clone.rotationQuaternion = null
    clone.rotation.setAll(0)
    clone.setEnabled(true)
    return clone
  }
}
