/**
 * Local stand-in for Meshy's REST API, for developing and testing the admin
 * "Generate with Meshy" panel without spending credits. Meshy's documented
 * test-mode key (msy_dummy_api_key_for_test_mode_12345678) is accepted here;
 * anything else gets a 401 like the real service.
 *
 *   node scripts/meshy-mock.mjs [port]
 *   .dev.vars: MESHY_API_KEY=msy_dummy_api_key_for_test_mode_12345678
 *              MESHY_API_BASE=http://localhost:8790/openapi
 *
 * Tasks advance from PENDING to SUCCEEDED over about six seconds and return a
 * small generated car body (with baked-in wheels) as their .glb.
 */
import { createServer } from 'node:http'
import { randomUUID } from 'node:crypto'
import { deflateSync } from 'node:zlib'
import { Document, NodeIO } from '@gltf-transform/core'

const PORT = Number(process.argv[2] ?? process.env.MESHY_MOCK_PORT ?? 8790)
const KEY = 'msy_dummy_api_key_for_test_mode_12345678'
const COSTS = { 'text-to-3d:preview': 20, 'text-to-3d:refine': 10, 'image-to-3d': 30, remesh: 5, retexture: 10 }
const tasks = new Map()
let balance = 1000

function box(doc, buffer, name, material, [sx, sy, sz], [cx, cy, cz]) {
  const hx = sx / 2, hy = sy / 2, hz = sz / 2
  const corners = [[-1, -1, -1], [1, -1, -1], [1, 1, -1], [-1, 1, -1], [-1, -1, 1], [1, -1, 1], [1, 1, 1], [-1, 1, 1]]
  const faces = [[0, 3, 2, 1], [4, 5, 6, 7], [0, 1, 5, 4], [2, 3, 7, 6], [1, 2, 6, 5], [0, 4, 7, 3]]
  const pos = [], idx = []
  for (const f of faces) {
    const base = pos.length / 3
    for (const c of f) pos.push(cx + corners[c][0] * hx, cy + corners[c][1] * hy, cz + corners[c][2] * hz)
    idx.push(base, base + 1, base + 2, base, base + 2, base + 3)
  }
  return primitive(doc, buffer, name, material, pos, idx)
}

function cylinderZ(doc, buffer, name, material, r, w, [cx, cy, cz], seg = 18) {
  const pos = [], idx = []
  for (let i = 0; i <= seg; i++) {
    const a = (i / seg) * Math.PI * 2
    pos.push(cx + Math.cos(a) * r, cy + Math.sin(a) * r, cz - w / 2, cx + Math.cos(a) * r, cy + Math.sin(a) * r, cz + w / 2)
  }
  for (let i = 0; i < seg; i++) { const a = i * 2; idx.push(a, a + 2, a + 1, a + 1, a + 2, a + 3) }
  return primitive(doc, buffer, name, material, pos, idx)
}

function primitive(doc, buffer, name, material, pos, idx) {
  const p = doc.createAccessor().setType('VEC3').setArray(new Float32Array(pos)).setBuffer(buffer)
  const i = doc.createAccessor().setType('SCALAR').setArray(new Uint16Array(idx)).setBuffer(buffer)
  const prim = doc.createPrimitive().setAttribute('POSITION', p).setIndices(i).setMaterial(material)
  return doc.createNode(name).setMesh(doc.createMesh(name).addPrimitive(prim))
}

/** A 4.4 m two-box wagon facing +Z (like many Meshy exports) with its wheels fused on. */
async function carGlb(tint) {
  const doc = new Document()
  const buffer = doc.createBuffer()
  const body = doc.createMaterial('Body').setBaseColorFactor([...tint, 1]).setMetallicFactor(0.3).setRoughnessFactor(0.4)
  const glass = doc.createMaterial('Glass').setBaseColorFactor([0.1, 0.14, 0.18, 1]).setRoughnessFactor(0.1)
  const tire = doc.createMaterial('Tire').setBaseColorFactor([0.05, 0.05, 0.05, 1]).setRoughnessFactor(0.9)
  const scene = doc.createScene('Scene')
  const root = doc.createNode('Wagon')
  scene.addChild(root)
  root.addChild(box(doc, buffer, 'Lower', body, [1.8, 0.7, 4.4], [0, 0.65, 0]))
  root.addChild(box(doc, buffer, 'Cabin', glass, [1.6, 0.55, 2.4], [0, 1.27, -0.3]))
  for (const z of [1.4, -1.4]) for (const x of [0.82, -0.82]) root.addChild(cylinderZ(doc, buffer, 'Wheel', tire, 0.34, 0.24, [0, 0, 0]).setTranslation([x, 0.34, z]).setRotation([0, Math.SQRT1_2, 0, Math.SQRT1_2]))
  return Buffer.from(await new NodeIO().writeBinary(doc))
}

