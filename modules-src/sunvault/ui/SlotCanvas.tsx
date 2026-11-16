import { useEffect, useRef } from 'react'
import { Scene } from '../render/scene'
import { WebGPURenderer, WebGPUUnavailableError, type RenderOptions } from '../render/webgpuRenderer'

export interface StageReady {
  scene: Scene
  renderer: WebGPURenderer
}

export interface StageFailure {
  kind: 'unsupported' | 'lost' | 'error'
  message: string
}

interface SlotCanvasProps {
  options: RenderOptions
  onReady: (stage: StageReady) => void
  onFailure: (failure: StageFailure) => void
  onFps: (fps: number) => void
}

export function SlotCanvas({ options, onReady, onFailure, onFps }: SlotCanvasProps) {
  const containerRef = useRef<HTMLDivElement>(null)
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const rendererRef = useRef<WebGPURenderer | null>(null)
  const callbacks = useRef({ onReady, onFailure, onFps })
  callbacks.current = { onReady, onFailure, onFps }

  useEffect(() => {
    if (rendererRef.current) rendererRef.current.options = options
  }, [options])

  useEffect(() => {
    const canvas = canvasRef.current
    const container = containerRef.current
    if (!canvas || !container) return
    let disposed = false
    let raf = 0
    let observer: ResizeObserver | null = null
    const scene = new Scene()

    const resize = () => {
      const dpr = Math.min(window.devicePixelRatio || 1, 2)
      const width = Math.max(2, Math.round(container.clientWidth * dpr))
      const height = Math.max(2, Math.round(container.clientHeight * dpr))
      if (canvas.width !== width || canvas.height !== height) {
        canvas.width = width
        canvas.height = height
      }
      scene.resize(width, height)
    }

    WebGPURenderer.create(canvas, (message) => callbacks.current.onFailure({ kind: 'lost', message }))
      .then((renderer) => {
        if (disposed) {
          renderer.dispose()
          return
        }
        rendererRef.current = renderer
        renderer.options = options
        resize()
        observer = new ResizeObserver(resize)
        observer.observe(container)
        let last = performance.now()
        let frames = 0
        let fpsClock = 0
        const frame = (now: number) => {
          const dt = Math.min(0.05, Math.max(0, (now - last) / 1000))
          last = now
          frames++
          fpsClock += dt
          if (fpsClock >= 0.5) {
            callbacks.current.onFps(Math.round(frames / fpsClock))
            frames = 0
            fpsClock = 0
          }
          renderer.render(scene.update(dt), canvas.width, canvas.height)
          raf = requestAnimationFrame(frame)
        }
        raf = requestAnimationFrame(frame)
        callbacks.current.onReady({ scene, renderer })
      })
      .catch((error: unknown) => {
        if (disposed) return
        const message = error instanceof Error ? error.message : 'WebGPU could not start.'
        callbacks.current.onFailure({ kind: error instanceof WebGPUUnavailableError ? 'unsupported' : 'error', message })
      })

    return () => {
      disposed = true
      cancelAnimationFrame(raf)
      observer?.disconnect()
      rendererRef.current?.dispose()
      rendererRef.current = null
    }
  }, [])

  return (
    <div ref={containerRef} className="absolute inset-0">
      <canvas ref={canvasRef} className="block h-full w-full" aria-label="Sun Vault reels" role="img" />
    </div>
  )
}
