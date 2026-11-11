/** Plays Wisco Wild Man's recorded lines: `public/modules/rackreel/voice/manifest.json` (written by `scripts/rackreel-voice.mjs`) maps clip ids from `systems/Voice.ts` to files, which are fetched once he's near and decoded through the module's `Audio`. A missing manifest or clip just means he isn't heard, only read. */
import type { Audio } from '../systems/Audio'

type Manifest = Record<string, string>

export class WildVoice {
  private manifest: Manifest | null | undefined
  private manifestLoad: Promise<void> | null = null
  private readonly bytes = new Map<string, ArrayBuffer>()
  private readonly buffers = new Map<string, AudioBuffer>()
  private readonly pending = new Set<string>()

  constructor(private readonly audio: Audio, private readonly base = '/modules/rackreel/voice/') {}

  /** Fetches the manifest and every clip, once. */
  preload(): void {
    if (this.manifestLoad) return
    this.manifestLoad = fetch(`${this.base}manifest.json`)
      .then(async (res) => (res.ok ? ((await res.json()) as Manifest) : null))
      .catch(() => null)
      .then((manifest) => {
        this.manifest = manifest
        if (!manifest) return
        for (const id of Object.keys(manifest)) void this.load(id)
      })
  }

  /** Whether a recording exists for this clip (false until the manifest arrives). */
  has(id: string | null): boolean {
    return !!id && !!this.manifest && id in this.manifest
  }

  /** Plays the clip when it's decoded; returns true when he's heard. */
  say(id: string | null): boolean {
    if (!id || !this.has(id)) return false
    const buffer = this.buffers.get(id)
    if (buffer) {
      this.audio.speak(buffer)
      return true
    }
    void this.load(id)
    return false
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
