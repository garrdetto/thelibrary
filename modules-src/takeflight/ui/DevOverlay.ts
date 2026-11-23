/**
 * The performance overlay (backquote key or `?perf=1`): frame rate, a frame-time graph against the 16.6 ms budget, sim time per
 * frame, draw calls, active and total meshes, materials, textures with an estimate of their GPU memory, JS heap where the browser
 * reports it, asset-cache use and terrain tiles. Scene tools stand in for the full Babylon Inspector (which would pull about
 * twenty React and Fluent UI packages into the bundle): wireframe, bounding boxes and a dump of the scene's resource counts to
 * the console. Text updates four times a second; the graph every frame into a preallocated ring.
 */
import type { AbstractEngine } from '@babylonjs/core/Engines/abstractEngine'
import { SceneInstrumentation } from '@babylonjs/core/Instrumentation/sceneInstrumentation'
import type { Scene } from '@babylonjs/core/scene'

const SAMPLES = 120
const BUDGET_MS = 1000 / 60

export interface DevSource {
  simMs(): number
  assets(): { containers: number; referenced: number; bytes: number; budget: number }
  terrain(): { tiles: number; visible: number; built: number; trees: number }
  backend: string
  tier: string
}

export function textureBytes(scene: Scene): number {
  let bytes = 0
  for (const texture of scene.textures) {
    const size = texture.getSize()
    const faces = texture.isCube ? 6 : 1
    bytes += size.width * size.height * 4 * faces * (texture.noMipmap ? 1 : 1.34)
  }
  return bytes
}

export class DevOverlay {
  readonly root: HTMLDivElement
  private readonly text: HTMLPreElement
  private readonly graph: HTMLCanvasElement
  private readonly graphContext: CanvasRenderingContext2D | null
  private readonly frames = new Float32Array(SAMPLES)
  private head = 0
  private since = 0
  private instrumentation: SceneInstrumentation | null = null
  private wireframe = false
  private boxes = false

  constructor(parent: HTMLElement, private readonly scene: Scene, private readonly engine: AbstractEngine, private readonly source: DevSource) {
    this.root = document.createElement('div')
    this.root.className = 'tf-dev'
    this.root.hidden = true
    this.text = document.createElement('pre')
    this.text.style.margin = '0'
    this.graph = document.createElement('canvas')
    this.graph.width = 240
    this.graph.height = 56
    this.graphContext = this.graph.getContext('2d')
    const tools = document.createElement('div')
    tools.className = 'tf-row'
    const button = (label: string, run: () => void) => {
      const b = document.createElement('button')
      b.className = 'tf-btn'
      b.type = 'button'
      b.textContent = label
      b.addEventListener('click', run)
      tools.appendChild(b)
      return b
    }
    button('Wireframe', () => {
      this.wireframe = !this.wireframe
      this.scene.forceWireframe = this.wireframe
    })
    button('Bounds', () => {
      this.boxes = !this.boxes
      this.scene.forceShowBoundingBoxes = this.boxes
    })
    button('Dump scene', () => {
      console.table({ meshes: scene.meshes.length, materials: scene.materials.length, textures: scene.textures.length, geometries: scene.geometries.length, transformNodes: scene.transformNodes.length, lights: scene.lights.length, postProcesses: scene.postProcesses.length })
    })
    this.root.append(this.text, this.graph, tools)
    parent.appendChild(this.root)
  }

  get visible(): boolean {
    return !this.root.hidden
  }

  toggle(): void {
    this.setVisible(this.root.hidden)
  }

  setVisible(visible: boolean): void {
    this.root.hidden = !visible
    if (visible && !this.instrumentation) {
      this.instrumentation = new SceneInstrumentation(this.scene)
      this.instrumentation.captureFrameTime = true
    }
    if (!visible && this.instrumentation) {
      this.instrumentation.dispose()
      this.instrumentation = null
    }
  }

  update(frameMs: number, dt: number): void {
    if (this.root.hidden) return
    this.frames[this.head] = frameMs
    this.head = (this.head + 1) % SAMPLES
    this.drawGraph()
    this.since += dt
    if (this.since < 0.25) return
    this.since = 0
    const assets = this.source.assets()
    const terrain = this.source.terrain()
    const heap = (performance as Performance & { memory?: { usedJSHeapSize: number } }).memory?.usedJSHeapSize
    let worst = 0
    let sum = 0
    for (let i = 0; i < SAMPLES; i++) {
      sum += this.frames[i]
      if (this.frames[i] > worst) worst = this.frames[i]
    }
    const mb = (bytes: number) => `${(bytes / 1048576).toFixed(1)} MB`
    this.text.textContent = [
      `${this.engine.getFps().toFixed(0)} fps  avg ${(sum / SAMPLES).toFixed(1)} ms  worst ${worst.toFixed(1)} ms`,
      `sim ${this.source.simMs().toFixed(2)} ms  ${this.source.backend} · ${this.source.tier}`,
      `draw calls ${this.instrumentation?.drawCallsCounter.current ?? 0}`,
      `meshes ${this.scene.getActiveMeshes().length} active / ${this.scene.meshes.length}`,
      `materials ${this.scene.materials.length}  textures ${this.scene.textures.length}`,
      `texture memory ~${mb(textureBytes(this.scene))}`,
      `heap ${heap ? mb(heap) : 'n/a'}`,
      `assets ${assets.referenced}/${assets.containers} · ${mb(assets.bytes)} of ${mb(assets.budget)}`,
      `terrain ${terrain.visible} shown / ${terrain.tiles} cached · trees ${terrain.trees}`,
    ].join('\n')
  }

  private drawGraph(): void {
    const ctx = this.graphContext
    if (!ctx) return
    const w = this.graph.width
    const h = this.graph.height
    ctx.clearRect(0, 0, w, h)
    const scale = h / (BUDGET_MS * 2.5)
    ctx.strokeStyle = 'rgba(255,255,255,0.25)'
    ctx.beginPath()
    ctx.moveTo(0, h - BUDGET_MS * scale)
    ctx.lineTo(w, h - BUDGET_MS * scale)
    ctx.stroke()
    const bar = w / SAMPLES
    for (let i = 0; i < SAMPLES; i++) {
      const value = this.frames[(this.head + i) % SAMPLES]
      ctx.fillStyle = value > BUDGET_MS * 1.5 ? '#ef5350' : value > BUDGET_MS ? '#f0b429' : '#45c46f'
      const bh = Math.min(h, value * scale)
      ctx.fillRect(i * bar, h - bh, Math.max(1, bar - 0.5), bh)
    }
  }

  dispose(): void {
    this.instrumentation?.dispose()
    this.scene.forceWireframe = false
    this.scene.forceShowBoundingBoxes = false
    this.root.remove()
  }
}
