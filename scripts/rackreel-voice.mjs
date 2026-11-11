/**
 * Records Wisco Wild Man: every line in modules-src/rackreel/systems/Voice.ts is read by Gemini's text-to-speech in the
 * VOICE_STYLE there and written to public/modules/rackreel/voice/, with manifest.json mapping clip ids to files for
 * game/WildVoice.ts. Needs GEMINI_API_KEY in the environment. Clips that already exist are kept unless --force is given.
 *
 *   node scripts/rackreel-voice.mjs [--force] [--only line-board,cheer-sendIt] [--voice Fenrir] [--model gemini-2.5-flash-preview-tts]
 *
 * Gemini returns 24 kHz 16-bit mono PCM. With ffmpeg on the PATH the clips are stored as 48 kbit/s Opus in .ogg; otherwise
 * as .wav, which plays everywhere but weighs about ten times as much.
 */
import { build } from 'esbuild'
import { spawnSync } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'

const root = resolve(import.meta.dirname, '..')
const outDir = join(root, 'public/modules/rackreel/voice')
const args = process.argv.slice(2)
const flag = (name) => {
  const i = args.indexOf(name)
  return i >= 0 ? args[i + 1] : undefined
}
const force = args.includes('--force')
const only = flag('--only')?.split(',').filter(Boolean)
const voiceName = flag('--voice') ?? 'Fenrir'
const model = flag('--model') ?? 'gemini-2.5-flash-preview-tts'
const key = process.env.GEMINI_API_KEY
if (!key) {
  console.error('GEMINI_API_KEY is not set; nothing recorded.')
  process.exit(2)
}

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

const hasFfmpeg = spawnSync('ffmpeg', ['-version'], { stdio: 'ignore' }).status === 0
const ext = hasFfmpeg ? 'ogg' : 'wav'
mkdirSync(outDir, { recursive: true })
const manifestPath = join(outDir, 'manifest.json')
const manifest = existsSync(manifestPath) ? JSON.parse(readFileSync(manifestPath, 'utf8')) : {}

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

async function synthesize(text) {
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`
  const body = {
    contents: [{ parts: [{ text: `${style}\n\nSay exactly this, nothing else:\n${text}` }] }],
    generationConfig: { responseModalities: ['AUDIO'], speechConfig: { voiceConfig: { prebuiltVoiceConfig: { voiceName } } } },
  }
  for (let attempt = 0; attempt < 5; attempt++) {
    const res = await fetch(url, { method: 'POST', headers: { 'content-type': 'application/json', 'x-goog-api-key': key }, body: JSON.stringify(body) })
    if (res.status === 429 || res.status >= 500) {
      const wait = 3000 * (attempt + 1)
      console.log(`  ${res.status} from Gemini, retrying in ${wait / 1000}s`)
      await new Promise((r) => setTimeout(r, wait))
      continue
    }
    if (!res.ok) throw new Error(`Gemini ${res.status}: ${(await res.text()).slice(0, 300)}`)
    const json = await res.json()
    const part = json.candidates?.[0]?.content?.parts?.find((p) => p.inlineData)
    if (!part) throw new Error('no audio in the response')
    const rate = Number(/rate=(\d+)/.exec(part.inlineData.mimeType ?? '')?.[1] ?? 24000)
    return { pcm: Buffer.from(part.inlineData.data, 'base64'), rate }
  }
  throw new Error('Gemini kept rate-limiting')
}

function encode(id, pcm, rate) {
  const file = `${id}.${ext}`
  const target = join(outDir, file)
  if (!hasFfmpeg) {
    writeFileSync(target, wav(pcm, rate))
    return file
  }
  const run = spawnSync('ffmpeg', ['-y', '-loglevel', 'error', '-f', 's16le', '-ar', String(rate), '-ac', '1', '-i', 'pipe:0', '-c:a', 'libopus', '-b:a', '48k', '-application', 'voip', target], { input: pcm })
  if (run.status !== 0) throw new Error(`ffmpeg failed for ${id}: ${run.stderr}`)
  return file
}

let made = 0
for (const clip of clips) {
  const have = manifest[clip.id]
  if (!force && have && existsSync(join(outDir, have))) continue
  console.log(`${clip.id}: ${clip.text}`)
  const { pcm, rate } = await synthesize(clip.text)
  const file = encode(clip.id, pcm, rate)
  if (have && have !== file && existsSync(join(outDir, have))) rmSync(join(outDir, have))
  manifest[clip.id] = file
  made++
  writeFileSync(manifestPath, JSON.stringify(manifest, null, 2) + '\n')
  await new Promise((r) => setTimeout(r, 400))
}
console.log(`${made} clip${made === 1 ? '' : 's'} recorded as ${ext} (${Object.keys(manifest).length} in the manifest, voice ${voiceName}, ${model}).`)
