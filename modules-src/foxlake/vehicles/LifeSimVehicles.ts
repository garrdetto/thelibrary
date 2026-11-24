/**
 * Vehicles that ship with Life Sim only: ordinary `custom:<id>` records (maplestreet/shared/CustomVehicles.ts) tagged
 * `game: 'lifesim'`, registered by Life Sim's page (foxlake/boot.ts) and by its world's authority (FoxLakeWorld), so
 * the dealership, garages and fuel treat them like any other vehicle. Fox Plains never sells them. Renderer-free: the
 * Worker imports this file.
 *
 * Both helicopters are Meshy text-to-3D models (task ids in assets-src/models/foxlake/vehicles.meshy.json) cut into
 * body, main rotor and tail rotor by modules-src/foxlake/tools/build-helicopter.py, which prints the measurements below
 * (model frame: x forward, y up, z right, metres from the foot of the mast on the ground). The chassis box is the cabin;
 * the skids are two raycast "axles" it rests on; `flight` is what Flight.ts flies it with. The Kestrel is the faster
 * light helicopter; the Bumblebee is the tiny two-seat bubble ("bug") chopper: cheaper, slower and nimbler.
 */
import type { CustomVehicleRecord } from '../../maplestreet/shared/CustomVehicles'
import { BUNDLED_VEHICLES } from '../../maplestreet/shared/BundledVehicles'

/** The cabin box's centre in the model frame: the chassis origin. */
const CENTRE = { x: 0.6, y: 1.45 }
const BUG = { x: 0.55, y: 1.4 }

export const KESTREL_ID = 'lifesim-kestrel-helicopter'
export const BUMBLEBEE_ID = 'lifesim-bumblebee-helicopter'

export const LIFE_SIM_VEHICLES: readonly CustomVehicleRecord[] = [
  {
    id: KESTREL_ID,
    name: 'Kestrel Two-Seat Helicopter',
    game: 'lifesim',
    template: 'sedan',
    model: { scale: 1, yaw: 0, x: -CENTRE.x, y: -CENTRE.y, z: 0 },
    physics: {
      chassis: { hx: 1.9, hy: 1.0, hz: 0.72 },
      mass: 900,
      comY: -0.45,
      axles: [
        { x: 1.5 - CENTRE.x, radius: 0.12, width: 0.08, halfTrack: 1.0, steer: true, drive: true },
        { x: -0.9 - CENTRE.x, radius: 0.12, width: 0.08, halfTrack: 1.0, steer: false, drive: false },
      ],
      wheelY: -CENTRE.y + 0.27 + 0.12,
      suspension: { rest: 0.3, travel: 0.2, stiffness: 60, compression: 4, relaxation: 5 },
      frictionSlip: 3,
      sideStiffness: 1.2,
      engineForce: 1,
      topSpeed: 49,
      brake: 30,
      maxSteer: 0.5,
      flight: {
        climb: 6,
        yawRate: 1.3,
        accel: 5,
        tilt: 0.22,
        rotors: { main: { x: 0, y: 3.333, z: 0 }, tail: { x: -4.552, y: 1.854, z: -0.083 } },
      },
      seat: { x: 0.45, y: -0.5, z: 0.32 },
      hitch: null,
      cam: { dist: 13, height: 3.6 },
    },
    lights: { head: [], tail: [] },
    paint: { mode: 'none', material: '', key: '#ffffff', tolerance: 0.18, color: '#f2f2f2' },
    targets: { topSpeedMph: 110, zeroToMph: 60, zeroToSeconds: 8 },
    dealer: { forSale: true, price: 95_000, fuel: 'gas', tank: 30, mpg: 9 },
    traffic: { enabled: false, driver: '', route: 'ringA', mph: 20 },
    wheelsRemoved: true,
    modelUrl: '/models/foxlake/helicopter.glb',
    wheelUrl: null,
    active: true,
    status: 'published',
    updatedAt: 1_794_787_200_000,
  },
  {
    id: BUMBLEBEE_ID,
    name: 'Bumblebee Bubble Helicopter',
    game: 'lifesim',
    template: 'sedan',
    model: { scale: 1, yaw: 0, x: -BUG.x, y: -BUG.y, z: 0 },
    physics: {
      chassis: { hx: 1.75, hy: 1.0, hz: 0.85 },
      mass: 780,
      comY: -0.45,
      axles: [
        { x: 1.9 - BUG.x, radius: 0.12, width: 0.06, halfTrack: 1.12, steer: true, drive: true },
        { x: -0.75 - BUG.x, radius: 0.12, width: 0.06, halfTrack: 1.12, steer: false, drive: false },
      ],
      wheelY: -BUG.y + 0.27 + 0.12,
      suspension: { rest: 0.3, travel: 0.2, stiffness: 60, compression: 4, relaxation: 5 },
      frictionSlip: 3,
      sideStiffness: 1.2,
      engineForce: 1,
      topSpeed: 38,
      brake: 30,
      maxSteer: 0.5,
      flight: {
        climb: 5,
        yawRate: 1.7,
        accel: 6,
        tilt: 0.25,
        rotors: { main: { x: 0, y: 2.741, z: 0 }, tail: { x: -5.729, y: 2.302, z: 0.067 } },
      },
      seat: { x: 0.85, y: -0.45, z: 0.35 },
      hitch: null,
      cam: { dist: 13, height: 3.4 },
    },
    lights: { head: [], tail: [] },
    paint: { mode: 'none', material: '', key: '#ffffff', tolerance: 0.18, color: '#f2c200' },
    targets: { topSpeedMph: 85, zeroToMph: 60, zeroToSeconds: 7 },
    dealer: { forSale: true, price: 48_000, fuel: 'gas', tank: 20, mpg: 12 },
    traffic: { enabled: false, driver: '', route: 'ringA', mph: 20 },
    wheelsRemoved: true,
    modelUrl: '/models/foxlake/bubble-helicopter.glb',
    wheelUrl: null,
    active: true,
    status: 'published',
    updatedAt: 1_794_787_200_000,
  },
]

const BUNDLED_IDS = new Set(BUNDLED_VEHICLES.map((r) => r.id))

/**
 * Life Sim's list from the published records, with its own vehicles first (a published record with the same id
 * replaces one). Re-publishing a bundled vehicle (the Maple Hauler and the rest) from Fox Plains' days changes it in
 * Fox Plains only; one saved from the vehicle creator since it became Life Sim's (`game: 'lifesim'`) changes it here.
 */
export function forLifeSim(records: readonly CustomVehicleRecord[]): CustomVehicleRecord[] {
  return [...LIFE_SIM_VEHICLES, ...records.filter((r) => !BUNDLED_IDS.has(r.id) || r.game === 'lifesim')]
}
