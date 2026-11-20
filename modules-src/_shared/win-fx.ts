export type WinTier = 'big' | 'huge'
export type ParticleKind = 'coin' | 'bill' | 'gem' | 'leaf' | 'spark'

export const BIG_WIN_AT = 15
export const HUGE_WIN_AT = 50

export function winTier(win: number, bet: number): WinTier | null {
  if (!(bet > 0) || !(win > 0)) return null
  const multiple = win / bet
  if (multiple >= HUGE_WIN_AT) return 'huge'
  if (multiple >= BIG_WIN_AT) return 'big'
  return null
}

export function countDuration(tier: WinTier | 'tally', multiple: number, turbo = false): number {
  const base = tier === 'huge' ? 4600 + Math.min(3000, multiple * 12) : tier === 'big' ? 2800 + Math.min(1400, multiple * 30) : 900
  return turbo ? base * 0.5 : base
}

export function easeOutCubic(t: number): number {
  const clamped = Math.max(0, Math.min(1, t))
  return 1 - (1 - clamped) ** 3
}

export interface WinFxSounds {
  start?(tier: WinTier): void
  tick?(): void
  land?(tier: WinTier | 'tally'): void
}

export interface WinFxOptions {
  format: (amount: number) => string
  font?: string
  particles?: ParticleKind[]
  parent?: HTMLElement
  zIndex?: number
  sounds?: WinFxSounds
  reducedMotion?: () => boolean
}

export interface CelebrateOptions {
  turbo?: boolean
  title?: string
}

export interface TallyOptions {
  start?: number
  subtitle?: string
}

export interface Tally {
  add(amount: number): void
  set(total: number): void
  subtitle(text: string): void
  finish(options?: { title?: string; hold?: number }): Promise<void>
  close(): void
}

export interface WinFx {
  celebrate(win: number, bet: number, options?: CelebrateOptions): Promise<boolean>
  tally(title: string, options?: TallyOptions): Tally
  dismiss(): void
  destroy(): void
}

interface Particle {
  kind: ParticleKind
  x: number
  y: number
  vx: number
  vy: number
  rot: number
  spin: number
  size: number
  life: number
  max: number
  phase: number
  hue: number
}

const STYLE_ID = 'tl-winfx-style'

