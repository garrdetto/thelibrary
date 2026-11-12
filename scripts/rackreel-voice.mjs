/**
 * Records Wisco Wild Man: every line in modules-src/rackreel/systems/Voice.ts is read aloud and written to
 * public/modules/rackreel/voice/, with manifest.json mapping clip ids to files for game/WildVoice.ts.
 * Clips that already exist are kept unless --force is given; a full run (no --only) drops clips whose lines are gone.
 *
 *   node scripts/rackreel-voice.mjs [--provider elevenlabs|gemini] [--force] [--only line-board,cheer-sendIt] [--voice <name or id>] [--model <id>]
 *                                   [--takes <n>] [--match-deps <folder>] [--check]
 *
 * ElevenLabs (ELEVENLABS_API_KEY): the default when its key is set. `--voice` is a voice id (default WMNqbmDbWYAXCWtmTvj5, the
 * owner's "Wild Man2" instant clone) or a voice name from the account's voice library (the part before " - " is enough; a
 * cloned voice wins over others of the same name, since the account also has an untrained professional voice called
 * "Wild Man2"). `--model` defaults to eleven_v4, which keeps a cloned voice's identity on short, shouted lines; eleven_v3
 * drifted off it on most takes and read them in a different, higher voice. Both read the audio tags in each clip's `spoken`
 * text (VOICE_TAGS, or the line's own tags in SPOKEN). v4 is read at stability 0.07 and similarity 0.75, the settings the
 * owner tuned by ear in the ElevenLabs app. Clips come back as 64 kbit/s MP3 and are stored as-is.
 *
 * `--takes <n>` records each line n times and keeps the take closest to the voice's own reference samples (leaving out
 * takes much longer or shorter than the others), with up to n more tries when none is close enough. `--check` records
 * nothing: it scores the clips already in the manifest the same way and exits 1 when any is too far from the voice. Both
 * use scripts/rackreel-voice-match.mjs, which needs the packages in `--match-deps <folder>` or RACKREEL_VOICE_DEPS (see
 * that file). Record new or changed lines with --takes 3.
 *
 * Gemini (GEMINI_API_KEY): `--voice` is a prebuilt voice (default Fenrir), `--model` a TTS model (default
 * gemini-2.5-flash-preview-tts); the VOICE_STYLE brief is sent with each line. Gemini returns 24 kHz 16-bit mono PCM;
 * with ffmpeg on the PATH the clips are stored as 48 kbit/s Opus in .ogg, otherwise as .wav.
 */
import { build } from 'esbuild'
import { spawnSync } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { MIN_MATCH, createMatcher } from './rackreel-voice-match.mjs'

const root = resolve(import.meta.dirname, '..')
const outDir = join(root, 'public/modules/rackreel/voice')
const args = process.argv.slice(2)
const flag = (name) => {
  const i = args.indexOf(name)
  return i >= 0 ? args[i + 1] : undefined
}
const force = args.includes('--force')
const check = args.includes('--check')
const only = flag('--only')?.split(',').filter(Boolean)
const takes = Math.max(1, Math.floor(Number(flag('--takes') ?? 1)) || 1)
const matchDeps = flag('--match-deps') ?? process.env.RACKREEL_VOICE_DEPS
const elevenKey = process.env.ELEVENLABS_API_KEY
const geminiKey = process.env.GEMINI_API_KEY
const provider = flag('--provider') ?? (elevenKey ? 'elevenlabs' : 'gemini')
if (provider !== 'elevenlabs' && provider !== 'gemini') {
  console.error(`Unknown provider "${provider}"; use elevenlabs or gemini.`)
  process.exit(2)
}
const key = provider === 'elevenlabs' ? elevenKey : geminiKey
if (!key) {
  console.error(`${provider === 'elevenlabs' ? 'ELEVENLABS_API_KEY' : 'GEMINI_API_KEY'} is not set; nothing recorded.`)
  process.exit(2)
}
const matching = check || takes > 1
if (matching && provider !== 'elevenlabs') {
  console.error('--takes and --check compare clips with an ElevenLabs voice; use --provider elevenlabs.')
  process.exit(2)
}
if (matching && !matchDeps) {
  console.error('--takes and --check need --match-deps <folder> (or RACKREEL_VOICE_DEPS); see scripts/rackreel-voice-match.mjs.')
  process.exit(2)
}
const voiceName = flag('--voice') ?? (provider === 'elevenlabs' ? 'WMNqbmDbWYAXCWtmTvj5' : 'Fenrir')
const model = flag('--model') ?? (provider === 'elevenlabs' ? 'eleven_v4' : 'gemini-2.5-flash-preview-tts')

