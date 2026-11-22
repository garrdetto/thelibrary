/**
 * A sign atlas: one `DynamicTexture` of plain block lettering (cream capitals on a dark board) split into equal cells, and one
 * material that shows it. A site layer shares one atlas for every sign it draws; a lot uses a one-cell atlas for its company
 * name. `cell` hands out the next free cell for a text (the same text twice reuses its cell) and returns its UV rectangle.
 */

import type { Scene } from '@babylonjs/core/scene'
import { DynamicTexture } from '@babylonjs/core/Materials/Textures/dynamicTexture'
import { PBRMaterial } from '@babylonjs/core/Materials/PBR/pbrMaterial'
import { Color3 } from '@babylonjs/core/Maths/math.color'
import type { UvRect } from './Batch'

export interface SignAtlasOptions {
  cellWidth: number
  cellHeight: number
  columns: number
  rows: number
  board?: string
  ink?: string
}

const FONT_STACK = "'TL Fox Dollar', 'Arial Narrow', Arial, Helvetica, sans-serif"

/** One lettering atlas and its material. */
export class SignAtlas {
  readonly texture: DynamicTexture
  readonly material: PBRMaterial
  private readonly context: CanvasRenderingContext2D
  private readonly cells = new Map<string, UvRect>()
  private next = 0
  private disposed = false

  constructor(scene: Scene, name: string, private readonly options: SignAtlasOptions) {
    const width = options.cellWidth * options.columns
    const height = options.cellHeight * options.rows
    this.texture = new DynamicTexture(`${name}-atlas`, { width, height }, scene, true)
    this.context = this.texture.getContext() as CanvasRenderingContext2D
    this.context.fillStyle = options.board ?? '#1d2024'
    this.context.fillRect(0, 0, width, height)
    this.texture.update(true)
    this.material = new PBRMaterial(`${name}-sign`, scene)
    this.material.albedoTexture = this.texture
    this.material.emissiveTexture = this.texture
    this.material.emissiveColor = new Color3(0.16, 0.16, 0.16)
    this.material.metallic = 0
    this.material.roughness = 0.92
    this.material.metallicF0Factor = 0
    this.material.environmentIntensity = 0.25
  }

  /** The UV rectangle of a text's cell, drawing it the first time. Null when the atlas is full. */
  cell(text: string): UvRect | null {
    const known = this.cells.get(text)
    if (known) return known
    const { cellWidth, cellHeight, columns, rows } = this.options
    if (this.next >= columns * rows) return null
    const column = this.next % columns
    const row = Math.floor(this.next / columns)
    this.next++
    this.draw(text, column * cellWidth, row * cellHeight)
    this.texture.update(true)
    const width = cellWidth * columns
    const height = cellHeight * rows
    const rect: UvRect = {
      u0: (column * cellWidth + 2) / width,
      u1: ((column + 1) * cellWidth - 2) / width,
      v1: 1 - (row * cellHeight + 2) / height,
      v0: 1 - ((row + 1) * cellHeight - 2) / height,
    }
    this.cells.set(text, rect)
    return rect
  }

  private draw(text: string, x: number, y: number): void {
    const { cellWidth, cellHeight } = this.options
    const g = this.context
    g.fillStyle = this.options.board ?? '#1d2024'
    g.fillRect(x, y, cellWidth, cellHeight)
    g.strokeStyle = 'rgba(232,226,208,0.55)'
    g.lineWidth = Math.max(2, cellHeight * 0.04)
    g.strokeRect(x + cellHeight * 0.08, y + cellHeight * 0.08, cellWidth - cellHeight * 0.16, cellHeight - cellHeight * 0.16)
    const label = text.toUpperCase()
    let size = Math.round(cellHeight * 0.58)
    g.font = `700 ${size}px ${FONT_STACK}`
    while (g.measureText(label).width > cellWidth - cellHeight * 0.5 && size > 8) {
      size -= 2
      g.font = `700 ${size}px ${FONT_STACK}`
    }
    g.textAlign = 'center'
    g.textBaseline = 'middle'
    g.fillStyle = this.options.ink ?? '#eee6cf'
    g.fillText(label, x + cellWidth / 2, y + cellHeight / 2 + size * 0.04)
  }

  /** Disposes the texture and the material. */
  dispose(): void {
    if (this.disposed) return
    this.disposed = true
    this.material.dispose(false, false)
    this.texture.dispose()
  }
}
