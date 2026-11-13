/**
 * Optional performance overlay for Rack & Reel and Fox Lake, off unless the address has `?perf=1` (or `?perf=log`, which also
 * prints a console table every 10 s). When off nothing here is created, so it costs nothing.
 *
 * It shows what to look at when frames drop or memory climbs:
 * - FPS, CPU time per frame (everything between the engine's begin and end of frame, game logic included), the scene's own render
 *   time, the shadow and other render-target time, active-mesh selection time, and GPU time where the browser allows timer queries
 *   (WebGL2 with EXT_disjoint_timer_query, WebGPU with timestamp queries; otherwise "n/a").
 * - Draw calls, active meshes, drawn triangles and the scene's total vertices.
 * - How often the cached and moving shadow layers were redrawn (`core/ShadowLayers.ts`); standing still both should stop climbing.
 * - Loaded textures, meshes, materials and geometries with their change since a baseline taken after the world settles, plus the
 *   JS heap where the browser reports it. A count that keeps setting new highs is flagged in red as a likely leak (`PerfTrend.ts`).
 *
 * Per-frame work is a few `performance.now()` calls and number writes; the text is rebuilt four times a second.
 * `window.__rrPerf()` returns the latest numbers for scripted checks (e.g. Playwright).
 */
import { EngineInstrumentation } from '@babylonjs/core/Instrumentation/engineInstrumentation'
import { SceneInstrumentation } from '@babylonjs/core/Instrumentation/sceneInstrumentation'
import type { EngineContext } from './EngineSetup'
import { RESOURCE_KEYS, ResourceTrend } from './PerfTrend'
import type { PerfMode, ResourceCounts } from './PerfTrend'

const TEXT_INTERVAL_MS = 250
const SAMPLE_INTERVAL_MS = 2000
const LOG_INTERVAL_MS = 10000

export interface PerfSnapshot {
  fps: number
  cpuMs: number
  sceneMs: number
  targetsMs: number
  selectMs: number
  gpuMs: number | null
  drawCalls: number
  activeMeshes: number
  triangles: number
  vertices: number
  shadowDraws: { fixed: number; moving: number }
  resources: ResourceCounts
  growth: ResourceCounts
  growing: string[]
  heapMb: number | null
}

export interface PerfOverlay {
  snapshot(): PerfSnapshot
  dispose(): void
}

function heapMegabytes(): number | null {
  const memory = (performance as Performance & { memory?: { usedJSHeapSize: number } }).memory
  return memory ? memory.usedJSHeapSize / 1048576 : null
}