const CSS = `
.wfx-root{position:fixed;inset:0;pointer-events:none;overflow:hidden;contain:strict;font-family:var(--wfx-font)}
.wfx-root canvas{position:absolute;inset:0;width:100%;height:100%}
.wfx-stage{position:absolute;inset:0;display:grid;place-items:center;pointer-events:auto;cursor:pointer;-webkit-tap-highlight-color:transparent}
.wfx-stage.wfx-out{animation:wfx-fade-out .45s ease-in forwards}
.wfx-shade{position:absolute;inset:0;background:radial-gradient(ellipse at center,rgba(0,0,0,.25) 0%,rgba(0,0,0,.72) 70%,rgba(0,0,0,.86) 100%);animation:wfx-fade-in .35s ease-out both}
.wfx-rays{position:absolute;left:50%;top:50%;width:190vmax;height:190vmax;margin:-95vmax 0 0 -95vmax;background:repeating-conic-gradient(from 0deg,var(--wfx-ray) 0deg 7deg,transparent 7deg 18deg);-webkit-mask:radial-gradient(circle,#000 0%,rgba(0,0,0,.55) 22%,transparent 46%);mask:radial-gradient(circle,#000 0%,rgba(0,0,0,.55) 22%,transparent 46%);animation:wfx-spin 14s linear infinite,wfx-fade-in .6s ease-out both}
.wfx-huge .wfx-rays{animation:wfx-spin 6s linear infinite,wfx-fade-in .4s ease-out both}
.wfx-card{position:relative;display:flex;flex-direction:column;align-items:center;gap:.6vmin;text-align:center;padding:0 4vw;max-width:100vw}
.wfx-kicker{font-size:clamp(14px,3.4vmin,30px);letter-spacing:.18em;text-transform:uppercase;color:#fff4c8;text-shadow:0 2px 0 rgba(0,0,0,.7),0 0 18px rgba(0,0,0,.6);animation:wfx-rise .5s .55s cubic-bezier(.2,1.4,.4,1) both}
.wfx-title{display:flex;flex-wrap:wrap;justify-content:center;column-gap:.32em;line-height:.95;font-size:clamp(48px,17vmin,190px);white-space:nowrap}
.wfx-huge .wfx-title{font-size:clamp(54px,20vmin,230px)}
.wfx-word{display:inline-flex}
.wfx-letter{display:inline-block;background:var(--wfx-face);background-size:100% 260%;-webkit-background-clip:text;background-clip:text;color:transparent;-webkit-text-stroke:.035em var(--wfx-edge);paint-order:stroke fill;filter:drop-shadow(0 .055em 0 var(--wfx-edge)) drop-shadow(0 0 .22em var(--wfx-glow));animation:wfx-drop .62s calc(var(--i) * 70ms) cubic-bezier(.2,1.5,.4,1) both,wfx-bob 1.6s calc(.7s + var(--i) * 90ms) ease-in-out infinite alternate,wfx-sheen 2.4s linear infinite}
.wfx-huge .wfx-letter{animation:wfx-drop .7s calc(var(--i) * 85ms) cubic-bezier(.2,1.6,.4,1) both,wfx-bob 1.1s calc(.8s + var(--i) * 80ms) ease-in-out infinite alternate,wfx-sheen 1.1s linear infinite}
.wfx-amount{font-size:clamp(34px,11vmin,124px);font-variant-numeric:tabular-nums;line-height:1;background:linear-gradient(180deg,#ffffff 0%,#fff3b0 45%,#ffc93a 70%,#fff0a0 100%);-webkit-background-clip:text;background-clip:text;color:transparent;-webkit-text-stroke:.03em #2a1500;paint-order:stroke fill;filter:drop-shadow(0 .05em 0 #1a0d00) drop-shadow(0 0 .3em rgba(255,214,90,.75));animation:wfx-rise .5s .35s cubic-bezier(.2,1.4,.4,1) both}
.wfx-amount.wfx-slam{animation:wfx-slam .5s cubic-bezier(.2,1.8,.4,1) both}
.wfx-hint{margin-top:1.6vmin;font-size:clamp(11px,2vmin,15px);letter-spacing:.12em;text-transform:uppercase;color:rgba(255,255,255,.72);text-shadow:0 1px 0 #000;animation:wfx-fade-in .4s 1.4s both}
.wfx-shake{animation:wfx-shake .5s linear}
.wfx-tally{position:absolute;inset:0;display:grid;place-items:center;pointer-events:none}
.wfx-tally-card{position:relative;display:flex;flex-direction:column;align-items:center;text-align:center;animation:wfx-pop-in .45s cubic-bezier(.2,1.5,.4,1) both}
.wfx-tally-card.wfx-out{animation:wfx-fade-out .4s ease-in forwards}
.wfx-tally-title{display:flex;flex-wrap:wrap;justify-content:center;column-gap:.3em;font-size:clamp(20px,6vmin,64px);line-height:1}
.wfx-tally-title .wfx-letter{animation:wfx-drop .5s calc(var(--i) * 45ms) cubic-bezier(.2,1.5,.4,1) both,wfx-sheen 2.4s linear infinite}
.wfx-tally-sub{margin-top:.6vmin;font-size:clamp(12px,2.6vmin,22px);letter-spacing:.14em;text-transform:uppercase;color:#fff4c8;text-shadow:0 2px 0 rgba(0,0,0,.8)}
.wfx-tally-num{position:relative;margin-top:.4vmin;font-size:clamp(46px,16vmin,180px);font-variant-numeric:tabular-nums;line-height:1;background:linear-gradient(180deg,#ffffff 0%,#fff3b0 42%,#ffc93a 68%,#fff0a0 100%);-webkit-background-clip:text;background-clip:text;color:transparent;-webkit-text-stroke:.03em #1d0f00;paint-order:stroke fill;filter:drop-shadow(0 .05em 0 #120800) drop-shadow(0 0 .35em rgba(255,214,90,.8)) drop-shadow(0 0 1.2em rgba(0,0,0,.65))}
.wfx-tally-num.wfx-bump{animation:wfx-bump .32s cubic-bezier(.2,1.8,.4,1)}
.wfx-tally-num.wfx-slam{animation:wfx-slam .55s cubic-bezier(.2,1.8,.4,1)}
.wfx-plus{position:absolute;left:50%;top:38%;transform:translateX(-50%);font-size:clamp(18px,5.2vmin,58px);white-space:nowrap;color:#b6ff9a;-webkit-text-fill-color:#b6ff9a;-webkit-text-stroke:.05em #062a00;text-shadow:0 0 .4em rgba(120,255,110,.8);animation:wfx-float 1s ease-out forwards;pointer-events:none}
@keyframes wfx-drop{0%{opacity:0;transform:translateY(-1.4em) scale(2.4) rotate(-14deg)}55%{opacity:1;transform:translateY(.08em) scale(.9) rotate(4deg)}78%{transform:translateY(-.04em) scale(1.06) rotate(-2deg)}100%{opacity:1;transform:none}}
@keyframes wfx-bob{from{transform:translateY(0) rotate(-1.5deg)}to{transform:translateY(-.07em) rotate(1.5deg)}}
@keyframes wfx-sheen{from{background-position:0 0}to{background-position:0 -260%}}
@keyframes wfx-rise{from{opacity:0;transform:translateY(.6em) scale(.7)}to{opacity:1;transform:none}}
@keyframes wfx-slam{0%{transform:scale(1)}35%{transform:scale(1.32)}70%{transform:scale(.94)}100%{transform:scale(1)}}
@keyframes wfx-bump{0%{transform:scale(1)}40%{transform:scale(1.14)}100%{transform:scale(1)}}
@keyframes wfx-pop-in{from{opacity:0;transform:scale(.5)}to{opacity:1;transform:none}}
@keyframes wfx-float{from{opacity:1;transform:translate(-50%,0)}to{opacity:0;transform:translate(-50%,-1.6em)}}
@keyframes wfx-spin{to{transform:rotate(360deg)}}
@keyframes wfx-fade-in{from{opacity:0}to{opacity:1}}
@keyframes wfx-fade-out{to{opacity:0}}
@keyframes wfx-shake{0%,100%{transform:none}10%{transform:translate(-1.2vmin,.6vmin)}25%{transform:translate(1.1vmin,-.8vmin)}40%{transform:translate(-.8vmin,-.5vmin)}55%{transform:translate(.7vmin,.7vmin)}70%{transform:translate(-.4vmin,.3vmin)}85%{transform:translate(.3vmin,-.2vmin)}}
@media (prefers-reduced-motion:reduce){.wfx-root *{animation-duration:.01ms!important;animation-iteration-count:1!important;animation-delay:0s!important}}
`

