/**
 * Tells whether a recorded take sounds like the voice it was meant to be read in. Text-to-speech models can drift off a cloned
 * voice on short, shouted lines (a different, higher voice comes out), so rackreel-voice.mjs records several takes and keeps
 * the one this module scores closest. It compares speaker embeddings (WavLM x-vectors, Xenova/wavlm-base-plus-sv) of the take
 * with those of the voice's own reference samples, which are fetched from ElevenLabs for the run and never stored.
 *
 * `match` is the mean cosine similarity to the five closest six-second pieces of the samples. For the owner's "Wild Man2"
 * clone the samples score about 0.88 against each other, good takes 0.70 to 0.88, and takes in the wrong voice 0.50 to 0.60.
 *
 * Needs two packages that are not project dependencies (about 750 MB with the model, which downloads on first use). Install
 * them in any folder outside the repo and pass it as --match-deps or RACKREEL_VOICE_DEPS:
 *
 *   npm install --prefix <folder> @huggingface/transformers@3 mpg123-decoder@1
 */
import { createRequire } from 'node:module'
import { join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'

const MODEL = 'Xenova/wavlm-base-plus-sv'
const RATE = 16000
const PIECE = RATE * 6
const SHORTEST = RATE * 2
const CLOSEST = 5

/** A take scoring below this is in the wrong voice often enough to be worth another try. */
export const MIN_MATCH = 0.7

function mono(channels, length) {
  const out = new Float32Array(length)
  for (const channel of channels) for (let i = 0; i < length; i++) out[i] += channel[i] / channels.length
  return out
}

/** Windowed-sinc resampling to 16 kHz. */
function resample(x, from) {
  if (from === RATE) return x
  const step = from / RATE
  const cutoff = Math.min(1, RATE / from) * 0.45
  const reach = Math.ceil(12 / (2 * cutoff))
  const out = new Float32Array(Math.floor(x.length / step))
  for (let n = 0; n < out.length; n++) {
    const at = n * step
    const first = Math.max(0, Math.ceil(at - reach))
    const last = Math.min(x.length - 1, Math.floor(at + reach))
    let sum = 0
    for (let k = first; k <= last; k++) {
      const d = at - k
      const phase = 2 * Math.PI * cutoff * d
      const sinc = d === 0 ? 1 : Math.sin(phase) / phase
      sum += x[k] * 2 * cutoff * sinc * (0.5 + 0.5 * Math.cos((Math.PI * d) / reach))
    }
    out[n] = sum
  }
  return out
}

/** Drops the silence before and after the voice. */
function trim(x) {
  let peak = 0
  for (const v of x) peak = Math.max(peak, Math.abs(v))
  const floor = peak * 0.02
  let a = 0
  let b = x.length - 1
  while (a < b && Math.abs(x[a]) < floor) a++
  while (b > a && Math.abs(x[b]) < floor) b--
  return x.subarray(Math.max(0, a - RATE / 20), Math.min(x.length, b + RATE / 20))
}

const cosine = (a, b) => a.reduce((sum, v, i) => sum + v * b[i], 0)

export async function createMatcher({ depsDir, key, voiceId }) {
  const require = createRequire(join(resolve(depsDir), 'package.json'))
  let transformers
  let MPEGDecoder
  try {
    transformers = require('@huggingface/transformers')
    ;({ MPEGDecoder } = await import(pathToFileURL(require.resolve('mpg123-decoder')).href))
  } catch (error) {
    throw new Error(`Comparing takes needs @huggingface/transformers and mpg123-decoder in ${resolve(depsDir)} (npm install --prefix <folder> @huggingface/transformers@3 mpg123-decoder@1): ${error.message}`)
  }
  const processor = await transformers.AutoProcessor.from_pretrained(MODEL)
  const model = await transformers.AutoModel.from_pretrained(MODEL, { dtype: 'fp32' })
  const decoder = new MPEGDecoder()
  await decoder.ready

  async function decode(bytes) {
    await decoder.reset()
    const { channelData, samplesDecoded, sampleRate } = decoder.decode(new Uint8Array(bytes))
    if (!samplesDecoded) throw new Error('not an MP3')
    return trim(resample(mono(channelData, samplesDecoded), sampleRate))
  }

  async function embed(x) {
    const { embeddings } = await model(await processor(x))
    const e = Array.from(embeddings.data)
    const norm = Math.hypot(...e)
    return e.map((v) => v / norm)
  }

  const headers = { 'xi-api-key': key }
  const res = await fetch(`https://api.elevenlabs.io/v1/voices/${voiceId}`, { headers })
  if (!res.ok) throw new Error(`ElevenLabs voice ${voiceId}: ${res.status}`)
  const voice = await res.json()
  const references = []
  for (const sample of voice.samples ?? []) {
    const audio = await fetch(`https://api.elevenlabs.io/v1/voices/${voiceId}/samples/${sample.sample_id}/audio`, { headers })
    if (!audio.ok) continue
    let x
    try {
      x = await decode(await audio.arrayBuffer())
    } catch {
      continue
    }
    for (let s = 0; s + SHORTEST <= x.length; s += PIECE) references.push(await embed(x.subarray(s, Math.min(x.length, s + PIECE))))
  }
  if (!references.length) throw new Error(`"${voice.name ?? voiceId}" has no MP3 reference samples to compare takes with (premade voices have none); record with --takes 1.`)

  return {
    voiceName: voice.name ?? voiceId,
    pieces: references.length,
    /** How close the MP3 is to the voice (`match`) and how long it runs without the silence at either end (`seconds`). */
    async score(bytes) {
      const x = await decode(bytes)
      const e = await embed(x)
      const closest = references.map((r) => cosine(e, r)).sort((a, b) => b - a).slice(0, CLOSEST)
      return { match: closest.reduce((sum, v) => sum + v, 0) / closest.length, seconds: x.length / RATE }
    },
  }
}
