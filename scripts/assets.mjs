#!/usr/bin/env node
/**
 * Asset pipeline: optimizes every model in `assets-src/models/` into `public/models/`.
 * The outputs and `public/models/.assets-cache.json` are committed, so a source change means running this and committing both;
 * `--check` in CI fails when they are stale. Bump PIPELINE_VERSION when the pass itself changes so every output is rebuilt.
 *
 *   node scripts/assets.mjs            incremental: only sources that changed since the last run
 *   node scripts/assets.mjs --force    rebuild everything
 *   node scripts/assets.mjs --check    exit 1 if any output is missing or stale (CI)
 *   node scripts/assets.mjs --report   print the before/after table only
 *
 * Each .glb is deduplicated, palette-merged, joined by material, welded, quantized and meshopt-compressed,
 * and its textures become WebP (lossless at 256 px and below, quality 92 above). Presets per folder are in PRESETS.
 * The 36 Sandlot Sluggers 3D player exports become one `sandlot3d/players.glb` (one scene per player) so identical
 * limbs, torsos and gear share buffers. three.js-only `EXT_materials_bump` is carried through (gltf-transform would drop it).
 */
import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { cpus } from 'node:os'
import { basename, dirname, join, relative, sep } from 'node:path'
import { fileURLToPath } from 'node:url'
import { fork } from 'node:child_process'

const PIPELINE_VERSION = 2
const repoRoot = dirname(dirname(fileURLToPath(import.meta.url)))
const srcRoot = join(repoRoot, 'assets-src', 'models')
const outRoot = join(repoRoot, 'public', 'models')
const cacheFile = join(outRoot, '.assets-cache.json')

/** Node names kept apart from the join pass (moving parts a module may need to find). */
const KEEP_NODE_NAMES = /^(Wheel_|Tire_|RaceNumber_|Hitch|Trailer|Prop_)/i

/**
 * Presets, matched in order against the path relative to `assets-src/models/` (forward slashes).
 * `simplify` is the meshopt simplifier error bound (0 = off); `join` merges sibling meshes per material (`flatten: false` keeps the
 * hierarchy, so wheel and part pivots survive and only parts under the same parent merge); `compress: false` skips
 * quantization and meshopt (instanced crowds and trees: their per-instance float transforms only grow when quantized).
 * `palette: false` keeps every material (and its name) for modules that recolor slots by name; `keepAttributes: true` keeps UVs on
 * untextured materials whose textures the module paints at runtime.
 */
