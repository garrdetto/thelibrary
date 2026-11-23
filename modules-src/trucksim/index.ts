/** Truck Simulator entry: boots the standalone host with a loading bar and tears everything down when the page goes away. */
import './ui/styles.css'
import { Standalone } from './game/Standalone'
import { bootFailure } from './game/BootRecovery'

async function main(): Promise<void> {
  const canvas = document.getElementById('scene') as HTMLCanvasElement | null
  const ui = document.getElementById('ui')
  const boot = document.getElementById('boot')
  const bar = document.getElementById('boot-bar')
  const text = document.getElementById('boot-text')
  if (!canvas || !ui || !boot) throw new Error('Truck Simulator page is missing its canvas or overlay')
  document.title = 'Truck Simulator · the library'
  try {
    const host = await Standalone.boot(canvas, ui, (share, message) => {
      if (bar) bar.style.width = `${Math.round(share * 100)}%`
      if (text) text.textContent = message
    })
    boot.hidden = true
    ;(window as Window & { __trucksim?: Standalone }).__trucksim = host
    addEventListener('pagehide', () => host.dispose(), { once: true })
  } catch (error) {
    console.error(error)
    const failure = bootFailure(location.href, error)
    if (failure.retry) {
      if (text) text.textContent = 'Switching to the WebGL2 renderer…'
      location.replace(failure.retry)
      return
    }
    if (text) text.textContent = failure.message
  }
}

void main()
