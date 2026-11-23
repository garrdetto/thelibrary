/**
 * Always-on memory watchdog for Truck Simulator. A timer driven by the scene's render observable (no setInterval) samples mesh,
 * material, texture and geometry counts, draw calls and the JS heap every couple of seconds into a 60-sample ring, feeds Rack &
 * Reel's `ResourceTrend` so a count that keeps setting new highs is flagged as a leak, and turns the trend plus the budgets into a
 * pressure level. Streamers, pools and caches report their own sizes through gauges. Listeners hear about level changes (and again
 * every 30 s while critical) so they can shrink radii, trim caches or drop a quality tier. `window.__truckMem()` returns the
 * report, and `?perf=1` shows a small fixed overlay refreshed once per sample. The render hook only compares two numbers. Draw calls
 * over budget only ever warn: they cost frame time, not memory, and cascaded shadows on high and ultra multiply them, so they never
 * make the level critical (which drops a quality tier).
 */
import type { Observer } from '@babylonjs/core/Misc/observable'
import type { Scene } from '@babylonjs/core/scene'
import { RESOURCE_KEYS, ResourceTrend, perfModeFromSearch } from '../../rackreel/core/PerfTrend'
import type { PerfMode, ResourceCounts } from '../../rackreel/core/PerfTrend'

export type PressureLevel = 'ok' | 'warn' | 'critical'

export interface MemoryBudget extends ResourceCounts {
  drawCalls: number
  heapMegabytes: number
}

export interface MemoryGuardOptions {
  budget?: Partial<MemoryBudget>
  sampleMs?: number
  search?: string
}

export interface GaugeReading {
  name: string
  value: number
  limit: number | null
}

export interface MemoryReport {
  pressure: PressureLevel
  elapsedSeconds: number
  samples: number
  historyLength: number
  counts: ResourceCounts
  delta: ResourceCounts
  drawCalls: number
  heapMegabytes: number | null
  budget: MemoryBudget
  growing: (keyof ResourceCounts)[]
  gauges: GaugeReading[]
  reasons: string[]
}

export type PressureListener = (level: PressureLevel, report: MemoryReport) => void

interface HeapInformation {
  memory?: { usedJSHeapSize: number }
}

declare global {
  interface Window {
    __truckMem?: () => MemoryReport
  }
}

export const DEFAULT_BUDGET: MemoryBudget = {
  textures: 160,
  meshes: 2500,
  materials: 220,
  geometries: 2500,
  drawCalls: 1200,
  heapMegabytes: 1400,
}

export const HISTORY_SAMPLES = 60
export const WARN_FRACTION = 0.85
export const CRITICAL_REPEAT_MS = 30000

interface Sample {
  atMs: number
  textures: number
  meshes: number
  materials: number
  geometries: number
  drawCalls: number
  heapMegabytes: number
}

interface Gauge {
  name: string
  read: () => number
  limit: number | null
}

const LEVEL_RANK: Record<PressureLevel, number> = { ok: 0, warn: 1, critical: 2 }

function emptySample(): Sample {
  return { atMs: 0, textures: 0, meshes: 0, materials: 0, geometries: 0, drawCalls: 0, heapMegabytes: -1 }
}

/** Watches a scene's resource counts and reports leaks and budget pressure. */
export class MemoryGuard {
  private readonly scene: Scene
  private readonly budget: MemoryBudget
  private readonly sampleMs: number
  private readonly trend = new ResourceTrend()
  private readonly history: Sample[] = Array.from({ length: HISTORY_SAMPLES }, emptySample)
  private readonly gauges: Gauge[] = []
  private readonly listeners: PressureListener[] = []
  private readonly reasonBuffer: string[] = []
  private readonly renderObserver: Observer<Scene> | null
  private readonly perfMode: PerfMode
  private overlay: HTMLElement | null = null
  private sampleCount = 0
  private startMs = 0
  private lastSampleMs = 0
  private lastRenderSampleMs = -1
  private lastCriticalNotifyMs = 0
  private pressureLevel: PressureLevel = 'ok'
  private lastLogMs = 0
  private lastDrawTotal = -1
  private lastFrameId = -1
  private disposed = false

