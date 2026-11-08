// Short Track Showdown: exports the procedural race truck (modules-src/shorttrack/truck-model.js) as a glTF binary for
// the Blender LOD script (scripts/blender/shorttrack/truck.py). Runs in Node with three.js; nothing is drawn.
//
//   node scripts/shorttrack-truck-export.mjs [--out <dir>]   (default: node_modules/.cache/shorttrack/truck_source.glb)
import { mkdirSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import * as THREE from 'three'
import { GLTFExporter } from 'three/addons/exporters/GLTFExporter.js'
import { TM } from '../modules-src/shorttrack/truck-model.js'

const args = process.argv.slice(2)
const outDir = resolve(args.includes('--out') ? args[args.indexOf('--out') + 1] : 'node_modules/.cache/shorttrack')

globalThis.FileReader ??= class {
  done(result) {
    this.result = result
    this.onload?.({ target: this })
    this.onloadend?.({ target: this })
  }
  readAsArrayBuffer(blob) {
    blob.arrayBuffer().then((buffer) => this.done(buffer))
  }
  readAsDataURL(blob) {
    blob.arrayBuffer().then((buffer) => this.done(`data:${blob.type || 'application/octet-stream'};base64,${Buffer.from(buffer).toString('base64')}`))
  }
}

const { group } = TM.buildTruck(THREE, {})
group.name = 'Truck'
group.updateMatrixWorld(true)
let triangles = 0
group.traverse((object) => {
  if (!object.isMesh) return
  const g = object.geometry
  triangles += (g.index ? g.index.count : g.attributes.position.count) / 3
})
const glb = await new GLTFExporter().parseAsync(group, { binary: true })
mkdirSync(outDir, { recursive: true })
const file = join(outDir, 'truck_source.glb')
writeFileSync(file, Buffer.from(glb))
console.log(`${file}: ${Math.round(triangles)} triangles, ${Buffer.byteLength(Buffer.from(glb))} bytes`)
