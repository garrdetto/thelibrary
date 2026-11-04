/** Builds Northwoods Angler's character and boat data from the owner's Meshy exports in assets-src/angler/ into public/modules/angler/. Run: node --max-old-space-size=12000 modules-src/angler/tools/build-models.mjs */
import { mkdirSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { buildBoat } from './boat.mjs'
import { buildFisherman, PARTS } from './fisherman.mjs'
import { quantizeNormals, smoothNormals, writeMeshBin } from './meshbin.mjs'

const root = join(dirname(fileURLToPath(import.meta.url)), '../../..')
const src = join(root, 'assets-src/angler')
const out = join(root, 'public/modules/angler')
mkdirSync(out, { recursive: true })

const only = process.argv[2]

if (!only || only === 'fisherman') {
  const lods = await buildFisherman(join(src, 'fisherman.fbx'), [60000, 14000])
  for (const [i, lod] of lods.entries()) {
    const file = join(out, i === 0 ? 'fisherman.bin' : 'fisherman-lod.bin')
    const bytes = writeMeshBin(file, { kind: 'fisherman', vertexCount: lod.positions.length / 3, bones: lod.bones, parts: PARTS }, {
      position: { type: 'f32', components: 3, data: lod.positions },
      normal: { type: 'i16n', components: 3, data: quantizeNormals(lod.normals) },
      joints: { type: 'u8', components: 4, data: lod.joints },
      weights: { type: 'u8n', components: 4, data: lod.weights },
      region: { type: 'u8', components: 4, data: lod.region },
      ao: { type: 'u8n', components: 1, data: lod.ao },
      index: { type: lod.positions.length / 3 < 65535 ? 'u16' : 'u32', components: 1, data: lod.indices },
    })
    console.log(file, (bytes / 1e6).toFixed(2), 'MB', lod.indices.length / 3, 'tris')
  }
}

if (!only || only === 'boat') {
  const boat = await buildBoat(join(src, 'bass-boat.glb'))
  const normals = smoothNormals(boat.positions, boat.indices)
  const bytes = writeMeshBin(join(out, 'bass-boat.bin'), { kind: 'boat', vertexCount: boat.positions.length / 3 }, {
    position: { type: 'f32', components: 3, data: boat.positions },
    normal: { type: 'i16n', components: 3, data: quantizeNormals(normals) },
    uv: { type: 'f32', components: 2, data: boat.uvs },
    index: { type: boat.indices instanceof Uint16Array ? 'u16' : 'u32', components: 1, data: boat.indices },
  })
  writeFileSync(join(out, 'bass-boat-base.webp'), boat.textures.base)
  writeFileSync(join(out, 'bass-boat-paint.png'), boat.textures.paint)
  writeFileSync(join(out, 'bass-boat-rough.webp'), boat.textures.rough)
  console.log('bass-boat.bin', (bytes / 1e6).toFixed(2), 'MB', boat.indices.length / 3, 'tris', 'textures', boat.textures.base.length, boat.textures.paint.length, boat.textures.rough.length)
}
