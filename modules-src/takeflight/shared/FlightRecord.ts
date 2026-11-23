/**
 * The flight record: everything needed to re-fly and re-score a flight, compressed. Layout: the 4-byte magic `TFR1`, then a raw
 * DEFLATE stream of frames `[type u8][length u32 LE][payload]`: a JSON header (aircraft, airport, start, conditions, assists),
 * input chunks (12 bytes per tick, each byte XORed with the same byte of the tick before, so steady controls become zeros),
 * telemetry chunks (Float32 bits XORed with the same channel's previous sample, then split into byte planes) and a JSON footer.
 * `RecordWriter` streams chunks into the compressor as they arrive (the page runs it in a worker); `readRecord` reverses it.
 */
import type { AssistSettings } from '../sim/Assists'
import type { CrashReason } from '../sim/FlightModel'
import type { StartKind } from '../sim/Starts'
import type { WindSpec } from '../sim/Wind'
import type { WeatherKind } from './Weather'
import { INPUT_BYTES } from '../sim/Controls'
import { CHANNELS } from '../sim/Telemetry'
import type { TouchdownEvent } from '../sim/Telemetry'

export const RECORD_VERSION = 3
const MAGIC = [0x54, 0x46, 0x52, 0x31]
const FRAME_HEADER = 1
const FRAME_INPUTS = 2
const FRAME_TELEMETRY = 3
const FRAME_FOOTER = 4

export interface RecordHeader {
  version: number
  aircraft: string
  airport: string
  start: StartKind
  wind: WindSpec
  seed: number
  temperatureOffset: number
  seaLevelPressure: number
  assists: AssistSettings
  weather: WeatherKind
}

export interface RecordFooter {
  ticks: number
  samples: number
  touchdowns: TouchdownEvent[]
  crashed: CrashReason | null
  ended: 'stopped' | 'pilot' | 'crash'
  score: number
}

export interface FlightRecordData {
  header: RecordHeader
  footer: RecordFooter
  inputs: Uint8Array
  telemetry: Float32Array
}

const encoder = new TextEncoder()
const decoder = new TextDecoder()

function frameBytes(type: number, payload: Uint8Array): Uint8Array {
  const out = new Uint8Array(5 + payload.length)
  out[0] = type
  new DataView(out.buffer).setUint32(1, payload.length, true)
  out.set(payload, 5)
  return out
}

async function collect(stream: ReadableStream<Uint8Array>): Promise<Uint8Array> {
  const reader = stream.getReader()
  const parts: Uint8Array[] = []
  let length = 0
  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    parts.push(value)
    length += value.length
  }
  const out = new Uint8Array(length)
  let offset = 0
  for (const part of parts) {
    out.set(part, offset)
    offset += part.length
  }
  return out
}

/** XOR-delta of a byte log against the tick before; `last` carries the previous tick across chunks. */
export function deltaInputs(bytes: Uint8Array, last: Uint8Array): Uint8Array {
  const out = new Uint8Array(bytes.length)
  for (let i = 0; i < bytes.length; i++) {
    const k = i % INPUT_BYTES
    out[i] = bytes[i] ^ last[k]
    last[k] = bytes[i]
  }
  return out
}

export function undeltaInputs(bytes: Uint8Array, last: Uint8Array): Uint8Array {
  const out = new Uint8Array(bytes.length)
  for (let i = 0; i < bytes.length; i++) {
    const k = i % INPUT_BYTES
    out[i] = bytes[i] ^ last[k]
    last[k] = out[i]
  }
  return out
}

/** Float32 telemetry to delta-coded byte planes; `last` carries the previous sample's bits per channel. */
export function packTelemetry(floats: Float32Array, last: Uint32Array): Uint8Array {
  const bits = new Uint32Array(floats.buffer.slice(floats.byteOffset, floats.byteOffset + floats.byteLength))
  const n = bits.length
  const out = new Uint8Array(n * 4)
  for (let i = 0; i < n; i++) {
    const c = i % CHANNELS
    const value = bits[i]
    const delta = (value ^ last[c]) >>> 0
    last[c] = value
    out[i] = delta & 0xff
    out[n + i] = (delta >>> 8) & 0xff
    out[2 * n + i] = (delta >>> 16) & 0xff
    out[3 * n + i] = delta >>> 24
  }
  return out
}

