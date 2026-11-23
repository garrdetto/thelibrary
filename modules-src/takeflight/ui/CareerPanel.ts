/**
 * The career on the start screen: level and XP bar, licence, Pilot Rating, hours and landings, and where it is saved. The
 * Checkrides screen lists every licence with its requirements, what the checkride asks for and its pass criteria, and starts
 * the checkride when the pilot qualifies. Also renders the career block of the debrief.
 */
import { CHECKRIDES, CHECKRIDE_SPECS, CLASS_LABELS, LICENCE_LABELS, PILOT_CLASSES, checkrideAvailability, classRating, currentLicence, hoursTotal, levelFor, levelProgress, pilotRating, xpForLevel } from '../shared/Career'
import type { CareerProfile, CheckrideId } from '../shared/Career'
import { HANGAR, HANGAR_CLASSES } from '../shared/Hangar'
import { airportById } from '../shared/Airports'
import { dayNumber, jobsFor } from '../shared/Cargo'
import type { CargoJob } from '../shared/Cargo'
import { AIRLINES, AIRLINE_IDS, RANKS, averageScore, nextRank, promotionGaps, rankOf, routesFor } from '../shared/Airlines'
import type { AirlineId, AirlineRoute } from '../shared/Airlines'
import { airlineBarriers } from '../shared/Career'
import { fleetSpec } from '../shared/Fleet'

const money = (value: number) => '$' + value.toLocaleString('en-US')
import type { CareerMode, RecordOutcome } from '../game/CareerStore'

function make<K extends keyof HTMLElementTagNameMap>(tag: K, className = '', text = ''): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag)
  if (className) node.className = className
  if (text) node.textContent = text
  return node
}

function button(label: string, onClick: () => void, className = 'tf-btn'): HTMLButtonElement {
  const b = make('button', className, label)
  b.type = 'button'
  b.addEventListener('click', onClick)
  return b
}

function xpBar(xp: number): HTMLElement {
  const level = levelFor(xp)
  const wrap = make('div', 'tf-xp')
  const track = make('div', 'tf-meter')
  const fill = make('i', 'good')
  fill.style.width = `${Math.round(levelProgress(xp) * 100)}%`
  track.append(fill)
  track.setAttribute('role', 'img')
  const next = level >= 100 ? 'top level' : `${(xpForLevel(level + 1) - xp).toLocaleString('en-US')} XP to level ${level + 1}`
  track.setAttribute('aria-label', `Level ${level}, ${next}`)
  wrap.append(track, make('small', 'tf-muted', `${xp.toLocaleString('en-US')} XP · ${next}`))
  return wrap
}

export interface CareerPanelHandlers {
  checkride(id: CheckrideId): void
  cargo(job: CargoJob, aircraft: string): void
  route(route: AirlineRoute, aircraft: string): void
  join(id: AirlineId): void
  leave(): void
  back(): void
}

export class CareerPanel {
  /** The summary block placed on the start screen. */
  readonly summary: HTMLDivElement
  private readonly screen: HTMLDivElement
  private readonly card: HTMLDivElement

  constructor(parent: HTMLElement, private readonly handlers: CareerPanelHandlers) {
    this.summary = make('div', 'tf-career')
    this.screen = make('div', 'tf-screen')
    this.screen.hidden = true
    this.card = make('div', 'tf-card tf-checkrides')
    this.card.setAttribute('role', 'dialog')
    this.card.setAttribute('aria-label', 'Checkrides')
    this.screen.append(this.card)
    parent.append(this.screen)
  }

  get open(): boolean {
    return !this.screen.hidden
  }

  /** Redraws the start-screen summary. */
  render(profile: CareerProfile, mode: CareerMode, username: string | null): void {
    const level = levelFor(profile.xp)
    const rating = pilotRating(profile)
    const head = make('div', 'tf-career-head')
    const badge = make('div', 'tf-level')
    badge.append(make('b', '', String(level)), make('span', '', 'Level'))
    const who = make('div')
    who.append(make('strong', '', LICENCE_LABELS[currentLicence(profile)]), make('small', 'tf-muted', mode === 'account' ? `Saved to ${username ?? 'your account'}` : 'Guest: saved in this browser. Sign in to keep it on your account.'))
    head.append(badge, who)
    const stats = make('dl', 'tf-career-stats')
    const add = (label: string, value: string) => stats.append(make('dt', '', label), make('dd', '', value))
    add('Pilot Rating', rating === null ? 'after 3 flights' : rating.toFixed(1))
    add('Hours', hoursTotal(profile).toFixed(1))
    add('Flights', String(profile.flights))
    add('Landings', String(profile.landings))
    add('Earnings', money(profile.cash))
    add('Deliveries', String(profile.cargo.delivered))
    if (profile.airline) add('Airline', `${rankOf(profile.airline.rank).title}, ${AIRLINES[profile.airline.id].name}`)
    this.summary.replaceChildren(head, xpBar(profile.xp), stats)
  }

