/**
 * Sun and moon shadows in two layers, so the woods are not redrawn into the shadow map every frame.
 *
 * `cache` holds the casters that never move (trees, rocks, logs) and is drawn only when that list, the light or the
 * shadow frame changes. The map the scene samples, `shadows`, starts each of its own renders as a copy of the cache,
 * colour and depth, so a mover behind a trunk stays behind it, and then draws only the movers: the hunter, animals,
 * vehicles, other players. It is redrawn only when one of them has drifted past a small slack since it was last drawn
 * (`ShadowPolicy.ts`), so a hunter standing on the dock or sitting in a stand costs no shadow rendering at all.
 *
 * Both layers hang off the same light and share its matrices. The cache is keyed to a camera that is never active, so
 * materials only ever see `shadows`; it is created first so it renders first in a frame where both are due.
 */
import { Camera } from '@babylonjs/core/Cameras/camera'
import { Constants } from '@babylonjs/core/Engines/constants'
import type { Skeleton } from '@babylonjs/core/Bones/skeleton'
import type { DirectionalLight } from '@babylonjs/core/Lights/directionalLight'
import { ShadowGenerator } from '@babylonjs/core/Lights/Shadows/shadowGenerator'
import { EffectRenderer, EffectWrapper } from '@babylonjs/core/Materials/effectRenderer'
import { ShaderLanguage } from '@babylonjs/core/Materials/shaderLanguage'
import { RenderTargetTexture } from '@babylonjs/core/Materials/Textures/renderTargetTexture'
import { Vector3 } from '@babylonjs/core/Maths/math.vector'
import type { AbstractMesh } from '@babylonjs/core/Meshes/abstractMesh'
import type { Scene } from '@babylonjs/core/scene'
import { drifted, slackAt } from './ShadowPolicy'

export interface ShadowLayers {
  /** The generator materials sample. */
  readonly shadows: ShadowGenerator
  /** Casters that never move. Pass a new array when the set changes. */
  setFixed(list: AbstractMesh[]): void
  /** Casters that may move; compared with the last list, so the same scratch array can be passed every frame. */
  setMoving(list: AbstractMesh[]): void
  /** Movers that also receive their own shadow (vehicles): redrawn at the near slack at any distance, so their self-shadow never lags and jumps. */
  markTight(mesh: AbstractMesh): void
  /** Turns shadow casting and receiving on or off for the whole scene. */
  setEnabled(on: boolean): void
  readonly enabled: boolean
  /** How many times each layer has been drawn. */
  readonly drawn: { fixed: number; moving: number }
}

const PRIME_GLSL = /* glsl */ `
precision highp float;
varying vec2 vUV;
uniform sampler2D cacheSampler;
void main(void) {
  vec4 stored = texelFetch(cacheSampler, ivec2(gl_FragCoord.xy), 0);
#ifdef PACKED
  float depth = dot(stored, vec4(1.0 / (255.0 * 255.0 * 255.0), 1.0 / (255.0 * 255.0), 1.0 / 255.0, 1.0));
#else
  float depth = stored.r;
#endif
  gl_FragColor = stored;
  gl_FragDepth = clamp(depth, 0.0, 1.0);
}`

const PRIME_WGSL = /* wgsl */ `
varying vUV: vec2f;
var cacheSampler: texture_2d<f32>;
@fragment
fn main(input: FragmentInputs) -> FragmentOutputs {
  let stored = textureLoad(cacheSampler, vec2u(fragmentInputs.position.xy), 0);
#ifdef PACKED
  let depth = dot(stored, vec4f(1.0 / (255.0 * 255.0 * 255.0), 1.0 / (255.0 * 255.0), 1.0 / 255.0, 1.0));
#else
  let depth = stored.r;
#endif
  fragmentOutputs.color = stored;
  fragmentOutputs.fragDepth = clamp(depth, 0.0, 1.0);
}`

const SNAP = 17

