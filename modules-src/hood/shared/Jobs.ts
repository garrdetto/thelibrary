/** The ten careers in town, the tasks a Sim can take on during a shift, and the services a household can call. */
import type { Need } from './Needs'
import type { PlaceId } from './Town'

export const JOB_IDS = ['police', 'firefighter', 'lawn', 'guard', 'resort', 'city', 'gas', 'food', 'ems', 'nurse'] as const
export type JobId = (typeof JOB_IDS)[number]

export interface Uniform {
  top: string
  bottom: string
  hat?: 'cap' | 'helmet' | 'hard' | 'visor' | 'none'
  hatColor?: string
  vest?: string
}

export interface JobTask {
  id: string
  label: string
  seconds: number
  perf: number
  needs?: Partial<Record<Need, number>>
  bonus?: number
  /** Which other job this task works alongside, for the career card. */
  with?: JobId
}

export interface JobDef {
  id: JobId
  title: string
  place: PlaceId
  blurb: string
  titles: [string, string, string, string, string]
  pay: [number, number, number, number, number]
  uniform: Uniform
  tasks: JobTask[]
  /** How this job meets the others around town. */
  links: string
  shiftCost: Partial<Record<Need, number>>
}

export const SHIFT_SECONDS = 300
export const RESPOND_SECONDS = 22
export const RESPOND_PERF = 14
export const RESPOND_BONUS = 60
export const BASE_PERF = 40
export const MAX_LEVEL = 5

