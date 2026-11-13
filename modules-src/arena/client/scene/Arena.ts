import type { Scene } from '@babylonjs/core/scene'
import { MeshBuilder } from '@babylonjs/core/Meshes/meshBuilder'
import type { Mesh } from '@babylonjs/core/Meshes/mesh'
import type { Material } from '@babylonjs/core/Materials/material'
import type { ShadowGenerator } from '@babylonjs/core/Lights/Shadows/shadowGenerator'
import { Vector3, Vector4 } from '@babylonjs/core/Maths/math.vector'
import type { ArenaMaterials } from './Materials'

export const ARENA_HALF_WIDTH = 36
export const ARENA_HALF_LENGTH = 60
export const BASE_DECK = 4
export const BASE_Z = 48

const WALL_HEIGHT = 3.4
const BARRIER_HEIGHT = 18
const GATE_HEIGHT = 10.4
const TILE = 4
const SIDES = [1, -1] as const

export interface ArenaMap {
  meshes: Mesh[]
  pylon: Mesh
  rings: Mesh[]
  spawn(team: 0 | 1): { position: Vector3; yaw: number }
}

interface BoxOptions {
  rotX?: number
  rotY?: number
  rotZ?: number
  shadow?: boolean
}

function faceUVs(width: number, height: number, depth: number): Vector4[] {
  const face = (u: number, v: number) => new Vector4(0, 0, Math.max(u / TILE, 0.03), Math.max(v / TILE, 0.03))
  return [face(width, height), face(width, height), face(depth, height), face(depth, height), face(width, depth), face(width, depth)]
}

class ArenaBuilder {
  readonly meshes: Mesh[] = []
  private count = 0

  constructor(private readonly scene: Scene, private readonly shadows: ShadowGenerator) {}

  private finish(mesh: Mesh, material: Material, shadow: boolean): Mesh {
    mesh.material = material
    mesh.checkCollisions = true
    mesh.metadata = { arenaSolid: true }
    mesh.receiveShadows = true
    if (shadow) this.shadows.addShadowCaster(mesh)
    mesh.freezeWorldMatrix()
    this.meshes.push(mesh)
    return mesh
  }

  box(width: number, height: number, depth: number, x: number, y: number, z: number, material: Material, options: BoxOptions = {}): Mesh {
    const mesh = MeshBuilder.CreateBox(`arena-box-${this.count++}`, { width, height, depth, faceUV: faceUVs(width, height, depth), wrap: true }, this.scene)
    mesh.position.set(x, y, z)
    mesh.rotation.set(options.rotX ?? 0, options.rotY ?? 0, options.rotZ ?? 0)
    return this.finish(mesh, material, options.shadow ?? true)
  }

  barrier(width: number, height: number, depth: number, x: number, y: number, z: number): void {
    const mesh = MeshBuilder.CreateBox(`arena-barrier-${this.count++}`, { width, height, depth }, this.scene)
    mesh.position.set(x, y, z)
    mesh.isVisible = false
    mesh.isPickable = false
    mesh.checkCollisions = true
    mesh.freezeWorldMatrix()
  }

  cylinder(diameter: number, height: number, x: number, y: number, z: number, material: Material, tessellation = 32, shadow = true): Mesh {
    const mesh = MeshBuilder.CreateCylinder(`arena-cyl-${this.count++}`, { diameter, height, tessellation }, this.scene)
    mesh.position.set(x, y, z)
    return this.finish(mesh, material, shadow)
  }

  torus(diameter: number, thickness: number, x: number, y: number, z: number, material: Material): Mesh {
    const mesh = MeshBuilder.CreateTorus(`arena-ring-${this.count++}`, { diameter, thickness, tessellation: 64 }, this.scene)
    mesh.position.set(x, y, z)
    mesh.material = material
    mesh.checkCollisions = true
    mesh.metadata = { arenaSolid: true }
    this.meshes.push(mesh)
    return mesh
  }

