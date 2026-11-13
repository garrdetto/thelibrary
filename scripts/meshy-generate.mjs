#!/usr/bin/env node
/**
 * Makes a game-ready 3D model with Meshy from a text prompt, for Admin → Site changes
 * (and for anyone running it by hand). Steps, each skipped when not asked for:
 *
 *   1. Text to 3D preview (mesh) → 2. refine (PBR textures) → 3. rig (humanoid characters only)
 *   → 4. animate (up to 10 library clips in one file) → 5. Blender clean-up when Blender is installed
 *   (feet on the ground, centred, sized, decimated, optional LODs, clips renamed) → assets-src/models/.
 *
 *   node scripts/meshy-generate.mjs --prompt "a cheerful wooden rowboat, game asset" \
 *     --name rowboat --out assets-src/models/angler --target furniture --size 3.2
 *
 *   node scripts/meshy-generate.mjs --prompt "a friendly park ranger, full body, A-pose" \
 *     --name ranger --out assets-src/models/maplestreet/characters --target character \
 *     --rig --height 1.8 --animate idle,walk,wave
 *
 *   node scripts/meshy-generate.mjs --list-animations
 *
 * Needs MESHY_API_KEY (a GitHub repository secret for site changes; MESHY_API_BASE points at
 * scripts/meshy-mock.mjs for testing). Every task id is saved in <out>/<name>.meshy.json as soon as
 * Meshy accepts it, so running the same command again resumes instead of paying twice; --fresh
 * starts over. Raw downloads go to .meshy-cache/ (git-ignored). The run refuses to start when the
 * estimate is over --max-credits (default MESHY_MAX_CREDITS or 150). Afterwards run `pnpm assets`
 * and load the optimised file from public/models/.
 */
