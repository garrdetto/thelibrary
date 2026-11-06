/** Broadcast lighting: applies a day, golden-hour or night preset to the engine's sun and sky light, rebuilds the sky dome and its prefiltered environment, adds cascaded shadows on high tiers, aims the stadium light banks and eases exposure between looks. */
import * as THREE from 'three/webgpu'
import { CSMShadowNode } from 'three/addons/csm/CSMShadowNode.js'
import { bakeEnvironment, type App, type BakedEnvironment, type LightingRig } from '../../../engine'
import type { LightPreset, TierBudget } from '../looks'
import { createSky } from './Sky'

/** Total luminous intensity of all light banks together (candela), split across however many the tier allows. */
const BANK_OUTPUT = 13000

export interface StadiumLights {
  setPreset(preset: LightPreset): void
  update(dt: number): void
  dispose(): void
}

function stars(): THREE.Points {
  const positions: number[] = []
  let seed = 7
  const next = () => ((seed = (seed * 16807) % 2147483647) / 2147483647)
  for (let index = 0; index < 1400; index++) {
    const theta = next() * Math.PI * 2
    const y = 0.12 + next() * 0.88
    const r = Math.sqrt(1 - y * y)
    positions.push(Math.cos(theta) * r * 650, y * 650, Math.sin(theta) * r * 650)
  }
  const geometry = new THREE.BufferGeometry()
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3))
  const points = new THREE.Points(geometry, new THREE.PointsMaterial({ color: '#dfe8ff', size: 1.6, sizeAttenuation: false, fog: false, transparent: true, opacity: 0.85 }))
  points.name = 'stars'
  return points
}

export function createStadiumLights(app: App, rig: LightingRig, budget: TierBudget, towers: THREE.Vector3[], lampMaterial: THREE.MeshStandardMaterial | null): StadiumLights {
  const root = new THREE.Group()
  root.name = 'stadium-lights'
  app.graph.add('world', root)
  let sky: THREE.Mesh | null = null
  let environment: BakedEnvironment | null = null
  const starField = stars()
  root.add(starField)
  let exposureTarget = app.renderer.toneMappingExposure

  let csm: CSMShadowNode | null = null
  if (budget.cascades > 0 && rig.sun.castShadow) {
    try {
      csm = new CSMShadowNode(rig.sun, { cascades: budget.cascades, maxFar: 260, mode: 'practical', lightMargin: 80 })
      rig.sun.shadow.shadowNode = csm
    } catch (error) {
      console.warn('[bushleague] cascaded shadows unavailable', error)
      csm = null
    }
  }

  const banks: THREE.SpotLight[] = []
  const chosen = towers.slice(0, budget.bankLights)
  for (const [index, tower] of chosen.entries()) {
    const light = new THREE.SpotLight('#fff4e0', 0, 0, 0.85, 0.7, 1.4)
    light.position.copy(tower)
    const aim = new THREE.Vector3(tower.x * 0.15, 0, -45 + (index % 3) * 12)
    light.target.position.copy(aim)
    light.castShadow = budget.bankShadows && index < 2
    if (light.castShadow) light.shadow.mapSize.set(1024, 1024)
    root.add(light, light.target)
    banks.push(light)
  }

  let lastFov = 0
  return {
    setPreset(preset) {
      rig.sun.color.set(preset.sunColor)
      rig.sun.intensity = preset.sunIntensity
      const offset = new THREE.Vector3(...preset.sunDirection).normalize().multiplyScalar(160)
      rig.sun.position.copy(rig.sun.target.position).add(offset)
      rig.hemisphere.color.set(preset.hemiSky)
      rig.hemisphere.groundColor.set(preset.hemiGround)
      rig.hemisphere.intensity = preset.hemiIntensity
      if (app.scene.fog) (app.scene.fog as THREE.Fog).color.set(preset.fog)
      app.scene.background = new THREE.Color(preset.sky.horizon)
      exposureTarget = preset.exposure
      for (const light of banks) light.intensity = (BANK_OUTPUT / Math.max(1, banks.length)) * preset.banks
      if (lampMaterial) lampMaterial.emissiveIntensity = preset.lampGlow
      starField.visible = preset.banks >= 1
      if (sky) {
        sky.removeFromParent()
        sky.geometry.dispose()
        ;(sky.material as THREE.Material).dispose()
      }
      sky = createSky(preset.sky.top, preset.sky.horizon, preset.sky.ground)
      root.add(sky)
      const source = new THREE.Scene()
      const copy = createSky(preset.sky.top, preset.sky.horizon, preset.sky.ground)
      copy.scale.setScalar(0.4)
      const glow = new THREE.HemisphereLight(preset.hemiSky, preset.hemiGround, 1)
      source.add(copy, glow)
      environment?.dispose()
      environment = bakeEnvironment(app.renderer, app.scene, source, preset.environment)
      copy.geometry.dispose()
      ;(copy.material as THREE.Material).dispose()
    },
    update(dt) {
      const exposure = app.renderer.toneMappingExposure
      app.renderer.toneMappingExposure = exposure + (exposureTarget - exposure) * Math.min(1, dt * 1.5)
      if (csm && (csm as unknown as { camera: THREE.Camera | null }).camera && Math.abs(app.camera.fov - lastFov) > 0.5) {
        lastFov = app.camera.fov
        csm.updateFrustums()
      }
    },
    dispose() {
      environment?.dispose()
      csm?.dispose()
      if (csm && rig.sun.shadow.shadowNode === csm) rig.sun.shadow.shadowNode = undefined
      for (const light of banks) light.dispose()
      root.removeFromParent()
      starField.geometry.dispose()
      ;(starField.material as THREE.Material).dispose()
      if (sky) {
        sky.geometry.dispose()
        ;(sky.material as THREE.Material).dispose()
      }
    },
  }
}
