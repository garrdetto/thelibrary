/**
 * Records the Short Track Showdown engine loops with the ElevenLabs sound-effects model and writes them to
 * public/modules/shorttrack-audio/, with manifest.json listing each layer and the rpm it was recorded at.
 * Layers that already exist are kept unless --force is given.
 *
 *   node --env-file=<file with ELEVENLABS_API_KEY> scripts/shorttrack-engine-sfx.mjs [--force] [--only idle,high] [--out <dir>]
 *
 * --out writes the loops somewhere else (to compare takes) and leaves the manifest alone.
 */
import { existsSync, mkdirSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'

const root = resolve(import.meta.dirname, '..')
const args = process.argv.slice(2)
const outAt = args.indexOf('--out')
const outDir = outAt >= 0 ? resolve(args[outAt + 1]) : join(root, 'public/modules/shorttrack-audio')
const force = args.includes('--force')
const onlyAt = args.indexOf('--only')
const only = onlyAt >= 0 ? args[onlyAt + 1].split(',') : null
const key = process.env.ELEVENLABS_API_KEY
if (!key) {
  console.error('ELEVENLABS_API_KEY is not set; nothing recorded.')
  process.exit(2)
}

const BASE =
  'Seamless looping recording of a single 650 horsepower carbureted V8 super late model short-track race car engine with open headers and a lumpy race cam, steady constant rpm, no gear changes, no revving up or down, no tire noise, no crowd, no music, no voices'

const LAYERS = [
  { id: 'idle', rpm: 1100, load: 0, prompt: `${BASE}. Engine idling in the pits at about 1100 rpm, choppy loping idle, recorded close behind the car.` },
  { id: 'low', rpm: 3500, load: 1, prompt: `${BASE}. Engine pulling hard under full throttle at a steady 3500 rpm, deep thundering exhaust, recorded from in-car.` },
  { id: 'mid', rpm: 5800, load: 1, influence: 0.85, prompt: 'Seamless loop of a mean, angry V8 race car engine at wide-open throttle, steady 5800 rpm. Open straight pipes, lumpy race cam, deep chest-pounding rumble with a raw raspy barking snarl, heavy and violent like a stock car under full power. Recorded close behind the exhaust. Constant rpm, no revving, no tires, no crowd, no music.' },
  { id: 'high', rpm: 8000, load: 1, influence: 0.85, prompt: 'Seamless loop of a ferocious V8 race car engine flat out at a steady 8000 rpm. Open straight pipes, savage raspy metallic howl with a thick bassy V8 growl underneath, angry and aggressive like a stock car screaming down the straightaway. Recorded close behind the exhaust. Constant rpm, no revving, no tires, no crowd, no music.' },
  { id: 'off', rpm: 5500, load: 0, prompt: `${BASE}. Driver off the throttle into the corner at about 5500 rpm, engine coasting on overrun with exhaust burble and crackle, recorded from in-car.` },
]

async function generate(layer) {
  for (let attempt = 0; attempt < 5; attempt++) {
    const res = await fetch('https://api.elevenlabs.io/v1/sound-generation?output_format=mp3_44100_128', {
      method: 'POST',
      headers: { 'xi-api-key': key, 'Content-Type': 'application/json' },
      body: JSON.stringify({ text: layer.prompt, duration_seconds: 6, prompt_influence: layer.influence ?? 0.65, loop: true, model_id: 'eleven_text_to_sound_v2' }),
    })
    if (res.status === 429 || res.status >= 500) {
      await new Promise((r) => setTimeout(r, 3000 * (attempt + 1)))
      continue
    }
    if (!res.ok) throw new Error(`${layer.id}: ${res.status} ${(await res.text()).slice(0, 300)}`)
    return Buffer.from(await res.arrayBuffer())
  }
  throw new Error(`${layer.id}: kept rate-limiting`)
}

mkdirSync(outDir, { recursive: true })
for (const layer of LAYERS) {
  const file = join(outDir, `engine-${layer.id}.mp3`)
  if ((only && !only.includes(layer.id)) || (!force && existsSync(file))) continue
  const audio = await generate(layer)
  writeFileSync(file, audio)
  console.log(`engine-${layer.id}.mp3  ${(audio.length / 1024).toFixed(0)} KB`)
}
if (outAt < 0) writeFileSync(
  join(outDir, 'manifest.json'),
  JSON.stringify({ layers: LAYERS.map(({ id, rpm, load }) => ({ id, rpm, load, file: `engine-${id}.mp3` })) }, null, 2) + '\n',
)