const tmp = mkdtempSync(join(tmpdir(), 'rackreel-voice-'))
let lines
try {
  await build({ entryPoints: [join(root, 'modules-src/rackreel/systems/Voice.ts')], bundle: true, platform: 'node', format: 'esm', outfile: join(tmp, 'voice.mjs'), logLevel: 'warning' })
  lines = await import('file://' + join(tmp, 'voice.mjs').replace(/\\/g, '/'))
} finally {
  rmSync(tmp, { recursive: true, force: true })
}
const clips = lines.voiceClips().filter((c) => !only || only.includes(c.id))
const style = lines.VOICE_STYLE

const hasFfmpeg = provider === 'gemini' && spawnSync('ffmpeg', ['-version'], { stdio: 'ignore' }).status === 0
const ext = provider === 'elevenlabs' ? 'mp3' : hasFfmpeg ? 'ogg' : 'wav'
mkdirSync(outDir, { recursive: true })
const manifestPath = join(outDir, 'manifest.json')
const manifest = existsSync(manifestPath) ? JSON.parse(readFileSync(manifestPath, 'utf8')) : {}
const pause = (ms) => new Promise((r) => setTimeout(r, ms))

async function retrying(label, send) {
  for (let attempt = 0; attempt < 5; attempt++) {
    const res = await send()
    if (res.status === 429 || res.status >= 500) {
      const wait = 3000 * (attempt + 1)
      console.log(`  ${res.status} from ${label}, retrying in ${wait / 1000}s`)
      await pause(wait)
      continue
    }
    if (!res.ok) throw new Error(`${label} ${res.status}: ${(await res.text()).slice(0, 300)}`)
    return res
  }
  throw new Error(`${label} kept rate-limiting`)
}

let voiceId
async function resolveVoice() {
  if (/^[A-Za-z0-9]{20,}$/.test(voiceName)) return voiceName
  const res = await retrying('ElevenLabs', () => fetch('https://api.elevenlabs.io/v1/voices', { headers: { 'xi-api-key': key } }))
  const { voices = [] } = await res.json()
  const want = voiceName.toLowerCase()
  const named = voices.filter((v) => v.name?.toLowerCase() === want)
  const short = voices.filter((v) => v.name?.toLowerCase().split(' - ')[0].trim() === want)
  const hits = named.length ? named : short
  const hit = hits.find((v) => v.category === 'cloned') ?? hits[0]
  if (!hit) {
    const names = voices.map((v) => v.name).filter(Boolean).sort().join(', ')
    throw new Error(`No voice named "${voiceName}" in this account. Available: ${names || 'none'}. Pass --voice <name> or a voice id.`)
  }
  return hit.voice_id
}

function elevenSettings() {
  if (model.startsWith('eleven_v4')) return { stability: 0.07, similarity_boost: 0.75 }
  if (model.startsWith('eleven_v3')) return { stability: 0.0, use_speaker_boost: true }
  return { stability: 0.35, similarity_boost: 0.8, style: 0.6, use_speaker_boost: true }
}

async function synthesizeEleven(text, spoken) {
  voiceId ??= await resolveVoice()
  const url = `https://api.elevenlabs.io/v1/text-to-speech/${voiceId}?output_format=mp3_44100_64`
  const body = { text: /^eleven_v[34]/.test(model) ? spoken : text, model_id: model, voice_settings: elevenSettings() }
  const res = await retrying('ElevenLabs', () => fetch(url, { method: 'POST', headers: { 'content-type': 'application/json', 'xi-api-key': key }, body: JSON.stringify(body) }))
  return { bytes: Buffer.from(await res.arrayBuffer()) }
}

let matcher
async function voiceMatcher() {
  if (matcher) return matcher
  voiceId ??= await resolveVoice()
  matcher = await createMatcher({ depsDir: matchDeps, key, voiceId })
  console.log(`Comparing with ${matcher.pieces} pieces of the "${matcher.voiceName}" reference samples.`)
  return matcher
}

/** The take closest to the voice among those of an ordinary length (a take that runs long or short added or lost words). */
function closest(tried) {
  const lengths = tried.map((t) => t.seconds).sort((a, b) => a - b)
  const middle = lengths[Math.floor((lengths.length - 1) / 2)]
  return tried.filter((t) => t.seconds >= middle * 0.7 && t.seconds <= middle * 1.4).reduce((a, b) => (b.match > a.match ? b : a))
}

async function bestTake(clip) {
  const match = await voiceMatcher()
  const tried = []
  while (tried.length < takes || (tried.length < takes * 2 && closest(tried).match < MIN_MATCH)) {
    const take = await synthesizeEleven(clip.text, clip.spoken)
    tried.push({ take, ...(await match.score(take.bytes)) })
    await pause(400)
  }
  const kept = closest(tried)
  console.log(`  takes ${tried.map((t) => t.match.toFixed(2)).join(' ')}, kept ${kept.match.toFixed(2)}`)
  return kept
}

