import { DynamicTexture } from '@babylonjs/core/Materials/Textures/dynamicTexture'
import { StandardMaterial } from '@babylonjs/core/Materials/standardMaterial'
import { Color3 } from '@babylonjs/core/Maths/math.color'
import { Vector3 } from '@babylonjs/core/Maths/math.vector'
import { CreatePlane } from '@babylonjs/core/Meshes/Builders/planeBuilder'
import type { Mesh } from '@babylonjs/core/Meshes/mesh'
import type { Scene } from '@babylonjs/core/scene'
import type { Cabin } from './Cabin'

const BOARD_W = 5.4
const BOARD_H = 0.56

/**
 * The painted lettering on the board over the garage bay (Fox Outfitters): cream letters with a dark outline and a
 * routed border, drawn once on a canvas, faintly self-lit so it reads at dusk. Null when the building has no sign.
 */
export function buildStoreSign(scene: Scene, cabin: Cabin): Mesh | null {
  const { sign, garage, halfD } = cabin.layout
  if (!sign || !garage) return null
  const width = 1024
  const height = Math.round((width * BOARD_H) / BOARD_W)
  const tex = new DynamicTexture('store-sign', { width, height }, scene, true)
  tex.hasAlpha = true
  const g = tex.getContext() as CanvasRenderingContext2D
  g.clearRect(0, 0, width, height)
  g.strokeStyle = 'rgba(240,222,170,0.85)'
  g.lineWidth = 5
  g.strokeRect(14, 12, width - 28, height - 24)
  let size = Math.round(height * 0.62)
  const font = (px: number) => `900 ${px}px Georgia,"Times New Roman",serif`
  g.font = font(size)
  while (g.measureText(sign).width > width - 90 && size > 16) {
    size -= 2
    g.font = font(size)
  }
  g.textAlign = 'center'
  g.textBaseline = 'middle'
  g.lineJoin = 'round'
  g.lineWidth = Math.max(4, size * 0.12)
  g.strokeStyle = '#1c0f05'
  g.strokeText(sign, width / 2, height / 2 + 2)
  const fill = g.createLinearGradient(0, height * 0.2, 0, height * 0.8)
  fill.addColorStop(0, '#fff3cf')
  fill.addColorStop(1, '#e2bf72')
  g.fillStyle = fill
  g.fillText(sign, width / 2, height / 2 + 2)
  tex.update(true)
  const mat = new StandardMaterial('store-sign', scene)
  mat.diffuseTexture = tex
  mat.useAlphaFromDiffuseTexture = true
  mat.emissiveColor = new Color3(0.22, 0.2, 0.16)
  mat.specularColor = new Color3(0.05, 0.05, 0.05)
  const plane = CreatePlane('store-sign', { width: BOARD_W - 0.1, height: BOARD_H - 0.06 }, scene)
  plane.material = mat
  plane.position.copyFrom(cabin.toWorld(new Vector3((garage.x0 + garage.x1) / 2, garage.floor + 2.75 - 0.42, halfD + 0.29)))
  plane.rotation.y = cabin.heading + Math.PI
  plane.isPickable = false
  plane.freezeWorldMatrix()
  return plane
}
