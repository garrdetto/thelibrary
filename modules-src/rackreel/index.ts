import { Game } from './game/Game'

declare global {
  interface Window {
    __rackreel?: Game
  }
}

async function boot(): Promise<void> {
  const canvas = document.getElementById('scene') as HTMLCanvasElement | null
  if (!canvas) throw new Error('Missing #scene')
  const game = new Game(canvas)
  window.__rackreel = game
  await game.start()
}

boot().catch((error: unknown) => {
  const status = document.getElementById('load-text')
  if (status) status.textContent = 'This learning module could not start on this device. It needs WebGPU or WebGL2.'
  console.error(error)
})