const FACES: Record<WinTier | 'tally', { face: string; edge: string; glow: string; ray: string }> = {
  big: { face: 'linear-gradient(180deg,#fffbe0 0%,#ffe47a 22%,#ffb000 45%,#c76a00 58%,#ffd54a 74%,#fff3b8 88%,#ffe47a 100%)', edge: '#3b1c00', glow: 'rgba(255,190,40,.85)', ray: 'rgba(255,214,110,.32)' },
  huge: { face: 'linear-gradient(180deg,#ffffff 0%,#ff9cf2 16%,#b46bff 32%,#3fd0ff 48%,#7dffb0 62%,#ffe45a 78%,#ff7a3a 90%,#ff9cf2 100%)', edge: '#220033', glow: 'rgba(210,120,255,.9)', ray: 'rgba(255,160,255,.3)' },
  tally: { face: 'linear-gradient(180deg,#fffbe0 0%,#ffe47a 25%,#ffb000 50%,#d27a00 62%,#ffe07a 80%,#fff6c8 100%)', edge: '#2e1600', glow: 'rgba(255,200,60,.8)', ray: 'transparent' },
}

function ensureStyle(): void {
  if (document.getElementById(STYLE_ID)) return
  const style = document.createElement('style')
  style.id = STYLE_ID
  style.textContent = CSS
  document.head.appendChild(style)
}