export function createShadowLayers(scene: Scene, sun: DirectionalLight, size: number): ShadowLayers {
  const engine = scene.getEngine()
  const key = new Camera('shadow-cache-key', Vector3.Zero(), scene, false)
  const tune = (generator: ShadowGenerator) => {
    generator.depthScale = 60
    generator.bias = 0.0006
    generator.normalBias = 0.012
    generator.forceBackFacesOnly = false
  }
  const cache = new ShadowGenerator(size, sun, true, key)
  cache.useCloseExponentialShadowMap = true
  tune(cache)
  const shadows = new ShadowGenerator(size, sun, true)
  shadows.useBlurCloseExponentialShadowMap = true
  shadows.blurKernel = Math.max(2, Math.round((8 * size) / 2048))
  shadows.blurScale = 2
  tune(shadows)
  shadows.setDarkness(0.62)
  shadows.frustumEdgeFalloff = 0.25
  const cacheMap = cache.getShadowMap()!
  const map = shadows.getShadowMap()!
  cacheMap.refreshRate = RenderTargetTexture.REFRESHRATE_RENDER_ONCE
  map.refreshRate = RenderTargetTexture.REFRESHRATE_RENDER_ONCE
  cacheMap.renderList = []
  map.renderList = []

  const wgsl = engine.isWebGPU
  const renderer = new EffectRenderer(engine)
  const prime = new EffectWrapper({
    engine,
    name: 'rr-shadow-prime',
    fragmentShader: wgsl ? PRIME_WGSL : PRIME_GLSL,
    samplerNames: ['cacheSampler'],
    defines: cacheMap.textureType === Constants.TEXTURETYPE_UNSIGNED_BYTE ? ['#define PACKED'] : [],
    shaderLanguage: wgsl ? ShaderLanguage.WGSL : ShaderLanguage.GLSL,
  })
  prime.onApplyObservable.add(() => prime.effect.setTexture('cacheSampler', cacheMap))

  const drawn = { fixed: 0, moving: 0 }
  let enabled = true
  let fixedStale = true
  let movingStale = true
  let cacheDrawn = false
  let primed = false
  let snapshot = new Float32Array(0)
  let poses = new Map<Skeleton, Float32Array>()
  let spare = new Map<Skeleton, Float32Array>()
  const lightAt = new Vector3(Number.NaN, 0, 0)
  const lightAim = new Vector3()
  const tight = new WeakSet<AbstractMesh>()

  cacheMap.onAfterRenderObservable.add(() => {
    cacheDrawn = true
    drawn.fixed++
    map.resetRefreshCounter()
  })
  map.onClearObservable.add(() => {
    primed = cacheDrawn && prime.effect.isReady()
    if (!primed) return
    renderer.setViewport()
    renderer.applyEffectWrapper(prime, true)
    const depth = engine.depthCullingState
    const compare = depth.depthFunc
    depth.depthFunc = Constants.ALWAYS
    depth.depthMask = true
    renderer.draw()
    depth.depthFunc = compare
  })
  map.onAfterRenderObservable.add(() => {
    drawn.moving++
  })

  const shown = (mesh: AbstractMesh) => (mesh.isEnabled() && mesh.isVisible ? 1 : 0)

  const moved = (list: AbstractMesh[]): boolean => {
    if (snapshot.length !== list.length * SNAP) return true
    const eye = scene.activeCamera?.globalPosition
    for (let i = 0; i < list.length; i++) {
      const mesh = list[i]
      const at = i * SNAP
      const visible = shown(mesh)
      if (snapshot[at] !== visible) return true
      if (!visible) continue
      const world = mesh.computeWorldMatrix().m
      const slack = tight.has(mesh) ? 1 : eye ? slackAt(Math.hypot(world[12] - eye.x, world[13] - eye.y, world[14] - eye.z)) : 1
      if (drifted(snapshot, world, at + 1, slack)) return true
      const skeleton = mesh.skeleton
      if (!skeleton) continue
      const pose = poses.get(skeleton)
      const now = skeleton.getTransformMatrices(mesh)
      if (!pose || pose.length !== now.length || drifted(pose, now, 0, slack)) return true
    }
    return false
  }

  const remember = (list: AbstractMesh[]): void => {
    if (snapshot.length !== list.length * SNAP) snapshot = new Float32Array(list.length * SNAP)
    const next = spare
    next.clear()
    for (let i = 0; i < list.length; i++) {
      const mesh = list[i]
      const at = i * SNAP
      snapshot[at] = shown(mesh)
      snapshot.set(mesh.computeWorldMatrix().m, at + 1)
      const skeleton = mesh.skeleton
      if (!skeleton || next.has(skeleton)) continue
      const now = skeleton.getTransformMatrices(mesh)
      let pose = poses.get(skeleton)
      if (!pose || pose.length !== now.length) pose = new Float32Array(now.length)
      pose.set(now)
      next.set(skeleton, pose)
    }
    spare = poses
    poses = next
  }

  scene.onBeforeRenderTargetsRenderObservable.add(() => {
    if (!enabled) return
    if (fixedStale || !lightAt.equals(sun.position) || !lightAim.equals(sun.direction)) {
      fixedStale = false
      lightAt.copyFrom(sun.position)
      lightAim.copyFrom(sun.direction)
      cacheMap.resetRefreshCounter()
      movingStale = true
    }
    const list = map.renderList ?? []
    if (movingStale || !primed || moved(list)) {
      movingStale = false
      remember(list)
      map.resetRefreshCounter()
    }
  })
  engine.onContextRestoredObservable.add(() => {
    cacheDrawn = false
    fixedStale = true
  })

  return {
    shadows,
    drawn,
    get enabled() {
      return enabled
    },
    setFixed(list) {
      cacheMap.renderList = list
      fixedStale = true
    },
    setMoving(list) {
      const current = map.renderList ?? []
      let same = current.length === list.length
      for (let i = 0; same && i < list.length; i++) same = current[i] === list[i]
      if (same) return
      map.renderList = list.slice()
      movingStale = true
    },
    markTight(mesh) {
      tight.add(mesh)
    },
    setEnabled(on) {
      if (on === enabled) return
      enabled = on
      scene.shadowsEnabled = on
      if (on) {
        cacheDrawn = false
        fixedStale = true
      }
    },
  }
}