  constructor(scene: Scene, options: MemoryGuardOptions = {}) {
    this.scene = scene
    this.budget = { ...DEFAULT_BUDGET, ...options.budget }
    this.sampleMs = options.sampleMs ?? 2000
    const search = options.search ?? (typeof window !== 'undefined' ? window.location.search : '')
    this.perfMode = perfModeFromSearch(search)
    this.renderObserver = scene.onBeforeRenderObservable.add(() => {
      const nowMs = performance.now()
      if (this.lastRenderSampleMs < 0) this.lastRenderSampleMs = nowMs
      if (nowMs - this.lastRenderSampleMs < this.sampleMs) return
      this.lastRenderSampleMs = nowMs
      this.sample(nowMs)
    })
    if (typeof window !== 'undefined') window.__truckMem = () => this.report()
    if (this.perfMode !== 'off' && typeof document !== 'undefined') this.createOverlay()
  }

  get pressure(): PressureLevel {
    return this.pressureLevel
  }

  /** Lets a streamer, pool or cache show its own size (and optional limit) in the report and overlay; returns an unregister function. */
  registerGauge(name: string, read: () => number, limit?: number): () => void {
    const gauge: Gauge = { name, read, limit: limit ?? null }
    this.gauges.push(gauge)
    return () => {
      const index = this.gauges.indexOf(gauge)
      if (index >= 0) this.gauges.splice(index, 1)
    }
  }

  /** Called when the level changes, and every 30 s while it stays critical. Returns an unsubscribe function. */
  onPressure(listener: PressureListener): () => void {
    this.listeners.push(listener)
    return () => {
      const index = this.listeners.indexOf(listener)
      if (index >= 0) this.listeners.splice(index, 1)
    }
  }

  /**
   * Babylon's draw-call counter keeps adding up unless an instrumentation resets it each frame, so the guard reads how much it
   * grew since the last sample and divides by the frames rendered in between.
   */
  private drawCallsPerFrame(): number {
    const engine = this.scene.getEngine()
    const counter = engine._drawCalls
    if (!counter) return 0
    const total = counter.current
    const frame = engine.frameId
    const previousTotal = this.lastDrawTotal
    const previousFrame = this.lastFrameId
    this.lastDrawTotal = total
    this.lastFrameId = frame
    if (previousTotal < 0 || frame <= previousFrame || total < previousTotal) return 0
    return Math.round((total - previousTotal) / (frame - previousFrame))
  }

  /** Takes one sample at `nowMs` (the render hook calls this on a timer; tests call it directly). */
  sample(nowMs: number): void {
    if (this.disposed) return
    if (this.sampleCount === 0) this.startMs = nowMs
    const slot = this.history[this.sampleCount % HISTORY_SAMPLES]
    slot.atMs = nowMs
    slot.textures = this.scene.textures.length
    slot.meshes = this.scene.meshes.length
    slot.materials = this.scene.materials.length
    slot.geometries = this.scene.geometries.length
    slot.drawCalls = this.drawCallsPerFrame()
    const heap = (performance as unknown as HeapInformation).memory
    slot.heapMegabytes = heap ? heap.usedJSHeapSize / 1048576 : -1
    this.sampleCount++
    this.lastSampleMs = nowMs
    this.trend.sample(slot, (nowMs - this.startMs) / 1000)
    const level = this.evaluate(slot)
    this.notify(level, nowMs)
    if (this.overlay) this.overlay.textContent = this.overlayText()
    if (this.perfMode === 'log' && nowMs - this.lastLogMs >= 10000) {
      this.lastLogMs = nowMs
      console.table(this.report().counts)
    }
  }

  report(): MemoryReport {
    const latest = this.latest()
    const counts: ResourceCounts = { textures: latest.textures, meshes: latest.meshes, materials: latest.materials, geometries: latest.geometries }
    return {
      pressure: this.pressureLevel,
      elapsedSeconds: this.sampleCount === 0 ? 0 : (this.lastSampleMs - this.startMs) / 1000,
      samples: this.sampleCount,
      historyLength: Math.min(this.sampleCount, HISTORY_SAMPLES),
      counts,
      delta: this.trend.delta(counts),
      drawCalls: latest.drawCalls,
      heapMegabytes: latest.heapMegabytes >= 0 ? latest.heapMegabytes : null,
      budget: { ...this.budget },
      growing: this.trend.growing(),
      gauges: this.gauges.map((gauge) => ({ name: gauge.name, value: gauge.read(), limit: gauge.limit })),
      reasons: this.reasonBuffer.slice(),
    }
  }