export const JOBS: Record<JobId, JobDef> = {
  police: {
    id: 'police', title: 'Police Officer', place: 'police',
    blurb: 'Patrol the street, answer calls and bring suspects to the prison for booking.',
    titles: ['Cadet', 'Patrol Officer', 'Corporal', 'Sergeant', 'Captain'], pay: [220, 300, 390, 500, 640],
    uniform: { top: '#1f3a68', bottom: '#1b2333', hat: 'cap', hatColor: '#141c2c' },
    links: 'Books arrests with prison guards, directs traffic at fires and crashes, and grabs lunch at Sunny Side Burgers.',
    shiftCost: { energy: -24, hunger: -26, fun: -6 },
    tasks: [
      { id: 'patrol', label: 'Patrol the street', seconds: 30, perf: 7, needs: { energy: -4 } },
      { id: 'reports', label: 'Write reports', seconds: 20, perf: 5, needs: { fun: -5 } },
      { id: 'traffic', label: 'Run a speed trap', seconds: 25, perf: 6, bonus: 20 },
      { id: 'lunch', label: 'Lunch run to Sunny Side', seconds: 20, perf: 2, needs: { hunger: 30, fun: 4 }, with: 'food' },
    ],
  },
  firefighter: {
    id: 'firefighter', title: 'Firefighter', place: 'fire',
    blurb: 'Keep Engine 1 ready, run drills and knock down fires on the street.',
    titles: ['Probationary Firefighter', 'Firefighter', 'Engineer', 'Lieutenant', 'Fire Captain'], pay: [210, 290, 380, 490, 620],
    uniform: { top: '#2a2620', bottom: '#2a2620', hat: 'helmet', hatColor: '#c43a2a', vest: '#e8d34a' },
    links: 'Works fires beside EMS and the police, hands patients to the ambulance crew, and cleans up fuel spills at Hood Fuel.',
    shiftCost: { energy: -30, hunger: -28, hygiene: -24 },
    tasks: [
      { id: 'check', label: 'Check the engine', seconds: 20, perf: 5 },
      { id: 'drill', label: 'Ladder drill', seconds: 30, perf: 8, needs: { energy: -6, hygiene: -6 } },
      { id: 'safety', label: 'Smoke alarm visits', seconds: 25, perf: 6, needs: { social: 8 } },
      { id: 'meal', label: 'Cook the station meal', seconds: 25, perf: 3, needs: { hunger: 32, social: 6 } },
    ],
  },
  lawn: {
    id: 'lawn', title: 'Lawn Care Tech', place: 'lawn',
    blurb: 'Mow, edge and trim every yard on the street with the Greenline crew.',
    titles: ['Crew Helper', 'Mower Operator', 'Crew Lead', 'Route Manager', 'Owner Partner'], pay: [160, 220, 290, 370, 470],
    uniform: { top: '#3f8a3a', bottom: '#5b4a36', hat: 'cap', hatColor: '#2e6b2a' },
    links: 'Fuels the mowers at Hood Fuel, mows the resort grounds, and keeps the station and hospital lawns trim.',
    shiftCost: { energy: -26, hunger: -24, hygiene: -28, fun: 4 },
    tasks: [
      { id: 'mow', label: 'Mow a front yard', seconds: 30, perf: 7, needs: { hygiene: -6 } },
      { id: 'edge', label: 'Edge and trim', seconds: 20, perf: 5 },
      { id: 'fix', label: 'Sharpen the blades', seconds: 25, perf: 5, needs: { fun: 3 } },
      { id: 'fuel', label: 'Fuel up at Hood Fuel', seconds: 20, perf: 3, with: 'gas' },
    ],
  },
  guard: {
    id: 'guard', title: 'Prison Guard', place: 'prison',
    blurb: 'Watch the cellblock and yard at Kettle Ridge and book in arrests from the police.',
    titles: ['Trainee Officer', 'Correctional Officer', 'Senior Officer', 'Shift Sergeant', 'Warden'], pay: [200, 280, 360, 460, 600],
    uniform: { top: '#5b6470', bottom: '#2c3138', hat: 'cap', hatColor: '#2c3138' },
    links: 'Books in suspects from the police, escorts the inmate work crew for the city, and brings hurt inmates to the nurses.',
    shiftCost: { energy: -22, hunger: -24, fun: -12, social: 4 },
    tasks: [
      { id: 'block', label: 'Walk the cellblock', seconds: 25, perf: 6 },
      { id: 'yard', label: 'Supervise the yard', seconds: 30, perf: 7, needs: { fun: -4 } },
      { id: 'crew', label: 'Escort the work crew', seconds: 35, perf: 9, needs: { energy: -5 }, with: 'city' },
      { id: 'tower', label: 'Tower watch', seconds: 20, perf: 4, needs: { fun: -6 } },
    ],
  },
  resort: {
    id: 'resort', title: 'Resort Manager', place: 'resort',
    blurb: 'Run Hood Springs Resort: guests, the pool, the shuttle and the events calendar.',
    titles: ['Front Desk Host', 'Guest Services Lead', 'Assistant Manager', 'Resort Manager', 'General Manager'], pay: [180, 260, 350, 460, 610],
    uniform: { top: '#f1ece0', bottom: '#2f5d7c', hat: 'none' },
    links: 'Books getaways for neighbors, sends the shuttle around town, keeps EMS on standby at the pool, and orders catering from Sunny Side.',
    shiftCost: { energy: -18, hunger: -22, social: 14, fun: 6 },
    tasks: [
      { id: 'greet', label: 'Greet arriving guests', seconds: 20, perf: 6, needs: { social: 10 } },
      { id: 'pool', label: 'Inspect the pool deck', seconds: 20, perf: 5 },
      { id: 'event', label: 'Plan a lakeside event', seconds: 30, perf: 8, bonus: 30, needs: { fun: 6 } },
      { id: 'cater', label: 'Order catering', seconds: 20, perf: 4, with: 'food' },
    ],
  },
  city: {
    id: 'city', title: 'City Worker', place: 'cityworks',
    blurb: 'Collect the trash, fix streetlights and patch the road with the City Works crew.',
    titles: ['Laborer', 'Equipment Operator', 'Crew Chief', 'Supervisor', 'Public Works Director'], pay: [180, 250, 330, 430, 560],
    uniform: { top: '#e2762e', bottom: '#3b4a5c', hat: 'hard', hatColor: '#f1c232', vest: '#d6f04a' },
    links: 'Leads the inmate work crew with the guards, clears crashes after the police, and fuels the trucks at Hood Fuel.',
    shiftCost: { energy: -28, hunger: -26, hygiene: -26 },
    tasks: [
      { id: 'trash', label: 'Ride the trash route', seconds: 30, perf: 7, needs: { hygiene: -8 } },
      { id: 'light', label: 'Fix a streetlight', seconds: 30, perf: 7 },
      { id: 'patch', label: 'Patch potholes', seconds: 25, perf: 6, needs: { energy: -4 } },
      { id: 'crew', label: 'Lead the inmate crew', seconds: 35, perf: 9, with: 'guard' },
    ],
  },
  gas: {
    id: 'gas', title: 'Gas Station Clerk', place: 'gas',
    blurb: 'Run Hood Fuel & Go: the register, the pumps, the shelves and the fuel deliveries.',
    titles: ['Cashier', 'Senior Cashier', 'Shift Lead', 'Assistant Manager', 'Station Manager'], pay: [150, 210, 280, 360, 460],
    uniform: { top: '#c62f2f', bottom: '#2f3540', hat: 'visor', hatColor: '#c62f2f' },
    links: 'Fuels every truck in town, takes the tanker deliveries, and calls the fire station for spills.',
    shiftCost: { energy: -18, hunger: -22, fun: -8, social: 8 },
    tasks: [
      { id: 'register', label: 'Run the register', seconds: 20, perf: 5, needs: { social: 6 } },
      { id: 'stock', label: 'Stock the shelves', seconds: 20, perf: 5 },
      { id: 'pumps', label: 'Clean the pumps', seconds: 20, perf: 4, needs: { hygiene: -6 } },
      { id: 'fleet', label: 'Fuel the emergency fleet', seconds: 25, perf: 8, with: 'police' },
    ],
  },
  food: {
    id: 'food', title: 'Fast Food Crew', place: 'diner',
    blurb: 'Work the grill and the drive-thru at Sunny Side Burgers and run deliveries.',
    titles: ['Crew Member', 'Grill Cook', 'Crew Trainer', 'Shift Manager', 'Restaurant Manager'], pay: [140, 200, 270, 350, 450],
    uniform: { top: '#f2b632', bottom: '#3a2c22', hat: 'visor', hatColor: '#d0452a' },
    links: 'Feeds the police and fire crews on their lunch runs, delivers to houses, and caters the resort.',
    shiftCost: { energy: -20, hunger: 10, hygiene: -24, social: 6 },
    tasks: [
      { id: 'grill', label: 'Work the grill', seconds: 25, perf: 6, needs: { hygiene: -6 } },
      { id: 'window', label: 'Drive-thru window', seconds: 20, perf: 5, needs: { social: 8 } },
      { id: 'clean', label: 'Clean the dining room', seconds: 20, perf: 4 },
      { id: 'station', label: 'Deliver to the fire station', seconds: 30, perf: 8, bonus: 25, with: 'firefighter' },
    ],
  },
  ems: {
    id: 'ems', title: 'EMS Paramedic', place: 'hospital',
    blurb: 'Answer medical calls in Medic 1 and bring patients to Hood General.',
    titles: ['EMT Trainee', 'EMT', 'Paramedic', 'Field Supervisor', 'EMS Chief'], pay: [210, 290, 380, 490, 630],
    uniform: { top: '#2c4a8a', bottom: '#1f2a44', hat: 'none', vest: '#e8e8e8' },
    links: 'Rolls with the fire engine, hands patients to the nurses, and stands by at the resort pool.',
    shiftCost: { energy: -28, hunger: -26, fun: -4 },
    tasks: [
      { id: 'restock', label: 'Restock the ambulance', seconds: 20, perf: 5 },
      { id: 'cpr', label: 'Practice CPR', seconds: 25, perf: 6 },
      { id: 'handoff', label: 'Patient handoff to nurses', seconds: 20, perf: 6, with: 'nurse' },
      { id: 'standby', label: 'Standby at the resort pool', seconds: 25, perf: 5, needs: { fun: 6 }, with: 'resort' },
    ],
  },
  nurse: {
    id: 'nurse', title: 'Nurse', place: 'hospital',
    blurb: 'Care for patients at Hood General as the ambulances bring them in.',
    titles: ['Nursing Assistant', 'Registered Nurse', 'Charge Nurse', 'Nurse Practitioner', 'Chief Nursing Officer'], pay: [220, 310, 410, 530, 680],
    uniform: { top: '#5fb3a8', bottom: '#5fb3a8', hat: 'none' },
    links: 'Takes patients from EMS, treats hurt firefighters and inmates, and holds health talks at the prison.',
    shiftCost: { energy: -26, hunger: -24, social: 8 },
    tasks: [
      { id: 'rounds', label: 'Patient rounds', seconds: 25, perf: 6, needs: { social: 6 } },
      { id: 'chart', label: 'Update charts', seconds: 20, perf: 5, needs: { fun: -5 } },
      { id: 'surgery', label: 'Assist in surgery', seconds: 35, perf: 9, needs: { energy: -6 } },
      { id: 'clinic', label: 'Clinic day at the prison', seconds: 30, perf: 7, with: 'guard' },
    ],
  },
}