  showCheckrides(profile: CareerProfile): void {
    const card = this.card
    card.replaceChildren(make('h2', '', 'Licences and checkrides'))
    card.append(make('p', '', 'Each licence is earned with a scored checkride. Meet its requirements, then fly it without assists.'))
    const ratings = make('dl', 'tf-career-stats')
    for (const c of PILOT_CLASSES) {
      const r = classRating(profile, c)
      if (r !== null) ratings.append(make('dt', '', `${CLASS_LABELS[c]} rating`), make('dd', '', r.toFixed(1)))
    }
    if (ratings.childElementCount) card.append(ratings)
    const list = make('div', 'tf-ride-list')
    for (const id of CHECKRIDES) {
      const spec = CHECKRIDE_SPECS[id]
      const held = profile.licences.includes(id)
      const availability = checkrideAvailability(profile, id, HANGAR_CLASSES)
      const record = profile.checkrides[id]
      const item = make('section', `tf-ride${held ? ' held' : availability.available ? ' ready' : ''}`)
      const title = make('h3', '', LICENCE_LABELS[id])
      title.append(make('small', '', held ? ' · held' : availability.available ? ' · ready' : ' · locked'))
      item.append(title, make('p', '', spec.brief))
      const criteria = make('ul', 'tf-criteria')
      for (const c of spec.criteria) criteria.append(make('li', '', c.label))
      item.append(criteria)
      if (!held && availability.reasons.length) {
        const reasons = make('ul', 'tf-reasons')
        for (const reason of availability.reasons) reasons.append(make('li', '', reason))
        item.append(reasons)
      }
      if (record) item.append(make('small', 'tf-muted', `${record.attempts} attempt${record.attempts === 1 ? '' : 's'} · best ${Math.round(record.best)}`))
      if (!held && availability.available) item.append(button('Take checkride', () => this.handlers.checkride(id), 'tf-btn primary'))
      list.append(item)
    }
    card.append(list, make('div', 'tf-row', ''))
    const back = button('Back', () => this.handlers.back(), 'tf-btn')
    ;(card.lastElementChild as HTMLElement).append(back)
    this.screen.hidden = false
    this.screen.scrollTop = 0
    ;(card.querySelector('.tf-btn.primary') as HTMLButtonElement | null ?? back).focus({ preventScroll: true })
  }

  /** Today's cargo contracts, each with the lightest aircraft the pilot may fly that can lift the load. */
  showCargo(profile: CareerProfile): void {
    const card = this.card
    card.replaceChildren(make('h2', '', 'Cargo contracts'))
    card.append(make('p', '', `Today's contracts. Fly the load to its destination and land on the runway; the pay rises with your score. Earnings so far: ${money(profile.cash)}.`))
    const list = make('div', 'tf-ride-list')
    const flyable = HANGAR.filter((entry) => profile.licences.includes(entry.requires)).sort((a, b) => a.payload - b.payload)
    for (const job of jobsFor(dayNumber(Date.now()))) {
      const from = airportById(job.from)
      const to = airportById(job.to)
      const aircraft = flyable.find((entry) => entry.payload >= job.kg)
      const item = make('section', `tf-ride${aircraft ? ' ready' : ''}`)
      const title = make('h3', '', `${from?.name ?? job.from} → ${to?.name ?? job.to}`)
      title.append(make('small', '', ` · ${money(job.pay)}`))
      item.append(title, make('p', '', `${job.kg.toLocaleString('en-US')} kg of ${job.goods} · ${job.km.toFixed(0)} km`))
      if (aircraft) {
        const spec = fleetSpec(aircraft.id)
        item.append(make('small', 'tf-muted', `Fly it in the ${spec ? spec.name : aircraft.id}. `), button('Fly this contract', () => this.handlers.cargo(job, aircraft.id), 'tf-btn primary'))
      } else {
        const needed = HANGAR.filter((entry) => entry.payload >= job.kg).sort((a, b) => a.payload - b.payload)[0]
        item.append(make('small', 'tf-reasons', needed ? `Needs an aircraft that lifts ${job.kg} kg: the ${fleetSpec(needed.id)?.name ?? needed.id} (${LICENCE_LABELS[needed.requires]}).` : 'Too heavy for any aircraft in the hangar.'))
      }
      list.append(item)
    }
    const back = button('Back', () => this.handlers.back(), 'tf-btn')
    card.append(list, make('div', 'tf-row'))
    ;(card.lastElementChild as HTMLElement).append(back)
    this.screen.hidden = false
    this.screen.scrollTop = 0
    ;(card.querySelector('.tf-btn.primary') as HTMLButtonElement | null ?? back).focus({ preventScroll: true })
  }

