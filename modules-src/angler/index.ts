/** Northwoods Angler entry: boots the PlayCanvas world and the game screens. */
import { pickQuality } from './config'
import { setClockOffset } from './shared/Clock'
import { Game } from './game/Game'

declare global {
  interface Window {
    __angler?: Game
  }
}

async function boot(): Promise<void> {
  const canvas = document.getElementById('scene') as HTMLCanvasElement | null
  if (!canvas) throw new Error('Missing #scene')
  const preview = new URLSearchParams(location.search).get('clock')
  if (preview) {
    const at = Date.parse(preview)
    if (Number.isFinite(at)) setClockOffset(at - Date.now())
  }
  const game = new Game(canvas, pickQuality())
  window.__angler = game
  await game.start()
}

boot().catch((error: unknown) => {
  const status = document.getElementById('loading-text')
  if (status) status.textContent = 'This learning module could not start on this device.'
  console.error(error)
})
