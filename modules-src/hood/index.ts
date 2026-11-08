/** The Hood: a street of player-owned houses. The street view and each lot are separate scenes, so only one detailed lot is ever loaded. */
import { App, Hud, createLighting, createPost, resolveQuality } from '../../engine'
import { config } from './config'
import { claimLot, fetchStreet, type StreetInfo } from './src/net/Api'
import { LocalLink, SocketLink, type LotLink } from './src/net/Link'
import type { Command } from './shared/Protocol'
import { LotMode } from './src/scene/LotMode'
import { Stage } from './src/scene/Stage'
import { StreetMode } from './src/scene/StreetMode'
import { openHouseholdDialog } from './src/ui/HouseholdDialog'
import { el, installStyles } from './src/ui/Ui'

interface Scene {
  update(dt: number): void
  dispose(): void
}

declare global {
  interface Window {
    __hood?: { scene: () => string; send: (command: Command) => void }
  }
}

async function boot(): Promise<void> {
  const container = document.getElementById('stage')
  if (!container) throw new Error('Missing #stage')
  document.title = `${config.meta.title} · the library`

  const app = await App.create({ container, config: config.engine })
  const quality = resolveQuality(config.engine.quality, app.backend)
  app.setPixelRatioCap(quality.settings.pixelRatioCap)
  const lighting = app.own(createLighting(config.engine.lighting, quality.settings))
  app.graph.add('world', lighting.root)
  app.own(createPost(app, config.engine.post, quality.settings))
  const hud = app.own(new Hud(config.engine.hud, config.meta.accent, container))
  const ui = installStyles(config.meta.accent)
  container.append(ui)
  const stage = new Stage(app, lighting, ui)

  let scene: Scene | null = null
  let sceneName = 'loading'
  let link: LotLink | null = null
  let street: StreetInfo | null = null
  const params = new URLSearchParams(location.search)

  const loading = el('div', { class: 'loading', role: 'status' }, 'Loading the street…')
  ui.append(loading)
  const showLoading = (text: string | null) => {
    loading.textContent = text ?? ''
    loading.style.opacity = text ? '1' : '0'
    loading.style.pointerEvents = text ? 'auto' : 'none'
  }

  const swap = (next: Scene, name: string) => {
    scene?.dispose()
    scene = next
    sceneName = name
  }

  const showStreet = async (index?: number, notice?: string) => {
    showLoading('Loading the street…')
    try {
      street = await fetchStreet(index)
    } catch (error) {
      showLoading(null)
      if (!street) {
        hud.toast('The street could not be reached, so here is the practice lot.')
        enterPractice()
        return
      }
      hud.toast(error instanceof Error ? error.message : 'The street could not be reached.')
      return
    }
    swap(new StreetMode(stage, street, {
      visit: lot => {
        const home = street?.me.home
        if (lot === -1 && home) {
          if (home.street !== street?.street) void showStreet(home.street).then(() => enterLot(home.street, home.lot))
          else enterLot(home.street, home.lot)
          return
        }
        if (street) enterLot(street.street, lot)
      },
      moveIn: lot => void moveIn(lot),
      practice: () => enterPractice(),
      changeStreet: n => void showStreet(Math.max(0, n)),
    }), 'street')
    showLoading(null)
    if (notice) hud.toast(notice)
  }

  const enterLot = (streetIndex: number, lot: number) => {
    const info = street
    if (!info) return
    showLoading(`Walking over to ${info.lots[lot]?.address ?? 'the lot'}…`)
    scene?.dispose()
    scene = null
    window.setTimeout(() => {
      const socket = new SocketLink(streetIndex, lot, { signedIn: info.me.signedIn })
      link = socket
      let ready = false
      const mode = new LotMode({
        stage, link: socket, street: info, practice: false,
        toast: text => hud.toast(text),
        exit: reason => { scene?.dispose(); scene = null; showLoading('Heading back to the street…'); window.setTimeout(() => void showStreet(streetIndex, reason), 500) },
      })
      const original = socket.onMessage
      socket.onMessage = message => {
        original(message)
        if (!ready && message.t === 'welcome') { ready = true; showLoading(null) }
      }
      swap(mode, 'lot')
    }, 350)
  }

  const enterPractice = () => {
    showLoading('Opening the practice lot…')
    const local = new LocalLink()
    link = local
    const mode = new LotMode({ stage, link: local, street, practice: true, toast: text => hud.toast(text), exit: () => void showStreet(street?.street) })
    const original = local.onMessage
    local.onMessage = message => { original(message); if (message.t === 'welcome') showLoading(null) }
    swap(mode, 'practice')
  }

  const moveIn = async (lot: number) => {
    const info = street
    if (!info || !info.me.signedIn) return
    const draft = await openHouseholdDialog(ui, info.lots[lot].address, info.me.name ?? 'Neighbor')
    if (!draft) return
    try {
      await claimLot(info.street, lot, draft)
    } catch (error) {
      hud.toast(error instanceof Error ? error.message : 'Moving in did not work. Please try again.')
      return
    }
    street = await fetchStreet(info.street).catch(() => info)
    hud.toast(`Welcome home to ${info.lots[lot].address}!`)
    enterLot(info.street, lot)
  }

  app.onFrame(dt => {
    const step = Math.min(dt, 0.1)
    stage.rig.update(step)
    scene?.update(step)
  })
  app.start()
  let frames = 0
  app.onFixed(() => { frames++ })
  window.__tlModule = { app, backend: app.backend, tier: quality.tier, steps: () => frames }
  window.__hood = { scene: () => sceneName, send: command => link?.send(command) }
  addEventListener('pagehide', () => { scene?.dispose(); stage.dispose(); app.dispose() }, { once: true })

  if (params.has('solo')) enterPractice()
  else await showStreet(params.has('street') ? Number(params.get('street')) || 0 : undefined)
}

boot().catch((error: unknown) => {
  const stage = document.getElementById('stage')
  if (stage) stage.textContent = 'This learning module could not start on this device.'
  console.error(error)
})
