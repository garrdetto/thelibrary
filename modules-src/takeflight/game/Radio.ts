/**
 * Basic ATC: follows a flight through its phases and shows what the controllers say (`shared/Atc.ts` words) in the radio log,
 * from the taxi clearance at the stand through take-off, departure, the inbound call with the destination's ATIS, landing
 * clearance on final and the taxi-in. `atis()` reads the nearest airport's ATIS. The radio only reads the flight; it never
 * changes the sim, so records and replays are unaffected.
 */
import { AIRPORTS, airportById, nearestAirport, pavementAt, runwayEndFor } from '../shared/Airports'
import type { AirportSpec } from '../shared/Airports'
import { atcPhrase, atisText, runwayInUse, windPhrase } from '../shared/Atc'
import type { AtcEvent, RunwayInUse } from '../shared/Atc'
import type { WeatherState } from '../shared/Weather'
import type { WindSpec } from '../sim/Wind'
import type { StartKind } from '../sim/Starts'
import type { FlightModel } from '../sim/FlightModel'
import type { RadioLog } from '../ui/RadioLog'
import type { TrafficPose } from '../shared/Traffic'
import { fleetSpec } from '../shared/Fleet'
import { HANGAR } from '../shared/Hangar'

type Phase = 'parked' | 'taxi' | 'rolling' | 'climb' | 'enroute' | 'inbound' | 'final' | 'landed' | 'done'

export interface RadioConditions {
  hours: number
  /** The sim's wind, weather included. */
  wind: WindSpec
  weather: WeatherState
  temperatureOffset: number
  pressure: number
}

const INBOUND_RANGE = 20000
const FINAL_RANGE = 9000
const CLIMB_HANDOFF = 300

export class Radio {
  private phase: Phase = 'done'
  private departure: AirportSpec = AIRPORTS[0]
  private destination: AirportSpec | null = null
  private callsign = ''
  private lastAgl = 0
  private readonly called = new Set<string>()
  private trafficCooldown = 0

  constructor(private readonly log: RadioLog) {}

  /** A new flight from `departure`; `destination` is the route's or contract's, or null for the nearest field. */
  begin(departure: AirportSpec, destination: string | null, start: StartKind, callsign: string, conditions: RadioConditions): void {
    this.departure = departure
    this.destination = destination ? airportById(destination) ?? null : null
    this.callsign = callsign
    this.log.clear()
    this.called.clear()
    if (start === 'stand') this.phase = 'parked'
    else if (start === 'runway1' || start === 'runway2') {
      this.phase = 'rolling'
      this.say('takeoff', departure, conditions)
    } else if (start === 'final1' || start === 'final2') {
      this.phase = 'inbound'
      this.destination ??= departure
    } else this.phase = 'enroute'
  }

  end(): void {
    this.phase = 'done'
  }

  /** The nearest airport's ATIS into the log. */
  atis(x: number, z: number, conditions: RadioConditions): void {
    const airport = nearestAirport(x, z)
    this.log.add('ATIS', this.atisFor(airport, conditions).text)
  }

  /** Per frame while flying. */
  update(a: FlightModel, parkingBrake: boolean, conditions: RadioConditions, traffic: readonly TrafficPose[] = []): void {
    if (a.crashed) return
    this.trafficCalls(a, traffic)
    if (this.phase === 'done') return
    const onGround = a.wheelLoad > 0
    switch (this.phase) {
      case 'parked':
        if (!parkingBrake && a.groundSpeed > 1) {
          this.phase = 'taxi'
          this.say('taxi', this.departure, conditions)
        }
        break
      case 'taxi':
        if (pavementAt(a.px, a.pz) === 'runway' && a.groundSpeed < 12) {
          this.phase = 'rolling'
          this.say('takeoff', this.departure, conditions)
        } else if (!onGround) this.phase = 'climb'
        break
      case 'rolling':
        if (!onGround && a.agl > 15) this.phase = 'climb'
        break
      case 'climb':
        if (a.agl > CLIMB_HANDOFF) {
          this.phase = 'enroute'
          this.log.add(this.departure.name, atcPhrase('departure', this.callsign, this.departure, this.inUse(this.departure, conditions)))
        }
        break
      case 'enroute': {
        const target = this.destination ?? nearestAirport(a.px, a.pz)
        const far = Math.hypot(a.px - this.departure.x, a.pz - this.departure.z) > 6000 || target !== this.departure
        if (far && Math.hypot(a.px - target.x, a.pz - target.z) < INBOUND_RANGE) {
          this.destination = target
          this.phase = 'inbound'
          this.say('inbound', target, conditions)
        }
        break
      }
      case 'inbound': {
        const target = this.destination ?? nearestAirport(a.px, a.pz)
        const end = this.alignedEnd(target, a)
        if (end) {
          this.phase = 'final'
          this.log.add(target.name, atcPhrase('final', this.callsign, target, { ...this.inUse(target, conditions), name: end }, { wind: this.windNow(conditions) }))
        }
        break
      }
      case 'final': {
        if (onGround && a.groundSpeed < 25) {
          const target = this.destination ?? nearestAirport(a.px, a.pz)
          this.phase = 'landed'
          this.say('landing', target, conditions)
        } else if (!onGround && a.agl > this.lastAgl + 0.5 && a.agl > 150 && a.verticalSpeed > 3) {
          this.phase = 'inbound'
        }
        break
      }
      case 'landed':
        if (a.groundSpeed < 8 && pavementAt(a.px, a.pz) !== 'runway') {
          const target = this.destination ?? nearestAirport(a.px, a.pz)
          this.phase = 'done'
          this.log.add(target.name, atcPhrase('vacate', this.callsign, target, this.inUse(target, conditions), { stand: target.stands[0]?.name.toLowerCase() ?? 'the apron', taxiway: target.taxiways[0]?.name ?? 'A' }))
        }
        break
    }
    this.lastAgl = a.agl
  }