export function attachPerfOverlay(ctx: EngineContext, mode: Exclude<PerfMode, 'off'>): PerfOverlay {
  const { engine, scene } = ctx
  const sceneInst = new SceneInstrumentation(scene)
  sceneInst.captureFrameTime = true
  sceneInst.captureRenderTime = true
  sceneInst.captureRenderTargetsRenderTime = true
  sceneInst.captureActiveMeshesEvaluationTime = true
  const engineInst = new EngineInstrumentation(engine)
  try {
    engineInst.captureGPUFrameTime = true
  } catch {
    /* The browser has no GPU timer queries; the overlay shows n/a. */
  }

  const panel = document.createElement('pre')
  panel.setAttribute('aria-hidden', 'true')
  panel.style.cssText = 'position:fixed;left:8px;bottom:8px;z-index:9999;margin:0;padding:8px 10px;max-width:340px;font:11px/1.35 ui-monospace,Menlo,Consolas,monospace;color:#e8f2e8;background:rgba(10,14,12,0.78);border-radius:6px;pointer-events:none;white-space:pre'
  document.body.appendChild(panel)

  let frameStart = 0
  let cpuAverage = 0
  const begin = engine.onBeginFrameObservable.add(() => {
    frameStart = performance.now()
  })
  const end = engine.onEndFrameObservable.add(() => {
    if (frameStart) cpuAverage += (performance.now() - frameStart - cpuAverage) * 0.05
  })

  const trend = new ResourceTrend()
  const startedAt = performance.now()
  const counts = (): ResourceCounts => ({
    textures: engine.getLoadedTexturesCache().length,
    meshes: scene.meshes.length,
    materials: scene.materials.length,
    geometries: scene.geometries.length,
  })

  const snapshot = (): PerfSnapshot => {
    const resources = counts()
    const gpu = engineInst.gpuFrameTimeCounter.lastSecAverage
    return {
      fps: engine.getFps(),
      cpuMs: cpuAverage,
      sceneMs: sceneInst.renderTimeCounter.lastSecAverage,
      targetsMs: sceneInst.renderTargetsRenderTimeCounter.lastSecAverage,
      selectMs: sceneInst.activeMeshesEvaluationTimeCounter.lastSecAverage,
      gpuMs: gpu > 0 ? gpu / 1e6 : null,
      drawCalls: sceneInst.drawCallsCounter.current,
      activeMeshes: scene.getActiveMeshes().length,
      triangles: Math.round(scene.getActiveIndices() / 3),
      vertices: scene.getTotalVertices(),
      shadowDraws: { ...ctx.shadowLayers.drawn },
      resources,
      growth: trend.delta(resources),
      growing: trend.growing(),
      heapMb: heapMegabytes(),
    }
  }

  const signed = (n: number) => (n > 0 ? `+${n}` : `${n}`)
  const render = () => {
    const s = snapshot()
    const gpu = s.gpuMs === null ? 'n/a' : `${s.gpuMs.toFixed(2)} ms`
    const lines = [
      `${s.fps.toFixed(0)} fps · ${ctx.backend}`,
      `cpu ${s.cpuMs.toFixed(2)} ms  gpu ${gpu}`,
      `scene ${s.sceneMs.toFixed(2)}  targets ${s.targetsMs.toFixed(2)}  select ${s.selectMs.toFixed(2)}`,
      `draws ${s.drawCalls}  meshes ${s.activeMeshes}  tris ${s.triangles.toLocaleString()}`,
      `vertices ${s.vertices.toLocaleString()}`,
      `shadow redraws  cache ${s.shadowDraws.fixed}  movers ${s.shadowDraws.moving}`,
      ...RESOURCE_KEYS.map((key) => `${key.padEnd(10)} ${String(s.resources[key]).padStart(5)}  ${trend.baseline ? signed(s.growth[key]) : '(settling)'}${s.growing.includes(key) ? '  ▲ climbing' : ''}`),
      s.heapMb === null ? 'heap n/a' : `heap ${s.heapMb.toFixed(0)} MB`,
    ]
    panel.textContent = lines.join('\n')
    panel.style.color = s.growing.length ? '#ffb4a8' : '#e8f2e8'
  }

  const textTimer = setInterval(render, TEXT_INTERVAL_MS)
  const sampleTimer = setInterval(() => trend.sample(counts(), (performance.now() - startedAt) / 1000), SAMPLE_INTERVAL_MS)
  const logTimer = mode === 'log'
    ? setInterval(() => {
        const s = snapshot()
        console.table({ fps: s.fps, cpuMs: s.cpuMs, gpuMs: s.gpuMs, drawCalls: s.drawCalls, activeMeshes: s.activeMeshes, triangles: s.triangles, ...s.resources, heapMb: s.heapMb })
        if (s.growing.length) console.warn(`[perf] still climbing: ${s.growing.join(', ')}`)
      }, LOG_INTERVAL_MS)
    : null

  const overlay: PerfOverlay = {
    snapshot,
    dispose() {
      clearInterval(textTimer)
      clearInterval(sampleTimer)
      if (logTimer) clearInterval(logTimer)
      engine.onBeginFrameObservable.remove(begin)
      engine.onEndFrameObservable.remove(end)
      sceneInst.dispose()
      engineInst.dispose()
      panel.remove()
      delete (window as Window & { __rrPerf?: () => PerfSnapshot }).__rrPerf
    },
  }
  ;(window as Window & { __rrPerf?: () => PerfSnapshot }).__rrPerf = snapshot
  return overlay
}
