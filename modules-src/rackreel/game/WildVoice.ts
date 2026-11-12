/** Plays Wisco Wild Man's recorded lines: `public/modules/rackreel/voice/manifest.json` (written by `scripts/rackreel-voice.mjs`) maps clip ids from `systems/Voice.ts` to files, which are fetched once he's near and decoded through the module's `Audio`. A missing manifest or clip just means he isn't heard, only read. He says one line at a time (`systems/Speech.ts`): a line that comes up while he's talking waits for him to finish or is skipped, and his synthesised holler takes a turn like any line. */
import type { Audio } from '../systems/Audio'
import { SpeechQueue } from '../systems/Speech'

type Manifest = Record<string, string>

/** How long before a manifest that couldn't be read is fetched again (`preload` is called every frame near his camp and on boarding). */
const MANIFEST_RETRY_MS = 20000

/** The synthesised holler's place in the queue. */
const HOLLER = 'holler'

/** What became of a line: 'said' now, 'held' until he finishes the one he's on, 'skipped' because he's talking and it can't wait, or 'unrecorded' (nothing to play). */
export type Spoken = 'said' | 'held' | 'skipped' | 'unrecorded'

export class WildVoice {
  private manifest: Manifest | null | undefined
  private manifestLoad: Promise<void> | null = null
  private readonly bytes = new Map<string, ArrayBuffer>()
  private readonly buffers = new Map<string, AudioBuffer>()
  private readonly pending = new Set<string>()
  private readonly queue = new SpeechQueue<string>()
  private heldStart: (() => void) | null = null

  constructor(private readonly audio: Audio, private readonly base = '/modules/rackreel/voice/') {}

  /** Fetches the manifest (fresh, never from the browser's cache) and every clip, once; a manifest that couldn't be read is tried again after `MANIFEST_RETRY_MS`. */
  preload(): void {
    if (this.manifestLoad) return
    this.manifestLoad = fetch(`${this.base}manifest.json`, { cache: 'no-cache' })
      .then(async (res) => (res.ok ? ((await res.json()) as Manifest) : null))
      .catch(() => null)
      .then((manifest) => {
        this.manifest = manifest
        if (!manifest) {
          setTimeout(() => {
            this.manifestLoad = null
          }, MANIFEST_RETRY_MS)
          return
        }
        for (const id of Object.keys(manifest)) void this.load(id)
      })
  }

  /** Whether a recording exists for this clip (false until the manifest arrives). */
  has(id: string | null): boolean {
    return !!id && !!this.manifest && id in this.manifest
  }

  /** Whether he's mid-line right now. */
  get talking(): boolean {
    return this.queue.talking(this.audio.time)
  }

  /** Seconds since he last finished a line (0 while he talks). */
  get quiet(): number {
    return this.queue.quiet(this.audio.time)
  }

  /** Says the clip: at once when he's quiet; while he's talking it waits for him to finish when that's within `patience` seconds (`onStart` runs when it begins) and is skipped otherwise. */
  say(id: string | null, patience: number, onStart?: () => void): Spoken {
    if (!id || !this.has(id)) return 'unrecorded'
    const buffer = this.buffers.get(id)
    if (!buffer) {
      void this.load(id)
      return 'unrecorded'
    }
    const outcome = this.queue.offer(id, this.audio.time, buffer.duration, patience)
    if (outcome === 'skip') return 'skipped'
    if (outcome === 'hold') {
      this.heldStart = onStart ?? null
      return 'held'
    }
    this.heldStart = null
    this.audio.speak(buffer)
    return 'said'
  }

  /** The synthesised holler that stands in for a line with no recording; never over a line he's saying. */
  holler(big: boolean): void {
    if (this.talking) return
    const seconds = this.audio.whoop(big)
    if (seconds > 0) this.queue.offer(HOLLER, this.audio.time, seconds, 0)
  }

  /** Every frame: starts the line that was waiting once he's finished the last one. */
  update(): void {
    const id = this.queue.next(this.audio.time)
    if (id === null) return
    const started = this.heldStart
    this.heldStart = null
    const buffer = this.buffers.get(id)
    if (!buffer) return
    this.audio.speak(buffer)
    started?.()
  }

  private async load(id: string): Promise<void> {
    if (this.buffers.has(id) || this.pending.has(id) || !this.manifest) return
    this.pending.add(id)
    try {
      let data = this.bytes.get(id)
      if (!data) {
        const res = await fetch(this.base + this.manifest[id])
        if (!res.ok) return
        data = await res.arrayBuffer()
        this.bytes.set(id, data)
      }
      const buffer = await this.audio.decode(data.slice(0))
      if (buffer) {
        this.buffers.set(id, buffer)
        this.bytes.delete(id)
      }
    } catch {
      // left unplayable; the line still shows in the HUD
    } finally {
      this.pending.delete(id)
    }
  }
}