  /** The airlines: join one, see the rank ladder and fly today's scheduled routes. */
  showAirlines(profile: CareerProfile, message: string | null = null): void {
    const card = this.card
    card.replaceChildren(make('h2', '', 'Airlines'))
    card.append(make('p', '', 'Fly scheduled routes for an airline: depart from the stand, land on the runway at the destination, and arrive inside the block time for a 20 % bonus. Airline flights, hours and scores earn promotion from First Officer to Chief Pilot, and each rank pays more.'))
    if (message) card.append(make('p', 'tf-bad', message))
    const member = profile.airline
    if (member) {
      const airline = AIRLINES[member.id]
      const rank = rankOf(member.rank)
      const next = nextRank(member.rank)
      const status = make('section', 'tf-ride ready')
      const title = make('h3', '', `${rank.title}, ${airline.name}`)
      title.append(make('small', '', ` · pay ×${rank.pay.toFixed(2)}`))
      status.append(title)
      status.append(make('p', '', `${member.flights} airline flights · ${(member.seconds / 3600).toFixed(1)} h · ${member.onTime} on time · average score ${Math.round(averageScore(member.scores))} · earned ${money(member.earned)}`))
      const gaps = promotionGaps(member)
      status.append(make('small', next ? 'tf-reasons' : 'tf-muted', next ? `Next: ${next.title} after ${gaps.join(', ')}.` : 'You hold the top rank.'))
      card.append(status)
      const list = make('div', 'tf-ride-list')
      const flyable = HANGAR.filter((entry) => airline.fleet.includes(entry.family) && profile.licences.includes(entry.requires))
      for (const route of routesFor(member.id, dayNumber(Date.now()))) {
        const item = make('section', `tf-ride${flyable.length > 0 ? ' ready' : ''}`)
        const head = make('h3', '', `${route.flight}: ${airportById(route.from)?.name ?? route.from} → ${airportById(route.to)?.name ?? route.to}`)
        head.append(make('small', '', ` · ${money(Math.round(route.pay * rank.pay))}`))
        item.append(head, make('p', '', `${route.passengers} passengers · ${route.km.toFixed(0)} km · block ${route.block} min`))
        for (const entry of flyable) item.append(button(`Fly in the ${fleetSpec(entry.id)?.name ?? entry.id}`, () => this.handlers.route(route, entry.id), 'tf-btn primary'))
        if (flyable.length === 0) item.append(make('small', 'tf-reasons', 'No aircraft in this fleet that your licences allow.'))
        list.append(item)
      }
      card.append(make('h3', '', 'Today’s schedule'), list)
    }
    const others = make('div', 'tf-ride-list')
    for (const id of AIRLINE_IDS) {
      if (member && member.id === id) continue
      const airline = AIRLINES[id]
      const barriers = airlineBarriers(profile, id)
      const item = make('section', `tf-ride${barriers.length === 0 ? ' ready' : ''}`)
      item.append(make('h3', '', airline.name), make('p', '', `${airline.blurb} Fleet: ${HANGAR.filter((entry) => airline.fleet.includes(entry.family)).map((entry) => fleetSpec(entry.id)?.name ?? entry.id).join(', ')}.`))
      if (barriers.length > 0) item.append(make('small', 'tf-reasons', barriers.join(' ')))
      else item.append(button(member ? `Move to ${airline.name}` : `Join ${airline.name}`, () => this.handlers.join(id), 'tf-btn'))
      if (member && barriers.length === 0) item.append(make('small', 'tf-muted', ' Moving starts again as First Officer.'))
      others.append(item)
    }
    card.append(make('h3', '', member ? 'Other airlines' : 'Choose an airline'), others)
    const ladder = make('ol', 'tf-muted')
    for (const rank of RANKS) ladder.append(make('li', '', rank.flights === 0 ? `${rank.title}: on joining` : `${rank.title}: ${rank.flights} flights, ${rank.hours} h, average score ${rank.score}`))
    card.append(make('h3', '', 'Ranks'), ladder)
    const row = make('div', 'tf-row')
    if (member) row.append(button('Leave the airline', () => this.handlers.leave(), 'tf-btn'))
    const back = button('Back', () => this.handlers.back(), 'tf-btn')
    row.append(back)
    card.append(row)
    this.screen.hidden = false
    this.screen.scrollTop = 0
    ;(card.querySelector('.tf-btn.primary') as HTMLButtonElement | null ?? back).focus({ preventScroll: true })
  }