import { spawnSync } from 'node:child_process'
import { copyFileSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, join, relative, resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'
import { parseArgs } from 'node:util'

const repoRoot = dirname(dirname(fileURLToPath(import.meta.url)))
const modelsRoot = join(repoRoot, 'assets-src', 'models')
const cacheRoot = join(repoRoot, '.meshy-cache')
const API = (process.env.MESHY_API_BASE?.trim() || 'https://api.meshy.ai/openapi').replace(/\/$/, '')
const POLL_MS = Number(process.env.MESHY_POLL_MS ?? 5000)
const TASK_TIMEOUT_MS = 25 * 60 * 1000

/** Same numbers as src/lib/meshy.ts (the admin panel); keep them in step. */
const COSTS = { preview: { latest: 20, 'meshy-6': 20, 'meshy-6-lite': 5 }, refine: 10, rig: 5, animation: 3 }
const TARGETS = ['furniture', 'vehicle', 'character', 'ride', 'racecar', 'ballplayer', 'ballpark']
const POLYCOUNT = { furniture: 8000, vehicle: 20000, character: 15000, ride: 12000, racecar: 20000, ballplayer: 24000, ballpark: 15000 }
const NEGATIVE = {
  vehicle: 'wheels, tires, logos, badges, brand names, license plate text, ground plane',
  furniture: 'floor, background, text, logos',
  character: 'logos, text, weapons',
  ride: 'people, riders, ground plane, background, scenery, text, logos, brand names, characters from films or games',
  ballplayer: 'logos, team names, numbers, text, real players, bats, gloves, ground plane, background',
  ballpark: 'people, logos, team names, real ballparks, text, background',
  racecar: 'wheels, tires, driver, logos, badges, brand names, sponsor decals, race numbers, text, ground plane',
}
const HUMANOID = new Set(['character', 'ballplayer'])

/** Short names for common clips in Meshy's animation library (docs.meshy.ai/en/api/animation-library). Any library id also works. */
const CLIPS = {
  idle: [0, 'Idle'], idle2: [11, 'Idle_02'], idle3: [12, 'Idle_03'], alert: [2, 'Alert'], attack: [4, 'Attack'], hit: [7, 'BeHit_FlyUp'], dead: [8, 'Dead'],
  jump: [13, 'Jump_Run'], run: [14, 'Run_02'], run3: [15, 'Run_03'], sprint: [16, 'RunFast'], dance: [22, 'FunnyDancing_01'], dance2: [23, 'FunnyDancing_02'],
  dance3: [24, 'FunnyDancing_03'], agree: [25, 'Agree_Gesture'], stomp: [26, 'Angry_Stomp'], wave: [28, 'Big_Wave_Hello'], walk: [30, 'Casual_Walk'],
  breath: [31, 'Catching_Breath'], sit: [33, 'Chair_Sit_Idle_M'], sitf: [32, 'Chair_Sit_Idle_F'], confused: [36, 'Confused_Scratch'], bow: [41, 'Formal_Bow'],
  happyjump: [44, 'Happy_jump_f'], jumprope: [46, 'Jump_Rope'], cheer: [49, 'Motivational_Cheer'], phone: [50, 'Phone_Call_Gesture'], chat: [56, 'Stand_and_Chat'],
  victory: [59, 'Victory_Cheer'],
}

const USAGE = `Usage: node scripts/meshy-generate.mjs --prompt "<text>" --name <file-name> --out assets-src/models/<module>[/<folder>] [options]

  --target <kind>        ${TARGETS.join(' | ')} (default furniture): sets the polygon budget and the negative prompt
  --negative <text>      things to keep out (default: the target's list)
  --ai-model <model>     latest | meshy-6 | meshy-6-lite (default latest)
  --polycount <n>        triangle budget Meshy remeshes to (default by target)
  --texture-prompt <t>   extra direction for the refine (texturing) step
  --rig                  rig a humanoid character (needs --target character or ballplayer)
  --height <m>           character height for rigging and clean-up (default 1.75 when rigging)
  --animate <clips>      comma list of clip names or Meshy action ids (implies --rig), e.g. idle,walk,wave or 0,30
  --size <m>             scale a prop so its longest side is this many metres
  --max-tris <n>         decimate to at most this many triangles in Blender
  --lods <a,b,c>         write LOD files at these triangle counts instead (<name>-lod0.glb …)
  --wheels <n>           vehicles: split the n wheels into centred wheel-<k> parts that spin on their own axle
  --smooth-angle <deg>   creases sharper than this stay sharp when the shading is smoothed (default 40)
  --no-smooth            keep Meshy's normals as they are (the clean-up welds and smooths them by default)
  --cleanup <mode>       auto | generic | bushleague-player | bushleague-prop | none (default auto: generic when Blender is installed)
  --max-credits <n>      refuse to start above this estimate (default MESHY_MAX_CREDITS or 150)
  --dry-run              print the plan and estimate, spend nothing
  --fresh                ignore an earlier run with the same --name and start over
  --list-animations      print Meshy's animation library and the short names this script knows`

const fail = (message) => {
  console.error(`meshy-generate: ${message}`)
  process.exit(1)
}

const { values: opt } = parseArgs({
  options: {
    prompt: { type: 'string' }, name: { type: 'string' }, out: { type: 'string' }, target: { type: 'string', default: 'furniture' },
    negative: { type: 'string' }, 'ai-model': { type: 'string', default: 'latest' }, polycount: { type: 'string' }, 'texture-prompt': { type: 'string' },
    rig: { type: 'boolean', default: false }, height: { type: 'string' }, animate: { type: 'string' }, size: { type: 'string' },
    'max-tris': { type: 'string' }, wheels: { type: 'string' }, 'smooth-angle': { type: 'string' }, 'no-smooth': { type: 'boolean' }, lods: { type: 'string' }, cleanup: { type: 'string', default: 'auto' }, 'max-credits': { type: 'string' },
    'dry-run': { type: 'boolean', default: false }, fresh: { type: 'boolean', default: false }, 'list-animations': { type: 'boolean', default: false },
    help: { type: 'boolean', short: 'h', default: false },
  },
  strict: true,
})

if (opt.help) {
  console.log(USAGE)
  process.exit(0)
}

const KEY = process.env.MESHY_API_KEY?.trim()

async function meshy(path, init = {}) {
  if (!KEY) fail('MESHY_API_KEY is not set. For site changes add it as a GitHub repository secret (Settings → Secrets and variables → Actions).')
  let response
  for (let attempt = 0; ; attempt++) {
    try {
      response = await fetch(`${API}${path}`, {
        method: init.method ?? 'GET',
        headers: { Authorization: `Bearer ${KEY}`, ...(init.body ? { 'Content-Type': 'application/json' } : {}) },
        body: init.body ? JSON.stringify(init.body) : undefined,
      })
    } catch (error) {
      if (attempt < 4) { await sleep(3000 * (attempt + 1)); continue }
      fail(`couldn't reach Meshy (${error.message}).`)
    }
    if ((response.status === 429 || response.status >= 500) && attempt < 4) { await sleep(5000 * (attempt + 1)); continue }
    break
  }
  const text = await response.text()
  if (!response.ok) {
    const why = { 401: 'Meshy rejected the API key.', 402: 'not enough Meshy credits (or the plan does not allow this task).', 403: 'Meshy refused this model for that task.', 404: 'Meshy no longer has that task.' }[response.status]
    let detail = ''
    try { detail = JSON.parse(text).message ?? '' } catch {}
    fail(`${init.method ?? 'GET'} ${path.replace(/\/[\w-]{16,}$/, '/<id>')} → ${response.status}. ${why ?? ''} ${detail}`.trim())
  }
  return text ? JSON.parse(text) : {}
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

async function library() {
  try {
    const data = await meshy('/v1/animations/library')
    const list = Array.isArray(data) ? data : data.result ?? data.data ?? data.animations ?? []
    const map = new Map()
    for (const item of list) {
      const id = item.action_id ?? item.id
      const name = item.name ?? item.action_name
      if (Number.isInteger(id) && name) map.set(id, { name, category: item.category ?? '' })
    }
    if (map.size) return map
  } catch {}
  return new Map(Object.values(CLIPS).map(([id, name]) => [id, { name, category: '' }]))
}

if (opt['list-animations']) {
  const lib = KEY ? await library() : new Map(Object.values(CLIPS).map(([id, name]) => [id, { name, category: '' }]))
  const short = Object.fromEntries(Object.entries(CLIPS).map(([alias, [id]]) => [id, alias]))
  for (const [id, { name, category }] of [...lib].sort((a, b) => a[0] - b[0])) console.log(`${String(id).padStart(4)}  ${name.padEnd(32)} ${category.padEnd(14)} ${short[id] ? `--animate ${short[id]}` : ''}`)
  process.exit(0)
}

if (!opt.prompt || opt.prompt.trim().length < 3) fail('--prompt is required (3–600 characters).\n\n' + USAGE)
if (opt.prompt.length > 600) fail('--prompt is longer than 600 characters.')
if (!opt.name || !/^[a-z0-9][a-z0-9_-]{0,47}$/.test(opt.name)) fail('--name must be lowercase letters, numbers, - or _ (it becomes the file name).')
if (!opt.out) fail('--out is required, e.g. assets-src/models/maplestreet/furniture.')
const outDir = resolve(repoRoot, opt.out)
if (!(outDir + sep).startsWith(modelsRoot + sep)) fail('--out must be inside assets-src/models/ so `pnpm assets` optimises the model.')
if (!TARGETS.includes(opt.target)) fail(`--target must be one of ${TARGETS.join(', ')}.`)
if (!(opt['ai-model'] in COSTS.preview)) fail('--ai-model must be latest, meshy-6 or meshy-6-lite.')
const num = (flag, min, max) => {
  if (opt[flag] === undefined) return undefined
  const n = Number(opt[flag])
  if (!Number.isFinite(n) || n < min || n > max) fail(`--${flag} must be a number from ${min} to ${max}.`)
  return n
}
const polycount = Math.round(num('polycount', 500, 300000) ?? POLYCOUNT[opt.target])
const sizeM = num('size', 0.05, 200)
const maxTris = num('max-tris', 200, 1000000)
const wheelCount = num('wheels', 1, 12)
const smoothAngle = num('smooth-angle', 1, 180)
const maxCredits = Number(opt['max-credits'] ?? process.env.MESHY_MAX_CREDITS ?? 150)
const lods = opt.lods ? opt.lods.split(',').map((n) => Math.round(Number(n.trim()))) : []
if (lods.some((n) => !Number.isFinite(n) || n < 100)) fail('--lods must be triangle counts like 15000,5000,1500.')
const clipWords = opt.animate ? opt.animate.split(',').map((s) => s.trim().toLowerCase()).filter(Boolean) : []
if (clipWords.length > 10) fail('Meshy animates at most 10 clips per task.')
const rig = opt.rig || clipWords.length > 0
const heightM = num('height', 0.3, 4) ?? (rig ? 1.75 : undefined)
if (rig && !HUMANOID.has(opt.target)) fail('Meshy only rigs humanoid (two-legged) characters: use --target character or ballplayer, or animate this model in code instead.')
if (sizeM && heightM && !rig) fail('Use --size or --height, not both.')

const clips = clipWords.map((word) => {
  if (/^\d+$/.test(word)) return { id: Number(word), label: null }
  if (!CLIPS[word]) fail(`unknown clip "${word}". Use a Meshy action id or one of: ${Object.keys(CLIPS).join(', ')} (see --list-animations).`)
  return { id: CLIPS[word][0], label: word }
})
if (new Set(clips.map((c) => c.id)).size !== clips.length) fail('--animate lists the same clip twice.')

const statePath = join(outDir, `${opt.name}.meshy.json`)
const settings = {
  prompt: opt.prompt.trim(), target: opt.target, negative: opt.negative ?? NEGATIVE[opt.target], aiModel: opt['ai-model'], polycount,
  texturePrompt: opt['texture-prompt'] ?? '', rig, height: heightM ?? null,
}
let state = existsSync(statePath) && !opt.fresh ? JSON.parse(readFileSync(statePath, 'utf8')) : null
if (state && JSON.stringify(state.settings) !== JSON.stringify(settings)) {
  fail(`${relative(repoRoot, statePath)} was made with different settings. Pick another --name, or pass --fresh to replace it (the old Meshy tasks are not refunded).`)
}
state ??= { version: 1, settings, tasks: {}, credits: 0, files: [], createdAt: new Date().toISOString() }
const save = () => {
  mkdirSync(outDir, { recursive: true })
  writeFileSync(statePath, JSON.stringify(state, null, 2) + '\n')
}

const done = (key) => state.tasks[key]?.status === 'SUCCEEDED'
const animKey = clips.length ? `animate:${clips.map((c) => c.id).join(',')}` : null
const plan = [
  ['preview', COSTS.preview[settings.aiModel]],
  ['refine', COSTS.refine],
  ...(rig ? [['rig', COSTS.rig]] : []),
  ...(animKey ? [[animKey, COSTS.animation * clips.length]] : []),
]
const estimate = plan.reduce((sum, [key, cost]) => sum + (done(key) ? 0 : cost), 0)

console.log(`Plan for ${relative(repoRoot, join(outDir, opt.name))}.glb: ${plan.map(([key]) => key.split(':')[0] + (done(key) ? ' (done)' : '')).join(' → ')}; about ${estimate} Meshy credits.`)
if (estimate > maxCredits) fail(`the estimate (${estimate}) is over the ${maxCredits}-credit limit. Raise --max-credits (or the MESHY_MAX_CREDITS variable) if this is intended.`)
if (opt['dry-run']) process.exit(0)

if (estimate > 0) {
  const { balance } = await meshy('/v1/balance')
  if (typeof balance === 'number' && balance < estimate) fail(`Meshy has ${balance} credits and this needs about ${estimate}.`)
}

const PATHS = { preview: '/v2/text-to-3d', refine: '/v2/text-to-3d', rig: '/v1/rigging', animate: '/v1/animations' }

/** Starts a task (or reuses the saved one) and waits for it to finish. */
async function task(key, body) {
  const path = PATHS[key.split(':')[0]]
  let saved = state.tasks[key]
  if (!saved || saved.status === 'FAILED' || saved.status === 'CANCELED') {
    const { result } = await meshy(path, { method: 'POST', body })
    if (!result) fail(`Meshy didn't return a task id for ${key}.`)
    saved = state.tasks[key] = { id: result, status: 'PENDING', startedAt: new Date().toISOString() }
    save()
    console.log(`• ${key}: started task ${result}`)
  } else {
    console.log(`• ${key}: ${saved.status === 'SUCCEEDED' ? 'already done' : 'resuming'} task ${saved.id}`)
  }
  const deadline = Date.now() + TASK_TIMEOUT_MS
  let shown = -1
  while (true) {
    const info = await meshy(`${path}/${encodeURIComponent(saved.id)}`)
    if (info.status === 'SUCCEEDED') {
      if (saved.status !== 'SUCCEEDED') {
        saved.status = 'SUCCEEDED'
        saved.credits = info.consumed_credits ?? null
        state.credits += typeof info.consumed_credits === 'number' ? info.consumed_credits : 0
        save()
      }
      console.log(`• ${key}: done`)
      return info
    }
    if (info.status === 'FAILED' || info.status === 'CANCELED') {
      saved.status = info.status
      save()
      fail(`Meshy ${info.status === 'FAILED' ? 'failed' : 'cancelled'} the ${key} step${info.task_error?.message ? `: ${info.task_error.message}` : ''}. Meshy refunds failed tasks; run the same command again to retry, or change the prompt.`)
    }
    const progress = Math.round(info.progress ?? 0)
    if (progress >= shown + 20) {
      console.log(`  ${key}: ${info.status === 'PENDING' ? 'queued' : `${progress}%`}`)
      shown = progress
    }
    if (Date.now() > deadline) fail(`the ${key} step is still running after ${TASK_TIMEOUT_MS / 60000} minutes. Run the same command again later to pick it up.`)
    await sleep(POLL_MS)
  }
}

async function download(url, file) {
  if (!url) fail(`Meshy didn't return a .glb for ${relative(repoRoot, file)}.`)
  const response = await fetch(url)
  if (!response.ok) fail(`downloading the model failed (${response.status}).`)
  const bytes = Buffer.from(await response.arrayBuffer())
  if (bytes.subarray(0, 4).toString('latin1') !== 'glTF') fail('Meshy returned something that is not a .glb file.')
  writeFileSync(file, bytes)
  return bytes.length
}

const preview = await task('preview', {
  mode: 'preview', prompt: settings.prompt, negative_prompt: settings.negative || undefined, ai_model: settings.aiModel,
  topology: 'triangle', target_polycount: polycount, should_remesh: true, origin_at: 'bottom', moderation: true,
})
const refined = await task('refine', {
  mode: 'refine', preview_task_id: preview.id, texture_prompt: settings.texturePrompt || undefined, enable_pbr: true, remove_lighting: true,
})
const cache = join(cacheRoot, opt.name)
mkdirSync(cache, { recursive: true })
let source = join(cache, 'refined.glb')
await download(refined.model_urls?.glb, source)

let clipNames = []
if (rig) {
  const rigged = await task('rig', { input_task_id: refined.id, height_meters: heightM })
  source = join(cache, 'rigged.glb')
  await download(rigged.result?.rigged_character_glb_url, source)
  if (animKey) {
    const lib = await library()
    clipNames = clips.map((c) => {
      const name = lib.get(c.id)?.name ?? Object.values(CLIPS).find(([id]) => id === c.id)?.[1] ?? `Action_${c.id}`
      return { id: c.id, meshyName: name, label: c.label ?? name.toLowerCase() }
    })
    const animated = await task(animKey, { rig_task_id: rigged.id, action_ids: clips.map((c) => c.id) })
    source = join(cache, 'animated.glb')
    await download(animated.result?.animation_glb_url, source)
  }
}

function findBlender() {
  const candidates = [process.env.BLENDER, 'blender', join(homedir(), 'blender', 'blender'), join(homedir(), '.local', 'bin', 'blender')].filter(Boolean)
  for (const bin of candidates) {
    const probe = spawnSync(bin, ['--version'], { encoding: 'utf8', timeout: 60000 })
    if (probe.status === 0) return { bin, version: (probe.stdout.match(/Blender\s+([\d.]+)/) ?? [])[1] ?? '?' }
  }
  return null
}

const blender = opt.cleanup === 'none' ? null : findBlender()
let mode = opt.cleanup
if (mode === 'auto') {
  const inBushLeague = relative(modelsRoot, outDir).split(sep)[0] === 'bushleague'
  mode = !blender ? 'none' : inBushLeague ? (rig ? 'bushleague-player' : 'bushleague-prop') : 'generic'
}
if (!['generic', 'bushleague-player', 'bushleague-prop', 'none'].includes(mode)) fail('--cleanup must be auto, generic, bushleague-player, bushleague-prop or none.')
if (mode !== 'none' && !blender) fail(`--cleanup ${mode} needs Blender. Install it (scripts/laptop-runner/setup.sh does) or set BLENDER to its path.`)

mkdirSync(outDir, { recursive: true })
for (const old of readdirSync(outDir).filter((f) => f === `${opt.name}.glb` || new RegExp(`^${opt.name}-lod\\d+\\.glb$`).test(f))) rmSync(join(outDir, old))
const warnings = []
let used = mode
if (mode === 'generic') {
  const args = ['-b', '--factory-startup', '-P', join(repoRoot, 'scripts', 'blender', 'meshy-cleanup.py'), '--', '--input', source, '--out', outDir, '--name', opt.name]
  if (heightM) args.push('--height', String(heightM))
  if (sizeM) args.push('--size', String(sizeM))
  if (maxTris) args.push('--max-tris', String(maxTris))
  if (lods.length) args.push('--lods', lods.join(','))
  if (wheelCount) args.push('--wheels', String(Math.round(wheelCount)))
  if (smoothAngle) args.push('--smooth-angle', String(smoothAngle))
  if (opt['no-smooth']) args.push('--no-smooth')
  if (clipNames.length) args.push('--clips', clipNames.map((c) => `${c.meshyName}=${c.label}`).join(','))
  const run = spawnSync(blender.bin, args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], timeout: 20 * 60 * 1000 })
  const log = `${run.stdout ?? ''}\n${run.stderr ?? ''}`
  for (const line of log.split('\n')) if (line.startsWith('meshy-cleanup:')) console.log(`  ${line}`)
  if (run.status !== 0) {
    warnings.push(`Blender clean-up failed, so the raw Meshy model was used:\n${log.trim().split('\n').slice(-12).join('\n')}`)
    used = 'none'
  }
} else if (mode.startsWith('bushleague-')) {
  const kind = mode === 'bushleague-player' ? 'player' : 'prop'
  const args = ['-b', '--factory-startup', '-P', join(repoRoot, 'scripts', 'blender', 'bushleague', 'cleanup.py'), '--', '--input', source, '--name', opt.name, '--kind', kind, '--out', outDir]
  const run = spawnSync(blender.bin, args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], timeout: 30 * 60 * 1000 })
  if (run.status !== 0) {
    warnings.push(`Bush League clean-up failed, so the raw Meshy model was used:\n${`${run.stdout}\n${run.stderr}`.trim().split('\n').slice(-12).join('\n')}`)
    used = 'none'
  }
}
if (used === 'none') {
  copyFileSync(source, join(outDir, `${opt.name}.glb`))
  if (!blender && opt.cleanup === 'auto') warnings.push('Blender is not installed here, so the model was not grounded, sized or decimated. Size and place it in code, or run this on the laptop runner.')
  if (sizeM || maxTris || lods.length || (heightM && !rig)) warnings.push('--size, --height, --max-tris and --lods need the Blender clean-up; they were not applied.')
}

