/** The Guide's Almanac: the bite right now and sun and moon times for everyone; with the Almanac bought in the shop, also an hour-by-hour outlook for the next day at the angler's spot, sun and moon times, every named spot on the lake and what the current rig is likely to hook. Read-only; it uses the same rules as the catch rolls. */
import { activity, conditionsAt, outlook, speciesChances } from '../shared/Catch'
import type { FishingContext } from '../shared/Catch'
import { centralTime, moonPhase, moonPhaseName, moonPosition, sunPosition } from '../shared/Astro'
import { depthFeetAt, spotsOf, waterTempF } from '../shared/Lakes'
import { windCompass } from '../shared/Weather'
import { SPECIES } from '../shared/Species'
import { PRESENTATIONS, RODS } from '../shared/Gear'

const HOUR = 3600_000
const esc = (s: string) => s.replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!)

function clock(date: Date): string {
  const ct = centralTime(date)
  const h = ((ct.hour + 11) % 12) + 1
  return `${h}:${String(ct.minute).padStart(2, '0')} ${ct.hour < 12 ? 'am' : 'pm'}`
}

function hourLabel(date: Date): string {
  const ct = centralTime(date)
  const h = ((ct.hour + 11) % 12) + 1
  return `${h}${ct.hour < 12 ? 'a' : 'p'}`
}

function word(a: number): string {
  return a > 1.8 ? 'Hot' : a > 1.1 ? 'Good' : a > 0.6 ? 'Fair' : a > 0.3 ? 'Slow' : 'Dead'
}

/** Rise, set and highest point of a body over the next 24 hours, in 10-minute steps. */
function passes(from: Date, altitude: (d: Date) => number) {
  let rise: Date | null = null, set: Date | null = null, top: Date | null = null, best = -90
  let prev = altitude(from)
  for (let m = 10; m <= 24 * 60; m += 10) {
    const d = new Date(from.getTime() + m * 60_000)
    const a = altitude(d)
    if (!rise && prev < 0 && a >= 0) rise = d
    if (!set && prev >= 0 && a < 0) set = d
    if (a > best) { best = a; top = d }
    prev = a
  }
  return { rise, set, top: best > 0 ? top : null }
}

export function renderAlmanac(ctx: Omit<FishingContext, 'date' | 'settled'>, date: Date, owned: boolean, price: number): string {
  const base: FishingContext = { ...ctx, date, settled: 60 }
  const c = conditionsAt(base)
  const now = outlook(base, c)
  const w = c.weather
  const trend = w.pressureTrend < -0.03 ? 'falling' : w.pressureTrend > 0.04 ? 'rising' : 'steady'

  const hours = Array.from({ length: 24 }, (_, i) => {
    const d = new Date(Math.floor(date.getTime() / HOUR) * HOUR + i * HOUR)
    return { d, a: activity({ ...base, date: d }) }
  })
  const best = [...hours].sort((a, b) => b.a - a.a).slice(0, 3).sort((a, b) => a.d.getTime() - b.d.getTime())
  const bars = hours.map(h => `<span title="${esc(`${hourLabel(h.d)}: ${word(h.a)} bite`)}" class="alm-bar is-${word(h.a).toLowerCase()}" style="height:${Math.round(8 + (h.a / 3) * 92)}%"><i>${centralTime(h.d).hour % 3 === 0 ? hourLabel(h.d) : ''}</i></span>`).join('')

  const sun = passes(date, d => sunPosition(d).altitude)
  const moon = passes(date, d => moonPosition(d).altitude)
  const when = (d: Date | null) => (d ? clock(d) : '—')

  const spots = spotsOf(ctx.lake).map(s => {
    const o = outlook({ ...base, x: s.x, z: s.z })
    return { s, o, depth: depthFeetAt(ctx.lake, s.x, s.z) }
  }).sort((a, b) => b.o.activity - a.o.activity)

  const chances = speciesChances(base, c).sort((a, b) => b.weight - a.weight)
  const total = chances.reduce((t, x) => t + x.weight, 0) || 1
  const rod = RODS[ctx.rig.rod], bait = PRESENTATIONS[ctx.rig.presentation]

  return `
    <div class="pan-grid alm">
      <section><h3>Right now</h3>
        <div class="stat-row">
          <div><small>Bite</small><strong>${word(now.activity)}</strong></div>
          <div><small>Water</small><strong>${Math.round(c.surfaceTemp)}°F</strong></div>
          <div><small>Barometer</small><strong>${w.pressure.toFixed(2)}</strong></div>
          <div><small>Moon</small><strong>${esc(moonPhaseName(moonPhase(date)))}</strong></div>
        </div>
        <p class="ang-note">${esc(w.label)} · air ${w.airTempF}°F · wind ${windCompass(w.windDir)} ${Math.round(w.windMph)} mph · pressure ${trend} · ${c.depth.toFixed(0)} ft under the boat, ${Math.round(waterTempF(ctx.lake, date, c.depth * 0.9))}°F near bottom${c.thermocline > 0 ? ` · thermocline near ${Math.round(c.thermocline)} ft` : ''}</p>
      </section>
      ${owned ? `<section><h3>Next 24 hours at this spot</h3>
        <div class="alm-bars" role="img" aria-label="Bite outlook by hour">${bars}</div>
        <p class="ang-note">Best windows: ${best.map(h => `${hourLabel(h.d)} (${word(h.a).toLowerCase()})`).join(', ')}. Low light, a falling barometer, moon overhead or underfoot and a light chop all help; a crowd of boats thins it.</p>
      </section>` : ''}
      <section><h3>Sun and moon</h3>
        <div class="stat-row">
          <div><small>Sunrise</small><strong>${when(sun.rise)}</strong></div>
          <div><small>Sunset</small><strong>${when(sun.set)}</strong></div>
          <div><small>Moonrise</small><strong>${when(moon.rise)}</strong></div>
          <div><small>Moon overhead</small><strong>${when(moon.top)}</strong></div>
        </div>
      </section>
      ${owned ? `<section><h3>Spots on ${esc(ctx.lake.name)}</h3>
        <ul class="alm-list">${spots.map(({ s, o, depth }) => `<li><span><strong>${esc(s.name)}</strong><small>${depth.toFixed(0)} ft · ${o.top.map(id => SPECIES[id].name.toLowerCase()).join(', ') || 'little holding here'}</small></span><b class="is-${word(o.activity).toLowerCase()}">${word(o.activity)}</b></li>`).join('')}</ul>
      </section>
      <section><h3>Likely on your ${esc(rod.name.toLowerCase())} and ${esc(bait.short.toLowerCase())}</h3>
        <ul class="alm-list">${chances.slice(0, 6).map(x => `<li><span><strong>${esc(SPECIES[x.id].name)}</strong><small>${esc(SPECIES[x.id].latin)}</small></span><b>${Math.max(1, Math.round((x.weight / total) * 100))}%</b></li>`).join('') || '<li><span>Nothing here takes that bait. Try another presentation or spot.</span></li>'}</ul>
      </section>` : `<section class="alm-locked"><h3>The full Guide's Almanac</h3>
        <p class="ang-note">An hour-by-hour bite outlook for the next day at your boat, every named spot on the lake ranked right now, and the species your rod and presentation are most likely to hook. It reads the same rules the lake rolls with; it never changes the odds.</p>
        <div class="pan-actions"><button type="button" class="ang-btn is-primary" data-buy="almanac">Buy the Almanac · ${price.toLocaleString()} TC</button></div>
      </section>`}
    </div>`
}