function wav(pcm, rate = 24000) {
  const header = Buffer.alloc(44)
  header.write('RIFF', 0)
  header.writeUInt32LE(36 + pcm.length, 4)
  header.write('WAVE', 8)
  header.write('fmt ', 12)
  header.writeUInt32LE(16, 16)
  header.writeUInt16LE(1, 20)
  header.writeUInt16LE(1, 22)
  header.writeUInt32LE(rate, 24)
  header.writeUInt32LE(rate * 2, 28)
  header.writeUInt16LE(2, 32)
  header.writeUInt16LE(16, 34)
  header.write('data', 36)
  header.writeUInt32LE(pcm.length, 40)
  return Buffer.concat([header, pcm])
}

async function synthesizeGemini(text) {
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`
  const body = {
    contents: [{ parts: [{ text: `${style}\n\nSay exactly this, nothing else:\n${text}` }] }],
    generationConfig: { responseModalities: ['AUDIO'], speechConfig: { voiceConfig: { prebuiltVoiceConfig: { voiceName } } } },
  }
  const res = await retrying('Gemini', () => fetch(url, { method: 'POST', headers: { 'content-type': 'application/json', 'x-goog-api-key': key }, body: JSON.stringify(body) }))
  const json = await res.json()
  const part = json.candidates?.[0]?.content?.parts?.find((p) => p.inlineData)
  if (!part) throw new Error('no audio in the response')
  const rate = Number(/rate=(\d+)/.exec(part.inlineData.mimeType ?? '')?.[1] ?? 24000)
  const pcm = Buffer.from(part.inlineData.data, 'base64')
  if (!hasFfmpeg) return { bytes: wav(pcm, rate) }
  return { pcm, rate }
}

function store(id, { bytes, pcm, rate }) {
  const file = `${id}.${ext}`
  const target = join(outDir, file)
  if (bytes) {
    writeFileSync(target, bytes)
    return file
  }
  const run = spawnSync('ffmpeg', ['-y', '-loglevel', 'error', '-f', 's16le', '-ar', String(rate), '-ac', '1', '-i', 'pipe:0', '-c:a', 'libopus', '-b:a', '48k', '-application', 'voip', target], { input: pcm })
  if (run.status !== 0) throw new Error(`ffmpeg failed for ${id}: ${run.stderr}`)
  return file
}

function report(scores, heading) {
  const low = scores.filter((s) => s.match < MIN_MATCH).sort((a, b) => a.match - b.match)
  const mean = scores.reduce((sum, s) => sum + s.match, 0) / Math.max(1, scores.length)
  console.log(`${heading}: ${scores.length} clip${scores.length === 1 ? '' : 's'}, mean match ${mean.toFixed(2)}, ${low.length} below ${MIN_MATCH}${low.length ? ` (${low.map((s) => `${s.id} ${s.match.toFixed(2)}`).join(', ')})` : ''}.`)
  return low.length
}

if (check) {
  const match = await voiceMatcher()
  const scores = []
  for (const clip of clips) {
    const file = manifest[clip.id]
    if (!file || !existsSync(join(outDir, file))) continue
    scores.push({ id: clip.id, ...(await match.score(readFileSync(join(outDir, file)))) })
  }
  for (const s of [...scores].sort((a, b) => a.match - b.match)) console.log(`${s.match.toFixed(2)}  ${s.seconds.toFixed(1).padStart(4)}s  ${s.id}`)
  process.exit(report(scores, `Checked against "${match.voiceName}"`) ? 1 : 0)
}

const kept = []
let made = 0
for (const clip of clips) {
  const have = manifest[clip.id]
  if (!force && have && existsSync(join(outDir, have))) continue
  console.log(`${clip.id}: ${clip.text}`)
  let take
  if (takes > 1) {
    const best = await bestTake(clip)
    kept.push({ id: clip.id, match: best.match })
    take = best.take
  } else take = await (provider === 'elevenlabs' ? synthesizeEleven(clip.text, clip.spoken) : synthesizeGemini(clip.text))
  const file = store(clip.id, take)
  if (have && have !== file && existsSync(join(outDir, have))) rmSync(join(outDir, have))
  manifest[clip.id] = file
  made++
  writeFileSync(manifestPath, JSON.stringify(manifest, null, 2) + '\n')
  await pause(400)
}
if (!only) {
  const keep = new Set(lines.voiceClips().map((c) => c.id))
  for (const [id, file] of Object.entries(manifest)) {
    if (keep.has(id)) continue
    if (existsSync(join(outDir, file))) rmSync(join(outDir, file))
    delete manifest[id]
    console.log(`dropped ${id}`)
  }
  writeFileSync(manifestPath, JSON.stringify(manifest, null, 2) + '\n')
}
console.log(`${made} clip${made === 1 ? '' : 's'} recorded as ${ext} (${Object.keys(manifest).length} in the manifest, ${provider} voice ${voiceName}, ${model}).`)
if (kept.length) report(kept, 'Kept takes')
