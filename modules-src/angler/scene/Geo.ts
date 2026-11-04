/** A tiny vertex-coloured mesh builder for procedural props: boxes, cylinders, cones, blobs and quads, each with its own transform and colour, merged into one PlayCanvas mesh. */
import * as pc from 'playcanvas'

export type Rgb = [number, number, number]

export interface Transform {
  pos?: [number, number, number]
  /** Euler degrees: pitch (X), yaw (Y), roll (Z), applied yaw, pitch, roll. */
  rot?: [number, number, number]
  scale?: [number, number, number]
}

export class GeoBuilder {
  positions: number[] = []
  normals: number[] = []
  colors: number[] = []
  uvs: number[] = []
  indices: number[] = []

  private transform(t: Transform | undefined): (p: [number, number, number], n: [number, number, number]) => [[number, number, number], [number, number, number]] {
    const pos = t?.pos ?? [0, 0, 0]
    const s = t?.scale ?? [1, 1, 1]
    const r = t?.rot ?? [0, 0, 0]
    const d = Math.PI / 180
    const cy = Math.cos(r[1] * d), sy = Math.sin(r[1] * d)
    const cx = Math.cos(r[0] * d), sx = Math.sin(r[0] * d)
    const cz = Math.cos(r[2] * d), sz = Math.sin(r[2] * d)
    const rotate = (v: [number, number, number]): [number, number, number] => {
      let [x, y, z] = v
      const x1 = x * cz - y * sz, y1 = x * sz + y * cz
      x = x1; y = y1
      const y2 = y * cx - z * sx, z2 = y * sx + z * cx
      y = y2; z = z2
      const x3 = x * cy + z * sy, z3 = -x * sy + z * cy
      return [x3, y, z3]
    }
    return (p, n) => {
      const sp = rotate([p[0] * s[0], p[1] * s[1], p[2] * s[2]])
      const sn = rotate([n[0] / s[0], n[1] / s[1], n[2] / s[2]])
      const l = Math.hypot(sn[0], sn[1], sn[2]) || 1
      return [[sp[0] + pos[0], sp[1] + pos[1], sp[2] + pos[2]], [sn[0] / l, sn[1] / l, sn[2] / l]]
    }
  }

  private push(p: [number, number, number], n: [number, number, number], c: Rgb, uv: [number, number] = [0, 0]): number {
    const i = this.positions.length / 3
    this.positions.push(p[0], p[1], p[2])
    this.normals.push(n[0], n[1], n[2])
    this.colors.push(c[0], c[1], c[2])
    this.uvs.push(uv[0], uv[1])
    return i
  }

  box(color: Rgb | ((face: number) => Rgb), t?: Transform): this {
    const tf = this.transform(t)
    const faces: [[number, number, number], [number, number, number], [number, number, number]][] = [
      [[1, 0, 0], [0, 1, 0], [0, 0, -1]], [[-1, 0, 0], [0, 1, 0], [0, 0, 1]],
      [[0, 1, 0], [0, 0, -1], [1, 0, 0]], [[0, -1, 0], [0, 0, 1], [1, 0, 0]],
      [[0, 0, 1], [0, 1, 0], [1, 0, 0]], [[0, 0, -1], [0, 1, 0], [-1, 0, 0]],
    ]
    faces.forEach(([n, up, right], f) => {
      const c = typeof color === 'function' ? color(f) : color
      const corners = [[-1, -1], [1, -1], [1, 1], [-1, 1]].map(([a, b]) => {
        const p: [number, number, number] = [n[0] * 0.5 + right[0] * 0.5 * a + up[0] * 0.5 * b, n[1] * 0.5 + right[1] * 0.5 * a + up[1] * 0.5 * b, n[2] * 0.5 + right[2] * 0.5 * a + up[2] * 0.5 * b]
        const [wp, wn] = tf(p, n)
        return this.push(wp, wn, c, [(a + 1) / 2, (b + 1) / 2])
      })
      this.indices.push(corners[0], corners[1], corners[2], corners[0], corners[2], corners[3])
    })
    return this
  }

  /** Cylinder or cone along +Y from y 0 to height 1 (scaled by the transform), radii at bottom and top. */
  cylinder(color: Rgb | ((y: number, angle: number) => Rgb), bottom: number, top: number, segments = 8, t?: Transform, caps = true, jitter = 0, seed = 1): this {
    const tf = this.transform(t)
    const ring = (y: number, r: number) => {
      const out: number[] = []
      for (let s = 0; s <= segments; s++) {
        const a = (s / segments) * Math.PI * 2
        const wobble = jitter ? 1 + jitter * Math.sin(a * 3 + seed * 1.7 + y * 5) * Math.cos(a * 2 + seed) : 1
        const slope = (bottom - top)
        const n: [number, number, number] = [Math.sin(a), slope, Math.cos(a)]
        const nl = Math.hypot(n[0], n[1], n[2])
        const [wp, wn] = tf([Math.sin(a) * r * wobble, y, Math.cos(a) * r * wobble], [n[0] / nl, n[1] / nl, n[2] / nl])
        out.push(this.push(wp, wn, typeof color === 'function' ? color(y, a) : color, [s / segments, y]))
      }
      return out
    }
    const a = ring(0, bottom), b = ring(1, top)
    for (let s = 0; s < segments; s++) this.indices.push(a[s], a[s + 1], b[s + 1], a[s], b[s + 1], b[s])
    if (caps) {
      for (const [y, r, up] of [[0, bottom, -1], [1, top, 1]] as const) {
        if (r <= 0) continue
        const c = typeof color === 'function' ? color(y, 0) : color
        const [cp, cn] = tf([0, y, 0], [0, up, 0])
        const centre = this.push(cp, cn, c)
        const edge: number[] = []
        for (let s = 0; s <= segments; s++) {
          const ang = (s / segments) * Math.PI * 2
          const [wp, wn] = tf([Math.sin(ang) * r, y, Math.cos(ang) * r], [0, up, 0])
          edge.push(this.push(wp, wn, c))
        }
        for (let s = 0; s < segments; s++) up > 0 ? this.indices.push(centre, edge[s], edge[s + 1]) : this.indices.push(centre, edge[s + 1], edge[s])
      }
    }
    return this
  }

