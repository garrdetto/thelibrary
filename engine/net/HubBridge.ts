/** Same-origin postMessage bridge between an embedded module and the hub page (tl-host, tl-room, tl-score-saved, tl-lap, tl-fairway). */

export type HubOutgoing =
  | { type: 'tl-room'; code: string }
  | { type: 'tl-score-saved'; module: string; saved: boolean }
  | { type: 'tl-lap'; track: string; mode?: string }
  | { type: 'tl-fairway'; board: 'round' | 'pin' | 'match' }

export type HubIncoming = { type: 'tl-host' }

export const HubBridge = {
  embedded(): boolean {
    try {
      return window.parent !== window
    } catch {
      return true
    }
  },

  post(message: HubOutgoing): void {
    try {
      if (window.parent && window.parent !== window) window.parent.postMessage(message, location.origin)
    } catch {
      return
    }
  },

  on<T extends HubIncoming['type']>(type: T, handler: (message: Extract<HubIncoming, { type: T }>) => void): () => void {
    const listener = (event: MessageEvent) => {
      if (event.origin !== location.origin || !event.data || event.data.type !== type) return
      handler(event.data as Extract<HubIncoming, { type: T }>)
    }
    addEventListener('message', listener)
    return () => removeEventListener('message', listener)
  },
}
