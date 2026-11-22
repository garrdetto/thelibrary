import { test } from 'node:test'
import assert from 'node:assert/strict'
import { CHAIN_POINTS, createProcedure, strapCount } from '../game/Procedures'
import type { KeyState, MachineView, ProcKey, ProcedureContext, TrailerView, TruckView } from '../game/Procedures'
import type { Job } from '../shared/Jobs'
import type { HaulKind } from '../shared/Catalog'
import { ZONE_BY_ID } from '../shared/WorldLayout'
import type { Zone } from '../shared/WorldLayout'

class FakeRig implements ProcedureContext {
  truck: TruckView
  trailer: TrailerView | null
  machine: MachineView | null = null
  keys = new Map<ProcKey, KeyState>()
  loaderRate = 2500
  neckReady = false

  constructor(readonly zone: Zone, readonly job: Job, haul: HaulKind) {
    this.truck = { x: zone.x, z: zone.z, heading: zone.heading, speed: 0, parkingBrake: false, fifthWheel: { x: zone.x, z: zone.z }, dump: haul === 'dump' ? { loadKg: 0, capacityKg: 14000, angle: 0 } : null }
    this.trailer = haul === 'dump' ? null : {
      kind: haul, center: { x: zone.x, z: zone.z }, heading: zone.heading, rear: { x: zone.x, z: zone.z }, hopper: { x: zone.x, z: zone.z },
      coupled: true, neckAttached: true, gear: 0, doors: 0, payloadKg: 0, capacityKg: 30000, deckFront: { x: zone.x, z: zone.z },
    }
  }

  key(key: ProcKey): KeyState {
    return this.keys.get(key) ?? 'up'
  }
  addDump(kg: number): number {
    const dump = this.truck.dump!
    const fit = Math.min(kg, dump.capacityKg - dump.loadKg)
    dump.loadKg += fit
    return fit
  }
  setTrailerPayload(kg: number): void {
    this.trailer!.payloadKg = kg
  }
  setDoors(target: 0 | 1): void {
    this.trailer!.doors = target
  }
  setDeck(target: 0 | 1): void {
    this.trailer!.gear = target
  }
  detachNeck(): string | null {
    this.trailer!.neckAttached = false
    return null
  }
  attachNeck(): string | null {
    if (!this.neckReady) return 'line the neck up with the deck'
    this.trailer!.neckAttached = true
    return null
  }
  spawnMachine(): void {
    this.machine ??= { x: this.zone.x + 30, z: this.zone.z, speed: 0, onDeck: false, secured: false, controlled: false }
  }
  secureMachine(): string | null {
    this.machine!.secured = true
    this.trailer!.payloadKg = 20500
    return null
  }
  releaseMachine(): void {
    this.machine!.secured = false
    this.trailer!.payloadKg = 0
  }
  takeMachine(): string | null {
    this.machine!.controlled = true
    return null
  }
  leaveMachine(): void {
    this.machine!.controlled = false
  }
  loaderStep(dt: number, ready: boolean, wantKg: number): number {
    return ready ? Math.min(wantKg, this.loaderRate * dt) : 0
  }
}

function job(haul: HaulKind, cargo: string, massKg: number): Job {
  return { id: 'county-1-0', world: 'county', cargo, haul, massKg, from: 'a', to: 'b', distanceM: 4000, pay: 2000, minutes: 12 }
}

function run(rig: FakeRig, procedure: ReturnType<typeof createProcedure>, frames: number, each: (frame: number) => void): void {
  for (let i = 0; i < frames && !procedure.done; i++) {
    each(i)
    procedure.update(rig, 0.1)
    for (const [k, v] of rig.keys) if (v === 'pressed') rig.keys.set(k, 'up')
  }
}

function press(rig: FakeRig, key: ProcKey): void {
  rig.keys.set(key, 'pressed')
}

test('dump loading waits for the parking brake, then fills to the job mass', () => {
  const zone = ZONE_BY_ID['quarry:bay1']
  const rig = new FakeRig(zone, job('dump', 'gravel', 12000), 'dump')
  const procedure = createProcedure(rig.job, 'load', zone)
  run(rig, procedure, 20, () => {})
  assert.equal(procedure.activeStep, 'park')
  assert.equal(rig.truck.dump!.loadKg, 0)
  rig.truck.parkingBrake = true
  run(rig, procedure, 200, () => {})
  assert.ok(procedure.done)
  assert.ok(Math.abs(rig.truck.dump!.loadKg - 12000) < 1)
})

test('dump loading stops at the bed capacity for heavy jobs', () => {
  const zone = ZONE_BY_ID['quarry:bay2']
  const rig = new FakeRig(zone, job('dump', 'riprap', 22000), 'dump')
  rig.truck.parkingBrake = true
  const procedure = createProcedure(rig.job, 'load', zone)
  run(rig, procedure, 300, () => {})
  assert.ok(procedure.done)
  assert.equal(rig.truck.dump!.loadKg, 14000)
})

