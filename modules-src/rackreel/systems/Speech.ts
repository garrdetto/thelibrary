/** Wisco Wild Man says one thing at a time, renderer-free: a line that comes up while he's talking waits for him to finish when it can still land in time, and is skipped otherwise. Nothing cuts a line off or plays over it. Times are seconds on any one clock (the audio clock in the module). */

/** The breath between two lines, seconds. */
export const SPEECH_GAP = 0.25

/** 'say': he's free, the caller starts the line now. 'hold': it's next, handed out by `next` when he finishes. 'skip': not said. */
export type SpeechOutcome = 'say' | 'hold' | 'skip'

export class SpeechQueue<T> {
  private current: T | null = null
  private endsAt = -Infinity
  private held: { line: T; seconds: number; expires: number } | null = null

  /** Whether he's mid-line (or catching his breath after one) at `now`. */
  talking(now: number): boolean {
    return now < this.endsAt
  }

  /** Seconds since he last finished a line: 0 while he talks, Infinity before his first. */
  quiet(now: number): number {
    return Math.max(0, now - this.endsAt)
  }

  /** A line `seconds` long comes up at `now` and is worth saying for `patience` more seconds. While he talks it's held (replacing a line already held) when he'll be done in time, and skipped when he won't, when `patience` is 0 or when it's the line he's saying. */
  offer(line: T, now: number, seconds: number, patience: number): SpeechOutcome {
    if (!this.talking(now)) {
      this.held = null
      this.begin(line, now, seconds)
      return 'say'
    }
    if (line === this.current || patience <= 0 || this.endsAt - now > patience) return 'skip'
    this.held = { line, seconds, expires: now + patience }
    return 'hold'
  }

  /** Asked every frame: the held line to start at `now`, once he's finished and it's still in time. */
  next(now: number): T | null {
    const held = this.held
    if (!held || this.talking(now)) return null
    this.held = null
    if (now > held.expires) return null
    this.begin(held.line, now, held.seconds)
    return held.line
  }

  /** Forgets the line in progress and the one waiting (the sound was stopped elsewhere). */
  reset(): void {
    this.current = null
    this.endsAt = -Infinity
    this.held = null
  }

  private begin(line: T, now: number, seconds: number): void {
    this.current = line
    this.endsAt = now + seconds + SPEECH_GAP
  }
}