/** Names each clip by its short label (idle, walk …) so modules can find them; Blender may have done it already. */
async function renameClips(paths) {
  if (!clipNames.length) return []
  const { NodeIO } = await import('@gltf-transform/core')
  const { ALL_EXTENSIONS } = await import('@gltf-transform/extensions')
  const io = new NodeIO().registerExtensions(ALL_EXTENSIONS)
  const found = new Set()
  const squash = (text) => text.toLowerCase().replace(/[^a-z0-9]/g, '')
  for (const path of paths) {
    const doc = await io.read(path)
    let changed = false
    for (const animation of doc.getRoot().listAnimations()) {
      const name = squash(animation.getName())
      const clip = clipNames.find((c) => squash(c.label) === name) ?? clipNames.find((c) => name.includes(squash(c.meshyName)))
      if (!clip) continue
      found.add(clip.label)
      if (animation.getName() !== clip.label) { animation.setName(clip.label); changed = true }
    }
    if (changed) await io.write(path, doc)
  }
  const missing = clipNames.filter((c) => !found.has(c.label)).map((c) => c.meshyName)
  if (missing.length) warnings.push(`These clips weren't found by name in the model, so check its animation list: ${missing.join(', ')}.`)
  return [...found]
}

const outFiles = () => readdirSync(outDir).filter((f) => f.endsWith('.glb') && (f === `${opt.name}.glb` || new RegExp(`^${opt.name}-lod\\d+\\.glb$`).test(f))).sort()
const clipLabels = await renameClips(outFiles().map((f) => join(outDir, f)))

const files = outFiles()
state.files = files.map((f) => relative(repoRoot, join(outDir, f)).split(sep).join('/'))
state.clips = clipNames
state.cleanup = used === 'none' ? 'none' : `${used} (Blender ${blender.version})`
state.updatedAt = new Date().toISOString()
save()

const summary = {
  name: opt.name,
  files: state.files,
  optimisedFiles: state.files.map((f) => f.replace(/^assets-src\/models\//, 'public/models/')),
  clips: clipLabels,
  rigged: rig,
  cleanup: state.cleanup,
  creditsSpent: state.credits,
  warnings,
  next: 'Run `pnpm assets`, then load the public/models/ file in the module (commit assets-src/models/ and public/models/ together).',
}
console.log('\nRESULT ' + JSON.stringify(summary, null, 2))