test('dump unloading needs the bed raised until empty and lowered again', () => {
  const zone = ZONE_BY_ID['oak:dump']
  const rig = new FakeRig(zone, job('dump', 'gravel', 12000), 'dump')
  rig.truck.dump!.loadKg = 12000
  rig.truck.parkingBrake = true
  const procedure = createProcedure(rig.job, 'unload', zone)
  run(rig, procedure, 10, () => {})
  assert.equal(procedure.activeStep, 'raise')
  run(rig, procedure, 100, () => {
    rig.truck.dump!.angle = 0.8
    rig.truck.dump!.loadKg = Math.max(0, rig.truck.dump!.loadKg - 400)
  })
  assert.equal(procedure.activeStep, 'lower')
  rig.truck.dump!.angle = 0
  run(rig, procedure, 5, () => {})
  assert.ok(procedure.done)
})

test('a truck outside the zone never starts loading', () => {
  const zone = ZONE_BY_ID['refinery:rack1']
  const rig = new FakeRig(zone, job('tanker', 'diesel', 20000), 'tanker')
  rig.trailer!.center = { x: zone.x + 80, z: zone.z }
  rig.truck.parkingBrake = true
  const procedure = createProcedure(rig.job, 'load', zone)
  run(rig, procedure, 50, () => press(rig, 'interact'))
  assert.equal(procedure.activeStep, 'position')
  assert.equal(rig.trailer!.payloadKg, 0)
})

test('tanker loading: connect the arm, fill, disconnect', () => {
  const zone = ZONE_BY_ID['refinery:rack2']
  const rig = new FakeRig(zone, job('tanker', 'gasoline', 21000), 'tanker')
  rig.truck.parkingBrake = true
  const procedure = createProcedure(rig.job, 'load', zone)
  run(rig, procedure, 400, (i) => { if (i % 3 === 0) press(rig, 'interact') })
  assert.ok(procedure.done)
  assert.equal(rig.trailer!.payloadKg, 21000)
})

test('releasing the parking brake pauses a fill', () => {
  const zone = ZONE_BY_ID['refinery:rack1']
  const rig = new FakeRig(zone, job('tanker', 'diesel', 20000), 'tanker')
  rig.truck.parkingBrake = true
  const procedure = createProcedure(rig.job, 'load', zone)
  run(rig, procedure, 6, () => press(rig, 'interact'))
  assert.equal(procedure.activeStep, 'flow')
  rig.truck.parkingBrake = false
  const before = rig.trailer!.payloadKg
  let status = procedure.update(rig, 0.1)
  status = procedure.update(rig, 0.1)
  assert.equal(rig.trailer!.payloadKg, before)
  assert.match(status.message, /parking brake/)
})

test('flatbed loading straps every tie point', () => {
  const zone = ZONE_BY_ID['steel:bay']
  const rig = new FakeRig(zone, job('flatbed', 'coils', 18000), 'flatbed')
  rig.truck.parkingBrake = true
  const procedure = createProcedure(rig.job, 'load', zone)
  run(rig, procedure, 400, () => {})
  assert.equal(procedure.activeStep, 'straps')
  assert.equal(rig.trailer!.payloadKg, 18000)
  rig.keys.set('interact', 'held')
  run(rig, procedure, 200, () => {})
  assert.ok(procedure.done)
  assert.equal(strapCount(18000), 6)
})

test('grain filling pauses when the hoppers leave the spout', () => {
  const zone = ZONE_BY_ID['hansen:bins']
  const rig = new FakeRig(zone, job('grain', 'corn', 20000), 'grain')
  rig.truck.parkingBrake = true
  const procedure = createProcedure(rig.job, 'load', zone)
  run(rig, procedure, 10, () => press(rig, 'interact'))
  assert.equal(procedure.activeStep, 'flow')
  rig.trailer!.hopper = { x: zone.x + 5, z: zone.z }
  const before = rig.trailer!.payloadKg
  run(rig, procedure, 20, () => {})
  assert.equal(rig.trailer!.payloadKg, before)
  rig.trailer!.hopper = { x: zone.x, z: zone.z }
  run(rig, procedure, 600, (i) => { if (i % 4 === 0) press(rig, 'interact') })
  assert.ok(procedure.done)
  assert.equal(rig.trailer!.doors, 0)
})

