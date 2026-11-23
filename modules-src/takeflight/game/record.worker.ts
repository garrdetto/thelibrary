/**
 * Compresses the flight record off the main thread. The page posts the header when a flight starts, a minute of inputs and
 * telemetry at a time while it flies, and the footer when it ends; the worker streams them through `RecordWriter` and posts the
 * finished bytes back.
 */
import { RecordWriter } from '../shared/FlightRecord'
import type { RecordFooter, RecordHeader } from '../shared/FlightRecord'

export type RecordRequest =
  | { type: 'begin'; header: RecordHeader }
  | { type: 'chunk'; inputs: Uint8Array; telemetry: Float32Array }
  | { type: 'finish'; id: number; footer: RecordFooter }
  | { type: 'abort' }

export type RecordReply = { type: 'done'; id: number; bytes: Uint8Array; raw: number } | { type: 'failed'; id: number }

const scope = self as unknown as { onmessage: ((event: MessageEvent<RecordRequest>) => void) | null; postMessage(message: RecordReply, transfer?: Transferable[]): void }
let writer: RecordWriter | null = null

scope.onmessage = (event) => {
  const message = event.data
  if (message.type === 'begin') {
    void writer?.abort()
    writer = new RecordWriter(message.header)
  } else if (message.type === 'chunk') {
    writer?.addInputs(message.inputs)
    writer?.addTelemetry(message.telemetry)
  } else if (message.type === 'finish') {
    const current = writer
    writer = null
    if (!current) {
      scope.postMessage({ type: 'failed', id: message.id })
      return
    }
    const raw = current.rawBytes
    current.finish(message.footer).then(
      (bytes) => scope.postMessage({ type: 'done', id: message.id, bytes, raw: raw }, [bytes.buffer]),
      () => scope.postMessage({ type: 'failed', id: message.id }),
    )
  } else {
    void writer?.abort()
    writer = null
  }
}
