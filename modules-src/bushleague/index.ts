/** Bush League Baseball entry: boots the shared engine with the tier's broadcast budget (AgX HDR output, post chain, cascaded shadows, adaptive resolution), builds the park, lights, crowd and grass for each contest, binds the screens and hands the contest to the Director; tears everything down on pagehide. */
import * as THREE from 'three/webgpu'
import { App, Input, applyEnvironment, createLighting, createPost, resolveQuality } from '../../engine'
import { createAdaptiveResolution } from '../_shared/adaptive-resolution.js'
import { config, type Action } from './config'
import { LIGHT_PRESETS, TIER_BUDGETS, themeFor, type TimeOfDay } from './looks'
import { Contest, parkById, stringSeed } from './sim'
import { Director, type Scenery } from './systems/Director'
import { Screens, type SetupChoice } from './ui/Screens'
import { Broadcast } from './ui/Broadcast'
import { OnlinePanel } from './ui/OnlinePanel'
import { OnlineLink, type ConnectOptions, type FinalMessage, type OnlineEvents } from './systems/Online'
import { isRoomCode } from './shared/Online'
import { BallparkAudio } from './systems/Audio'
import { Actors } from './view/Actors'
import { createCrowd, type Crowd } from './view/Crowd'
import { createField, type FieldView } from './view/Field'
import { createGrass, type GrassField } from './view/Grass'
import { createStadiumLights, type StadiumLights } from './view/Lights'

declare global {
  interface Window {
    __tlModule?: { app: App; backend: string; tier: string; steps: () => number }
    __bushleague?: { director: Director; start(choice?: Partial<SetupChoice>, seed?: number): Contest; contest(): Contest | null; tick(dt: number): void; scene(): { crowd: number; grass: number; post: boolean; cascades: number }; react(kind: 'homer' | 'final'): void; online(): OnlineLink | null }
  }
}

