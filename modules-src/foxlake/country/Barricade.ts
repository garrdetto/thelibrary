/**
 * Where the interstate runs into the hills south-east of the lake: a row of
 * striped barricades across both carriageways with ROAD CLOSED boards, and
 * orange drums on the shoulders (scene space). The solid behind them is the
 * last of `barrierSegments`.
 */
import { DynamicTexture } from '@babylonjs/core/Materials/Textures/dynamicTexture'
import { StandardMaterial } from '@babylonjs/core/Materials/standardMaterial'
import { Color3 } from '@babylonjs/core/Maths/math.color'
import { CreateBox } from '@babylonjs/core/Meshes/Builders/boxBuilder'
import { CreateCylinder } from '@babylonjs/core/Meshes/Builders/cylinderBuilder'
import { CreatePlane } from '@babylonjs/core/Meshes/Builders/planeBuilder'
import { Mesh } from '@babylonjs/core/Meshes/mesh'
import { TransformNode } from '@babylonjs/core/Meshes/transformNode'
import type { Scene } from '@babylonjs/core/scene'
import { HIGHWAY, highwayGrade, type Terrain, type TerrainShape } from '../../rackreel/world/Terrain'
import { HIGHWAY_END_T, highwayAt } from './Roads'

function stripes(scene: Scene): StandardMaterial {
  const tex = new DynamicTexture('barricade-stripes', { width: 256, height: 64 }, scene, true)
  const g = tex.getContext() as CanvasRenderingContext2D
  g.fillStyle = '#f4f1e8'
  g.fillRect(0, 0, 256, 64)
  g.fillStyle = '#f26a1b'
  for (let x = -64; x < 320; x += 48) {
    g.beginPath()
    g.moveTo(x, 64)
    g.lineTo(x + 24, 64)
    g.lineTo(x + 48, 0)
    g.lineTo(x + 24, 0)
    g.closePath()
    g.fill()
  }
  tex.update(true)
  const m = new StandardMaterial('barricade-stripes', scene)
  m.diffuseTexture = tex
  m.emissiveColor = new Color3(0.12, 0.1, 0.08)
  m.specularColor = new Color3(0.1, 0.1, 0.1)
  return m
}

function board(scene: Scene): StandardMaterial {
  const tex = new DynamicTexture('road-closed', { width: 512, height: 160 }, scene, true)
  const g = tex.getContext() as CanvasRenderingContext2D
  g.fillStyle = '#f4f1e8'
  g.fillRect(0, 0, 512, 160)
  g.strokeStyle = '#111'
  g.lineWidth = 8
  g.strokeRect(8, 8, 496, 144)
  g.fillStyle = '#111'
  g.font = '900 78px "Arial Black","Impact",sans-serif'
  g.textAlign = 'center'
  g.textBaseline = 'middle'
  g.fillText('ROAD CLOSED', 256, 84)
  tex.update(true)
  const m = new StandardMaterial('road-closed', scene)
  m.diffuseTexture = tex
  m.emissiveColor = new Color3(0.15, 0.15, 0.14)
  m.specularColor = new Color3(0.05, 0.05, 0.05)
  return m
}

export function buildBarricade(scene: Scene, shape: TerrainShape, terrain: Terrain): TransformNode {
  const root = new TransformNode('interstate-barricade', scene)
  const c = highwayAt(HIGHWAY_END_T, 0)
  const y = Math.max(highwayGrade(HIGHWAY_END_T, shape), terrain.heightAt(c.x, c.z)) + 0.05
  root.position.set(c.x, y, c.z)
  root.rotation.y = Math.atan2(HIGHWAY.dx, HIGHWAY.dz)
  const stripe = stripes(scene)
  const sign = board(scene)
  const leg = new StandardMaterial('barricade-leg', scene)
  leg.diffuseColor = new Color3(0.82, 0.8, 0.76)
  leg.specularColor = new Color3(0.05, 0.05, 0.05)
  const drum = new StandardMaterial('barricade-drum', scene)
  drum.diffuseColor = new Color3(0.95, 0.42, 0.1)
  drum.emissiveColor = new Color3(0.12, 0.05, 0.01)
  const parts: Mesh[] = []
  const hw = HIGHWAY.halfWidth
  for (const a of [-hw + 3.2, -3.2, 3.2, hw - 3.2]) {
    for (const [h, w] of [[0.55, 4.2], [0.95, 4.2], [1.35, 4.2]] as const) {
      const b = CreateBox('barricade-board', { width: w, height: 0.22, depth: 0.04 }, scene)
      b.position.set(a, h, 0)
      b.material = stripe
      b.parent = root
      parts.push(b)
    }
    for (const dx of [-1.8, 1.8]) {
      const l = CreateBox('barricade-leg', { width: 0.07, height: 1.55, depth: 0.5 }, scene)
      l.position.set(a + dx, 0.77, 0)
      l.material = leg
      l.parent = root
      parts.push(l)
    }
    for (const side of [1, -1]) {
      const p = CreatePlane('road-closed', { width: 1.9, height: 0.6 }, scene)
      p.position.set(a, 1.85, -side * 0.03)
      p.rotation.y = side > 0 ? 0 : Math.PI
      p.material = sign
      p.parent = root
      parts.push(p)
    }
  }
  for (const a of [-hw - 0.2, -0.9, 0.9, hw + 0.2]) {
    for (const dz of [-3, 2.5]) {
      const d = CreateCylinder('barricade-drum', { diameter: 0.6, height: 0.95, tessellation: 14 }, scene)
      d.position.set(a, 0.48, dz)
      d.material = drum
      d.parent = root
      parts.push(d)
    }
  }
  for (const m of parts) {
    m.isPickable = false
    m.receiveShadows = true
  }
  root.computeWorldMatrix(true)
  for (const m of parts) {
    m.computeWorldMatrix(true)
    m.freezeWorldMatrix()
  }
  return root
}
