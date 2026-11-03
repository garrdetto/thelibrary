/** Builds and tears down the meshes for one hole: samples the course systems into typed specs and hands them to the model factories. */
import * as THREE from 'three/webgpu'
import { disposeObject, type QualityTier } from '../../../engine'
import type { ModuleConfig } from '../config'
import { createFlag, type FlagModel } from '../models/Flag'
import { createTeeMarkers } from '../models/TeeMarkers'
import { createTerrain } from '../models/Terrain'
import { createTrees } from '../models/Trees'
import { createWater } from '../models/Water'
import type { Course } from '../systems/Course'
import { createRandom } from '../systems/Random'
import { yawTowards, type Vec3 } from '../systems/Vector'

export interface HoleScene {
  root: THREE.Group
  flag: FlagModel
  dispose(): void
}

const ZONE_A: Readonly<Record<string, number>> = { fairway: 0, green: 1, bunker: 2, water: 3 }
const ZONE_B: Readonly<Record<string, number>> = { tee: 0, path: 1 }

function terrainMesh(course: Course, config: ModuleConfig, tier: QualityTier): THREE.Mesh {
  const look = config.terrain3d
  const cellSize = look.cellSize[tier]
  const [minX, minZ, maxX, maxZ] = course.hole.bounds
  const originX = minX - look.margin
  const originZ = minZ - look.margin
  const columns = Math.ceil((maxX - minX + look.margin * 2) / cellSize) + 1
  const rows = Math.ceil((maxZ - minZ + look.margin * 2) / cellSize) + 1
  const heights = new Float32Array(columns * rows)
  const zonesA = new Float32Array(columns * rows * 4)
  const zonesB = new Float32Array(columns * rows * 2)
  const weight = 1 / look.zoneSamples.length
  for (let row = 0; row < rows; row++) {
    const z = originZ + row * cellSize
    for (let column = 0; column < columns; column++) {
      const x = originX + column * cellSize
      const index = row * columns + column
      heights[index] = course.heightAt(x, z)
      for (const [dx, dz] of look.zoneSamples) {
        const surface = course.surfaceAt(x + dx * cellSize, z + dz * cellSize)
        if (surface in ZONE_A) zonesA[index * 4 + ZONE_A[surface]] += weight
        else if (surface in ZONE_B) zonesB[index * 2 + ZONE_B[surface]] += weight
      }
    }
  }
  const route = course.hole.route
  return createTerrain({
    columns,
    rows,
    cellSize,
    originX,
    originZ,
    heights,
    zonesA,
    zonesB,
    palette: look.palette,
    stripeWidth: look.stripeWidth,
    greenStripeWidth: look.greenStripeWidth,
    stripeEdges: look.stripeEdges,
    stripeYaw: yawTowards(route[0], route[route.length - 1]),
    noiseScales: look.noiseScales,
    noiseWeights: look.noiseWeights,
    noiseStrength: look.noiseStrength,
    roughness: look.roughness,
  })
}

function waterMeshes(course: Course, config: ModuleConfig): THREE.Mesh[] {
  const look = config.water
  return course.regions.water.map((pond) => {
    const points = pond.points
    let shore = Infinity
    for (let sample = 0; sample < look.shoreSamples; sample++) {
      const [x, z] = points[Math.floor((sample / look.shoreSamples) * points.length)]
      shore = Math.min(shore, course.heightAt(x, z))
    }
    return createWater({
      centerX: (pond.minX + pond.maxX) / 2,
      centerZ: (pond.minZ + pond.maxZ) / 2,
      width: pond.maxX - pond.minX + look.margin * 2,
      depth: pond.maxZ - pond.minZ + look.margin * 2,
      level: shore - look.levelBelowShore,
      cellSize: look.cellSize,
      shallow: look.shallow,
      deep: look.deep,
      opacity: look.opacity,
      roughness: look.roughness,
      fresnelPower: look.fresnelPower,
      waves: look.waves,
    })
  })
}

function treeGroup(course: Course, config: ModuleConfig): THREE.Group {
  const random = createRandom(course.hole.number)
  return createTrees({
    ...config.treeLook,
    species: config.treeLook.species,
    instances: course.trees.map((tree) => ({ x: tree.x, y: course.heightAt(tree.x, tree.z), z: tree.z, scale: tree.scale, variant: tree.variant, yaw: random() * Math.PI * 2 })),
  })
}

/** Everything static on a hole. The tee markers sit at the mode's teeing spot, square to the line toward the target. */
export function createHoleScene(course: Course, tee: Vec3, target: Vec3, config: ModuleConfig, tier: QualityTier): HoleScene {
  const root = new THREE.Group()
  root.name = `hole-${course.hole.number}`
  root.add(terrainMesh(course, config, tier))
  for (const water of waterMeshes(course, config)) root.add(water)
  root.add(treeGroup(course, config))

  const flag = createFlag({ ...config.flag, cupRadius: config.cup.radius })
  const pin = course.pinPosition()
  flag.root.position.set(pin[0], course.heightAt(pin[0], pin[2]), pin[2])
  root.add(flag.root)

  const markers = createTeeMarkers(config.teeMarkers)
  const yaw = yawTowards(tee, target)
  markers.rotation.y = yaw
  const ahead = config.teeMarkers.ahead
  const markerX = tee[0] + Math.sin(yaw) * ahead
  const markerZ = tee[2] + Math.cos(yaw) * ahead
  markers.position.set(markerX, course.heightAt(markerX, markerZ), markerZ)
  root.add(markers)

  return {
    root,
    flag,
    dispose() {
      root.removeFromParent()
      disposeObject(root)
    },
  }
}