function lettersInto(target: HTMLElement, text: string, offset = 0): number {
  let index = offset
  for (const word of text.split(' ')) {
    const wordEl = document.createElement('span')
    wordEl.className = 'wfx-word'
    for (const char of word) {
      const letter = document.createElement('span')
      letter.className = 'wfx-letter'
      letter.textContent = char
      letter.style.setProperty('--i', String(index++))
      wordEl.appendChild(letter)
    }
    target.appendChild(wordEl)
  }
  target.setAttribute('aria-label', text)
  return index
}

function applyFace(element: HTMLElement, tier: WinTier | 'tally'): void {
  const face = FACES[tier]
  element.style.setProperty('--wfx-face', face.face)
  element.style.setProperty('--wfx-edge', face.edge)
  element.style.setProperty('--wfx-glow', face.glow)
  element.style.setProperty('--wfx-ray', face.ray)
}

export function createWinFx(options: WinFxOptions): WinFx {
  ensureStyle()
  const parent = options.parent ?? document.body
  const reduced = options.reducedMotion ?? (() => window.matchMedia('(prefers-reduced-motion: reduce)').matches)
  const kinds = options.particles?.length ? options.particles : (['coin', 'spark'] as ParticleKind[])
  const root = document.createElement('div')
  root.className = 'wfx-root'
  root.style.zIndex = String(options.zIndex ?? 80)
  root.style.setProperty('--wfx-font', options.font ?? '"Luckiest Guy", "Arial Black", Impact, system-ui, sans-serif')
  root.setAttribute('aria-live', 'polite')
  const canvas = document.createElement('canvas')
  canvas.setAttribute('aria-hidden', 'true')
  root.appendChild(canvas)
  parent.appendChild(root)
  const ctx = canvas.getContext('2d')

  let particles: Particle[] = []
  let raf = 0
  let last = 0
  let width = 0
  let height = 0
  let dpr = 1
  let rainUntil = 0
  let rainRate = 0
  let rainCarry = 0
  let active: { stage: HTMLElement; skip: () => void; close: () => void } | null = null
  let destroyed = false

  const resize = () => {
    dpr = Math.min(2, window.devicePixelRatio || 1)
    width = root.clientWidth || window.innerWidth
    height = root.clientHeight || window.innerHeight
    canvas.width = Math.max(1, Math.round(width * dpr))
    canvas.height = Math.max(1, Math.round(height * dpr))
  }

  const spawn = (kind: ParticleKind, x: number, y: number, vx: number, vy: number, size: number, life: number): void => {
    if (particles.length > 420) return
    particles.push({ kind, x, y, vx, vy, rot: Math.random() * Math.PI * 2, spin: (Math.random() - 0.5) * 9, size, life, max: life, phase: Math.random() * Math.PI * 2, hue: Math.random() })
  }

  const pickKind = (): ParticleKind => kinds[Math.floor(Math.random() * kinds.length)]

  const burst = (count: number, power: number): void => {
    if (reduced() || !ctx) return
    const unit = Math.min(width, height)
    for (let index = 0; index < count; index++) {
      const angle = Math.random() * Math.PI * 2
      const speed = unit * (0.35 + Math.random() * 0.9) * power
      const kind = Math.random() < 0.25 ? 'spark' : pickKind()
      spawn(kind, width / 2, height / 2, Math.cos(angle) * speed, Math.sin(angle) * speed - unit * 0.45, unit * (kind === 'spark' ? 0.012 : 0.032 + Math.random() * 0.02), 2.6 + Math.random() * 1.4)
    }
    run()
  }

  const rain = (seconds: number, perSecond: number): void => {
    if (reduced() || !ctx) return
    rainUntil = performance.now() + seconds * 1000
    rainRate = perSecond
    run()
  }

  const drawParticle = (g: CanvasRenderingContext2D, p: Particle): void => {
    const fade = Math.min(1, p.life / 0.6)
    g.save()
    g.globalAlpha = fade
    g.translate(p.x, p.y)
    g.rotate(p.rot)
    const s = p.size
    if (p.kind === 'coin') {
      const flip = Math.cos(p.phase)
      g.scale(Math.max(0.12, Math.abs(flip)), 1)
      const gradient = g.createRadialGradient(-s * 0.3, -s * 0.3, s * 0.1, 0, 0, s)
      gradient.addColorStop(0, flip > 0 ? '#fff6c0' : '#ffe07a')
      gradient.addColorStop(0.55, '#ffc21f')
      gradient.addColorStop(1, '#a35c00')
      g.fillStyle = gradient
      g.beginPath()
      g.arc(0, 0, s, 0, Math.PI * 2)
      g.fill()
      g.lineWidth = s * 0.14
      g.strokeStyle = '#7a4200'
      g.stroke()
      g.fillStyle = 'rgba(122,66,0,.75)'
      g.font = `bold ${s * 1.1}px system-ui, sans-serif`
      g.textAlign = 'center'
      g.textBaseline = 'middle'
      g.fillText('$', 0, s * 0.04)
    } else if (p.kind === 'bill') {
      g.scale(1, 0.55 + 0.45 * Math.abs(Math.sin(p.phase)))
      g.fillStyle = '#5fbf52'
      g.fillRect(-s * 1.4, -s * 0.66, s * 2.8, s * 1.32)
      g.strokeStyle = '#1f5e1a'
      g.lineWidth = s * 0.12
      g.strokeRect(-s * 1.4, -s * 0.66, s * 2.8, s * 1.32)
      g.fillStyle = '#9ee08f'
      g.beginPath()
      g.ellipse(0, 0, s * 0.45, s * 0.5, 0, 0, Math.PI * 2)
      g.fill()
      g.fillStyle = '#1f5e1a'
      g.font = `bold ${s * 0.75}px system-ui, sans-serif`
      g.textAlign = 'center'
      g.textBaseline = 'middle'
      g.fillText('$', 0, s * 0.03)
    } else if (p.kind === 'gem') {
      const hue = Math.floor(p.hue * 360)
      g.fillStyle = `hsl(${hue} 90% 62%)`
      g.beginPath()
      g.moveTo(0, -s)
      g.lineTo(s * 0.85, -s * 0.2)
      g.lineTo(0, s)
      g.lineTo(-s * 0.85, -s * 0.2)
      g.closePath()
      g.fill()
      g.fillStyle = 'rgba(255,255,255,.55)'
      g.beginPath()
      g.moveTo(0, -s)
      g.lineTo(s * 0.4, -s * 0.2)
      g.lineTo(-s * 0.4, -s * 0.2)
      g.closePath()
      g.fill()
    } else if (p.kind === 'leaf') {
      g.fillStyle = p.hue > 0.5 ? '#7fd85a' : '#4fb83a'
      g.beginPath()
      g.ellipse(0, 0, s * 1.2, s * 0.5, 0, 0, Math.PI * 2)
      g.fill()
    } else {
      g.globalCompositeOperation = 'lighter'
      g.fillStyle = `rgba(255,${200 + Math.floor(p.hue * 55)},140,1)`
      g.beginPath()
      for (let point = 0; point < 8; point++) {
        const radius = point % 2 === 0 ? s * 2.2 : s * 0.5
        const angle = (point / 8) * Math.PI * 2
        g.lineTo(Math.cos(angle) * radius, Math.sin(angle) * radius)
      }
      g.closePath()
      g.fill()
    }
    g.restore()
  }

  const frame = (now: number) => {
    raf = 0
    if (destroyed || !ctx) return
    const dt = Math.min(0.05, last ? (now - last) / 1000 : 0.016)
    last = now
    const unit = Math.min(width, height)
    if (now < rainUntil) {
      rainCarry += rainRate * dt
      while (rainCarry >= 1) {
        rainCarry -= 1
        const kind = Math.random() < 0.15 ? 'spark' : pickKind()
        spawn(kind, Math.random() * width, -unit * 0.05, (Math.random() - 0.5) * unit * 0.25, unit * (0.2 + Math.random() * 0.35), unit * (kind === 'spark' ? 0.01 : 0.028 + Math.random() * 0.018), 4)
      }
    }
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
    ctx.clearRect(0, 0, width, height)
    const gravity = unit * 1.15
    particles = particles.filter((p) => {
      p.life -= dt
      if (p.life <= 0 || p.y > height + unit * 0.2) return false
      const drag = p.kind === 'bill' || p.kind === 'leaf' ? 2.2 : 0.6
      p.vx -= p.vx * drag * dt
      p.vy += (p.kind === 'bill' || p.kind === 'leaf' ? gravity * 0.35 : gravity) * dt
      p.vy -= p.vy * (p.kind === 'bill' || p.kind === 'leaf' ? 1.8 : 0.2) * dt
      p.x += p.vx * dt + (p.kind === 'bill' || p.kind === 'leaf' ? Math.sin(p.phase) * unit * 0.12 * dt : 0)
      p.y += p.vy * dt
      p.rot += p.spin * dt * (p.kind === 'coin' ? 0.3 : 1)
      p.phase += dt * (p.kind === 'coin' ? 9 : 4)
      drawParticle(ctx, p)
      return true
    })
    if (particles.length || now < rainUntil) raf = requestAnimationFrame(frame)
    else last = 0
  }

  function run(): void {
    if (!raf && !destroyed) {
      resize()
      raf = requestAnimationFrame(frame)
    }
  }

  const onResize = () => resize()
  window.addEventListener('resize', onResize)

  const wait = (ms: number) => new Promise<void>((resolve) => window.setTimeout(resolve, ms))

  const celebrate = (win: number, bet: number, celebrateOptions: CelebrateOptions = {}): Promise<boolean> => {
    const tier = winTier(win, bet)
    if (!tier || destroyed) return Promise.resolve(false)
    active?.close()
    const multiple = win / bet
    const quiet = reduced()
    const stage = document.createElement('div')
    stage.className = `wfx-stage wfx-${tier}`
    stage.setAttribute('role', 'status')
    applyFace(stage, tier)
    const shade = document.createElement('div')
    shade.className = 'wfx-shade'
    const rays = document.createElement('div')
    rays.className = 'wfx-rays'
    const card = document.createElement('div')
    card.className = 'wfx-card'
    const title = document.createElement('div')
    title.className = 'wfx-title'
    lettersInto(title, celebrateOptions.title ?? (tier === 'huge' ? 'HUGE WIN' : 'BIG WIN'))
    const amount = document.createElement('div')
    amount.className = 'wfx-amount'
    amount.textContent = options.format(0)
    const kicker = document.createElement('div')
    kicker.className = 'wfx-kicker'
    kicker.textContent = `${multiple >= 100 ? Math.round(multiple).toLocaleString('en-US') : multiple.toFixed(1).replace(/\.0$/, '')}× your bet`
    const hint = document.createElement('div')
    hint.className = 'wfx-hint'
    hint.textContent = 'Tap to continue'
    card.append(title, amount, kicker, hint)
    stage.append(shade, rays, card)
    root.appendChild(stage)
    options.sounds?.start?.(tier)
    if (!quiet) {
      burst(tier === 'huge' ? 90 : 50, tier === 'huge' ? 1.25 : 1)
      rain(countDuration(tier, multiple, celebrateOptions.turbo) / 1000 + 1.2, tier === 'huge' ? 70 : 34)
      if (tier === 'huge') {
        card.classList.add('wfx-shake')
        window.setTimeout(() => card.classList.remove('wfx-shake'), 520)
      }
    }
    return new Promise<boolean>((resolve) => {
      const duration = quiet ? 0 : countDuration(tier, multiple, celebrateOptions.turbo)
      const started = performance.now()
      let counting = true
      let finished = false
      let ticker = 0
      let lastTick = 0
      const land = () => {
        if (!counting) return
        counting = false
        window.cancelAnimationFrame(ticker)
        amount.textContent = options.format(win)
        amount.classList.add('wfx-slam')
        options.sounds?.land?.(tier)
        if (!quiet) burst(tier === 'huge' ? 120 : 60, tier === 'huge' ? 1.4 : 1.1)
        holdTimer = window.setTimeout(close, quiet ? 1600 : celebrateOptions.turbo ? 1100 : 2000)
      }
      const close = () => {
        if (finished) return
        finished = true
        window.clearTimeout(holdTimer)
        window.cancelAnimationFrame(ticker)
        stage.classList.add('wfx-out')
        rainUntil = 0
        window.setTimeout(() => stage.remove(), 460)
        if (active?.stage === stage) active = null
        resolve(true)
      }
      let holdTimer = 0
      const step = (now: number) => {
        if (!counting) return
        const t = duration ? (now - started) / duration : 1
        if (t >= 1) {
          land()
          return
        }
        amount.textContent = options.format(Math.floor(win * easeOutCubic(t) * 100) / 100)
        if (now - lastTick > 90) {
          lastTick = now
          options.sounds?.tick?.()
        }
        ticker = window.requestAnimationFrame(step)
      }
      const skip = () => (counting ? land() : close())
      stage.addEventListener('pointerdown', (event) => {
        event.preventDefault()
        event.stopPropagation()
        skip()
      })
      active = { stage, skip, close }
      if (duration) ticker = window.requestAnimationFrame(step)
      else land()
    })
  }

  const tally = (titleText: string, tallyOptions: TallyOptions = {}): Tally => {
    const quiet = reduced()
    const layer = document.createElement('div')
    layer.className = 'wfx-tally'
    const card = document.createElement('div')
    card.className = 'wfx-tally-card'
    applyFace(card, 'tally')
    const title = document.createElement('div')
    title.className = 'wfx-tally-title'
    lettersInto(title, titleText)
    const sub = document.createElement('div')
    sub.className = 'wfx-tally-sub'
    sub.textContent = tallyOptions.subtitle ?? ''
    sub.hidden = !tallyOptions.subtitle
    const number = document.createElement('div')
    number.className = 'wfx-tally-num'
    card.append(title, number, sub)
    layer.appendChild(card)
    root.appendChild(layer)
    let shown = tallyOptions.start ?? 0
    let target = shown
    let from = shown
    let started = 0
    let anim = 0
    let closed = false
    number.textContent = options.format(shown)

    const animate = (now: number) => {
      anim = 0
      const t = quiet ? 1 : (now - started) / countDuration('tally', 0)
      shown = from + (target - from) * easeOutCubic(t)
      number.textContent = options.format(t >= 1 ? target : Math.floor(shown * 100) / 100)
      if (t < 1 && !closed) anim = window.requestAnimationFrame(animate)
      else shown = target
    }
    const goTo = (next: number) => {
      from = shown
      target = next
      started = performance.now()
      if (!anim) anim = window.requestAnimationFrame(animate)
      number.classList.remove('wfx-bump')
      void number.offsetWidth
      number.classList.add('wfx-bump')
    }
    const handle: Tally = {
      add(amount: number) {
        if (closed || !(amount > 0)) return
        goTo(target + amount)
        options.sounds?.tick?.()
        const plus = document.createElement('span')
        plus.className = 'wfx-plus'
        plus.textContent = `+${options.format(amount)}`
        card.appendChild(plus)
        window.setTimeout(() => plus.remove(), 1000)
      },
      set(total: number) {
        if (closed) return
        goTo(total)
      },
      subtitle(text: string) {
        sub.textContent = text
        sub.hidden = !text
      },
      async finish(finishOptions = {}) {
        if (closed) return
        if (finishOptions.title) {
          title.textContent = ''
          lettersInto(title, finishOptions.title)
        }
        await wait(quiet ? 0 : 450)
        window.cancelAnimationFrame(anim)
        anim = 0
        shown = target
        number.textContent = options.format(target)
        number.classList.remove('wfx-bump')
        void number.offsetWidth
        number.classList.add('wfx-slam')
        options.sounds?.land?.('tally')
        burst(70, 1.1)
        await wait(finishOptions.hold ?? 1900)
        handle.close()
      },
      close() {
        if (closed) return
        closed = true
        window.cancelAnimationFrame(anim)
        card.classList.add('wfx-out')
        window.setTimeout(() => layer.remove(), 420)
      },
    }
    return handle
  }

  return {
    celebrate,
    tally,
    dismiss() {
      active?.close()
    },
    destroy() {
      destroyed = true
      window.cancelAnimationFrame(raf)
      window.removeEventListener('resize', onResize)
      root.remove()
    },
  }
}