export function jobDef(id: string | null | undefined): JobDef | null {
  return id && (JOB_IDS as readonly string[]).includes(id) ? JOBS[id as JobId] : null
}

export function jobTitle(job: JobId, level: number): string {
  return JOBS[job].titles[Math.max(0, Math.min(MAX_LEVEL, level) - 1)]
}

export function shiftPay(job: JobId, level: number, perf: number): number {
  const base = JOBS[job].pay[Math.max(0, Math.min(MAX_LEVEL, level) - 1)]
  return Math.round(base * (0.5 + Math.max(0, Math.min(100, perf)) / 100))
}

export function xpForNext(level: number): number {
  return level * 140
}

export function perfLabel(perf: number): string {
  if (perf >= 85) return 'Outstanding'
  if (perf >= 65) return 'Great'
  if (perf >= 45) return 'Good'
  if (perf >= 30) return 'Fair'
  return 'Slow'
}

export const SERVICE_KINDS = ['police', 'fire', 'ems', 'food', 'mow', 'city', 'resort'] as const
export type ServiceKind = (typeof SERVICE_KINDS)[number]

export interface ServiceDef {
  kind: ServiceKind
  label: string
  verb: string
  cost: number
  /** Seconds the responder spends at the lot. */
  stay: number
  blurb: string
  needsSim?: boolean
}