export function unpackTelemetry(bytes: Uint8Array, last: Uint32Array): Float32Array {
  const n = bytes.length >> 2
  const bits = new Uint32Array(n)
  for (let i = 0; i < n; i++) {
    const c = i % CHANNELS
    const delta = (bytes[i] | (bytes[n + i] << 8) | (bytes[2 * n + i] << 16) | (bytes[3 * n + i] << 24)) >>> 0
    const value = (delta ^ last[c]) >>> 0
    last[c] = value
    bits[i] = value
  }
  return new Float32Array(bits.buffer)
}

/** Streams a flight into a compressed record chunk by chunk. */
export class RecordWriter {
  private readonly writer: WritableStreamDefaultWriter<Uint8Array>
  private readonly output: Promise<Uint8Array>
  private readonly lastInput = new Uint8Array(INPUT_BYTES)
  private readonly lastSample = new Uint32Array(CHANNELS)
  private chain: Promise<void> = Promise.resolve()
  private raw = 0

  constructor(header: RecordHeader) {
    const stream = new CompressionStream('deflate-raw')
    this.writer = stream.writable.getWriter() as WritableStreamDefaultWriter<Uint8Array>
    this.output = collect(stream.readable as ReadableStream<Uint8Array>)
    this.write(frameBytes(FRAME_HEADER, encoder.encode(JSON.stringify(header))))
  }

  /** Uncompressed bytes written so far. */
  get rawBytes(): number {
    return this.raw
  }

  private write(bytes: Uint8Array): void {
    this.raw += bytes.length
    this.chain = this.chain.then(() => this.writer.write(bytes))
  }

  addInputs(bytes: Uint8Array): void {
    if (bytes.length) this.write(frameBytes(FRAME_INPUTS, deltaInputs(bytes, this.lastInput)))
  }

  addTelemetry(floats: Float32Array): void {
    if (floats.length) this.write(frameBytes(FRAME_TELEMETRY, packTelemetry(floats, this.lastSample)))
  }

  async finish(footer: RecordFooter): Promise<Uint8Array> {
    this.write(frameBytes(FRAME_FOOTER, encoder.encode(JSON.stringify(footer))))
    await this.chain
    await this.writer.close()
    const body = await this.output
    const out = new Uint8Array(4 + body.length)
    out.set(MAGIC, 0)
    out.set(body, 4)
    return out
  }

  /** Stops without producing a record. */
  async abort(): Promise<void> {
    await this.chain.catch(() => undefined)
    await this.writer.abort().catch(() => undefined)
    await this.output.catch(() => undefined)
  }
}

/** Decompresses and decodes a record written by `RecordWriter`. */
export async function readRecord(bytes: Uint8Array): Promise<FlightRecordData> {
  for (let i = 0; i < 4; i++) if (bytes[i] !== MAGIC[i]) throw new Error('Not a Take Flight record')
  const stream = new Blob([bytes.slice(4)]).stream().pipeThrough(new DecompressionStream('deflate-raw'))
  const body = await collect(stream as ReadableStream<Uint8Array>)
  const view = new DataView(body.buffer, body.byteOffset, body.byteLength)
  const lastInput = new Uint8Array(INPUT_BYTES)
  const lastSample = new Uint32Array(CHANNELS)
  const inputs: Uint8Array[] = []
  const telemetry: Float32Array[] = []
  let header: RecordHeader | null = null
  let footer: RecordFooter | null = null
  let offset = 0
  while (offset + 5 <= body.length) {
    const type = body[offset]
    const length = view.getUint32(offset + 1, true)
    const payload = body.subarray(offset + 5, offset + 5 + length)
    offset += 5 + length
    if (type === FRAME_HEADER) header = JSON.parse(decoder.decode(payload)) as RecordHeader
    else if (type === FRAME_INPUTS) inputs.push(undeltaInputs(payload, lastInput))
    else if (type === FRAME_TELEMETRY) telemetry.push(unpackTelemetry(payload, lastSample))
    else if (type === FRAME_FOOTER) footer = JSON.parse(decoder.decode(payload)) as RecordFooter
  }
  if (!header || !footer) throw new Error('Take Flight record is incomplete')
  if (header.version !== RECORD_VERSION) throw new Error(`Unsupported record version ${header.version}`)
  const allInputs = new Uint8Array(inputs.reduce((sum, part) => sum + part.length, 0))
  let at = 0
  for (const part of inputs) {
    allInputs.set(part, at)
    at += part.length
  }
  const allTelemetry = new Float32Array(telemetry.reduce((sum, part) => sum + part.length, 0))
  at = 0
  for (const part of telemetry) {
    allTelemetry.set(part, at)
    at += part.length
  }
  return { header, footer, inputs: allInputs, telemetry: allTelemetry }
}
