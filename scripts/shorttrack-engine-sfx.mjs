/**
 * Records the Short Track Showdown engine sounds with the ElevenLabs sound-effects model into
 * public/modules/shorttrack-audio/: `engine-idle.mp3` (a seamless idle loop) and `engine-pull.mp3` (one continuous
 * full-throttle pull, low rpm to redline, no shifts). `render-three/engine-audio.js` time-stretches the pull so the
 * engine follows the car's rpm, using the pitch map in manifest.json (`from`/`to` Hz, and `points`/`rms`: the time and
 * level at eleven evenly spaced log-pitch steps from `from` to `to`).
 *
 *   node --env-file=<file with ELEVENLABS_API_KEY> scripts/shorttrack-engine-sfx.mjs [--only idle,pull] [--out <dir>]
 *
 * Takes vary a lot: record several with --out, listen, and copy the one you want in. A new pull needs its pitch map
 * measured again before it replaces the old one; the manifest is never rewritten by this script.
 */
import { mkdirSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'

const root = resolve(import.meta.dirname, '..')
const args = process.argv.slice(2)
const flag = (name) => {
  const i = args.indexOf(name)
  return i >= 0 ? args[i + 1] : undefined
}
const outDir = resolve(flag('--out') ?? join(root, 'public/modules/shorttrack-audio'))
const only = flag('--only')?.split(',')
const key = process.env.ELEVENLABS_API_KEY
if (!key) {
  console.error('ELEVENLABS_API_KEY is not set; nothing recorded.')
  process.exit(2)
}

const SOUNDS = [
  {
    id: 'idle',
    loop: true,
    seconds: 6,
    influence: 0.65,
    text: 'Seamless looping recording of a 650 horsepower carbureted V8 super late model race car idling in the pits at about 1100 rpm, choppy loping race-cam idle, recorded close behind the car, no revving, no crowd, no music.',
  },
  {
    id: 'pull',
    loop: false,
    seconds: 8,
    influence: 0.5,
    text: 'NASCAR Cup Series stock car onboard audio: the V8 accelerates at full throttle from low rpm all the way up to 9000 rpm in fourth gear, one continuous pull with no gear shifts, loud raw roaring engine. No crowd, no commentary, no music.',
  },
]

async function record(sound) {
  for (let attempt = 0; attempt < 5; attempt++) {
    const res = await fetch('https://api.elevenlabs.io/v1/sound-generation?output_format=mp3_44100_128', {
      method: 'POST',
      headers: { 'xi-api-key': key, 'Content-Type': 'application/json' },
      body: JSON.stringify({ text: sound.text, duration_seconds: sound.seconds, prompt_influence: sound.influence, loop: sound.loop, model_id: 'eleven_text_to_sound_v2' }),
    })
    if (res.status === 429 || res.status >= 500) {
      await new Promise((r) => setTimeout(r, 3000 * (attempt + 1)))
      continue
    }
    if (!res.ok) throw new Error(`${sound.id}: ${res.status} ${(await res.text()).slice(0, 300)}`)
    return Buffer.from(await res.arrayBuffer())
  }
  throw new Error(`${sound.id}: kept rate-limiting`)
}

mkdirSync(outDir, { recursive: true })
for (const sound of SOUNDS) {
  if (only && !only.includes(sound.id)) continue
  const audio = await record(sound)
  writeFileSync(join(outDir, `engine-${sound.id}.mp3`), audio)
  console.log(`engine-${sound.id}.mp3  ${(audio.length / 1024).toFixed(0)} KB`)
}
