/**
 * Truck Simulator entry. The module plays on Montello: the page takes Life Sim's shell, retitles it, and boots Montello in
 * trucking mode (`foxlake/boot.ts` → `foxlake/trucks/TruckingMode.ts`). `?world=county` still boots the original county on the
 * standalone host.
 */
import './ui/styles.css'
import { bootFailure } from './game/BootRecovery'

const TRUCKING_KEYS: [string, string][] = [
  ['<kbd>W</kbd><kbd>S</kbd>', 'Throttle and brake'],
  ['<kbd>A</kbd><kbd>D</kbd>', 'Steer'],
  ['<kbd>Space</kbd>', 'Parking brake'],
  ['<kbd>B</kbd>', 'Engine brake'],
  ['<kbd>Shift</kbd><kbd>Ctrl</kbd>', 'Shift up and down'],
  ['<kbd>H</kbd> <kbd>L</kbd>', 'Horn, headlights'],
  ['<kbd>T</kbd> <kbd>G</kbd>', 'Couple trailer, landing gear'],
  ['<kbd>R</kbd> <kbd>F</kbd>', 'Raise and lower the dump bed'],
  ['<kbd>E</kbd>', 'Get in and out of the cab, fuel, wash, dealer, job steps'],
  ['<kbd>J</kbd>', 'Job board'],
  ['<kbd>Tab</kbd>', 'Montello map: click to set a route'],
  ['<kbd>O</kbd>', 'Your fleet, repairs and the paint shop'],
  ['<kbd>Y</kbd>', 'Build on your Haulers Lane lot'],
  ['<kbd>F9</kbd>', 'Bring the rig back to your lot'],
  ['<kbd>Mouse</kbd>', 'Look around on foot'],
  ['<kbd>Esc</kbd>', 'Menu'],
]

/** Puts Life Sim's page shell (styles, loading and start screens, HUD) in place of the county page and retitles it. */
async function mountMontelloShell(): Promise<void> {
  const shell = (await import('../foxlake/index.html?raw')).default
  const doc = new DOMParser().parseFromString(shell, 'text/html')
  for (const style of Array.from(doc.head.querySelectorAll('style'))) document.head.append(style)
  const trucking = document.createElement('style')
  trucking.textContent = '#start .lobby-browser,#book-btn{display:none!important}'
  document.head.append(trucking)
  document.body.replaceChildren(...Array.from(doc.body.children).filter((node) => node.tagName !== 'SCRIPT'))
  document.title = 'Truck Simulator · the library'
  for (const title of Array.from(document.querySelectorAll('.fl-title'))) title.textContent = 'Truck Simulator'
  const subs = Array.from(document.querySelectorAll('.fl-sub'))
  if (subs[0]) subs[0].textContent = 'Montello, Wisconsin: Haulers Lane, the quarry, the farms and the fuel terminal'
  if (subs[1]) subs[1].textContent = 'Haul gravel, fuel, grain, steel, cold freight and heavy equipment around Montello and the country round it. Your rig waits at your lot on Haulers Lane, east of Foxtails off State Highway 23: earn your way into semis, build up your lot, and climb out of the cab to walk the town.'
  const loadText = document.getElementById('load-text')
  if (loadText) loadText.textContent = 'Warming up the engine…'
  const keys = document.querySelector('#start .rr-keys')
  if (keys) keys.innerHTML = TRUCKING_KEYS.map(([key, text]) => `<div>${key} ${text}</div>`).join('')
  const start = document.getElementById('start-btn')
  if (start) start.textContent = 'Start driving'
  const canvas = document.getElementById('scene')
  canvas?.setAttribute('aria-label', 'Truck Simulator 3D view')
}

async function bootCounty(): Promise<void> {
  const canvas = document.getElementById('scene') as HTMLCanvasElement | null
  const ui = document.getElementById('ui')
  const boot = document.getElementById('boot')
  const bar = document.getElementById('boot-bar')
  const text = document.getElementById('boot-text')
  if (!canvas || !ui || !boot) throw new Error('Truck Simulator page is missing its canvas or overlay')
  try {
    const { Standalone } = await import('./game/Standalone')
    const host = await Standalone.boot(canvas, ui, (share, message) => {
      if (bar) bar.style.width = `${Math.round(share * 100)}%`
      if (text) text.textContent = message
    })
    boot.hidden = true
    ;(window as Window & { __trucksim?: unknown }).__trucksim = host
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

async function main(): Promise<void> {
  document.title = 'Truck Simulator · the library'
  if (new URLSearchParams(location.search).get('world') === 'county') {
    await bootCounty()
    return
  }
  await mountMontelloShell()
  const { bootMontello } = await import('../foxlake/boot')
  bootMontello({ trucking: true })
}

void main()