export const SERVICES: Record<ServiceKind, ServiceDef> = {
  police: { kind: 'police', label: 'Police', verb: 'Ask for a patrol check', cost: 0, stay: 40, blurb: 'An officer comes by to check on the house.' },
  fire: { kind: 'fire', label: 'Fire station', verb: 'Smoke alarm check', cost: 0, stay: 50, blurb: 'Engine 2 stops by and tests the smoke alarms.' },
  ems: { kind: 'ems', label: 'EMS', verb: 'Call the paramedics', cost: 0, stay: 40, blurb: 'Medic 2 checks everyone over. Anyone running on empty gets back on their feet.' },
  food: { kind: 'food', label: 'Sunny Side Burgers', verb: 'Order burgers', cost: 45, stay: 14, blurb: 'Burgers for everyone at home, delivered to the door.' },
  mow: { kind: 'mow', label: 'Greenline Lawn Co.', verb: 'Book a mowing', cost: 80, stay: 70, blurb: 'The second crew mows your yard right away.' },
  city: { kind: 'city', label: 'City Works', verb: 'Report a pothole', cost: 0, stay: 45, blurb: 'A city crew patches the road out front.' },
  resort: { kind: 'resort', label: 'Hood Springs Resort', verb: 'Book a resort day', cost: 400, stay: 12, blurb: 'The resort shuttle picks one resident up for an afternoon at the pool and the lake.', needsSim: true },
}

export const RESORT_SECONDS = 240
export const SERVICE_COOLDOWN = 10 * 60 * 1000