test('reefer docking needs the rear within a metre and square to the door', () => {
  const zone = ZONE_BY_ID['cold:dock2']
  const rig = new FakeRig(zone, job('reefer', 'frozen', 15000), 'reefer')
  rig.trailer!.rear = { x: zone.dock!.x, z: zone.dock!.z - 2 }
  rig.truck.parkingBrake = true
  const procedure = createProcedure(rig.job, 'load', zone)
  run(rig, procedure, 10, () => {})
  assert.equal(procedure.activeStep, 'dock')
  rig.trailer!.rear = { x: zone.dock!.x, z: zone.dock!.z - 0.5 }
  rig.trailer!.heading = zone.heading + 0.2
  run(rig, procedure, 10, () => {})
  assert.equal(procedure.activeStep, 'dock')
  rig.trailer!.heading = zone.heading
  run(rig, procedure, 400, (i) => { if (i % 3 === 0) press(rig, 'interact') })
  assert.ok(procedure.done)
  assert.equal(rig.trailer!.payloadKg, 15000)
})

test('lowboy pickup: lower, detach, pull away, drive on, chain, reconnect, raise', () => {
  const zone = ZONE_BY_ID['yard:pickup']
  const rig = new FakeRig(zone, job('lowboy', 'excavator', 20500), 'lowboy')
  rig.truck.parkingBrake = true
  const procedure = createProcedure(rig.job, 'load', zone)
  run(rig, procedure, 5, () => {})
  assert.ok(rig.machine, 'machine spawned at the yard')
  rig.keys.set('gear', 'held')
  run(rig, procedure, 5, () => {})
  rig.keys.delete('gear')
  assert.equal(procedure.activeStep, 'detach')
  press(rig, 'fifth')
  run(rig, procedure, 1, () => {})
  assert.equal(rig.trailer!.neckAttached, false)
  assert.equal(procedure.activeStep, 'pull-away')
  rig.truck.parkingBrake = false
  rig.truck.fifthWheel = { x: zone.x, z: zone.z + 8 }
  run(rig, procedure, 2, () => {})
  rig.truck.parkingBrake = true
  press(rig, 'interact')
  run(rig, procedure, 1, () => {})
  assert.equal(rig.machine!.controlled, true)
  rig.machine!.onDeck = true
  run(rig, procedure, 40, () => {})
  press(rig, 'interact')
  run(rig, procedure, 1, () => {})
  assert.equal(rig.machine!.controlled, false)
  rig.keys.set('interact', 'held')
  run(rig, procedure, 60, () => {})
  rig.keys.delete('interact')
  assert.equal(rig.machine!.secured, true)
  assert.equal(procedure.activeStep, 'reconnect')
  press(rig, 'fifth')
  run(rig, procedure, 1, () => {})
  assert.equal(procedure.activeStep, 'reconnect', 'refused until lined up')
  rig.neckReady = true
  press(rig, 'fifth')
  run(rig, procedure, 1, () => {})
  rig.keys.set('gear', 'held')
  run(rig, procedure, 5, () => {})
  assert.ok(procedure.done)
  assert.equal(rig.trailer!.payloadKg, 20500)
  assert.equal(CHAIN_POINTS, 4)
})

test('lowboy drop releases the machine and needs it parked on the pad', () => {
  const zone = ZONE_BY_ID['oak:equip']
  const rig = new FakeRig(zone, job('lowboy', 'excavator', 20500), 'lowboy')
  rig.machine = { x: zone.x, z: zone.z, speed: 0, onDeck: true, secured: true, controlled: false }
  rig.trailer!.payloadKg = 20500
  rig.truck.parkingBrake = true
  rig.neckReady = true
  const procedure = createProcedure(rig.job, 'unload', zone)
  rig.keys.set('gear', 'held')
  run(rig, procedure, 5, () => {})
  rig.keys.set('interact', 'held')
  run(rig, procedure, 60, () => {})
  rig.keys.delete('interact')
  rig.keys.delete('gear')
  assert.equal(rig.machine.secured, false)
  press(rig, 'fifth')
  run(rig, procedure, 1, () => {})
  rig.truck.fifthWheel = { x: zone.x, z: zone.z + 9 }
  run(rig, procedure, 1, () => {})
  press(rig, 'interact')
  run(rig, procedure, 1, () => {})
  assert.equal(procedure.activeStep, 'drive-off')
  run(rig, procedure, 30, () => {})
  assert.equal(procedure.activeStep, 'drive-off', 'not yet on the pad')
  rig.machine.x = zone.equipment!.x
  rig.machine.z = zone.equipment!.z
  run(rig, procedure, 40, () => {})
  press(rig, 'interact')
  run(rig, procedure, 1, () => {})
  press(rig, 'fifth')
  run(rig, procedure, 1, () => {})
  rig.trailer!.gear = 1
  rig.keys.set('gear', 'held')
  run(rig, procedure, 5, () => {})
  assert.ok(procedure.done)
})
