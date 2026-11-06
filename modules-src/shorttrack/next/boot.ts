import { ArcRotateCamera } from '@babylonjs/core/Cameras/arcRotateCamera'
import type { AbstractEngine } from '@babylonjs/core/Engines/abstractEngine'
import { Engine } from '@babylonjs/core/Engines/engine'
import { WebGPUEngine } from '@babylonjs/core/Engines/webgpuEngine'
import { DirectionalLight } from '@babylonjs/core/Lights/directionalLight'
import { HemisphericLight } from '@babylonjs/core/Lights/hemisphericLight'
import { StandardMaterial } from '@babylonjs/core/Materials/standardMaterial'
import { Color3, Color4 } from '@babylonjs/core/Maths/math.color'
import { Vector3 } from '@babylonjs/core/Maths/math.vector'
import { CreateBox } from '@babylonjs/core/Meshes/Builders/boxBuilder'
import { CreateGround } from '@babylonjs/core/Meshes/Builders/groundBuilder'
import { PhysicsShapeType } from '@babylonjs/core/Physics/v2/IPhysicsEnginePlugin'
import { PhysicsAggregate } from '@babylonjs/core/Physics/v2/physicsAggregate'
import '@babylonjs/core/Physics/joinedPhysicsEngineComponent'
import '@babylonjs/core/Physics/v2/physicsEngineComponent'
import { HavokPlugin } from '@babylonjs/core/Physics/v2/Plugins/havokPlugin'
import { Scene } from '@babylonjs/core/scene'
import HavokPhysics from '@babylonjs/havok'
import havokWasm from '@babylonjs/havok/lib/esm/HavokPhysics.wasm?url'

export type Backend = 'webgpu' | 'webgl2'

export type NextStatus = {
  backend: Backend | null
  physics: 'havok' | null
  frames: number
  fps: number
  error: string | null
  fellBack: boolean
}

declare global {
  interface Window {
    __stNext?: NextStatus
  }
}

type GpuPreference = 'high-performance' | undefined

async function webGpuPreference(): Promise<GpuPreference | null> {
  const gpu = (navigator as Navigator & { gpu?: { requestAdapter(options?: { powerPreference?: string }): Promise<unknown> } }).gpu
  if (!gpu || !(await WebGPUEngine.IsSupportedAsync)) return null
  try {
    if (await gpu.requestAdapter({ powerPreference: 'high-performance' })) return 'high-performance'
    if (await gpu.requestAdapter()) return undefined
  } catch {
    return null
  }
  return null
}

export async function createEngine(canvas: HTMLCanvasElement, force: string | null): Promise<{ engine: AbstractEngine; backend: Backend }> {
  const preference = force === 'webgl' ? null : await webGpuPreference()
  if (preference !== null) {
    try {
      const engine = new WebGPUEngine(canvas, { antialias: true, adaptToDeviceRatio: true, ...(preference ? { powerPreference: preference } : {}) })
      await engine.initAsync()
      return { engine, backend: 'webgpu' }
    } catch (error) {
      console.warn('WebGPU unavailable, using WebGL2', error)
    }
  }
  const engine = new Engine(canvas, true, { powerPreference: 'high-performance', stencil: true }, true)
  return { engine, backend: 'webgl2' }
}

export async function createPhysics(scene: Scene): Promise<HavokPlugin> {
  const havok = await HavokPhysics({ locateFile: () => havokWasm })
  const plugin = new HavokPlugin(true, havok)
  scene.enablePhysics(new Vector3(0, -9.81, 0), plugin)
  return plugin
}