  hide(): void {
    this.screen.hidden = true
  }

  /** The career block for the debrief. */
  static outcome(outcome: RecordOutcome, mode: CareerMode): HTMLElement {
    const r = outcome.result
    const block = make('div', 'tf-outcome')
    const line = make('p', 'tf-outcome-xp')
    line.append(make('b', '', `+${r.xp.toLocaleString('en-US')} XP`), ` · level ${r.levelAfter}`)
    if (r.levelAfter > r.levelBefore) line.append(make('span', 'tf-good', ` · level up from ${r.levelBefore}!`))
    block.append(line, xpBar(r.profile.xp))
    if (r.ratingAfter !== null) {
      const delta = r.ratingBefore === null ? null : r.ratingAfter - r.ratingBefore
      block.append(make('p', '', `Pilot Rating ${r.ratingAfter.toFixed(1)}${delta === null ? ' (new)' : ` (${delta >= 0 ? '+' : ''}${delta.toFixed(1)})`}`))
    }
    if (r.checkride) {
      const ride = make('div', `tf-ride-result ${r.checkride.passed ? 'pass' : 'fail'}`)
      ride.append(make('h4', '', `${CHECKRIDE_SPECS[r.checkride.id].title}: ${r.checkride.passed ? 'passed' : 'not passed'}`))
      const list = make('ul', 'tf-criteria result')
      for (const c of r.checkride.criteria) {
        const li = make('li', c.passed ? 'ok' : 'no', c.label)
        li.setAttribute('aria-label', `${c.label}: ${c.passed ? 'met' : 'not met'}`)
        list.append(li)
      }
      ride.append(list)
      if (r.licence) ride.append(make('p', 'tf-good', `${LICENCE_LABELS[r.licence]} earned. +${r.checkride.bonus} XP`))
      block.append(ride)
    }
    if (r.cargo) {
      const ride = make('div', `tf-ride-result ${r.cargo.paid > 0 ? 'pass' : 'fail'}`)
      ride.append(make('h4', '', r.cargo.paid > 0 ? `Delivered: +${money(r.cargo.paid)}` : 'Contract not delivered'))
      ride.append(make('p', '', `${r.cargo.job.kg.toLocaleString('en-US')} kg of ${r.cargo.job.goods} for ${airportById(r.cargo.job.to)?.name ?? r.cargo.job.to}.${r.cargo.reason ? ` ${r.cargo.reason}` : ''}`))
      block.append(ride)
    }
    if (r.airline) {
      const a = r.airline
      const ride = make('div', `tf-ride-result ${a.paid > 0 ? 'pass' : 'fail'}`)
      ride.append(make('h4', '', a.paid > 0 ? `${a.route.flight} arrived: +${money(a.paid)}${a.onTime ? ' (on time)' : ''}` : `${a.route.flight} not completed`))
      ride.append(make('p', '', `${a.route.passengers} passengers for ${airportById(a.route.to)?.name ?? a.route.to}, block ${a.route.block} min.${a.reason ? ` ${a.reason}` : ''}`))
      if (a.promoted) ride.append(make('p', 'tf-good', `Promoted to ${rankOf(a.promoted).title}.`))
      block.append(ride)
    }
    if (outcome.message) block.append(make('p', 'tf-bad', outcome.message))
    else if (mode === 'guest') block.append(make('p', 'tf-muted', 'Saved in this browser. Sign in to keep your career on your account.'))
    return block
  }

  dispose(): void {
    this.screen.remove()
  }
}