  /** Calls nearby airborne traffic once per movement: clock position, distance, relative height and type. */
  private trafficCalls(a: FlightModel, traffic: readonly TrafficPose[]): void {
    if (this.trafficCooldown > 0) this.trafficCooldown--
    if (a.wheelLoad > 0 || this.trafficCooldown > 0) return
    for (const pose of traffic) {
      if (pose.onGround || this.called.has(pose.key)) continue
      const dx = pose.x - a.px
      const dz = pose.z - a.pz
      const distance = Math.hypot(dx, dz)
      if (distance > 5500 || Math.abs(pose.y - a.py) > 300) continue
      this.called.add(pose.key)
      this.trafficCooldown = 240
      let bearing = Math.atan2(dx, -dz) * 180 / Math.PI - a.heading
      bearing = ((bearing % 360) + 360) % 360
      const clock = Math.round(bearing / 30) % 12 || 12
      const miles = Math.max(1, Math.round(distance / 1852))
      const height = pose.y - a.py > 90 ? 'above you' : pose.y - a.py < -90 ? 'below you' : 'same altitude'
      const entry = HANGAR.find((h) => h.family === pose.family)
      const name = entry ? fleetSpec(entry.id)?.name ?? pose.family : pose.family
      this.log.add('Approach', `${this.callsign}, traffic ${clock} o'clock, ${miles} mile${miles === 1 ? '' : 's'}, ${height}, a ${name} ${pose.kind === 'arrival' ? 'on final' : pose.kind === 'departure' ? 'departing' : 'in the circuit'}.`)
      return
    }
  }

  private alignedEnd(airport: AirportSpec, a: FlightModel): string | null {
    for (const runway of airport.runways) {
      const end = runwayEndFor(runway, a.heading)
      const bx = end.x - a.px
      const bz = end.z - a.pz
      const ahead = bx * end.dx + bz * end.dz
      const cross = Math.abs(bx * end.dz - bz * end.dx)
      if (ahead > 0 && ahead < FINAL_RANGE && cross < 600 && a.agl < 900) return end.name
    }
    return null
  }

  private atisFor(airport: AirportSpec, c: RadioConditions): ReturnType<typeof atisText> {
    const temperature = 15 - airport.elevation * 0.0065 + c.temperatureOffset
    return atisText(airport, { hourOfDay: c.hours, windFrom: c.wind.direction, windSpeed: c.wind.speed, gust: c.wind.gust, weather: c.weather, temperature, pressure: c.pressure })
  }

  private inUse(airport: AirportSpec, c: RadioConditions): RunwayInUse {
    return runwayInUse(airport, c.wind.direction, c.wind.speed)
  }

  private windNow(c: RadioConditions): string {
    return windPhrase(c.wind.direction, c.wind.speed, c.wind.gust)
  }

  private say(event: AtcEvent, airport: AirportSpec, c: RadioConditions): void {
    const atis = this.atisFor(airport, c)
    this.log.add(airport.name, atcPhrase(event, this.callsign, airport, atis.runway, { wind: this.windNow(c), letter: atis.letter, taxiway: airport.taxiways[0]?.name ?? 'A' }))
  }
}
