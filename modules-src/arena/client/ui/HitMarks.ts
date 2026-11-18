import type { Scene } from '@babylonjs/core/scene'
import type { Camera } from '@babylonjs/core/Cameras/camera'
import type { AbstractMesh } from '@babylonjs/core/Meshes/abstractMesh'
import { Matrix, Vector3 } from '@babylonjs/core/Maths/math.vector'

const LIFE = 0.7
const KILL_LIFE = 1.1
const LIMIT = 12

interface Mark {
  element: HTMLDivElement
  mesh: AbstractMesh | null
  local: Vector3
  world: Vector3
  age: number
  life: number
}

export class HitMarks {
  private readonly layer: HTMLDivElement | null
  private readonly marks: Mark[] = []
  private readonly inverse = new Matrix()
  private readonly screen = new Vector3()

  constructor(private readonly scene: Scene, private readonly camera: Camera, host: HTMLElement | null) {
    this.layer = host ? document.createElement('div') : null
    if (this.layer && host) {
      this.layer.id = 'hitmarks'
      this.layer.className = 'hud'
      this.layer.setAttribute('aria-hidden', 'true')
      host.appendChild(this.layer)
    }
  }

  add(point: Vector3, mesh: AbstractMesh | null, headshot: boolean, kill: boolean): void {
    if (!this.layer) return
    while (this.marks.length >= LIMIT) this.drop(0)
    const element = document.createElement('div')
    element.className = kill ? 'hitmark kill' : headshot ? 'hitmark head' : 'hitmark'
    this.layer.appendChild(element)
    const local = new Vector3()
    if (mesh && !mesh.isDisposed()) {
      mesh.computeWorldMatrix().invertToRef(this.inverse)
      Vector3.TransformCoordinatesToRef(point, this.inverse, local)
    }
    this.marks.push({ element, mesh: mesh && !mesh.isDisposed() ? mesh : null, local, world: point.clone(), age: 0, life: kill ? KILL_LIFE : LIFE })
    this.place(this.marks[this.marks.length - 1])
  }

  upgrade(kill: boolean, headshot: boolean): void {
    const last = this.marks[this.marks.length - 1]
    if (!last || last.age > 0.4) return
    if (kill) {
      last.element.className = 'hitmark kill'
      last.life = Math.max(last.life, KILL_LIFE)
    } else if (headshot && !last.element.classList.contains('kill')) last.element.className = 'hitmark head'
  }

  update(dt: number): void {
    for (let index = this.marks.length - 1; index >= 0; index--) {
      const mark = this.marks[index]
      mark.age += dt
      if (mark.age >= mark.life) {
        this.drop(index)
        continue
      }
      this.place(mark)
    }
  }

  clear(): void {
    while (this.marks.length) this.drop(0)
  }

  private place(mark: Mark): void {
    if (mark.mesh) {
      if (mark.mesh.isDisposed() || !mark.mesh.isEnabled()) mark.mesh = null
      else Vector3.TransformCoordinatesToRef(mark.local, mark.mesh.computeWorldMatrix(), mark.world)
    }
    const engine = this.scene.getEngine()
    const canvas = engine.getRenderingCanvas()
    const width = canvas?.clientWidth ?? engine.getRenderWidth()
    const height = canvas?.clientHeight ?? engine.getRenderHeight()
    const viewport = this.camera.viewport.toGlobal(width, height)
    Vector3.ProjectToRef(mark.world, Matrix.IdentityReadOnly, this.scene.getTransformMatrix(), viewport, this.screen)
    const behind = this.screen.z < 0 || this.screen.z > 1
    const share = mark.age / mark.life
    const fade = share < 0.55 ? 1 : 1 - (share - 0.55) / 0.45
    const pop = mark.age < 0.08 ? 1.5 - (mark.age / 0.08) * 0.5 : 1
    mark.element.style.opacity = behind ? '0' : String(Math.max(0, fade))
    mark.element.style.transform = `translate(${this.screen.x.toFixed(1)}px, ${this.screen.y.toFixed(1)}px) scale(${pop.toFixed(2)})`
  }

  private drop(index: number): void {
    const [mark] = this.marks.splice(index, 1)
    mark?.element.remove()
  }
}
