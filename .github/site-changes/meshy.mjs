// Meshy text-to-3D for site-change runs, through the live site's /api/meshy, so it uses the site's
// own MESHY_API_KEY (the same key as the admin car, vehicle and ride generators) and every model also
// shows up in the admin Meshy panel. run.mjs sets SITE_URL and SITE_MESHY_TOKEN, a pass that only
// works while this site-change run is going.
//
//   node .github/site-changes/meshy.mjs balance
//   node .github/site-changes/meshy.mjs generate "<prompt>" --out assets-src/models/<module>/<name>.glb
//        [--target furniture|character|vehicle|...] [--polycount 30000] [--preview] [--texture "<texture prompt>"]
//   node .github/site-changes/meshy.mjs animations "<words>"        search Meshy's animation library
//   node .github/site-changes/meshy.mjs rig <jobId> --out rigged.glb [--height 1.8]
//   node .github/site-changes/meshy.mjs animate <rigJobId> --action <actionId> --out clip.glb [--label "Walk"]
//
// generate makes a preview mesh, then (unless --preview) a PBR-textured refine of it, waits for both
// and downloads the finished .glb to --out. Every command that makes a model prints `job <id>`, which
// rig (textured humanoid or creature, generated with --target character) and animate take next.
import { mkdirSync, writeFileSync } from 'node:fs'
import { dirname } from 'node:path'

const POLL_MS = 8_000
const LIMIT_MS = 20 * 60_000

function arg(name, fallback) {
  const index = process.argv.indexOf(`--${name}`)
  return index === -1 ? fallback : process.argv[index + 1]
}

function fail(message) {
  console.error(`meshy: ${message}`)
  process.exit(1)
}

async function call(query, body) {
  const site = process.env.SITE_URL
  const token = process.env.SITE_MESHY_TOKEN
  if (!site || !token) fail('this only works inside a site-change run (SITE_URL and SITE_MESHY_TOKEN are missing).')
  const response = await fetch(`${site}/api/meshy${query}`, {
    method: body ? 'POST' : 'GET',
    headers: { Authorization: `Bearer ${token}`, ...(body ? { 'Content-Type': 'application/json' } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  })
  if (response.status === 401 || response.status === 403) fail('the site refused the Meshy pass (the run may have ended).')
  const type = response.headers.get('content-type') ?? ''
  if (!response.ok) {
    const detail = type.includes('json') ? (await response.json().catch(() => ({}))).error : ''
    fail(`the site answered ${response.status}${detail ? `: ${detail}` : ''}`)
  }
  return type.includes('json') ? response.json() : Buffer.from(await response.arrayBuffer())
}

async function balance() {
  const status = await call('?status')
  if (!status.connected) fail('Meshy is not connected on the site (MESHY_API_KEY in Cloudflare).')
  return status.balance
}

async function wait(id, label) {
  const started = Date.now()
  let last = -1
  while (Date.now() - started < LIMIT_MS) {
    const { jobs } = await call('')
    const job = jobs.find((item) => item.id === id)
    if (!job) fail(`${label} job ${id} disappeared.`)
    if (job.progress !== last) {
      console.log(`${label}: ${job.status} ${job.progress ?? 0}%`)
      last = job.progress
    }
    if (job.status === 'SUCCEEDED') return job
    if (job.status === 'FAILED' || job.status === 'CANCELED') fail(`${label} ${job.status.toLowerCase()}${job.error ? `: ${job.error}` : ''}`)
    await new Promise((resolve) => setTimeout(resolve, POLL_MS))
  }
  fail(`${label} did not finish within ${LIMIT_MS / 60_000} minutes (job ${id}).`)
}

async function generate() {
  const prompt = process.argv[3]
  const out = arg('out')
  if (!prompt || prompt.startsWith('--')) fail('give a prompt: generate "<prompt>" --out path.glb')
  if (!out || !out.endsWith('.glb')) fail('give --out path/to/model.glb')
  const polycount = Number(arg('polycount', '30000'))
  const preview = await call('', { action: 'text', target: arg('target', 'furniture'), prompt, polycount, count: 1 })
  let id = preview.ids[0]
  console.log(`preview job ${id}`)
  await wait(id, 'preview')
  if (!process.argv.includes('--preview')) {
    const refine = await call('', { action: 'refine', jobId: id, texturePrompt: arg('texture', '') })
    id = refine.ids[0]
    console.log(`refine job ${id}`)
    await wait(id, 'refine')
  }
  await save(id, out)
}

async function save(id, out) {
  const bytes = await call(`?model=${id}`)
  mkdirSync(dirname(out), { recursive: true })
  writeFileSync(out, bytes)
  console.log(`job ${id}`)
  console.log(`saved ${out} (${(bytes.length / 1024).toFixed(0)} KB); ${await balance()} credits left`)
}

function outPath() {
  const out = arg('out')
  if (!out || !out.endsWith('.glb')) fail('give --out path/to/model.glb')
  return out
}

async function animations() {
  const words = process.argv.slice(3).filter((word) => !word.startsWith('--')).join(' ')
  const { animations: found } = await call(`?animations=${encodeURIComponent(words)}`)
  if (!found.length) fail(`no animation matches "${words}"; try fewer or broader words.`)
  for (const entry of found) console.log(`${String(entry.actionId).padStart(4)}  ${entry.name}  (${entry.category})`)
}

async function rig() {
  const jobId = process.argv[3]
  if (!jobId || jobId.startsWith('--')) fail('give the finished, textured job id: rig <jobId> --out rigged.glb')
  const out = outPath()
  const { ids } = await call('', { action: 'rig', jobId, height: Number(arg('height', '1.8')) })
  console.log(`rig job ${ids[0]}`)
  await wait(ids[0], 'rig')
  await save(ids[0], out)
}

async function animate() {
  const jobId = process.argv[3]
  const action = Number(arg('action'))
  if (!jobId || jobId.startsWith('--')) fail('give the finished rig job id: animate <rigJobId> --action <id> --out clip.glb')
  if (!Number.isInteger(action) || action < 0) fail('give --action with an id from: node .github/site-changes/meshy.mjs animations "<words>"')
  const out = outPath()
  const { ids } = await call('', { action: 'animate', jobId, actionId: action, label: arg('label', `Action ${action}`) })
  console.log(`animate job ${ids[0]}`)
  await wait(ids[0], 'animate')
  await save(ids[0], out)
}

const command = process.argv[2]
if (command === 'balance') console.log(`${await balance()} credits`)
else if (command === 'generate') await generate()
else if (command === 'animations') await animations()
else if (command === 'rig') await rig()
else if (command === 'animate') await animate()
else fail('usage: balance | generate "<prompt>" --out path.glb [--target T] [--polycount N] [--preview] [--texture "..."] | animations "<words>" | rig <jobId> --out path.glb [--height M] | animate <rigJobId> --action <id> --out path.glb [--label "..."]')
