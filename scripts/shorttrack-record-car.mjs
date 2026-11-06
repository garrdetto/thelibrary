import { readFileSync, writeFileSync } from 'node:fs'
import * as THREE from 'three'
import { carScenario } from '../modules-src/shorttrack/tests/carScenario.mjs'

const file = process.argv[2]
if (!file) throw new Error('usage: node scripts/shorttrack-record-car.mjs <pre-port main.js> [out]')
const source = readFileSync(file, 'utf8')
const out = process.argv[3] ?? 'modules-src/shorttrack/tests/fixtures/car-classic.json'
const cut = (from, to) => {
  const a = source.indexOf(from)
  const b = source.indexOf(to, a)
  if (a < 0 || b < 0) throw new Error(`section ${from} not found`)
  return source.slice(a, b)
}
const track = cut('const CFG = {', '\n// ===================== RENDERER')
const physics = cut('function concreteContact(c){', 'function lineCross(c){')
const contact = cut('const CORNERS=', 'function impact(')
const stubs = `
const TM={DIM:{FA:1.62,RA:-1.55}},TRUCK_SCALE=0.9,AI_TOUCH=2*CFG.carScale;
const sgnDs=(a,b)=>{let d=mod(a-b,P);if(d>P/2)d-=P;return d;};
function aiPace(){}
function spawnSparks(){}
function lineCross(c){LOG.push(['line',c.id,c.cross]);c.cross++;}
function impact(c,px,pz,ix,iz,v,kind){LOG.push(['impact',c.id,px,pz,ix,iz,v,kind]);}
`
const result = {}
for (const id of ['prison', 'bullring', 'dells', 'dellswide', 'dirt']) {
  let seed = 12345
  const random = () => { seed = (seed * 1103515245 + 12345) % 2147483648; return seed / 2147483648 }
  const fakeMath = Object.create(Math)
  fakeMath.random = random
  const LOG = []
  const fn = new Function('THREE', 'location', 'document', 'localStorage', 'Math', 'LOG', `${track}\n${stubs}\n${physics}\n${contact}\nreturn {CFG,center,toTrack,HW,P,S_LINE,stepCar,collidePair,walls};`)
  const api = fn(THREE, { search: `?track=${id}` }, { getElementById: () => null }, { getItem: () => null, setItem() {} }, fakeMath, LOG)
  result[id] = carScenario(api, LOG)
}
writeFileSync(out, JSON.stringify(result))
console.log(`wrote ${out}`)