  rampZ(width: number, rise: number, run: number, x: number, baseY: number, topZ: number, direction: 1 | -1, material: Material, trim?: Material): void {
    const thickness = 0.5
    const angle = Math.atan2(rise, run)
    const length = Math.hypot(rise, run)
    const centerZ = topZ - (direction * run) / 2
    const lift = thickness / 2 / Math.cos(angle)
    this.box(width, thickness, length, x, baseY + rise / 2 - lift, centerZ, material, { rotX: -direction * angle })
    if (!trim) return
    for (const edge of [-1, 1]) {
      this.box(0.18, 0.04, length, x + (edge * (width / 2 - 0.16)), baseY + rise / 2 + 0.005, centerZ, trim, { rotX: -direction * angle, shadow: false })
    }
  }

  rampX(width: number, rise: number, run: number, z: number, baseY: number, topX: number, direction: 1 | -1, material: Material, trim?: Material): void {
    const thickness = 0.5
    const angle = Math.atan2(rise, run)
    const length = Math.hypot(rise, run)
    const centerX = topX - (direction * run) / 2
    const lift = thickness / 2 / Math.cos(angle)
    this.box(length, thickness, width, centerX, baseY + rise / 2 - lift, z, material, { rotZ: direction * angle })
    if (!trim) return
    for (const edge of [-1, 1]) {
      this.box(length, 0.04, 0.18, centerX, baseY + rise / 2 + 0.005, z + (edge * (width / 2 - 0.16)), trim, { rotZ: direction * angle, shadow: false })
    }
  }
}

const teamPaint = (materials: ArenaMaterials, side: number) => (side > 0 ? materials.markingRed : materials.markingBlue)
const teamLight = (materials: ArenaMaterials, side: number) => (side > 0 ? materials.energyRed : materials.energyBlue)

function buildShell(build: ArenaBuilder, materials: ArenaMaterials): void {
  const width = ARENA_HALF_WIDTH * 2
  const length = ARENA_HALF_LENGTH * 2
  build.box(width + 2, 1, length + 2, 0, -0.5, 0, materials.floor, { shadow: false })

  build.box(width - 6, 0.02, 0.4, 0, 0.011, 0, materials.marking, { shadow: false })
  for (const side of SIDES) {
    build.box(width - 6, 0.02, 0.4, 0, 0.011, side * 30, teamPaint(materials, side), { shadow: false })
    build.box(0.4, 0.02, 14, side * 15, 0.011, 0, materials.marking, { shadow: false })
  }

  for (const side of SIDES) {
    build.box(1, WALL_HEIGHT, length, side * (ARENA_HALF_WIDTH + 0.5), WALL_HEIGHT / 2, 0, materials.hull)
    build.box(1.6, 0.4, length + 1.6, side * (ARENA_HALF_WIDTH + 0.5), WALL_HEIGHT + 0.2, 0, materials.trim)
    build.box(width + 2, WALL_HEIGHT, 1, 0, WALL_HEIGHT / 2, side * (ARENA_HALF_LENGTH + 0.5), materials.hull)
    build.box(width + 3.6, 0.4, 1.6, 0, WALL_HEIGHT + 0.2, side * (ARENA_HALF_LENGTH + 0.5), materials.trim)
    build.barrier(1, BARRIER_HEIGHT, length + 2, side * (ARENA_HALF_WIDTH + 0.5), BARRIER_HEIGHT / 2, 0)
    build.barrier(width + 2, BARRIER_HEIGHT, 1, 0, BARRIER_HEIGHT / 2, side * (ARENA_HALF_LENGTH + 0.5))

    for (let x = -24; x <= 24; x += 12) {
      build.box(2.4, 0.16, 0.1, x, 2.7, side * (ARENA_HALF_LENGTH - 0.03), teamLight(materials, side), { shadow: false })
    }
    for (let z = -ARENA_HALF_LENGTH + 12; z <= ARENA_HALF_LENGTH - 12; z += 12) {
      build.box(1.4, WALL_HEIGHT + 1.4, 1.8, side * (ARENA_HALF_WIDTH - 0.3), (WALL_HEIGHT + 1.4) / 2, z, materials.panel)
      build.box(1.1, 4.2, 0.9, side * (ARENA_HALF_WIDTH - 1.25), 1.8, z, materials.trim, { rotZ: -side * 0.42 })
      build.box(0.08, 0.5, 0.36, side * (ARENA_HALF_WIDTH - 1.02), WALL_HEIGHT + 0.5, z, materials.energyWhite, { shadow: false })
    }
  }

  for (const sx of SIDES) {
    for (const sz of SIDES) {
      build.box(8, WALL_HEIGHT + 1.4, 1.2, sx * (ARENA_HALF_WIDTH - 2.6), (WALL_HEIGHT + 1.4) / 2, sz * (ARENA_HALF_LENGTH - 2.6), materials.panel, { rotY: sx * sz * Math.PI / 4 })
    }
  }

  for (const side of SIDES) {
    const z = side * 30
    for (const sx of SIDES) {
      build.box(1.4, GATE_HEIGHT, 1.8, sx * (ARENA_HALF_WIDTH - 1.2), GATE_HEIGHT / 2, z, materials.panel)
      build.box(1.2, 3, 1.2, sx * (ARENA_HALF_WIDTH - 2.4), GATE_HEIGHT - 0.9, z, materials.trim, { rotZ: sx * 0.8 })
    }
    build.box(width - 1, 1, 1.6, 0, GATE_HEIGHT - 0.4, z, materials.hull)
    build.box(width - 6, 0.08, 0.3, 0, GATE_HEIGHT - 0.94, z, teamLight(materials, side), { shadow: false })
  }
}

