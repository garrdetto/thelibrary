/**
 * Head textures mixed from the painted heads: one head's face, another's hair, a third's beard. All heads share the
 * head atlas and an evened skin tone, so the hair and beard regions (the red and green channels of
 * `hunter-head-masks.webp`, soft-edged) can be laid over any face. A head that takes all three from one painting uses
 * that painting as it is; a mix is drawn once into a texture of its own and shared by everyone wearing it.
 */
import type { Material } from '@babylonjs/core/Materials/material'
import { DynamicTexture } from '@babylonjs/core/Materials/Textures/dynamicTexture'
import type { Scene } from '@babylonjs/core/scene'
import { modelFileUrl } from '../core/ModelLibrary'
import { paintedMaterial } from '../world/TexturedMaterial'

const SIZE = 1024

interface Mix {
  material: Material
  texture: DynamicTexture
}

export interface PaintedHead {
  /** Hand this back to `release` when the head is no longer worn. Empty for a plain head, which is never freed. */
  key: string
  material: Material
}

function loadImage(file: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const image = new Image()
    image.onload = () => resolve(image)
    image.onerror = () => reject(new Error(`Missing head ${file}`))
    image.src = modelFileUrl(file)
  })
}

export class HeadPaint {
  private readonly images = new Map<string, Promise<HTMLImageElement>>()
  private readonly mixes = new Map<string, Promise<Mix>>()
  private readonly users = new Map<string, number>()
  private masks: Promise<{ hair: HTMLCanvasElement; beard: HTMLCanvasElement }> | null = null
  private readonly scratch = document.createElement('canvas')

  constructor(private readonly scene: Scene, private readonly plain: (head: string) => Material) {
    this.scratch.width = SIZE
    this.scratch.height = SIZE
  }

  async acquire(face: string, hair: string, beard: string): Promise<PaintedHead> {
    if (hair === face && beard === face) return { key: '', material: this.plain(face) }
    const key = `${face}.${hair}.${beard}`
    this.users.set(key, (this.users.get(key) ?? 0) + 1)
    let pending = this.mixes.get(key)
    if (!pending) {
      pending = this.mix(key, face, hair, beard)
      this.mixes.set(key, pending)
    }
    try {
      return { key, material: (await pending).material }
    } catch (error) {
      this.release(key)
      throw error
    }
  }

  release(key: string): void {
    if (!key) return
    const left = (this.users.get(key) ?? 0) - 1
    if (left > 0) {
      this.users.set(key, left)
      return
    }
    this.users.delete(key)
    const pending = this.mixes.get(key)
    if (!pending) return
    this.mixes.delete(key)
    void pending.then((mix) => {
      mix.material.dispose()
      mix.texture.dispose()
    }, () => undefined)
  }

  private image(head: string): Promise<HTMLImageElement> {
    let found = this.images.get(head)
    if (!found) {
      found = loadImage(`hunter-head-${head}.webp`)
      this.images.set(head, found)
      found.catch(() => this.images.delete(head))
    }
    return found
  }

  private regions(): Promise<{ hair: HTMLCanvasElement; beard: HTMLCanvasElement }> {
    this.masks ??= loadImage('hunter-head-masks.webp').then((image) => {
      const ctx = this.scratch.getContext('2d', { willReadFrequently: true })!
      ctx.globalCompositeOperation = 'copy'
      ctx.drawImage(image, 0, 0, SIZE, SIZE)
      const source = ctx.getImageData(0, 0, SIZE, SIZE).data
      const cut = (channel: number) => {
        const canvas = document.createElement('canvas')
        canvas.width = SIZE
        canvas.height = SIZE
        const out = new ImageData(SIZE, SIZE)
        for (let i = 0; i < source.length; i += 4) {
          out.data[i] = 255
          out.data[i + 1] = 255
          out.data[i + 2] = 255
          out.data[i + 3] = source[i + channel]
        }
        canvas.getContext('2d')!.putImageData(out, 0, 0)
        return canvas
      }
      return { hair: cut(0), beard: cut(1) }
    })
    return this.masks
  }

  private async mix(key: string, face: string, hair: string, beard: string): Promise<Mix> {
    const [base, top, chin, masks] = await Promise.all([this.image(face), this.image(hair), this.image(beard), this.regions()])
    const texture = new DynamicTexture(`rr-head-${key}`, { width: SIZE, height: SIZE }, this.scene, true)
    const ctx = texture.getContext() as CanvasRenderingContext2D
    ctx.drawImage(base, 0, 0, SIZE, SIZE)
    const lay = (image: HTMLImageElement, mask: HTMLCanvasElement) => {
      const s = this.scratch.getContext('2d')!
      s.globalCompositeOperation = 'copy'
      s.drawImage(image, 0, 0, SIZE, SIZE)
      s.globalCompositeOperation = 'destination-in'
      s.drawImage(mask, 0, 0)
      ctx.drawImage(this.scratch, 0, 0)
    }
    if (hair !== face) lay(top, masks.hair)
    if (beard !== face) lay(chin, masks.beard)
    texture.update(true)
    texture.anisotropicFilteringLevel = 8
    const material = paintedMaterial(this.scene, `rr-head-${key}`, texture, 'hunter-head')
    return { material, texture }
  }
}
