import { Lab } from '../sim/lab'
import type { Snapshot } from '../sim/lab'
import { handlingDelta, railHandling, railTrackQuery, railVehicle } from '../sim/vehicle'
import type { RailHandling } from '../sim/vehicle'

export const BASELINE_NAME = 'Test Drive Baseline'

/**
 * Test on track: opens Short Track Showdown's track test (`shorttrack.html?lab=1`) over the Lab, on a track with the
 * Lab's corner radius and banking, and hands it the current setup as a `RailVehicle`. The page stays loaded while
 * hidden, so going back to the setup and returning only sends the changed setup; a new radius or banking reloads it.
 */
export class TrackTest {
  private readonly box: HTMLDivElement
  private readonly frame: HTMLIFrameElement
  private ready = false
  private src = ''
  private sent = ''
  private base: Snapshot | null = null
  private baseKey = ''
  private baseHandling: RailHandling | null = null

  constructor(private readonly lab: Lab, private readonly name: () => string, private readonly onClose: () => void) {
    this.box = document.createElement('div')
    this.box.id = 'tt-ov'
    this.box.hidden = true
    this.box.setAttribute('role', 'dialog')
    this.box.setAttribute('aria-label', 'Track test')
    this.frame = document.createElement('iframe')
    this.frame.title = 'Track test'
    this.frame.allow = 'fullscreen; gamepad'
    this.box.append(this.frame)
    document.body.append(this.box)
    addEventListener('message', (e) => {
      if (e.origin !== location.origin || e.source !== this.frame.contentWindow || !e.data) return
      if (e.data.type === 'rail-test-ready') {
        this.ready = true
        this.sent = ''
        this.send()
      } else if (e.data.type === 'rail-test-close') this.close()
    })
    addEventListener('keydown', (e) => { if (e.key === 'Escape' && !this.box.hidden) this.close() })
  }

  get open(): boolean {
    return !this.box.hidden
  }

  show() {
    const q = railTrackQuery(this.lab)
    const src = `shorttrack.html?lab=1&rad=${encodeURIComponent(q.rad)}&bank=${encodeURIComponent(q.bank)}`
    if (src !== this.src) {
      this.src = src
      this.ready = false
      this.sent = ''
      this.frame.src = src
    }
    this.box.hidden = false
    document.documentElement.classList.add('tt-on')
    if (this.ready) this.send()
    this.frame.focus()
  }

  close() {
    if (this.box.hidden) return
    this.box.hidden = true
    document.documentElement.classList.remove('tt-on')
    this.onClose()
  }

  /** The setup the test driver treats as balanced at the limit (null: the Lab's defaults). */
  setBaseline(x: Snapshot | null) {
    this.base = x
    this.baseHandling = null
    if (this.open) this.send()
  }

  get baselineName(): string {
    return this.base ? BASELINE_NAME : 'Lab defaults'
  }

  /** The setup's handling against the baseline per corner phase (balance points, + tighter). */
  handling(): RailHandling {
    const key = JSON.stringify(this.lab.rawHardpoints()) + (this.base ? JSON.stringify(this.base.inputs) + JSON.stringify(this.base.adj) + JSON.stringify(this.base.radj) : '') + this.lab.num('bank')
    if (!this.baseHandling || key !== this.baseKey) {
      const b = new Lab(this.lab.rawHardpoints())
      b.mrFixedFlag = this.lab.mrFixedFlag
      if (this.base) b.applySnapshot(this.base)
      Object.assign(b.inputs, { bank: this.lab.num('bank') })
      b.recompute()
      this.baseHandling = railHandling(b)
      this.baseKey = key
    }
    return handlingDelta(railHandling(this.lab), this.baseHandling)
  }

  private send() {
    if (!this.ready || !this.frame.contentWindow) return
    const name = this.name()
    const vehicle = { ...railVehicle(this.lab, name), handling: this.handling() }
    const key = JSON.stringify(vehicle)
    if (key === this.sent) return
    this.sent = key
    this.frame.contentWindow.postMessage({ type: 'rail-setup', vehicle, name }, location.origin)
  }
}