function buildBase(build: ArenaBuilder, materials: ArenaMaterials, side: 1 | -1): void {
  const front = side * (BASE_Z - 7)
  build.box(24, BASE_DECK, 14, 0, BASE_DECK / 2, side * BASE_Z, materials.hull)
  build.box(24.4, 0.3, 0.5, 0, BASE_DECK - 0.1, front, materials.trim)
  build.box(24.2, 0.08, 0.1, 0, BASE_DECK - 0.15, front - side * 0.26, teamLight(materials, side), { shadow: false })
  build.box(24.2, 0.6, 0.06, 0, 1, front - side * 0.01, teamPaint(materials, side), { shadow: false })

  for (const sx of SIDES) {
    build.rampZ(5, BASE_DECK, 10, sx * 8, 0, front, side, materials.panel, teamPaint(materials, side))
    build.box(4, 1.2, 0.8, sx * 3.2, BASE_DECK + 0.6, front - side * 1.2, materials.cover)
  }

  build.box(14, 3.4, 1, 0, BASE_DECK + 1.7, side * (BASE_Z + 3.5), materials.panel)
  build.box(1, 3, 4, 0, BASE_DECK + 1.5, side * (BASE_Z + 1), materials.panel)
  for (const sx of SIDES) build.box(0.8, 3.4, 0.8, sx * 6.5, BASE_DECK + 1.7, side * (BASE_Z - 1.2), materials.trim)
  build.box(15, 0.4, 6.4, 0, BASE_DECK + 3.6, side * (BASE_Z + 1.2), materials.hull)
  build.box(15.2, 0.9, 0.4, 0, BASE_DECK + 3.5, side * (BASE_Z - 2.1), materials.trim, { rotX: side * 0.5 })
  build.box(13.6, 0.08, 0.1, 0, BASE_DECK + 3.37, side * (BASE_Z - 1.9), teamLight(materials, side), { shadow: false })

  for (const sx of SIDES) {
    build.box(16.5, 0.6, 5, sx * 20.25, BASE_DECK - 0.3, side * BASE_Z, materials.hull)
    build.box(16.5, 0.03, 0.25, sx * 20.25, BASE_DECK + 0.01, side * (BASE_Z - 2.3), teamPaint(materials, side), { shadow: false })
    build.box(16.5, 1, 0.3, sx * 20.25, BASE_DECK + 0.5, side * (BASE_Z + 2.35), materials.trim)
    build.box(1.2, BASE_DECK - 0.6, 1.2, sx * 20.25, (BASE_DECK - 0.6) / 2, side * BASE_Z, materials.panel)
  }
}

