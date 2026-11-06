import { readFileSync, writeFileSync } from 'node:fs'
import * as THREE from 'three'

const source = readFileSync(process.argv[2] ?? 'modules-src/shorttrack/main.js', 'utf8')
const out = process.argv[3] ?? 'modules-src/shorttrack/tests/fixtures/track-classic.json'
const start = source.indexOf('const CFG = {')
const endMarker = 'function aMaxAt('
const end = source.indexOf('\n', source.indexOf(endMarker))
if (start < 0 || end < 0) throw new Error('track section not found')
const section = source.slice(start, end)

const probe = `
const S=[];for(let i=-6;i<=150;i++)S.push(i*P/144);S.push(T1,T2,T1+TURN,L+TURN,P-1e-9,P,P+1e-9,0.5,L-0.5,T2-0.25);
const LAT=[-HW-4,-HW-0.5,-HW,-HW+0.01,-3.3,0,0.7,2.5,HW-0.1,HW,HW+1.5];
const MU=[0.6,CFG.grip,CFG.apronGrip,1.3];
const XZ=[];for(let x=-L/2-R-14;x<=L/2+R+14;x+=11.3)for(let z=-R-13;z<=R+13;z+=7.9)XZ.push([+x.toFixed(3),+z.toFixed(3)]);
const n=new THREE.Vector3();
return {
  consts:{L,R,W,AP,HW,TURN,P,S_LINE,T1,T2,GROOVE_HIGH,GROOVE_LOW,GROOVE_SPAN,LINE_MIN,LINE_MAX,DIRT},
  cfg:JSON.parse(JSON.stringify(CFG)),
  center:S.map(s=>center(s)),
  bank:S.map(s=>bankAt(s)),
  groove:S.map(s=>grooveLat(s)),
  height:S.flatMap(s=>LAT.map(l=>heightAt(s,l))),
  normal:S.filter((_,i)=>i%3===0).flatMap(s=>LAT.map(l=>{normalAt(s,l,n);return [n.x,n.y,n.z];})),
  aMax:S.filter((_,i)=>i%2===0).flatMap(s=>LAT.flatMap(l=>MU.map(m=>aMaxAt(s,l,m)))),
  toTrack:XZ.map(([x,z])=>toTrack(x,z)),
  inputs:{S,LAT,MU,XZ},
};`
const tracks = ['prison', 'bullring', 'dells', 'dellswide', 'dirt']
const result = {}
for (const id of tracks) {
  const location = { search: `?track=${id}` }
  const fn = new Function('THREE', 'location', 'document', 'localStorage', `${section}\n${probe}`)
  result[id] = fn(THREE, location, { getElementById: () => null }, { getItem: () => null, setItem() {} })
}
writeFileSync(out, JSON.stringify(result))
console.log(`wrote ${out}: ${tracks.length} tracks`)