  blob(color: Rgb | ((n: [number, number, number]) => Rgb), t?: Transform, detail = 6, jitter = 0.18, seed = 1): this {
    const tf = this.transform(t)
    const rows = detail, cols = detail * 2
    const grid: number[][] = []
    for (let r = 0; r <= rows; r++) {
      const phi = (r / rows) * Math.PI
      const row: number[] = []
      for (let c = 0; c <= cols; c++) {
        const th = (c / cols) * Math.PI * 2
        const n: [number, number, number] = [Math.sin(phi) * Math.sin(th), Math.cos(phi), Math.sin(phi) * Math.cos(th)]
        const k = 1 + jitter * (Math.sin(th * 3 + seed) * Math.sin(phi * 4 + seed * 2.3) + 0.5 * Math.cos(th * 5 + seed * 0.7))
        const [wp, wn] = tf([n[0] * 0.5 * k, n[1] * 0.5 * k, n[2] * 0.5 * k], n)
        row.push(this.push(wp, wn, typeof color === 'function' ? color(n) : color))
      }
      grid.push(row)
    }
    for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) this.indices.push(grid[r][c], grid[r + 1][c], grid[r][c + 1], grid[r][c + 1], grid[r + 1][c], grid[r + 1][c + 1])
    return this
  }

  /** A double-sided vertical quad (for reeds and leaves), centred on x, base at y 0, 1 unit wide and tall before scaling. */
  card(color: Rgb, t?: Transform, tipColor?: Rgb): this {
    const tf = this.transform(t)
    for (const side of [1, -1]) {
      const n: [number, number, number] = [0, 0, side]
      const pts: [number, number, number][] = [[-0.5, 0, 0], [0.5, 0, 0], [0.12, 1, 0], [-0.12, 1, 0]]
      const ids = pts.map((p, i) => { const [wp, wn] = tf(p, n); return this.push(wp, wn, i >= 2 && tipColor ? tipColor : color) })
      if (side > 0) this.indices.push(ids[0], ids[1], ids[2], ids[0], ids[2], ids[3])
      else this.indices.push(ids[0], ids[2], ids[1], ids[0], ids[3], ids[2])
    }
    return this
  }

  merge(other: GeoBuilder): this {
    const base = this.positions.length / 3
    this.positions.push(...other.positions)
    this.normals.push(...other.normals)
    this.colors.push(...other.colors)
    this.uvs.push(...other.uvs)
    for (const i of other.indices) this.indices.push(i + base)
    return this
  }

  toMesh(device: pc.GraphicsDevice): pc.Mesh {
    const mesh = new pc.Mesh(device)
    const count = this.positions.length / 3
    mesh.setPositions(this.positions)
    mesh.setNormals(this.normals)
    const c = new Uint8Array(count * 4)
    for (let i = 0; i < count; i++) {
      c[i * 4] = Math.round(Math.min(1, Math.max(0, this.colors[i * 3])) * 255)
      c[i * 4 + 1] = Math.round(Math.min(1, Math.max(0, this.colors[i * 3 + 1])) * 255)
      c[i * 4 + 2] = Math.round(Math.min(1, Math.max(0, this.colors[i * 3 + 2])) * 255)
      c[i * 4 + 3] = 255
    }
    mesh.setColors32(c)
    mesh.setUvs(0, this.uvs)
    mesh.setIndices(count > 65535 ? new Uint32Array(this.indices) : new Uint16Array(this.indices))
    mesh.update()
    return mesh
  }
}

export function vertexColorMaterial(options: { gloss?: number; cull?: number; metalness?: number; emissive?: Rgb } = {}): pc.StandardMaterial {
  const m = new pc.StandardMaterial()
  m.diffuse = new pc.Color(1, 1, 1)
  m.diffuseVertexColor = true
  m.useMetalness = true
  m.metalness = options.metalness ?? 0
  m.gloss = options.gloss ?? 0.2
  if (options.cull !== undefined) m.cull = options.cull
  if (options.emissive) m.emissive = new pc.Color(...options.emissive)
  m.update()
  return m
}

export function instanced(app: pc.AppBase, mesh: pc.Mesh, material: pc.Material, matrices: Float32Array, name: string, shadows = true): pc.Entity {
  const entity = new pc.Entity(name)
  const instance = new pc.MeshInstance(mesh, material)
  const count = matrices.length / 16
  if (count > 0) {
    const vb = new pc.VertexBuffer(app.graphicsDevice, pc.VertexFormat.getDefaultInstancingFormat(app.graphicsDevice), count, { data: matrices })
    instance.setInstancing(vb)
  }
  instance.castShadow = shadows
  instance.receiveShadow = true
  instance.cull = false
  entity.addComponent('render', { meshInstances: [instance], castShadows: shadows, receiveShadows: true })
  return entity
}

export function matrix(x: number, y: number, z: number, yaw: number, scale: number, scaleY = scale, tiltX = 0, tiltZ = 0): number[] {
  const q = new pc.Quat().setFromEulerAngles(tiltX, yaw, tiltZ)
  const m = new pc.Mat4().setTRS(new pc.Vec3(x, y, z), q, new pc.Vec3(scale, scaleY, scale))
  return Array.from(m.data)
}