function buildCatwalks(build: ArenaBuilder, materials: ArenaMaterials): void {
  for (const sx of SIDES) {
    const x = sx * 30.5
    for (const side of SIDES) {
      const from = side * 14
      const to = side * (BASE_Z + 2.5)
      const length = Math.abs(to - from)
      const centerZ = (from + to) / 2
      build.box(5, 0.6, length, x, BASE_DECK - 0.3, centerZ, materials.hull)
      build.box(0.25, 0.03, length, x - sx * 2.3, BASE_DECK + 0.01, centerZ, teamPaint(materials, side), { shadow: false })
      build.box(0.3, 1, length - 6, x - sx * 2.35, BASE_DECK + 0.5, centerZ - side * 3, materials.trim)
      for (let z = Math.min(from, to) + 4; z < Math.max(from, to) - 2; z += 9) {
        build.box(1, BASE_DECK - 0.6, 1, x, (BASE_DECK - 0.6) / 2, z, materials.panel)
      }
      build.rampZ(5, BASE_DECK, 10, x, 0, from, side, materials.panel, teamPaint(materials, side))
    }
  }
}

function buildCenter(build: ArenaBuilder, materials: ArenaMaterials): { pylon: Mesh; rings: Mesh[] } {
  const deck = 2
  build.box(12, deck, 12, 0, deck / 2, 0, materials.hull)
  build.box(12.4, 0.2, 12.4, 0, deck - 0.05, 0, materials.trim, { shadow: false })
  for (const side of SIDES) {
    build.rampZ(4.5, deck, 6, 0, 0, side * 6, side, materials.panel, materials.marking)
    build.rampX(4.5, deck, 6, 0, 0, side * 6, side, materials.panel, materials.marking)
  }
  for (const sx of SIDES) {
    for (const sz of SIDES) {
      build.box(2.2, 1.3, 2.2, sx * 4.4, deck + 0.65, sz * 4.4, materials.cover)
    }
  }
  build.cylinder(2.8, 0.6, 0, deck + 0.3, 0, materials.trim)
  const pylon = build.cylinder(0.7, 6, 0, deck + 3.6, 0, materials.energyWhite, 24, false)
  const rings = [0, 1, 2].map(index => build.torus(2.4 - index * 0.4, 0.1, 0, deck + 2 + index * 1.8, 0, materials.trim))
  return { pylon, rings }
}

function buildCover(build: ArenaBuilder, materials: ArenaMaterials): void {
  for (const sx of SIDES) {
    build.box(7, 1.4, 1.2, sx * 19, 0.7, 0, materials.cover)
    for (const sz of SIDES) {
      build.box(3, 2, 3, sx * 10, 1, sz * 18, materials.cover)
      build.box(3.05, 0.03, 0.4, sx * 10, 2.01, sz * 18, teamPaint(materials, sz), { shadow: false })
      build.box(2, 6, 2, sx * 20, 3, sz * 24, materials.panel)
      build.box(2.1, 0.12, 2.1, sx * 20, 5.2, sz * 24, teamLight(materials, sz), { shadow: false })
      build.box(2.2, 2.2, 2.2, sx * 22, 1.1, sz * 8, materials.cover)
      build.box(2.2, 2.2, 2.2, sx * 22, 3.3, sz * 8, materials.cover, { rotY: Math.PI / 7 })
      build.box(2.2, 2.2, 2.2, sx * 24.4, 1.1, sz * 8, materials.cover)
      build.box(4, 1.2, 1, sx * 4, 0.6, sz * 28, materials.cover)
      build.box(1.2, 3.5, 6, sx * 14, 1.75, sz * 36, materials.panel)
      build.box(1.3, 0.6, 6.2, sx * 14, 3.2, sz * 36, materials.trim, { rotZ: sx * 0.35 })
      build.box(0.16, 3.1, 0.16, sx * 14, 1.6, sz * 33, teamLight(materials, sz), { shadow: false })
      build.box(0.16, 3.1, 0.16, sx * 14, 1.6, sz * 39, teamLight(materials, sz), { shadow: false })
    }
  }
}

export function buildArena(scene: Scene, materials: ArenaMaterials, shadows: ShadowGenerator): ArenaMap {
  const build = new ArenaBuilder(scene, shadows)
  buildShell(build, materials)
  for (const side of SIDES) buildBase(build, materials, side)
  buildCatwalks(build, materials)
  const { pylon, rings } = buildCenter(build, materials)
  buildCover(build, materials)
  return {
    meshes: build.meshes,
    pylon,
    rings,
    spawn(team) {
      const side = team === 0 ? -1 : 1
      return { position: new Vector3(0, BASE_DECK + 0.05, side * (BASE_Z - 3)), yaw: side > 0 ? Math.PI : 0 }
    },
  }
}