const PRESETS = [
  { match: /^maplestreet\/houses\//, name: 'house', join: true, simplify: 0.0005, textureQuality: 92 },
  { match: /^shorttrack\/(truck_race_|pace_car_|props_kit)/, name: 'vehicle', join: true, flatten: false, palette: false, simplify: 0, textureQuality: 92 },
  { match: /^(maplestreet\/town|sandlot3d\/ballpark_|shorttrack\/track_|botwreck\/arena|botwreck\/crates)/, name: 'static', join: true, simplify: 0, textureQuality: 92 },
  { match: /^shorttrack\/(crowd|trees)_/, name: 'instanced', join: false, simplify: 0, textureQuality: 92, compress: false },
  { match: /^hood\/furniture\.glb$/, name: 'props', join: true, flatten: false, palette: false, simplify: 0, textureQuality: 92 },
  { match: /^(sandlot3d\/(athlete|field_detail)|hood\/(sim|vehicles)|proskater\/board)\.glb$/, name: 'slots', join: false, flatten: false, palette: false, keepAttributes: true, simplify: 0, textureQuality: 92 },
  { match: /^proskater\/skater\.glb$/, name: 'character', join: false, flatten: false, simplify: 0, textureQuality: 92 },
  { match: /^sandlot3d\//, name: 'figure', join: true, simplify: 0, textureQuality: 92 },
  { match: /^tello\//, name: 'kit', join: false, flatten: false, palette: false, keepAttributes: true, simplify: 0, textureQuality: 92 },
  { match: /./, name: 'rig', join: true, flatten: false, simplify: 0, textureQuality: 92 },
]

/** Groups: several sources merged into one output. Matched sources are removed from the one-to-one list. */
const GROUPS = [
  { out: 'sandlot3d/players.glb', match: /^sandlot3d\/(player_\d+_(home|away)|batter_(home|away)|catcher_home)\.glb$/, preset: 'figure' },
]

const args = new Set(process.argv.slice(2))
const toPosix = (p) => p.split(sep).join('/')

function listSources() {
  const files = []
  const walk = (dir) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const full = join(dir, entry.name)
      if (entry.isDirectory()) walk(full)
      else if (entry.name.endsWith('.glb')) files.push(full)
    }
  }
  if (existsSync(srcRoot)) walk(srcRoot)
  return files.sort()
}

function hashFiles(paths, extra = '') {
  const h = createHash('sha1')
  h.update(`v${PIPELINE_VERSION}|${extra}|`)
  for (const p of paths) h.update(readFileSync(p))
  return h.digest('hex')
}

function presetFor(rel) {
  return PRESETS.find((p) => p.match.test(rel))
}

/** Builds the job list: { out (relative), sources (absolute), preset }. */
function plan() {
  const sources = listSources().map((abs) => ({ abs, rel: toPosix(relative(srcRoot, abs)) }))
  const jobs = []
  const grouped = new Set()
  for (const group of GROUPS) {
    const members = sources.filter((s) => group.match.test(s.rel))
    if (!members.length) continue
    members.forEach((m) => grouped.add(m.rel))
    jobs.push({ out: group.out, sources: members.map((m) => m.abs), preset: PRESETS.find((p) => p.name === group.preset), group: true })
  }
  for (const s of sources) {
    if (grouped.has(s.rel)) continue
    jobs.push({ out: s.rel, sources: [s.abs], preset: presetFor(s.rel), group: false })
  }
  return jobs
}

function loadCache() {
  try {
    return JSON.parse(readFileSync(cacheFile, 'utf8'))
  } catch {
    return {}
  }
}

function runWorker(job) {
  return new Promise((resolve, reject) => {
    const child = fork(fileURLToPath(import.meta.url), ['--worker'], { stdio: ['ignore', 'inherit', 'inherit', 'ipc'] })
    child.once('message', (msg) => {
      if (msg.error) reject(new Error(`${job.out}: ${msg.error}`))
      else resolve(msg)
    })
    child.once('exit', (code) => {
      if (code) reject(new Error(`${job.out}: worker exited with ${code}`))
    })
    child.send({ ...job, outAbs: join(outRoot, job.out) })
  })
}

async function main() {
  const jobs = plan()
  if (!jobs.length) {
    console.log('assets: no sources in assets-src/models')
    return
  }
  const cache = loadCache()
  const force = args.has('--force')
  const todo = []
  const upToDate = []
  for (const job of jobs) {
    const hash = hashFiles(job.sources, job.preset.name)
    const outAbs = join(outRoot, job.out)
    const fresh = !force && cache[job.out]?.hash === hash && existsSync(outAbs)
    ;(fresh ? upToDate : todo).push({ ...job, hash })
  }

  if (args.has('--check')) {
    if (todo.length) {
      console.error(`assets: ${todo.length} output(s) missing or stale; run \`pnpm assets\``)
      for (const job of todo) console.error(`  ${job.out}`)
      process.exit(1)
    }
    console.log(`assets: ${upToDate.length} outputs up to date`)
    return
  }

  mkdirSync(outRoot, { recursive: true })
  const results = []
  const concurrency = Math.max(1, Math.min(cpus().length, Number(process.env.ASSETS_WORKERS) || 4))
  let index = 0
  const started = Date.now()
  const next = async () => {
    while (index < todo.length) {
      const job = todo[index++]
      mkdirSync(dirname(join(outRoot, job.out)), { recursive: true })
      try {
        const result = await runWorker(job)
        cache[job.out] = { hash: job.hash, ...result }
        results.push({ out: job.out, ...result })
        console.log(`  ${job.out}  ${mb(result.before)} → ${mb(result.after)} MB  prims ${result.primsBefore} → ${result.primsAfter}`)
      } catch (error) {
        failures.push(error)
        console.error(`  FAILED ${error.message.split('\n')[0]}`)
      }
    }
  }
  const failures = []
  await Promise.all(Array.from({ length: concurrency }, next))

  const wanted = new Set(jobs.map((j) => j.out))
  for (const key of Object.keys(cache)) {
    if (!wanted.has(key)) {
      delete cache[key]
      rmSync(join(outRoot, key), { force: true })
    }
  }
  writeFileSync(cacheFile, JSON.stringify(cache, null, 1))

  const all = jobs.map((j) => cache[j.out]).filter(Boolean)
  const before = all.reduce((s, r) => s + r.before, 0)
  const after = all.reduce((s, r) => s + r.after, 0)
  if (failures.length) {
    console.error(`assets: ${failures.length} model(s) failed`)
    for (const error of failures) console.error(error.stack || error)
    process.exit(1)
  }
  console.log(
    `assets: ${todo.length - failures.length} rebuilt, ${upToDate.length} up to date in ${((Date.now() - started) / 1000).toFixed(1)}s; ` +
      `${jobs.length} outputs, ${mb(before)} MB → ${mb(after)} MB`,
  )
}

function mb(n) {
  return (n / 1e6).toFixed(2)
}

async function report() {
  const cache = loadCache()
  const rows = Object.entries(cache).sort((a, b) => b[1].before - a[1].before)
  console.log('| Output | Before (MB) | After (MB) | Primitives | Materials |')
  console.log('| --- | ---: | ---: | ---: | ---: |')
  for (const [out, r] of rows) {
    console.log(`| ${out} | ${mb(r.before)} | ${mb(r.after)} | ${r.primsBefore} → ${r.primsAfter} | ${r.matsBefore} → ${r.matsAfter} |`)
  }
  const before = rows.reduce((s, [, r]) => s + r.before, 0)
  const after = rows.reduce((s, [, r]) => s + r.after, 0)
  console.log(`| **Total (${rows.length})** | **${mb(before)}** | **${mb(after)}** | | |`)
}

/* ------------------------------------------------------------------ worker ------------------------------------------------------------------ */

/** Uses the sharp build that @gltf-transform's ndarray-pixels loads, so Windows never maps two libvips builds into one process. */
async function loadSharp() {
  const { createRequire } = await import('node:module')
  const { pathToFileURL } = await import('node:url')
  try {
    const fromFunctions = createRequire(createRequire(import.meta.url).resolve('@gltf-transform/functions'))
    const fromPixels = createRequire(fromFunctions.resolve('ndarray-pixels'))
    return (await import(pathToFileURL(fromPixels.resolve('sharp')).href)).default
  } catch {
    return (await import('sharp')).default
  }
}

async function worker() {
  const sharp = await loadSharp()
  const [{ Document, Logger, NodeIO, Extension, ExtensionProperty, PropertyType, TextureInfo, TextureChannel }, { ALL_EXTENSIONS, EXTMeshoptCompression, EXTTextureWebP }, fn, meshopt] =
    await Promise.all([
      import('@gltf-transform/core'),
      import('@gltf-transform/extensions'),
      import('@gltf-transform/functions'),
      import('meshoptimizer'),
    ])
  const { MeshoptEncoder, MeshoptSimplifier } = meshopt
  await Promise.all([MeshoptEncoder.ready, MeshoptSimplifier.ready])

  const EXT_MATERIALS_BUMP = 'EXT_materials_bump'

  class Bump extends ExtensionProperty {
    init() {
      this.extensionName = EXT_MATERIALS_BUMP
      this.propertyType = 'Bump'
      this.parentTypes = [PropertyType.MATERIAL]
    }
    getDefaults() {
      return Object.assign(super.getDefaults(), {
        bumpFactor: 1,
        bumpTexture: null,
        bumpTextureInfo: new TextureInfo(this.graph, 'bumpTextureInfo'),
      })
    }
    getBumpFactor() {
      return this.get('bumpFactor')
    }
    setBumpFactor(value) {
      return this.set('bumpFactor', value)
    }
    getBumpTexture() {
      return this.getRef('bumpTexture')
    }
    getBumpTextureInfo() {
      return this.getRef('bumpTexture') ? this.getRef('bumpTextureInfo') : null
    }
    setBumpTexture(texture) {
      return this.setRef('bumpTexture', texture, { channels: TextureChannel.R })
    }
  }

  /** three.js's EXT_materials_bump (bumpTexture + bumpFactor), read and written so the pass keeps it. */
  class EXTMaterialsBump extends Extension {
    static EXTENSION_NAME = EXT_MATERIALS_BUMP
    extensionName = EXT_MATERIALS_BUMP
    prereadTypes = [PropertyType.MESH]
    prewriteTypes = [PropertyType.MESH]
    createBump() {
      return new Bump(this.document.getGraph())
    }
    read() {
      return this
    }
    write() {
      return this
    }
    preread(context) {
      const json = context.jsonDoc.json
      const textureDefs = json.textures || []
      ;(json.materials || []).forEach((materialDef, materialIndex) => {
        const def = materialDef.extensions?.[EXT_MATERIALS_BUMP]
        if (!def) return
        const bump = this.createBump()
        context.materials[materialIndex].setExtension(EXT_MATERIALS_BUMP, bump)
        if (def.bumpFactor !== undefined) bump.setBumpFactor(def.bumpFactor)
        if (def.bumpTexture !== undefined) {
          const texture = context.textures[textureDefs[def.bumpTexture.index].source]
          bump.setBumpTexture(texture)
          context.setTextureInfo(bump.getBumpTextureInfo(), def.bumpTexture)
        }
      })
      return this
    }
    prewrite(context) {
      const json = context.jsonDoc.json
      for (const material of this.document.getRoot().listMaterials()) {
        const bump = material.getExtension(EXT_MATERIALS_BUMP)
        if (!bump) continue
        const materialIndex = context.materialIndexMap.get(material)
        const materialDef = json.materials[materialIndex]
        const def = context.createPropertyDef(bump)
        def.bumpFactor = bump.getBumpFactor()
        if (bump.getBumpTexture()) def.bumpTexture = context.createTextureInfoDef(bump.getBumpTexture(), bump.getBumpTextureInfo())
        materialDef.extensions = materialDef.extensions || {}
        materialDef.extensions[EXT_MATERIALS_BUMP] = def
      }
      return this
    }
  }

  const quiet = new Logger(Logger.Verbosity.ERROR)
  const io = new NodeIO().setLogger(quiet).registerExtensions([...ALL_EXTENSIONS, EXTMaterialsBump]).registerDependencies({ 'meshopt.encoder': MeshoptEncoder })

  const stats = (document) => {
    const root = document.getRoot()
    return {
      prims: root.listMeshes().reduce((n, m) => n + m.listPrimitives().length, 0),
      mats: root.listMaterials().length,
    }
  }

  const rootNames = (document) => new Set(document.getRoot().listScenes().flatMap((s) => s.listChildren().map((n) => n.getName())))

  const stripJoinNames = (document, keep) => {
    for (const node of document.getRoot().listNodes()) {
      const name = node.getName()
      if (keep.has(name) || KEEP_NODE_NAMES.test(name)) continue
      node.setName('')
    }
  }

  const textureSettings = (quality) => ({
    encoder: sharp,
    targetFormat: 'webp',
    quality,
    lossless: false,
    nearLossless: false,
  })

  const optimize = async (document, preset) => {
    document.setLogger(quiet)
    const keep = rootNames(document)
    await document.transform(fn.unpartition(), fn.dedup(), fn.instance({ min: 5 }))
    if (preset.palette !== false) await document.transform(fn.palette({ min: 5 }))
    if (preset.flatten !== false) await document.transform(fn.flatten())
    if (preset.join) {
      stripJoinNames(document, keep)
      await document.transform(fn.join({ keepNamed: true }))
    }
    await document.transform(fn.weld())
    if (preset.simplify > 0) await document.transform(fn.simplify({ simplifier: MeshoptSimplifier, ratio: 0, error: preset.simplify, lockBorder: true }))
    await document.transform(fn.resample(), fn.prune({ keepAttributes: preset.keepAttributes === true }), fn.sparse())
    for (const texture of document.getRoot().listTextures()) {
      const size = texture.getSize()
      const tiny = !size || Math.max(size[0], size[1]) <= 256
      await fn.compressTexture(texture, tiny ? { ...textureSettings(100), lossless: true } : textureSettings(preset.textureQuality))
    }
    if (document.getRoot().listTextures().some((t) => t.getMimeType() === 'image/webp')) document.createExtension(EXTTextureWebP).setRequired(true)
    if (preset.compress === false) return
    await document.transform(fn.quantize({ quantizePosition: 14, quantizeNormal: 10, quantizeTexcoord: 12 }), fn.meshopt({ encoder: MeshoptEncoder, level: 'medium' }))
    document.createExtension(EXTMeshoptCompression).setRequired(true)
  }

  process.on('message', async (job) => {
    try {
      let document
      let before = 0
      const primsBefore = { prims: 0, mats: 0 }
      if (job.group) {
        document = new Document()
        for (const src of job.sources) {
          before += statSync(src).size
          const part = await io.read(src)
          const s = stats(part)
          primsBefore.prims += s.prims
          primsBefore.mats += s.mats
          for (const scene of part.getRoot().listScenes()) scene.setName(basename(src, '.glb'))
          fn.mergeDocuments(document, part)
        }
        const scenes = document.getRoot().listScenes()
        document.getRoot().setDefaultScene(scenes[0])
      } else {
        before = statSync(job.sources[0]).size
        document = await io.read(job.sources[0])
        Object.assign(primsBefore, stats(document))
      }
      await optimize(document, job.preset)
      const bytes = await io.writeBinary(document)
      writeFileSync(job.outAbs, bytes)
      const s = stats(document)
      process.send({ before, after: bytes.byteLength, primsBefore: primsBefore.prims, primsAfter: s.prims, matsBefore: primsBefore.mats, matsAfter: s.mats, preset: job.preset.name })
      process.exit(0)
    } catch (error) {
      process.send({ error: error?.stack || String(error) })
      process.exit(1)
    }
  })
}

if (args.has('--worker')) await worker()
else if (args.has('--report')) await report()
else await main()
