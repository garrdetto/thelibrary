/** Module host: WebGPU renderer with WebGL2 fallback, 60 Hz fixed-step loop with interpolated rendering, iframe resize, visibility pause and full GPU teardown. */
import * as THREE from 'three/webgpu'
import type { EngineConfig, RenderBackend } from '../config'
import { FixedStep } from './FixedStep'
import { SceneGraph } from './Scene'

export interface AppOptions {
  container: HTMLElement
  config: EngineConfig
}

export interface Disposable {
  dispose(): void
}

type FixedHandler = (dt: number) => void
type FrameHandler = (frameSeconds: number, alpha: number) => void
type RenderPass = () => void

export class App {
  readonly graph = new SceneGraph()
  readonly scene = this.graph.scene
  readonly camera: THREE.PerspectiveCamera
  readonly clock: FixedStep
  renderer!: THREE.WebGPURenderer
  backend: RenderBackend = 'webgl2'
  running = false
  paused = false
  frameRate = 0

  private readonly fixedHandlers = new Set<FixedHandler>()
  private readonly frameHandlers = new Set<FrameHandler>()
  private readonly owned = new Set<Disposable>()
  private renderPass: RenderPass = () => this.renderer.render(this.scene, this.camera)
  private resizeObserver: ResizeObserver | null = null
  private lastTime = 0
  private rateFrames = 0
  private rateSeconds = 0
  private disposed = false

  private constructor(
    readonly container: HTMLElement,
    readonly config: EngineConfig,
  ) {
    const camera = config.camera
    this.camera = new THREE.PerspectiveCamera(camera.fov, 1, camera.near, camera.far)
    this.camera.position.set(...camera.position)
    this.camera.lookAt(...camera.lookAt)
    this.clock = new FixedStep(config.loop)
  }

  static async create(options: AppOptions): Promise<App> {
    const app = new App(options.container, options.config)
    await app.initRenderer()
    app.attach()
    return app
  }

  private async initRenderer(): Promise<void> {
    const forced = new URLSearchParams(location.search).has('webgl')
    const wantsWebGPU = this.config.renderer.preferWebGPU && !forced && typeof navigator !== 'undefined' && 'gpu' in navigator
    try {
      this.renderer = await this.buildRenderer(!wantsWebGPU)
    } catch (error) {
      if (!wantsWebGPU) throw error
      this.renderer = await this.buildRenderer(true)
    }
    const backend = (this.renderer as unknown as { backend?: { isWebGPUBackend?: boolean } }).backend
    this.backend = backend?.isWebGPUBackend ? 'webgpu' : 'webgl2'
  }

  private async buildRenderer(forceWebGL: boolean): Promise<THREE.WebGPURenderer> {
    const settings = this.config.renderer
    const renderer = new THREE.WebGPURenderer({ antialias: settings.antialias, forceWebGL })
    renderer.toneMapping = settings.toneMapping === 'agx' ? THREE.AgXToneMapping : settings.toneMapping === 'neutral' ? THREE.NeutralToneMapping : THREE.ACESFilmicToneMapping
    renderer.toneMappingExposure = settings.toneMappingExposure
    renderer.shadowMap.enabled = settings.shadows
    renderer.shadowMap.type = THREE.PCFShadowMap
    renderer.setClearColor(new THREE.Color(settings.clearColor))
    try {
      await renderer.init()
    } catch (error) {
      renderer.dispose()
      throw error
    }
    return renderer
  }

  private attach(): void {
    const canvas = this.renderer.domElement
    canvas.style.display = 'block'
    canvas.style.width = '100%'
    canvas.style.height = '100%'
    canvas.style.touchAction = 'none'
    this.container.appendChild(canvas)
    this.resize()
    if (typeof ResizeObserver !== 'undefined') {
      this.resizeObserver = new ResizeObserver(() => this.resize())
      this.resizeObserver.observe(this.container)
    }
    addEventListener('resize', this.resize)
    document.addEventListener('visibilitychange', this.onVisibility)
  }

  readonly resize = (): void => {
    if (this.disposed) return
    const width = this.container.clientWidth || innerWidth
    const height = this.container.clientHeight || innerHeight
    this.renderer.setPixelRatio(Math.min(devicePixelRatio || 1, this.config.renderer.maxPixelRatio))
    this.renderer.setSize(width, height, false)
    this.camera.aspect = width / Math.max(height, 1)
    this.camera.updateProjectionMatrix()
  }

  setPixelRatioCap(cap: number): void {
    this.config.renderer.maxPixelRatio = cap
    this.resize()
  }

  onFixed(handler: FixedHandler): () => void {
    this.fixedHandlers.add(handler)
    return () => this.fixedHandlers.delete(handler)
  }

  onFrame(handler: FrameHandler): () => void {
    this.frameHandlers.add(handler)
    return () => this.frameHandlers.delete(handler)
  }

  setRenderPass(pass: RenderPass | null): void {
    this.renderPass = pass ?? (() => this.renderer.render(this.scene, this.camera))
  }

  own<T extends Disposable>(resource: T): T {
    this.owned.add(resource)
    return resource
  }

  start(): void {
    if (this.running || this.disposed) return
    this.running = true
    if (document.visibilityState !== 'hidden') this.resume()
    else this.paused = true
  }

  stop(): void {
    this.running = false
    this.renderer.setAnimationLoop(null)
  }

  renderOnce(): void {
    this.renderPass()
  }

  private resume(): void {
    this.paused = false
    this.lastTime = performance.now()
    this.clock.reset()
    this.renderer.setAnimationLoop(this.tick)
  }

  private readonly onVisibility = (): void => {
    if (!this.running) return
    if (document.visibilityState === 'hidden') {
      this.paused = true
      this.renderer.setAnimationLoop(null)
    } else if (this.paused) {
      this.resume()
    }
  }

  private readonly tick = (now: number): void => {
    const frameSeconds = (now - this.lastTime) / 1000
    this.lastTime = now
    const { steps, alpha } = this.clock.advance(frameSeconds)
    for (let step = 0; step < steps; step++) for (const handler of this.fixedHandlers) handler(this.clock.dt)
    for (const handler of this.frameHandlers) handler(frameSeconds, alpha)
    this.renderPass()
    this.rateFrames++
    this.rateSeconds += frameSeconds
    if (this.rateSeconds >= this.config.loop.frameRateWindowSeconds) {
      this.frameRate = Math.round(this.rateFrames / this.rateSeconds)
      this.rateFrames = 0
      this.rateSeconds = 0
    }
  }

  dispose(): void {
    if (this.disposed) return
    this.stop()
    this.disposed = true
    this.resizeObserver?.disconnect()
    removeEventListener('resize', this.resize)
    document.removeEventListener('visibilitychange', this.onVisibility)
    for (const resource of [...this.owned].reverse()) resource.dispose()
    this.owned.clear()
    this.fixedHandlers.clear()
    this.frameHandlers.clear()
    this.graph.dispose()
    this.renderer.dispose()
    this.renderer.domElement.remove()
  }
}