async function boot(): Promise<void> {
  const container = document.getElementById('stage')
  if (!container) throw new Error('Missing #stage')
  document.title = `${config.meta.title} · the library`
  document.documentElement.style.setProperty('--module-accent', config.meta.accent)

  const app = await App.create({ container, config: config.engine })
  const quality = resolveQuality(config.engine.quality, app.backend)
  const budget = TIER_BUDGETS[quality.tier]
  app.setPixelRatioCap(budget.pixelRatio)
  app.own(applyEnvironment(app.scene, config.engine.environment))
  const rig = app.own(createLighting(config.engine.lighting, quality.settings))
  app.graph.add('world', rig.root)
  rig.follow(new THREE.Vector3(0, 0, -55))
  const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)').matches
  const effects = budget.post && reducedMotion ? { ...budget.post, flare: undefined, grain: undefined } : budget.post
  const post = app.own(createPost(app, { ...config.engine.post, effects: effects ?? undefined }, { ...quality.settings, post: !!effects }))
  const adaptive = budget.adaptive ? createAdaptiveResolution({ max: budget.pixelRatio, min: 0.75, apply: (ratio) => app.setPixelRatioCap(ratio) }) : null

  const input = app.own(new Input<Action>(container, config.bindings, config.engine.input))
  const actors = new Actors(config.actors)
  app.graph.add('characters', actors.root)
  app.own(actors)
  const screens = new Screens()
  const broadcast = new Broadcast(input)
  const audio = new BallparkAudio((text) => broadcast.say(text))

  let field: FieldView | null = null
  let lights: StadiumLights | null = null
  let crowd: Crowd | null = null
  let grass: GrassField | null = null

  const dressPark = (contest: Contest, time: TimeOfDay) => {
    lights?.dispose()
    crowd?.dispose()
    grass?.dispose()
    field?.dispose()
    const home = contest.teams[1].roster.team
    const away = contest.teams[0].roster.team
    const theme = themeFor(contest.park.id)
    field = createField(contest.park, config.field, theme, home, away)
    app.graph.add('world', field.root)
    lights = createStadiumLights(app, rig, budget, field.towers, field.lampMaterial)
    const preset = LIGHT_PRESETS[time]
    lights.setPreset(preset)
    if (theme.fogTint && app.scene.fog) (app.scene.fog as THREE.Fog).color.lerp(new THREE.Color(theme.fogTint), 0.35)
    field.signature?.setTimeOfDay(time)
    crowd = createCrowd(field.bowl, budget.crowd, home.colors, away.colors, contest.setup.seed)
    if (crowd) app.graph.add('props', crowd.mesh)
    grass = createGrass(contest.park, budget.grassBlades, theme.grass[0], theme.grass[1], contest.setup.seed)
    if (grass) app.graph.add('props', grass.mesh)
    audio.setAmbience(theme.signature ?? 'none', time !== 'day')
  }

  const scenery: Scenery = {
    excite: (level) => {
      crowd?.excite(level)
      audio.swell(level)
    },
    startWave: () => {
      if (!reducedMotion) crowd?.startWave()
    },
    celebrate: (kind) => field?.celebrate(kind),
    scuff: (x, z, radius, strength, angle, length) => field?.dirt.scuff(x, z, radius, strength, angle, length),
  }

  const director = new Director(
    app,
    input,
    actors,
    screens,
    config,
    {
      onContest(contest, choice) {
        dressPark(contest, choice.time)
      },
      onFinal() {
        screens.setHint('')
        if (link?.finalMessage) showOnlineResult(link.finalMessage)
      },
    },
    scenery,
    { broadcast, audio, post },
  )
  const preview = new Contest({ seed: 1, away: 'sal', home: 'frt', innings: 3, dh: true, autoRunner: true, mercy: false, park: parkById('outhouse').id })
  dressPark(preview, 'night')
  actors.bind(preview)
  actors.setScene(preview, 'R')

  let seed = stringSeed(`${Date.now()}`) % 1_000_000
  const start = (choice: SetupChoice, customSeed?: number) => {
    screens.showSetup(false)
    screens.hideFinal()
    seed = customSeed ?? seed + 1
    return director.start(choice, seed)
  }
  const panel = new OnlinePanel()
  const rematchButton = document.getElementById('rematch-button') as HTMLButtonElement
  let link: OnlineLink | null = null
  let inviteRequested = false

  const postRoom = (code: string) => {
    try {
      if (window.parent !== window) window.parent.postMessage({ type: 'tl-room', code }, location.origin)
    } catch {
      /* standalone */
    }
  }

  function showOnlineResult(message: FinalMessage): void {
    if (!link) return
    const mine = message.winner === link.side
    const text = message.reason === 'forfeit' ? (mine ? 'Your opponent did not come back, so the win is yours.' : 'You were away too long, so this one went to your opponent.') : message.reason === 'concede' ? (mine ? 'Your opponent conceded.' : 'You conceded.') : link.ranked ? 'Ranked result saved.' : ''
    panel.showResult(text, message.ratings[link.side])
    rematchButton.hidden = link.ranked
    rematchButton.disabled = false
    rematchButton.textContent = 'Rematch'
    void panel.refreshRatings()
  }

  const leaveOnline = () => {
    link?.close()
    link = null
    director.leaveOnline()
    panel.hideLobby()
    panel.setOpponent([], null, false)
    panel.clearResult()
    rematchButton.hidden = false
    rematchButton.disabled = false
    rematchButton.textContent = 'Rematch'
  }

  const backToSetup = () => {
    screens.hideFinal()
    screens.showSetup(true)
    broadcast.hide()
    director.stage = 'idle'
  }

  const goOnline = (options: Omit<ConnectOptions, 'team' | 'options'>) => {
    leaveOnline()
    const choice = screens.readChoice()
    screens.setup.hidden = true
    panel.setNote('')
    panel.showLobby('Connecting', 'Opening the line to the ballpark…', [], null)
    const events: OnlineEvents = {
      lobby: (title, text, players, code) => {
        panel.showLobby(title, text, players, code)
        if (code && inviteRequested) {
          inviteRequested = false
          postRoom(code)
        }
      },
      start: (setup, current, players) => {
        panel.hideLobby()
        panel.clearResult()
        screens.showSetup(false)
        screens.hideFinal()
        director.startOnline(choice, setup, current)
        panel.setOpponent(players, current.side, current.ranked)
        panel.setConcede(true)
      },
      players: (players) => {
        if (!link) return
        panel.setOpponent(link.setup ? players : [], link.side, link.ranked)
        if (!link.setup && !link.ranked && link.code) panel.showLobby(`Room ${link.code}`, players.length > 1 ? 'Both players are here.' : 'Waiting for your opponent to join…', players, link.code)
      },
      final: (message) => {
        panel.setConcede(false)
        if (message.reason !== 'final') director.endOnline(message.winner)
        else if (director.stage === 'final') showOnlineResult(message)
      },
      rematch: (sides) => {
        if (!link) return
        screens.say(sides.includes(link.side) ? 'Waiting for your opponent to accept the rematch…' : 'Your opponent wants a rematch.', 3)
      },
      notice: (text) => screens.say(text, 3.2),
      ended: (text) => {
        const atFinal = director.stage === 'final'
        leaveOnline()
        if (atFinal) return
        backToSetup()
        panel.setNote(text)
      },
    }
    link = new OnlineLink(events, { ...options, team: choice.team, options: { innings: choice.innings, dh: choice.dh, autoRunner: choice.autoRunner, mercy: choice.mercy } })
    link.connect()
  }

  screens.bindSetup((choice) => {
    leaveOnline()
    start(choice)
  })
  panel.bind({
    ranked: () => goOnline({ mode: 'queue' }),
    create: () => goOnline({ mode: 'create' }),
    join: (code) => goOnline({ mode: 'join', code }),
    leave: () => {
      leaveOnline()
      backToSetup()
    },
    concede: () => link?.send({ t: 'concede' }),
  })
  screens.showSetup(true)
  rematchButton.addEventListener('click', () => {
    if (link) {
      link.send({ t: 'rematch' })
      rematchButton.disabled = true
      rematchButton.textContent = 'Waiting for opponent…'
      return
    }
    screens.hideFinal()
    director.rematch()
  })
  document.getElementById('new-button')?.addEventListener('click', () => {
    leaveOnline()
    backToSetup()
  })
  addEventListener('message', (event) => {
    if (event.origin !== location.origin || (event.data as { type?: string } | null)?.type !== 'tl-host') return
    if (link?.code && !link.ranked) return postRoom(link.code)
    if (link) return screens.say('Ranked matchups are paired automatically; open a private room to invite someone.', 3)
    inviteRequested = true
    goOnline({ mode: 'create' })
  })
  const invited = new URLSearchParams(location.search).get('room')?.toUpperCase() ?? ''
  if (isRoomCode(invited)) goOnline({ mode: 'join', code: invited })

  let frames = 0
  const tick = (dt: number) => {
    director.update(dt)
    actors.update(dt)
    field?.update(dt)
    crowd?.update(dt)
    lights?.update(dt)
    audio.update(dt)
  }
  app.onFrame((frameSeconds) => {
    frames++
    tick(Math.min(frameSeconds, 0.1))
    adaptive?.update(frameSeconds)
  })
  app.start()

  window.__tlModule = { app, backend: app.backend, tier: quality.tier, steps: () => frames }
  window.__bushleague = {
    director,
    start: (choice = {}, customSeed) => start({ team: 'frt', opponent: 'sal', side: 'watch', innings: 3, difficulty: 'rookie', level: config.difficulty.rookie, dh: true, autoRunner: true, mercy: false, time: 'night', trail: true, assist: false, colorSafe: false, replays: false, ...choice }, customSeed),
    contest: () => director.contest,
    tick,
    scene: () => ({ crowd: crowd?.mesh.count ?? 0, grass: grass?.mesh.count ?? 0, post: post.enabled, cascades: budget.cascades }),
    react: (kind: 'homer' | 'final') => {
      scenery.celebrate(kind)
      scenery.excite(1)
    },
    online: () => link,
  }
  addEventListener(
    'pagehide',
    () => {
      director.dispose()
      audio.dispose()
      lights?.dispose()
      crowd?.dispose()
      grass?.dispose()
      field?.dispose()
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