function stage(): { canvas: HTMLCanvasElement; readout: HTMLDivElement } {
  for (const id of ['menus', 'hud', 'c']) document.getElementById(id)?.classList.add('hidden')
  const host = document.getElementById('wrap') ?? document.body
  const canvas = document.createElement('canvas')
  canvas.id = 'next'
  canvas.style.cssText = 'display:block;width:100%;height:100%;touch-action:none'
  const readout = document.createElement('div')
  readout.id = 'nextReadout'
  readout.className = 'panel'
  readout.style.cssText = 'position:absolute;left:12px;top:12px;padding:8px 12px;font:600 13px/1.4 system-ui,sans-serif;color:#eef2f7;pointer-events:none'
  readout.textContent = 'Starting the next renderer…'
  host.append(canvas, readout)
  return { canvas, readout }
}

function testScene(scene: Scene) {
  scene.clearColor = new Color4(0.42, 0.6, 0.82, 1)
  const camera = new ArcRotateCamera('camera', -Math.PI / 3, 1.05, 34, new Vector3(0, 1, 0), scene)
  camera.attachControl(true)
  new HemisphericLight('sky', new Vector3(0, 1, 0), scene).intensity = 0.55
  const sun = new DirectionalLight('sun', new Vector3(-0.4, -1, -0.3), scene)
  sun.intensity = 1.6
  const asphalt = new StandardMaterial('asphalt', scene)
  asphalt.diffuseColor = new Color3(0.16, 0.17, 0.19)
  const ground = CreateGround('ground', { width: 60, height: 40 }, scene)
  ground.material = asphalt
  new PhysicsAggregate(ground, PhysicsShapeType.BOX, { mass: 0 }, scene)
  const paint = new StandardMaterial('paint', scene)
  paint.diffuseColor = new Color3(0.9, 0.18, 0.12)
  for (let i = 0; i < 6; i += 1) {
    const box = CreateBox(`car${i}`, { width: 1.9, height: 1.2, depth: 4.6 }, scene)
    box.position.set(-10 + i * 4, 4 + i * 1.5, 0)
    box.rotation.set(0.3 * i, 0.5 * i, 0)
    box.material = paint
    new PhysicsAggregate(box, PhysicsShapeType.BOX, { mass: 1200, restitution: 0.2, friction: 0.9 }, scene)
  }
}

async function run(canvas: HTMLCanvasElement, readout: HTMLDivElement, status: NextStatus, force: string | null): Promise<void> {
  const { engine, backend } = await createEngine(canvas, force)
  status.backend = backend
  const scene = new Scene(engine)
  await createPhysics(scene)
  status.physics = 'havok'
  testScene(scene)
  let lost = false
  engine.onContextLostObservable.add(() => {
    if (backend !== 'webgpu' || lost) return
    lost = true
    console.warn('WebGPU device lost, switching to WebGL2')
    engine.stopRenderLoop()
    scene.dispose()
    engine.dispose()
    const replacement = canvas.cloneNode() as HTMLCanvasElement
    canvas.replaceWith(replacement)
    status.fellBack = true
    void run(replacement, readout, status, 'webgl').catch((error) => fail(readout, status, error))
  })
  engine.runRenderLoop(() => {
    scene.render()
    status.frames += 1
    if (status.frames % 30 === 0) {
      status.fps = Math.round(engine.getFps())
      readout.textContent = `Next renderer · ${backend === 'webgpu' ? 'WebGPU' : 'WebGL2'} · Havok physics · ${status.fps} fps`
    }
  })
  const resize = () => engine.resize()
  addEventListener('resize', resize)
  scene.onDisposeObservable.add(() => removeEventListener('resize', resize))
}

function fail(readout: HTMLDivElement, status: NextStatus, error: unknown) {
  status.error = error instanceof Error ? error.message : String(error)
  readout.textContent = `The next renderer could not start: ${status.error}`
  console.error(error)
}

export async function start() {
  const status: NextStatus = { backend: null, physics: null, frames: 0, fps: 0, error: null, fellBack: false }
  window.__stNext = status
  const { canvas, readout } = stage()
  try {
    await run(canvas, readout, status, new URLSearchParams(location.search).get('gpu'))
  } catch (error) {
    fail(readout, status, error)
  }
}