function pngThumb(r, g, b) {
  const size = 64
  const raw = Buffer.alloc((size * 3 + 1) * size)
  for (let y = 0; y < size; y++) {
    raw[y * (size * 3 + 1)] = 0
    for (let x = 0; x < size; x++) {
      const o = y * (size * 3 + 1) + 1 + x * 3
      const shade = y > 20 && y < 48 && x > 8 && x < 56 ? 1 : 0.35
      raw[o] = r * shade; raw[o + 1] = g * shade; raw[o + 2] = b * shade
    }
  }
  const crc = buf => { let c = ~0; for (const byte of buf) { c ^= byte; for (let k = 0; k < 8; k++) c = c & 1 ? (c >>> 1) ^ 0xedb88320 : c >>> 1 } return ~c >>> 0 }
  const chunk = (type, data) => { const len = Buffer.alloc(4); len.writeUInt32BE(data.length); const td = Buffer.concat([Buffer.from(type), data]); const c = Buffer.alloc(4); c.writeUInt32BE(crc(td)); return Buffer.concat([len, td, c]) }
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(size, 0); ihdr.writeUInt32BE(size, 4); ihdr[8] = 8; ihdr[9] = 2
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', deflateSync(raw)), chunk('IEND', Buffer.alloc(0))])
}

function view(task) {
  const age = (Date.now() - task.created) / 1000
  const progress = Math.min(100, Math.round(age * 18))
  const status = task.status !== 'AUTO' ? task.status : age < 1 ? 'PENDING' : progress < 100 ? 'IN_PROGRESS' : 'SUCCEEDED'
  const done = status === 'SUCCEEDED'
  return {
    id: task.id, type: task.type, mode: task.mode, status, progress: status === 'PENDING' ? 0 : progress,
    prompt: task.prompt ?? '', created_at: task.created, consumed_credits: task.cost,
    model_urls: done ? { glb: `http://localhost:${PORT}/assets/${task.id}.glb` } : {},
    thumbnail_url: done ? `http://localhost:${PORT}/assets/${task.id}.png` : '',
    task_error: status === 'FAILED' ? { message: 'Mock failure' } : null,
  }
}

const send = (res, status, body, type = 'application/json') => {
  res.writeHead(status, { 'Content-Type': type, 'Access-Control-Allow-Origin': '*' })
  res.end(type === 'application/json' ? JSON.stringify(body) : body)
}

const server = createServer(async (req, res) => {
  const url = new URL(req.url, `http://localhost:${PORT}`)
  const asset = url.pathname.match(/^\/assets\/([\w-]+)\.(glb|png)$/)
  if (asset) {
    const task = tasks.get(asset[1])
    if (!task) return send(res, 404, { message: 'Not found' })
    const tint = [[0.7, 0.15, 0.12], [0.15, 0.35, 0.7], [0.2, 0.55, 0.3], [0.85, 0.6, 0.1]][task.seed % 4]
    return asset[2] === 'glb' ? send(res, 200, await carGlb(tint), 'model/gltf-binary') : send(res, 200, pngThumb(...tint.map(c => Math.round(c * 255))), 'image/png')
  }
  if (req.headers.authorization !== `Bearer ${KEY}`) return send(res, 401, { message: 'Invalid API key' })
  const match = url.pathname.match(/^\/openapi\/(v1|v2)\/(text-to-3d|image-to-3d|remesh|retexture|balance)(?:\/([\w-]+))?$/)
  if (!match) return send(res, 404, { message: 'Not found' })
  const [, , kind, id] = match
  if (kind === 'balance') return send(res, 200, { balance, monthly_credits: balance, permanent_credits: 0 })
  if (req.method === 'POST' && !id) {
    let raw = ''
    for await (const part of req) raw += part
    let body
    try { body = JSON.parse(raw || '{}') } catch { return send(res, 400, { message: 'Bad JSON' }) }
    if (kind === 'text-to-3d' && body.mode === 'refine' && !tasks.has(body.preview_task_id)) return send(res, 400, { message: 'preview_task_id not found' })
    if ((kind === 'remesh' || kind === 'retexture') && !body.input_task_id && !body.model_url) return send(res, 400, { message: 'model required' })
    if (kind === 'text-to-3d' && body.mode === 'preview' && !body.prompt) return send(res, 400, { message: 'prompt required' })
    const lite = body.ai_model === 'meshy-6-lite'
    const cost = lite && (body.mode === 'preview' || kind === 'image-to-3d') ? (kind === 'image-to-3d' ? 15 : 5) : COSTS[kind === 'text-to-3d' ? `text-to-3d:${body.mode}` : kind] ?? 5
    if (balance < cost) return send(res, 402, { message: 'Insufficient credits' })
    balance -= cost
    const task = { id: randomUUID(), type: kind, mode: body.mode, prompt: body.prompt ?? body.text_style_prompt, cost, created: Date.now(), status: body.prompt?.includes('[fail]') ? 'FAILED' : 'AUTO', seed: tasks.size }
    tasks.set(task.id, task)
    return send(res, 202, { result: task.id })
  }
  if (!id) return send(res, 200, [...tasks.values()].filter(t => t.type === kind).map(view))
  const task = tasks.get(id)
  if (!task) return send(res, 404, { message: 'Task not found' })
  if (req.method === 'DELETE') { tasks.delete(id); return send(res, 200, {}) }
  return send(res, 200, view(task))
})

server.listen(PORT, () => console.log(`Meshy stand-in on http://localhost:${PORT}/openapi (key: ${KEY})`))
