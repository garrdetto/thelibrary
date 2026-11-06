/** Bush League Baseball entry: boots the shared engine, builds the gray-box park and players, binds the setup and final screens and hands each contest to the Director; tears everything down on pagehide. */
import * as THREE from 'three/webgpu'
import { App, Input, applyEnvironment, createLighting, createPost, disposeObject, resolveQuality } from '../../engine'
import { config, type Action } from './config'
import { Contest, parkById, stringSeed } from './sim'
import { Director } from './systems/Director'
import { Screens, type SetupChoice } from './ui/Screens'
import { Actors } from './view/Actors'
import { createField, type FieldView } from './view/Field'
import { createSky } from './view/Sky'

declare global {
  interface Window {
    __tlModule?: { app: App; backend: string; tier: string; steps: () => number }
    __bushleague?: { director: Director; start(choice?: Partial<SetupChoice>, seed?: number): Contest; contest(): Contest | null }
  }
}

async function boot(): Promise<void> {
  const container = document.getElementById('stage')
  if (!container) throw new Error('Missing #stage')
  document.title = `${config.meta.title} · the library`
  document.documentElement.style.setProperty('--module-accent', config.meta.accent)

  const app = await App.create({ container, config: config.engine })
  const requested = new URLSearchParams(location.search).get('quality')
  const quality = resolveQuality(requested === 'low' || requested === 'medium' || requested === 'high' || requested === 'ultra' ? { ...config.engine.quality, requested } : config.engine.quality, app.backend)
  app.setPixelRatioCap(quality.settings.pixelRatioCap)
  app.own(applyEnvironment(app.scene, config.engine.environment))
  const lighting = app.own(createLighting(config.engine.lighting, quality.settings))
  app.graph.add('world', lighting.root)
  lighting.follow(new THREE.Vector3(0, 0, -55))
  app.own(createPost(app, config.engine.post, quality.settings))
  const sky = app.graph.add('world', createSky('#2a5ba8', '#a9c6ea', '#1f3320'))

  const input = app.own(new Input<Action>(container, config.bindings, config.engine.input))
  const actors = new Actors(config.actors)
  app.graph.add('characters', actors.root)
  app.own(actors)
  const screens = new Screens()
  let field: FieldView | null = null

  const director = new Director(app, input, actors, screens, config, {
    onContest(contest) {
      field?.dispose()
      field = createField(contest.park, config.field, contest.teams[1].roster.team, contest.teams[0].roster.team)
      app.graph.add('world', field.root)
    },
    onFinal() {
      screens.setHint('')
    },
  })
  const defaultContest = new Contest({ seed: 1, away: 'sal', home: 'frt', innings: 3, dh: true, autoRunner: true, mercy: false })
  field = createField(parkById(defaultContest.teams[1].roster.team.park), config.field, defaultContest.teams[1].roster.team, defaultContest.teams[0].roster.team)
  app.graph.add('world', field.root)
  actors.placeFieldersHome()
  actors.hideBatter()

  let seed = stringSeed(`${Date.now()}`) % 1_000_000
  const start = (choice: SetupChoice, customSeed?: number) => {
    screens.showSetup(false)
    screens.hideFinal()
    seed = customSeed ?? seed + 1
    return director.start(choice, seed)
  }
  screens.bindSetup((choice) => start(choice))
  screens.showSetup(true)
  document.getElementById('rematch-button')?.addEventListener('click', () => {
    screens.hideFinal()
    director.rematch()
  })
  document.getElementById('new-button')?.addEventListener('click', () => {
    screens.hideFinal()
    screens.showSetup(true)
    director.stage = 'idle'
  })

  let frames = 0
  app.onFrame((frameSeconds) => {
    frames++
    director.update(Math.min(frameSeconds, 0.1))
  })
  app.start()

  window.__tlModule = { app, backend: app.backend, tier: quality.tier, steps: () => frames }
  window.__bushleague = {
    director,
    start: (choice = {}, customSeed) => start({ team: 'frt', opponent: 'sal', side: 'watch', innings: 3, pace: 'rookie', dh: true, autoRunner: true, mercy: false, ...choice }, customSeed),
    contest: () => director.contest,
  }
  addEventListener(
    'pagehide',
    () => {
      director.dispose()
      field?.dispose()
      disposeObject(sky)
      app.dispose()
    },
    { once: true },
  )
}

boot().catch((error: unknown) => {
  const stage = document.getElementById('stage')
  if (stage) stage.textContent = 'This learning module could not start on this device.'
  console.error(error)
})