  dispose(): void {
    if (this.disposed) return
    this.disposed = true
    if (this.renderObserver) this.scene.onBeforeRenderObservable.remove(this.renderObserver)
    this.overlay?.remove()
    this.overlay = null
    this.listeners.length = 0
    this.gauges.length = 0
    if (typeof window !== 'undefined') delete window.__truckMem
  }

  private latest(): Sample {
    if (this.sampleCount === 0) return emptySample()
    return this.history[(this.sampleCount - 1) % HISTORY_SAMPLES]
  }

  private evaluate(sample: Sample): PressureLevel {
    this.reasonBuffer.length = 0
    let rank = 0
    for (const key of this.trend.growing()) {
      rank = Math.max(rank, 1)
      this.reasonBuffer.push(`${key} keep climbing`)
    }
    for (const key of RESOURCE_KEYS) rank = Math.max(rank, this.judge(key, sample[key], this.budget[key]))
    rank = Math.max(rank, Math.min(1, this.judge('draw calls', sample.drawCalls, this.budget.drawCalls)))
    if (sample.heapMegabytes >= 0) rank = Math.max(rank, this.judge('heap', sample.heapMegabytes, this.budget.heapMegabytes))
    for (const gauge of this.gauges) {
      if (gauge.limit !== null) rank = Math.max(rank, this.judge(gauge.name, gauge.read(), gauge.limit))
    }
    return rank === 2 ? 'critical' : rank === 1 ? 'warn' : 'ok'
  }

  private judge(name: string, value: number, limit: number): number {
    if (limit <= 0) return 0
    if (value > limit) {
      this.reasonBuffer.push(`${name} ${Math.round(value)} is over ${limit}`)
      return 2
    }
    if (value >= limit * WARN_FRACTION) {
      this.reasonBuffer.push(`${name} ${Math.round(value)} is near ${limit}`)
      return 1
    }
    return 0
  }

  private notify(level: PressureLevel, nowMs: number): void {
    const changed = LEVEL_RANK[level] !== LEVEL_RANK[this.pressureLevel]
    const repeat = level === 'critical' && nowMs - this.lastCriticalNotifyMs >= CRITICAL_REPEAT_MS
    this.pressureLevel = level
    if (!changed && !repeat) return
    if (level === 'critical') this.lastCriticalNotifyMs = nowMs
    if (this.listeners.length === 0) return
    const report = this.report()
    for (const listener of this.listeners.slice()) {
      try {
        listener(level, report)
      } catch (error) {
        console.error('MemoryGuard listener failed', error)
      }
    }
  }

  private createOverlay(): void {
    const element = document.createElement('div')
    element.style.cssText = 'position:fixed;left:8px;bottom:8px;z-index:2147483000;padding:6px 8px;background:rgba(0,0,0,0.72);color:#e8e8e8;font:11px/1.35 ui-monospace,Menlo,Consolas,monospace;white-space:pre;pointer-events:none;border-radius:4px'
    element.setAttribute('aria-hidden', 'true')
    document.body.appendChild(element)
    this.overlay = element
  }

  private overlayText(): string {
    const report = this.report()
    const lines = [`memory ${report.pressure.toUpperCase()}  ${report.samples} samples`]
    for (const key of RESOURCE_KEYS) {
      const growing = report.growing.includes(key) ? ' GROWING' : ''
      const delta = report.delta[key]
      lines.push(`${key.padEnd(10)} ${String(report.counts[key]).padStart(6)} / ${report.budget[key]}  ${delta >= 0 ? '+' : ''}${delta}${growing}`)
    }
    lines.push(`draw calls ${String(report.drawCalls).padStart(6)} / ${report.budget.drawCalls}`)
    if (report.heapMegabytes !== null) lines.push(`heap MB    ${report.heapMegabytes.toFixed(0).padStart(6)} / ${report.budget.heapMegabytes}`)
    for (const gauge of report.gauges) lines.push(`${gauge.name.padEnd(10)} ${String(gauge.value).padStart(6)}${gauge.limit === null ? '' : ` / ${gauge.limit}`}`)
    for (const reason of report.reasons) lines.push(`! ${reason}`)
    return lines.join('\n')
  }
}
