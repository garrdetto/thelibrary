import { useEffect, useRef, useState } from 'react'
import type { KeyboardEvent } from 'react'
import { Flag, RotateCcw, Wrench } from 'lucide-react'
import { io } from 'socket.io-client'
import type { Socket } from 'socket.io-client'
import { PoolAccount } from './PoolAccount'
import { OnlinePlayers } from './SitePresence'
import { RecordResetDialog } from './RecordResetDialog'
import { CAR_SCALE, OVAL_BACKDROP, ROLLING_START, TRACK_MAP_SCALE, TRACK_SCENE_WIDTH, TRACK_SCENE_HEIGHT, positionSpeedBonus, trackFor } from '../../server/racing-engine.mjs'
import { presets, vehicles, vehicleImage, stockCarImage, defaultStockCar, displayScheme, randomOpponentScheme, tracks } from '../lib/racing'
import type { Car, Controls, Scheme, StockCarPaint, RaceRoom, VehicleId, TrackId, RaceTrack } from '../lib/racing'
import type { PoolPlayer } from '../lib/pool-network'

type LapRecord = {username:string;milliseconds:number;date:string;mode:string;track?:TrackId}
type Player = {id:string;name:string;busy:boolean}
type RaceMode = 'practice'|'multiplayer'|'time-attack'
const DEFAULT_LAPS=3,MIN_LAPS=1,MAX_LAPS=50
function clampLaps(value:string) {
  const laps=Math.round(Number(value))
  return Number.isFinite(laps)&&value.trim()?Math.min(MAX_LAPS,Math.max(MIN_LAPS,laps)):DEFAULT_LAPS
}
const modeNames = {practice:'Single Player', 'time-attack':'Time Attack', multiplayer:'Multiplayer Race'}
async function api(body?:unknown) {
  const response=await fetch('/api/racing',body?{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)}:undefined)
  const result=await response.json().catch(()=>({error:'Racing services are unavailable.'}))
  if(!response.ok)throw Object.assign(new Error(result.error??'Unable to connect.'),{status:response.status})
  return result
}
const paintedSprites=new Map<string,HTMLCanvasElement>()
function paintedVehicle(sprite:HTMLImageElement,scheme:Scheme) {
  const paint=scheme.vehiclePaints?.[scheme.vehicle??vehicles[0].id]
  if(!paint)return sprite
  const key=JSON.stringify([scheme.vehicle,paint])
  const cached=paintedSprites.get(key);if(cached)return cached
  const canvas=document.createElement('canvas');canvas.width=832;canvas.height=448
  const ctx=canvas.getContext('2d');if(!ctx)return sprite
  ctx.drawImage(sprite,0,0,832,448)
  const pixels=ctx.getImageData(0,0,832,448),mask=document.createElement('canvas');mask.width=832;mask.height=448
  const maskContext=mask.getContext('2d');if(!maskContext)return sprite
  const maskPixels=maskContext.createImageData(832,448)
  const rgb=[1,3,5].map(offset=>parseInt(paint.body.slice(offset,offset+2),16))
  for(let index=0;index<pixels.data.length;index+=4){
    const r=pixels.data[index],g=pixels.data[index+1],b=pixels.data[index+2],a=pixels.data[index+3],high=Math.max(r,g,b),low=Math.min(r,g,b)
    if(a<20||high<65||(high-low<22&&high<145))continue
    const shade=(r*.299+g*.587+b*.114)/180
    for(let channel=0;channel<3;channel++)pixels.data[index+channel]=Math.min(255,rgb[channel]*shade)
    maskPixels.data[index]=255;maskPixels.data[index+1]=255;maskPixels.data[index+2]=255;maskPixels.data[index+3]=a
  }
  ctx.putImageData(pixels,0,0);maskContext.putImageData(maskPixels,0,0)
  const graphics=document.createElement('canvas');graphics.width=832;graphics.height=448
  const art=graphics.getContext('2d');if(!art)return canvas
  art.scale(3.2,3.2)
  art.fillStyle=paint.stripe;art.strokeStyle=paint.stripe;art.lineWidth=7
  if(paint.pattern==='stripes'){art.fillRect(0,51,260,11);art.fillRect(0,78,260,11)}
  if(paint.pattern==='checker')for(let x=0;x<260;x+=12)for(let y=0;y<140;y+=12)if((x+y)/12%2===0)art.fillRect(x,y,12,12)
  if(paint.pattern==='chevrons')for(let x=10;x<260;x+=42){art.beginPath();art.moveTo(x,24);art.lineTo(x+26,70);art.lineTo(x,116);art.stroke()}
  if(paint.pattern==='lightning'){art.beginPath();art.moveTo(12,63);art.lineTo(126,40);art.lineTo(108,65);art.lineTo(240,49);art.lineTo(119,96);art.lineTo(140,73);art.closePath();art.fill()}
  if(paint.pattern==='flames')for(const side of [-1,1]){
    art.beginPath();art.moveTo(5,70+side*48);art.bezierCurveTo(60,70+side*30,85,70+side*68,180,70+side*33);art.bezierCurveTo(130,70+side*40,145,70+side*8,222,70+side*18);art.bezierCurveTo(125,70-side*5,101,70+side*28,5,70+side*20);art.closePath();art.fill()
  }
  art.resetTransform();art.globalCompositeOperation='destination-in';art.drawImage(mask,0,0);ctx.drawImage(graphics,0,0)
  if(paintedSprites.size>100)paintedSprites.delete(paintedSprites.keys().next().value!)
  paintedSprites.set(key,canvas);return canvas
}
const detailedSprites=new Map<string,HTMLCanvasElement>()
function detailedVehicle(sprite:HTMLImageElement,scheme:Scheme) {
  const key=JSON.stringify([scheme.vehicle,scheme.vehiclePaints?.[scheme.vehicle??vehicles[0].id]])
  const cached=detailedSprites.get(key);if(cached)return cached
  const canvas=document.createElement('canvas');canvas.width=832;canvas.height=448
  const ctx=canvas.getContext('2d');if(!ctx)return sprite
  ctx.drawImage(paintedVehicle(sprite,scheme),0,0,832,448)
  ctx.save();ctx.scale(3.2,3.2)
  const vehicle=scheme.vehicle??vehicles[0].id,truck=vehicle==='ram',suv=vehicle==='escalade',exotic=vehicle==='lamborghini'
  ctx.lineJoin='round';ctx.lineCap='round'
  const seam=(points:number[][],color:string|CanvasGradient,width:number)=>{
    ctx.beginPath();points.forEach(([x,y],index)=>index?ctx.lineTo(x,y):ctx.moveTo(x,y));ctx.strokeStyle=color;ctx.lineWidth=width;ctx.stroke()
  }
  for(const side of [-1,1]){
    const y=(value:number)=>70+side*value
    seam([[20,y(48)],[75,y(51)],[139,y(47)],[188,y(48)],[243,y(44)]],'#eff4ef77',.7)
    seam([[70,y(43)],[76,y(31)],[137,y(31)],[146,y(43)]],'#14252b99',.65)
    seam([[82,y(42)],[95,y(42)]],'#19272cc4',1.1)
    seam([[83,y(41.3)],[94,y(41.3)]],'#eef3eead',.5)
    seam([[193,y(36)],[231,y(34)],[241,y(26)]],'#17272c99',.6)
    const lamp=ctx.createLinearGradient(243,y(34),249,y(34))
    lamp.addColorStop(0,'#c7d8dc');lamp.addColorStop(.5,'#f4f5dc');lamp.addColorStop(1,'#9caeb2')
    seam([[247,y(24)],[248,y(35)]],lamp,1.7)
    seam([[9,y(24)],[10,y(36)]],'#ba322b',1.6)
    seam([[9,y(25)],[9,y(34)]],'#f6977977',.6)
    for(let tread=0;tread<5;tread++)seam([[48+tread*2,y(55)],[49+tread*2,y(57)]],'#8b929477',.45)
    for(let tread=0;tread<5;tread++)seam([[203+tread*2,y(53)],[204+tread*2,y(55)]],'#8b929477',.45)
  }
  if(!truck){
    const glass=ctx.createLinearGradient(140,35,179,101)
    glass.addColorStop(0,'#a7cfda55');glass.addColorStop(.45,'#6c9eac08');glass.addColorStop(.5,'#d4e5e52e');glass.addColorStop(1,'#182d3d11')
    ctx.fillStyle=glass;ctx.beginPath();ctx.moveTo(145,39);ctx.quadraticCurveTo(166,31,177,43);ctx.lineTo(181,93);ctx.quadraticCurveTo(166,109,145,102);ctx.closePath();ctx.fill()
    seam([[149,97],[170,90]],'#cad9db66',.7)
  }
  if(exotic)for(let vent=0;vent<6;vent++)seam([[92+vent*4,53],[92+vent*4,87]],'#19262caa',1)
  if(truck)for(let rib=0;rib<5;rib++)seam([[29,49+rib*10],[102,49+rib*10]],'#dae0dd55',.65)
  if(suv){seam([[65,37],[129,37]],'#e6ece7aa',1.3);seam([[65,103],[129,103]],'#e6ece7aa',1.3)}
  for(let slat=0;slat<7;slat++)seam([[251,57+slat*4],[253,57+slat*4]],'#bdcacbbb',.6)
  ctx.restore();ctx.globalCompositeOperation='destination-in';ctx.drawImage(sprite,0,0,832,448)
  if(detailedSprites.size>100)detailedSprites.delete(detailedSprites.keys().next().value!)
  const display=document.createElement('canvas');display.width=104;display.height=56
  const displayContext=display.getContext('2d')
  if(displayContext){displayContext.imageSmoothingQuality='high';displayContext.drawImage(canvas,0,0,104,56)}
  const result=displayContext?display:canvas
  detailedSprites.set(key,result);return result
}
const vehicleSprites=new Map<VehicleId,HTMLImageElement>()
function vehicleSprite(vehicle:VehicleId) {
  let sprite=vehicleSprites.get(vehicle)
  if(!sprite){sprite=new Image();sprite.src=vehicleImage(vehicle);vehicleSprites.set(vehicle,sprite)}
  return sprite.complete&&sprite.naturalWidth?sprite:undefined
}
const clipartSprites=new Map<string,HTMLCanvasElement>()
function racingNumber(name:string) {
  let hash=0
  for(const character of name)hash=(Math.imul(hash,31)+character.charCodeAt(0))>>>0
  return hash%99+1
}
function clipartRacecar(car:Car) {
  const paint=car.scheme.vehiclePaints?.[car.scheme.vehicle??vehicles[0].id]
  const body=paint?.body??car.scheme.body,stripe=paint?.stripe??car.scheme.stripe,number=racingNumber(car.name)
  const key=JSON.stringify([body,stripe,number])
  const cached=clipartSprites.get(key);if(cached)return cached
  const canvas=document.createElement('canvas');canvas.width=208;canvas.height=112
  const ctx=canvas.getContext('2d');if(!ctx)return canvas
  const outline='#151515'
  ctx.scale(.8,.8);ctx.lineJoin='round';ctx.lineCap='round'
  for(const x of [50,182])for(const y of [5,109]){
    ctx.beginPath();ctx.roundRect(x,y,46,26,8);ctx.fillStyle='#222326';ctx.fill();ctx.lineWidth=5;ctx.strokeStyle=outline;ctx.stroke()
    ctx.fillStyle='#6c7078';ctx.fillRect(x+15,y+9,16,8)
  }
  ctx.beginPath();ctx.roundRect(4,14,26,112,7);ctx.fillStyle=stripe;ctx.fill();ctx.lineWidth=6;ctx.strokeStyle=outline;ctx.stroke()
  const shell=new Path2D()
  shell.moveTo(30,32);shell.quadraticCurveTo(30,19,48,19);shell.lineTo(168,21)
  shell.bezierCurveTo(214,23,247,41,254,70);shell.bezierCurveTo(247,99,214,117,168,119)
  shell.lineTo(48,121);shell.quadraticCurveTo(30,121,30,108);shell.closePath()
  ctx.fillStyle=body;ctx.fill(shell)
  ctx.save();ctx.clip(shell)
  ctx.fillStyle=stripe;ctx.fillRect(0,52,260,11);ctx.fillRect(0,77,260,11)
  ctx.fillStyle='#ffffff55';ctx.beginPath();ctx.ellipse(130,30,100,7,0,0,Math.PI*2);ctx.fill()
  ctx.fillStyle='#00000026';ctx.beginPath();ctx.ellipse(130,116,110,9,0,0,Math.PI*2);ctx.fill()
  ctx.restore()
  ctx.lineWidth=7;ctx.strokeStyle=outline;ctx.stroke(shell)
  ctx.beginPath();ctx.moveTo(124,38);ctx.quadraticCurveTo(160,36,172,48);ctx.quadraticCurveTo(178,70,172,92);ctx.quadraticCurveTo(160,104,124,102);ctx.quadraticCurveTo(132,70,124,38);ctx.closePath()
  ctx.fillStyle='#24313c';ctx.fill();ctx.lineWidth=4.5;ctx.stroke()
  ctx.beginPath();ctx.moveTo(140,46);ctx.quadraticCurveTo(160,46,166,56);ctx.lineWidth=4;ctx.strokeStyle='#ffffffaa';ctx.stroke()
  ctx.beginPath();ctx.arc(86,70,23,0,Math.PI*2);ctx.fillStyle='#fbfaf4';ctx.fill();ctx.lineWidth=4.5;ctx.strokeStyle=outline;ctx.stroke()
  ctx.fillStyle=outline;ctx.font='900 28px system-ui, sans-serif';ctx.textAlign='center';ctx.textBaseline='middle';ctx.fillText(String(number),86,72)
  for(const y of [48,92]){ctx.beginPath();ctx.ellipse(238,y,6,9,0,0,Math.PI*2);ctx.fillStyle='#ffe066';ctx.fill();ctx.lineWidth=3;ctx.strokeStyle=outline;ctx.stroke()}
  if(clipartSprites.size>100)clipartSprites.delete(clipartSprites.keys().next().value!)
  clipartSprites.set(key,canvas);return canvas
}
let stockCarBase:HTMLImageElement|undefined
function stockCarSource() {
  if(!stockCarBase){stockCarBase=new Image();stockCarBase.src=stockCarImage}
  return stockCarBase.complete&&stockCarBase.naturalWidth?stockCarBase:undefined
}
const stockCarSprites=new Map<string,HTMLCanvasElement>()
const stockCarLogos=[[424,79,481,113],[428,132,473,146],[52,202,80,225]]
function stockCarPaint(scheme:Scheme,name:string):StockCarPaint {
  return scheme.stockCar??{...defaultStockCar,number:racingNumber(name)}
}
function stockCarSprite(paint:StockCarPaint) {
  const base=stockCarSource();if(!base)return undefined
  const key=JSON.stringify(paint),cached=stockCarSprites.get(key);if(cached)return cached
  const canvas=document.createElement('canvas');canvas.width=base.naturalWidth;canvas.height=base.naturalHeight
  const ctx=canvas.getContext('2d',{willReadFrequently:true});if(!ctx)return undefined
  ctx.drawImage(base,0,0)
  const pixels=ctx.getImageData(0,0,canvas.width,canvas.height),data=pixels.data
  const rgb=(hex:string)=>[1,3,5].map(offset=>parseInt(hex.slice(offset,offset+2),16))
  const body=rgb(paint.body),stripe=rgb(paint.stripe),accent=rgb(paint.accent)
  for(let index=0;index<data.length;index+=4){
    if(data[index+3]<10)continue
    const pixel=index/4,x=pixel%canvas.width,y=(pixel-x)/canvas.width
    if(stockCarLogos.some(([left,top,right,bottom])=>x>=left&&x<=right&&y>=top&&y<=bottom))continue
    const r=data[index],g=data[index+1],b=data[index+2],high=Math.max(r,g,b),low=Math.min(r,g,b),saturation=high?(high-low)/high:0
    let target:number[]|undefined,shade=1
    if(saturation>.4&&high>50){
      const hue=high===r?((g-b)/(high-low)+6)%6*60:high===g?((b-r)/(high-low)+2)*60:((r-g)/(high-low)+4)*60
      if(hue>=190&&hue<=255){target=body;shade=high/214}
      else if(hue<=18||hue>=335){target=stripe;shade=high/214}
    }else if(saturation<.14&&high>195){target=accent;shade=high/250}
    if(!target)continue
    for(let channel=0;channel<3;channel++)data[index+channel]=Math.min(255,target[channel]*Math.min(1.15,shade))
  }
  ctx.putImageData(pixels,0,0)
  const label=String(paint.number)
  ctx.save();ctx.translate(253,100);ctx.transform(1,0,-.18,1,0,0)
  ctx.font='italic 900 92px system-ui, sans-serif';ctx.textAlign='center';ctx.textBaseline='middle';ctx.lineJoin='round'
  ctx.lineWidth=16;ctx.strokeStyle=paint.body;ctx.strokeText(label,0,4)
  ctx.lineWidth=7;ctx.strokeStyle='#ffffff';ctx.strokeText(label,0,4)
  ctx.fillStyle='#111214';ctx.fillText(label,0,4)
  ctx.restore()
  if(stockCarSprites.size>100)stockCarSprites.delete(stockCarSprites.keys().next().value!)
  stockCarSprites.set(key,canvas);return canvas
}
function drawCar(ctx:CanvasRenderingContext2D,car:Car,track:TrackId) {
  ctx.save();ctx.translate(car.x,car.y);ctx.rotate(car.angle)
  const raceTrack=trackFor(track)
  if(track==='oval'){
    const sprite=stockCarSprite(stockCarPaint(car.scheme,car.name)),{CAR_LENGTH:length,CAR_WIDTH:width}=raceTrack
    ctx.shadowColor='#0d191dbb';ctx.shadowBlur=4;ctx.shadowOffsetY=3
    ctx.drawImage(sprite??clipartRacecar(car),-length/2,-width/2,length,width);ctx.restore();return
  }
  const scale=CAR_SCALE*raceTrack.carScale;ctx.scale(scale,scale)
  const sprite=vehicleSprite(car.scheme.vehicle??vehicles[0].id)
  if(sprite){ctx.shadowColor='#0d191dbb';ctx.shadowBlur=3;ctx.shadowOffsetY=2;ctx.drawImage(detailedSprites.get(JSON.stringify([car.scheme.vehicle,car.scheme.vehiclePaints?.[car.scheme.vehicle??vehicles[0].id]]))??sprite,-13,-7,26,14);ctx.restore();return}
  ctx.restore()
}
function drawPlaceBadge(ctx:CanvasRenderingContext2D,car:Car,place:number,track:TrackId) {
  const {CAR_LENGTH:length,CAR_WIDTH:width}=trackFor(track),reach=length*.24,radius=Math.max(6,width*.3)
  const x=car.x+Math.cos(car.angle)*reach,y=car.y+Math.sin(car.angle)*reach
  ctx.save();ctx.beginPath();ctx.arc(x,y,radius,0,Math.PI*2)
  ctx.fillStyle=place===1?'#f0d990':'#13252ce6';ctx.fill()
  ctx.lineWidth=1.5;ctx.strokeStyle=place===1?'#13252c':'#f4ecd6';ctx.stroke()
  ctx.fillStyle=place===1?'#13252c':'#f4ecd6';ctx.font=`bold ${Math.round(radius*(place>9?1.05:1.3))}px monospace`;ctx.textAlign='center';ctx.textBaseline='middle'
  ctx.fillText(String(place),x,y+.5);ctx.restore()
}
const RACE_VIEW_ZOOM = .9
const raceViewWidth = 1250 / RACE_VIEW_ZOOM, raceViewHeight = 610 / RACE_VIEW_ZOOM
const raceView = { x: (705 - raceViewWidth / 2) * TRACK_MAP_SCALE, y: (375 - raceViewHeight / 2) * TRACK_MAP_SCALE, width: raceViewWidth * TRACK_MAP_SCALE, height: raceViewHeight * TRACK_MAP_SCALE }
type CourseGeometry = {id:TrackId;COURSE:number[][];COURSE_HALF_WIDTHS:number[];courseNormals:number[][];outerSide:number}
const geometries=new Map<TrackId,CourseGeometry>()
function courseGeometry(track:RaceTrack) {
  const cached=geometries.get(track.id);if(cached)return cached
  const {COURSE,COURSE_HALF_WIDTHS}=track
  const courseNormals=COURSE.map((_,index)=>{
    const previous=COURSE[(index+COURSE.length-1)%COURSE.length],next=COURSE[(index+1)%COURSE.length]
    const angle=Math.atan2(next[1]-previous[1],next[0]-previous[0])
    return [-Math.sin(angle),Math.cos(angle)]
  })
  const result={id:track.id,COURSE,COURSE_HALF_WIDTHS,courseNormals,outerSide:track.outerSide}
  geometries.set(track.id,result);return result
}
function roadRibbon(ctx:CanvasRenderingContext2D,geometry:CourseGeometry,widthScale:number) {
  const {COURSE,COURSE_HALF_WIDTHS,courseNormals}=geometry
  ctx.beginPath()
  COURSE.forEach(([x,y],index)=>{
    const next=(index+1)%COURSE.length,[nx,ny]=COURSE[next]
    const width=COURSE_HALF_WIDTHS[index]*widthScale,nextWidth=COURSE_HALF_WIDTHS[next]*widthScale
    const [ax,ay]=courseNormals[index],[bx,by]=courseNormals[next]
    const quad=[[x+ax*width,y+ay*width],[nx+bx*nextWidth,ny+by*nextWidth],[nx-bx*nextWidth,ny-by*nextWidth],[x-ax*width,y-ay*width]]
    const area=quad.reduce((sum,[px,py],corner)=>{const [qx,qy]=quad[(corner+1)%4];return sum+px*qy-qx*py},0)
    if(area<0)quad.reverse()
    quad.forEach(([px,py],corner)=>corner?ctx.lineTo(px,py):ctx.moveTo(px,py));ctx.closePath()
    ctx.moveTo(x+width,y);ctx.arc(x,y,width,0,Math.PI*2)
  })
}
function roadEdge(ctx:CanvasRenderingContext2D,geometry:CourseGeometry,side:number,inset:number) {
  const {COURSE,COURSE_HALF_WIDTHS,courseNormals}=geometry
  const edge=COURSE.map(([x,y],index)=>{
    const [nx,ny]=courseNormals[index],width=(COURSE_HALF_WIDTHS[index]-inset)*side
    return [x+nx*width,y+ny*width]
  })
  const last=edge[edge.length-1],first=edge[0]
  ctx.beginPath();ctx.moveTo((last[0]+first[0])/2,(last[1]+first[1])/2)
  edge.forEach(([x,y],index)=>{
    const next=edge[(index+1)%edge.length]
    ctx.quadraticCurveTo(x,y,(x+next[0])/2,(y+next[1])/2)
  })
  ctx.closePath()
}
const GRAIN_TILE=256
function grainTile() {
  const tile=document.createElement('canvas');tile.width=GRAIN_TILE;tile.height=GRAIN_TILE
  const ctx=tile.getContext('2d');if(!ctx)return tile
  let seed=7319
  const random=()=>{seed=(Math.imul(seed,1664525)+1013904223)>>>0;return seed/4294967296}
  const count=Math.round(65000*GRAIN_TILE*GRAIN_TILE/(TRACK_SCENE_WIDTH*TRACK_SCENE_HEIGHT))
  for(let grain=0;grain<count;grain++){
    const x=random()*GRAIN_TILE,y=random()*GRAIN_TILE,size=.5+random()*1.6
    ctx.fillStyle=grain%3?'#171b2026':'#d4cfc52b';ctx.fillRect(x,y,size,size*.65)
  }
  return tile
}
function drawRoadTexture(ctx:CanvasRenderingContext2D,geometry:CourseGeometry) {
  const {COURSE,courseNormals}=geometry
  ctx.save();roadRibbon(ctx,geometry,1);ctx.clip('nonzero')
  const grain=ctx.createPattern(grainTile(),'repeat')
  if(grain){ctx.fillStyle=grain;ctx.fillRect(0,0,TRACK_SCENE_WIDTH,TRACK_SCENE_HEIGHT)}
  for(let pass=0;pass<9;pass++){
    const offset=(pass-4)*5*TRACK_MAP_SCALE
    ctx.beginPath()
    COURSE.forEach(([x,y],index)=>{
      const [nx,ny]=courseNormals[index],drift=Math.sin(index*.065+pass*.4)*8*TRACK_MAP_SCALE
      const px=x+nx*(offset+drift),py=y+ny*(offset+drift)
      if(index)ctx.lineTo(px,py);else ctx.moveTo(px,py)
    })
    ctx.closePath();ctx.lineWidth=(1+pass%3)*TRACK_MAP_SCALE;ctx.strokeStyle='#11151a16';ctx.stroke()
  }
  for(let index=0;index<COURSE.length;index++){
    const [nx,ny]=courseNormals[index],[bx,by]=courseNormals[(index+6)%COURSE.length]
    if(Math.abs(nx*by-ny*bx)<.18)continue
    for(const wheel of [-1,1]){
      ctx.beginPath()
      for(let step=0;step<9;step++){
        const sample=(index+step)%COURSE.length,[x,y]=COURSE[sample],[ax,ay]=courseNormals[sample]
        const offset=wheel*8*TRACK_MAP_SCALE+Math.sin(index*.9)*18*TRACK_MAP_SCALE
        if(step)ctx.lineTo(x+ax*offset,y+ay*offset);else ctx.moveTo(x+ax*offset,y+ay*offset)
      }
      ctx.lineWidth=2*TRACK_MAP_SCALE;ctx.strokeStyle='#10131724';ctx.stroke()
    }
  }
  ctx.restore()
}
function drawRumbleStrips(ctx:CanvasRenderingContext2D,geometry:CourseGeometry) {
  const {COURSE,COURSE_HALF_WIDTHS,courseNormals}=geometry
  const sides=COURSE.map((_,index)=>{
    const before=courseNormals[(index+COURSE.length-3)%COURSE.length],after=courseNormals[(index+3)%COURSE.length]
    const bend=before[0]*after[1]-before[1]*after[0]
    return Math.abs(bend)<.14?0:Math.sign(bend)
  })
  const lengths=COURSE.map(([x,y],index)=>{
    const next=COURSE[(index+1)%COURSE.length]
    return Math.hypot(next[0]-x,next[1]-y)
  })
  const distances=[0]
  lengths.forEach(length=>distances.push(distances[distances.length-1]+length))
  const circumference=distances[COURSE.length]
  const start=sides.findIndex((side,index)=>side!==sides[(index+COURSE.length-1)%COURSE.length])
  if(start<0)return
  for(let cursor=0;cursor<COURSE.length;){
    const index=(start+cursor)%COURSE.length,side=sides[index]
    if(!side){cursor++;continue}
    let originalLength=0
    do{originalLength+=lengths[(start+cursor)%COURSE.length];cursor++}
    while(cursor<COURSE.length&&sides[(start+cursor)%COURSE.length]===side)
    const total=originalLength*1.5,begin=distances[index]-originalLength*.25
    const taper=Math.min(total/2,30*TRACK_MAP_SCALE)
    const point=(distance:number,inner:boolean)=>{
      const wrapped=((begin+distance)%circumference+circumference)%circumference
      let sample=0
      while(sample<COURSE.length-1&&distances[sample+1]<=wrapped)sample++
      const next=(sample+1)%COURSE.length,fraction=(wrapped-distances[sample])/lengths[sample]
      const x=COURSE[sample][0]+(COURSE[next][0]-COURSE[sample][0])*fraction
      const y=COURSE[sample][1]+(COURSE[next][1]-COURSE[sample][1])*fraction
      let nx=courseNormals[sample][0]+(courseNormals[next][0]-courseNormals[sample][0])*fraction
      let ny=courseNormals[sample][1]+(courseNormals[next][1]-courseNormals[sample][1])*fraction
      const normalLength=Math.hypot(nx,ny);nx/=normalLength;ny/=normalLength
      const progress=Math.min(1,distance/taper,(total-distance)/taper)
      const width=8*TRACK_MAP_SCALE*progress*progress*(3-2*progress)
      const halfWidth=COURSE_HALF_WIDTHS[sample]+(COURSE_HALF_WIDTHS[next]-COURSE_HALF_WIDTHS[sample])*fraction
      const offset=side*(halfWidth-2*TRACK_MAP_SCALE-(inner?width:0))
      return [x+nx*offset,y+ny*offset]
    }
    const stripeLength=12*TRACK_MAP_SCALE,stripeCount=Math.ceil(total/stripeLength)
    const stripeOffset=(stripeCount*stripeLength-total)/2
    for(let stripe=0;stripe<stripeCount;stripe++){
      const from=Math.max(0,stripe*stripeLength-stripeOffset),to=Math.min(total,(stripe+1)*stripeLength-stripeOffset)
      const subdivisions=Math.max(2,Math.ceil((to-from)/(2*TRACK_MAP_SCALE)))
      ctx.beginPath()
      for(const inner of [false,true])for(let vertex=0;vertex<=subdivisions;vertex++){
        const fraction=inner?1-vertex/subdivisions:vertex/subdivisions
        const [x,y]=point(from+(to-from)*fraction,inner)
        if(!inner&&vertex===0)ctx.moveTo(x,y);else ctx.lineTo(x,y)
      }
      ctx.closePath();ctx.fillStyle=stripe%2?'#dedbd1':'#b74d43';ctx.fill()
    }
  }
}
function drawLapBanner(ctx:CanvasRenderingContext2D,geometry:CourseGeometry,label:string) {
  const {COURSE,COURSE_HALF_WIDTHS}=geometry
  const [finishX,finishY]=COURSE[0]
  ctx.save();ctx.font='bold 20px monospace';ctx.textAlign='center';ctx.textBaseline='middle'
  const width=ctx.measureText(label).width+32,y=finishY-COURSE_HALF_WIDTHS[0]-28
  ctx.fillStyle='#13252cdd';ctx.strokeStyle='#f0d990';ctx.lineWidth=2
  ctx.beginPath();ctx.roundRect(finishX-width/2,y-18,width,36,6);ctx.fill();ctx.stroke()
  ctx.fillStyle='#f0d990';ctx.fillText(label,finishX,y+1)
  ctx.restore()
}
function lapBannerLabel(car:Car|undefined,laps:number) {
  if(!car?.started)return ''
  const remaining=laps-1-car.lap
  if(car.finished||remaining<=0)return 'FINISH'
  return remaining===1?'FINAL LAP':`${remaining} LAPS TO GO`
}
function widenPaintedRoad(ctx:CanvasRenderingContext2D,geometry:CourseGeometry) {
  const {COURSE,COURSE_HALF_WIDTHS,courseNormals}=geometry
  ctx.save();ctx.lineJoin='round';ctx.lineCap='round'
  roadRibbon(ctx,geometry,1);ctx.fillStyle='#3d3e41';ctx.fill('nonzero')
  drawRoadTexture(ctx,geometry);drawRumbleStrips(ctx,geometry)
  const [finishX,finishY]=COURSE[0],[nx,ny]=courseNormals[0]
  ctx.save();roadRibbon(ctx,geometry,1);ctx.clip('nonzero');ctx.translate(finishX,finishY);ctx.rotate(Math.atan2(ny,nx)-Math.PI/2)
  const tile=6*TRACK_MAP_SCALE,halfWidth=COURSE_HALF_WIDTHS[0]
  for(let row=0;row<2;row++)for(let column=0;column<Math.ceil(halfWidth*2/tile);column++){
    ctx.fillStyle=(row+column)%2?'#ece9df':'#27292b';ctx.fillRect((row-1)*tile,-halfWidth+column*tile,tile,tile)
  }
  ctx.restore()
  ctx.strokeStyle='#f1eee4';ctx.lineWidth=2.5*TRACK_MAP_SCALE
  for(const side of [1,-1]){roadEdge(ctx,geometry,side,1.5*TRACK_MAP_SCALE);ctx.stroke()}
  ctx.restore()
}

const roadLayers=new Map<TrackId,HTMLCanvasElement>()
function paintedRoad(geometry:CourseGeometry) {
  const cached=roadLayers.get(geometry.id);if(cached)return cached
  const layer=document.createElement('canvas');layer.width=TRACK_SCENE_WIDTH;layer.height=TRACK_SCENE_HEIGHT
  const ctx=layer.getContext('2d');if(ctx)widenPaintedRoad(ctx,geometry)
  roadLayers.set(geometry.id,layer);return layer
}
const courseLayers=new Map<TrackId,HTMLCanvasElement>()
const courseBackdrop='/images/max-secure-circuit.webp'
function drawForest(ctx:CanvasRenderingContext2D,from:number,to:number) {
  let seed=4127
  const random=()=>{seed=(Math.imul(seed,1664525)+1013904223)>>>0;return seed/4294967296}
  const canopy=['#1f4a1c','#2a5e22','#34702a','#3f8231','#4c923a']
  ctx.save();ctx.beginPath();ctx.rect(from,0,to-from,TRACK_SCENE_HEIGHT);ctx.clip()
  ctx.fillStyle='#1b3d18';ctx.fillRect(from,0,to-from,TRACK_SCENE_HEIGHT)
  const count=Math.round((to-from)*TRACK_SCENE_HEIGHT/260)
  for(let tree=0;tree<count;tree++){
    const x=from-20+random()*(to-from+40),y=random()*TRACK_SCENE_HEIGHT,radius=12+random()*16
    ctx.fillStyle='#0f2a0e66';ctx.beginPath();ctx.arc(x+4,y+5,radius,0,Math.PI*2);ctx.fill()
    ctx.fillStyle=canopy[Math.floor(random()*canopy.length)];ctx.beginPath();ctx.arc(x,y,radius,0,Math.PI*2);ctx.fill()
    ctx.fillStyle='#9fd06a26';ctx.beginPath();ctx.arc(x-radius*.3,y-radius*.35,radius*.45,0,Math.PI*2);ctx.fill()
  }
  ctx.restore()
}
function drawOvalBackdrop(ctx:CanvasRenderingContext2D,background?:HTMLImageElement) {
  const {width,height,centerX,centerY,sceneX,sceneY,scale}=OVAL_BACKDROP
  const left=sceneX-centerX*scale,top=sceneY-centerY*scale,right=left+width*scale,feather=20
  drawForest(ctx,0,left+feather);drawForest(ctx,right-feather,TRACK_SCENE_WIDTH)
  if(!background?.complete||!background.naturalWidth)return
  const layer=document.createElement('canvas');layer.width=TRACK_SCENE_WIDTH;layer.height=TRACK_SCENE_HEIGHT
  const art=layer.getContext('2d');if(!art)return
  art.drawImage(background,left,top,width*scale,height*scale)
  const fade=art.createLinearGradient(left,0,right,0),edge=feather/(right-left)
  fade.addColorStop(0,'#0000');fade.addColorStop(edge,'#000f');fade.addColorStop(1-edge,'#000f');fade.addColorStop(1,'#0000')
  art.globalCompositeOperation='destination-in';art.fillStyle=fade;art.fillRect(0,0,TRACK_SCENE_WIDTH,TRACK_SCENE_HEIGHT)
  ctx.drawImage(layer,0,0)
}
function drawOvalMarkings(ctx:CanvasRenderingContext2D,geometry:CourseGeometry) {
  const {COURSE,COURSE_HALF_WIDTHS,courseNormals}=geometry
  ctx.save()
  const [finishX,finishY]=COURSE[0],[nx,ny]=courseNormals[0]
  const tile=6*TRACK_MAP_SCALE,halfWidth=COURSE_HALF_WIDTHS[0]+20,columns=Math.ceil(halfWidth*2/tile)
  ctx.translate(finishX,finishY);ctx.rotate(Math.atan2(ny,nx)-Math.PI/2)
  ctx.beginPath();ctx.rect(-tile-2,-halfWidth,tile*2+4,halfWidth*2);ctx.clip()
  ctx.fillStyle='#f4f1e8';ctx.fillRect(-tile-2,-halfWidth,tile*2+4,halfWidth*2)
  for(let row=0;row<2;row++)for(let column=0;column<columns;column++){
    if((row+column)%2)continue
    ctx.fillStyle='#1d1f21';ctx.fillRect((row-1)*tile,-halfWidth+column*tile,tile,tile)
  }
  ctx.restore()
}
function drawCourse(ctx:CanvasRenderingContext2D,geometry:CourseGeometry,background?:HTMLImageElement) {
  ctx.fillStyle='#89a451';ctx.fillRect(0,0,TRACK_SCENE_WIDTH,TRACK_SCENE_HEIGHT)
  if(geometry.id==='oval'){drawOvalBackdrop(ctx,background);drawOvalMarkings(ctx,geometry);return}
  if(background?.complete&&background.naturalWidth){
    ctx.drawImage(background,0,0,TRACK_SCENE_WIDTH,TRACK_SCENE_HEIGHT)
  }
  ctx.drawImage(paintedRoad(geometry),0,0)
}
function loadCourse(geometry:CourseGeometry,onReady:(course:HTMLCanvasElement)=>void) {
  const cached=courseLayers.get(geometry.id)
  if(cached){onReady(cached);return()=>{}}
  const backdrop=new Image()
  const finish=()=>{
    const course=document.createElement('canvas');course.width=TRACK_SCENE_WIDTH;course.height=TRACK_SCENE_HEIGHT
    const ctx=course.getContext('2d');if(ctx)drawCourse(ctx,geometry,backdrop)
    if(backdrop.naturalWidth)courseLayers.set(geometry.id,course);onReady(course)
  }
  backdrop.onload=finish;backdrop.onerror=finish
  backdrop.decoding='async';backdrop.src=geometry.id==='oval'?OVAL_BACKDROP.src:courseBackdrop
  return()=>{backdrop.onload=null;backdrop.onerror=null}
}

export function Racing({players:sitePlayers,playerName,joinRequest,onJoinHandled}:{players:PoolPlayer[];playerName:string;joinRequest:number;onJoinHandled:()=>void}) {
  const [records,setRecords]=useState<LapRecord[]>([]),[recordStatus,setRecordStatus]=useState('Loading lap records…')
  async function resetRecords(password:string){
    const resetTrack=trackRef.current.id,resetMode=recordModeRef.current
    await api({action:'reset-records',password,mode:resetMode,track:resetTrack})
    pendingLaps.current=pendingLaps.current.filter(body=>body.mode!==resetMode||body.track!==resetTrack)
    if(trackRef.current.id===resetTrack&&recordModeRef.current===resetMode){setRecords([]);setRecordStatus('')}
    setNotice(`${modeNames[resetMode]} lap records on ${tracks.find(item=>item.id===resetTrack)?.name??trackInfo.name} have been cleared.`)
  }
  const run=useRef(''),submitted=useRef(0),runMode=useRef<RaceMode>('time-attack'),runTrack=useRef<TrackId>('circuit'),canSave=useRef(false)
  const [track,setTrack]=useState<TrackId>('circuit'),trackRef=useRef<RaceTrack>(trackFor('circuit'))
  const trackInfo=tracks.find(item=>item.id===track)??tracks[0]
  const [recordMode,setRecordMode]=useState<RaceMode>('time-attack'),recordModeRef=useRef<RaceMode>('time-attack')
  const [clock,setClock]=useState(Date.now())
  useEffect(()=>{const timer=setInterval(()=>setClock(Date.now()),1000);return()=>clearInterval(timer)},[])
  async function loadRecords(){try{const requestedTrack=trackRef.current.id,response=await fetch(`/api/racing?records&mode=${recordModeRef.current}&track=${requestedTrack}`);const result=await response.json();if(!response.ok)throw new Error();if(requestedTrack!==trackRef.current.id)return;if((result.records[0]?.mode===recordModeRef.current&&(result.records[0]?.track??'circuit')===requestedTrack)||!result.records.length)setRecords(result.records);setRecordStatus('')}catch{setRecordStatus('Lap records are unavailable. Try again.')}}
  function saveLaps(car:Car){
    for(let lap=submitted.current;lap<(car.lapTimes?.length??0);lap++){submitted.current=lap+1;const body={action:'lap' as const,run:run.current,lap:lap+1,milliseconds:car.lapTimes[lap],mode:runMode.current,track:runTrack.current};void api(body).then(()=>loadRecords()).catch(()=>{setRecordStatus('A lap could not be saved.');pendingLaps.current.push(body)})}
  }
  const pendingLaps=useRef<{action:'lap';run:string;lap:number;milliseconds:number;mode:RaceMode;track:TrackId}[]>([])
  const [username,setUsername]=useState<string|null>(null),[loaded,setLoaded]=useState(false),[authError,setAuthError]=useState(false)
  const [scheme,setScheme]=useState<Scheme>(displayScheme(presets[0]))
  const [mode,setMode]=useState<RaceMode>('time-attack'),[opponentCount,setOpponentCount]=useState(9)
  const [difficulty,setDifficulty]=useState(50),raceDifficulty=useRef(50)
  const [ovalLapsInput,setOvalLapsInput]=useState(String(DEFAULT_LAPS)),ovalLaps=clampLaps(ovalLapsInput),[activeLaps,setActiveLaps]=useState(DEFAULT_LAPS),raceLaps=useRef(DEFAULT_LAPS)
  const [running,setRunning]=useState(false),[hud,setHud]=useState({lap:0,speed:0,time:0,penalty:'',finished:0,best:0,lastLap:0}),[standings,setStandings]=useState<Car[]>([])
  const [error,setError]=useState(''),[notice,setNotice]=useState(''),[busy,setBusy]=useState(false)
  const [connection,setConnection]=useState('Offline'),[players,setPlayers]=useState<Player[]>([]),[room,setRoom]=useState<RaceRoom|null>(null),[connecting,setConnecting]=useState(false)
  const canvas=useRef<HTMLCanvasElement>(null),cars=useRef<Car[]>([]),input=useRef<Controls>({}),socket=useRef<Socket|null>(null),autoJoin=useRef(false),contacts=useRef(new Set<string>()),elapsed=useRef(0),active=useRef(false),multiplayer=useRef(false)
  useEffect(()=>{
    let cancelled=false
    api().then(result=>{if(!cancelled){setUsername(result.username);setScheme(displayScheme(result.scheme));void loadRecords()}}).catch(failure=>{if(!cancelled){if(failure.status!==401)setAuthError(true);setError(failure.message)}}).finally(()=>{if(!cancelled)setLoaded(true)})
    return()=>{cancelled=true;socket.current?.disconnect()}
  },[])
  useEffect(()=>{
    if(!active.current)cars.current=[trackRef.current.makeCar('local',username??'Driver',0,scheme)]
  },[scheme,username,track])
  useEffect(()=>{
    const ctx=canvas.current?.getContext('2d');if(!ctx||!username)return
    let courseCanvas:HTMLCanvasElement|null=null
    const raceTrack=trackRef.current,geometry=courseGeometry(raceTrack)
    const cancelCourse=loadCourse(geometry,course=>{courseCanvas=course})
    const displayedCars=new Map<string,Car>()
    const previousPositions=new Map<string,{car:Car;x:number;y:number;angle:number}>()
    let frame=0,last=0,accumulator=0,hudAt=0
    function tick(now:number){
      const dt=last?Math.min((now-last)/1000,1/15):0;last=now
      if(active.current&&!multiplayer.current){
        accumulator+=dt
        while(accumulator>=1/120){
          elapsed.current+=1/120
          for(const car of cars.current){
            const previous=previousPositions.get(car.id)
            if(previous){previous.car=car;previous.x=car.x;previous.y=car.y;previous.angle=car.angle}
            else previousPositions.set(car.id,{car,x:car.x,y:car.y,angle:car.angle})
          }
          if(elapsed.current>=0){
            const inputs:Record<string,Controls>={local:input.current}
            for(const car of cars.current)if(car.id!=='local')inputs[car.id]=raceTrack.aiInput(car,raceDifficulty.current,cars.current,elapsed.current)
            raceTrack.stepRace(cars.current,inputs,1/120,elapsed.current,contacts.current,runMode.current==='time-attack'?Infinity:raceLaps.current)
          }else raceTrack.paceRace(cars.current,elapsed.current)
          accumulator-=1/120
        }
        if(raceTrack.raceComplete(cars.current,elapsed.current)){active.current=false;setRunning(false);setNotice(`Race complete. Your ${raceLaps.current===1?'one':raceLaps.current}-lap run is finished.`)}
      }else accumulator=0
      const unpainted=raceTrack.id==='oval'?undefined:cars.current.find(car=>!detailedSprites.has(JSON.stringify([car.scheme.vehicle,car.scheme.vehiclePaints?.[car.scheme.vehicle??vehicles[0].id]])))
      if(unpainted){const sprite=vehicleSprite(unpainted.scheme.vehicle??vehicles[0].id);if(sprite)detailedVehicle(sprite,unpainted.scheme)}
      if(ctx){
        ctx.clearRect(0,0,raceView.width,raceView.height)
        ctx.save();ctx.translate(-raceView.x,-raceView.y)
        if(courseCanvas)ctx.drawImage(courseCanvas,0,0);else{ctx.fillStyle='#89a451';ctx.fillRect(0,0,TRACK_SCENE_WIDTH,TRACK_SCENE_HEIGHT)}
        if(!multiplayer.current||elapsed.current<0)displayedCars.clear()
        const places=new Map<string,number>(cars.current.length>1?raceTrack.raceStandings(cars.current).map((car,index)=>[car.id,index+1] as const):[])
        cars.current.forEach(car=>{
          let displayed=car
          if(!multiplayer.current&&active.current&&elapsed.current>=0){
            const previous=previousPositions.get(car.id)
            if(previous?.car===car&&Math.hypot(car.x-previous.x,car.y-previous.y)<100){
              const blend=accumulator*120
              displayed={...car,x:previous.x+(car.x-previous.x)*blend,y:previous.y+(car.y-previous.y)*blend,angle:previous.angle+Math.atan2(Math.sin(car.angle-previous.angle),Math.cos(car.angle-previous.angle))*blend}
            }
          }
          if(multiplayer.current&&elapsed.current>=0){
            const previous=displayedCars.get(car.id)
            if(previous&&Math.hypot(car.x-previous.x,car.y-previous.y)<100){
              const blend=1-Math.exp(-dt*25)
              displayed={...car,x:previous.x+(car.x-previous.x)*blend,y:previous.y+(car.y-previous.y)*blend,angle:previous.angle+Math.atan2(Math.sin(car.angle-previous.angle),Math.cos(car.angle-previous.angle))*blend}
            }
            displayedCars.set(car.id,displayed)
          }
          const isCurrentUser=car.id===(multiplayer.current?socket.current?.id:'local')
          ctx.globalAlpha=car.finished&&elapsed.current-car.finished>=1?.45:1
          drawCar(ctx,displayed,raceTrack.id)
          const place=places.get(car.id);if(place)drawPlaceBadge(ctx,displayed,place,raceTrack.id)
          ctx.fillStyle=car.nameColor??(isCurrentUser?'#39ff14':'#f4ecd6');ctx.font='14px monospace';ctx.textAlign='center';ctx.fillText(car.name,displayed.x,displayed.y-raceTrack.CAR_WIDTH/2-12);ctx.textAlign='left'
          ctx.globalAlpha=1
        })
        if(runMode.current!=='time-attack'&&active.current){const label=lapBannerLabel(cars.current.find(car=>car.id===(multiplayer.current?socket.current?.id:'local')),raceLaps.current);if(label)drawLapBanner(ctx,geometry,label)}
        ctx.restore()
        if(active.current&&elapsed.current<0){ctx.fillStyle='#13252cdd';ctx.fillRect(raceView.width/2-100,raceView.height/2-33,200,65);ctx.fillStyle='#f0d990';ctx.font='bold 36px monospace';ctx.textAlign='center';ctx.fillText(String(Math.ceil(-elapsed.current)),raceView.width/2,raceView.height/2+12);ctx.textAlign='left'}
      }
      if(now-hudAt>100){hudAt=now;const me=cars.current.find(car=>car.id===(multiplayer.current?socket.current?.id:'local'));if(me&&canSave.current)saveLaps(me);if(me)setHud({lap:me.lap,speed:Math.abs(Math.round(me.speed)),time:Math.max(0,elapsed.current),penalty:me.penalty,finished:me.finished,best:me.lapTimes.length?me.lapTimes.reduce((best,lap)=>Math.min(best,lap),Infinity):0,lastLap:me.lapTimes.at(-1)??0});setStandings(raceTrack.raceStandings(cars.current))}
      frame=requestAnimationFrame(tick)
    }
    frame=requestAnimationFrame(tick);return()=>{cancelAnimationFrame(frame);cancelCourse()}
  },[username,loaded,track])
  useEffect(()=>{
    const clear=()=>{input.current={};socket.current?.emit('input',{up:false,down:false,left:false,right:false})}
    const visibility=()=>{if(document.hidden)clear()}
    window.addEventListener('blur',clear);document.addEventListener('visibilitychange',visibility)
    const interval=setInterval(()=>{if(multiplayer.current&&active.current)socket.current?.emit('input',{up:!!input.current.up,down:!!input.current.down,left:!!input.current.left,right:!!input.current.right})},50)
    return()=>{clearInterval(interval);window.removeEventListener('blur',clear);document.removeEventListener('visibilitychange',visibility)}
  },[])
  useEffect(()=>{
    if(!joinRequest||!username)return
    onJoinHandled();setError('')
    if(socket.current?.connected){raceAction('join-race',{});return}
    if(mode!=='multiplayer')changeMode('multiplayer')
    autoJoin.current=true;void connect()
  },[joinRequest,username])
  function leaveRoom(){canSave.current=false;socket.current?.emit('leave-room');setRoom(null);active.current=false;setRunning(false)}
  function practice(){
    canSave.current=true;runMode.current=mode;runTrack.current=trackRef.current.id;run.current=crypto.randomUUID();submitted.current=0;input.current={};contacts.current.clear();elapsed.current=-ROLLING_START;multiplayer.current=false
    raceDifficulty.current=difficulty
    raceLaps.current=trackRef.current.id==='oval'?ovalLaps:DEFAULT_LAPS;setActiveLaps(raceLaps.current);setOvalLapsInput(String(ovalLaps))
    const count=mode==='time-attack'?0:opponentCount
    const raceTrack=trackRef.current,positions=raceTrack.randomGrid(count+1)
    cars.current=[raceTrack.makeCar('local',username??'Driver',positions[0],scheme),...Array.from({length:count},(_,index)=>raceTrack.makeCar(`ai-${index+1}`,`Driver ${String(index+1).padStart(2,'0')}`,positions[index+1],randomOpponentScheme()))]
    active.current=true;setRunning(true);setHud({lap:0,speed:0,time:0,penalty:'',finished:0,best:0,lastLap:0});setNotice('');setError('');canvas.current?.focus()
  }
  async function connect(){
    setConnecting(true);setError('');setConnection('Connecting')
    try{
      const {ticket}=await api({action:'ticket'})
      socket.current?.disconnect()
      const base=import.meta.env.VITE_POOL_SERVER_URL||'https://myworkhelper-production-0164.up.railway.app'
      const client=io(`${base.replace(/\/$/,'')}/racing`,{auth:{ticket},reconnection:false,timeout:10000,transports:['websocket','polling']});socket.current=client
      client.on('connect',()=>{setConnection('Connected');setConnecting(false)})
      client.on('connect_error',()=>{autoJoin.current=false;setConnection('Unavailable');setConnecting(false);setError('The Racing service is unavailable. Reconnect after the game server is updated.')})
      client.on('disconnect',()=>{active.current=false;setRunning(false);setRoom(null);setPlayers([]);setConnection('Disconnected');setConnecting(false);setNotice('Connection closed. Reconnect to enter the lobby.')})
      client.on('players',setPlayers);client.on('room',(value:RaceRoom|null)=>{setRoom(value);if(autoJoin.current){autoJoin.current=false;if(value&&!value.running&&!value.players.some(player=>player.id===client.id))raceAction('join-race',{});else if(!value||value.running)setNotice('That race invitation has closed. Start a new invitation or watch the current race.')}if(value&&!value.running){const roomTrack=trackFor(value.track);if(roomTrack.id!==trackRef.current.id){trackRef.current=roomTrack;setTrack(roomTrack.id);cars.current=[];setRecords([]);setRecordStatus('Loading lap records…');void loadRecords()}}if(!value?.running){active.current=false;setRunning(false)}})
      client.on('notice',setNotice)
      client.on('start',(value:{track?:TrackId;laps?:number;cars:Car[];elapsed:number})=>{const raceTrack=trackFor(value.track);raceLaps.current=raceTrack.id==='oval'?clampLaps(String(value.laps??DEFAULT_LAPS)):DEFAULT_LAPS;setActiveLaps(raceLaps.current);if(raceTrack.id!==trackRef.current.id){trackRef.current=raceTrack;setTrack(raceTrack.id);setRecords([]);setRecordStatus('Loading lap records…');void loadRecords()}canSave.current=value.cars.some(car=>car.id===client.id);runMode.current='multiplayer';runTrack.current=raceTrack.id;run.current=crypto.randomUUID();submitted.current=0;cars.current=value.cars;elapsed.current=value.elapsed;multiplayer.current=true;active.current=true;setRunning(true);setNotice('');canvas.current?.focus()})
      client.on('snapshot',(value:{cars:Car[];elapsed:number})=>{cars.current=value.cars;elapsed.current=value.elapsed;const me=value.cars.find(car=>car.id===client.id);if(me&&canSave.current)saveLaps(me)})
      client.on('ended',(message:string)=>{active.current=false;setRunning(false);setRoom(null);setNotice(message)})
    }catch(failure){setError((failure as Error).message);setConnection('Unavailable');setConnecting(false)}
  }
  function raceAction(event:string,payload:unknown){socket.current?.timeout(5000).emit(event,payload,(timeout:Error|null,result:{error?:string})=>{if(timeout||result?.error)setError((result?.error==='Choose AI strength from 0 to 100.'||(result?.error==='Choose a track and AI strength from 0 to 100.'&&event==='create-race'))&&track==='oval'?'The multiplayer server needs an update before it can host Oval Speedway races. Choose Max Secure Circuit or try again after the update.':result?.error??'The race service did not respond. Reconnect and try again.')})}
  function changeTrack(next:TrackId){
    if(running||room||next===trackRef.current.id)return
    trackRef.current=trackFor(next);setTrack(next);active.current=false;elapsed.current=0;contacts.current.clear();input.current={}
    cars.current=[trackRef.current.makeCar('local',username??'Driver',0,scheme)];setStandings([]);setNotice('')
    setHud({lap:0,speed:0,time:0,penalty:'',finished:0,best:0,lastLap:0});setRecords([]);setRecordStatus('Loading lap records…');void loadRecords()
  }
  async function save(vehicle:VehicleId,paint=false){
    if(busy||running||room)return
    setBusy(true);setError('');setNotice('')
    try{const result=await api(paint?{action:'paint',vehicle,...scheme.vehiclePaints?.[vehicle]}:{action:'vehicle',vehicle});setScheme(displayScheme(result.scheme));socket.current?.disconnect();setNotice(paint?'Paint design saved to your driver profile.':'Vehicle saved to your driver profile.')}catch(failure){setError((failure as Error).message)}finally{setBusy(false)}
  }
  async function saveStockCar(){
    if(busy||running||room)return
    setBusy(true);setError('');setNotice('')
    try{const result=await api({action:'stock-car',...stockCarPaint(scheme,username??'Driver')});setScheme(displayScheme(result.scheme));socket.current?.disconnect();setNotice('Oval stock car saved to your driver profile.')}catch(failure){setError((failure as Error).message)}finally{setBusy(false)}
  }
  function updateStockCar(change:Partial<StockCarPaint>){
    setScheme(current=>({...current,stockCar:{...stockCarPaint(current,username??'Driver'),...change}}))
  }
  function updatePaint(change:Partial<NonNullable<NonNullable<Scheme['vehiclePaints']>[string]>>){
    const vehicle=scheme.vehicle??vehicles[0].id
    setScheme(current=>({...current,vehiclePaints:{...current.vehiclePaints,[vehicle]:{body:'#cb6237',stripe:'#f2e5bd',pattern:'plain',...current.vehiclePaints?.[vehicle],...change}}}))
  }
  function key(event:KeyboardEvent<HTMLCanvasElement>,pressed:boolean){const bindings={ArrowUp:'up',ArrowDown:'down',ArrowLeft:'left',ArrowRight:'right'} as const;const control=bindings[event.key as keyof typeof bindings];if(control){event.preventDefault();input.current[control]=pressed}}
  function changeMode(next:RaceMode){canSave.current=false;socket.current?.disconnect();socket.current=null;setRoom(null);active.current=false;setRunning(false);setMode(next);setRecordMode(next);recordModeRef.current=next;setRecords([]);setRecordStatus('Loading lap records…');void loadRecords();multiplayer.current=next==='multiplayer';cars.current=[trackRef.current.makeCar('local',username??'Driver',0,scheme)];elapsed.current=0;setNotice('')}
  if(!loaded)return <section className="racing-app"><p role="status">Verifying workspace clearance…</p></section>
  if(!username)return <section className="racing-app racing-login"><Flag size={36}/><span className="race-eyebrow">OVERDRIVE RACING</span><h1>Your next session starts here.</h1><p>Sign in with your workspace username and password to open Racing and your Garage.</p>{authError?<><p role="alert">{error}</p><button onClick={()=>window.location.reload()}>Retry account connection</button></>:<PoolAccount username={null} ready disabled={false} beforeChange={async()=>{window.location.hash='racing'}} onFailure={()=>{}}/>}</section>
  const locked=busy||running||Boolean(room)
  const shownLaps=running?activeLaps:room?(trackFor(room.track).id==='oval'?room.laps??DEFAULT_LAPS:DEFAULT_LAPS):track==='oval'?ovalLaps:DEFAULT_LAPS
  return <section className="racing-app">
    <header className="race-heading"><div><span className="race-eyebrow"><Flag size={15}/> MOTORSPORT / EST. 2026</span><h1>Overdrive <em>Racing</em><span>03</span></h1><p>Precision driving. Personal expression. Shared competition.</p></div><div className="driver-badge"><Flag size={26}/><div>DRIVER PROFILE<strong>{username}</strong><small>{scheme.name}</small></div></div></header>
    {error&&<p className="race-error" role="alert">{error}</p>}{notice&&<p className="race-notice" role="status">{notice}</p>}
    {mode==='time-attack'&&<p className="race-notice">Solo time attack · unlimited laps · Best: {hud.best?`${(hud.best/1000).toFixed(3)}s`:'—'} · Last lap: {hud.lastLap?`${(hud.lastLap/1000).toFixed(3)}s`:'—'}</p>}
    <OnlinePlayers players={sitePlayers} name={playerName}/>
    {mode==='multiplayer'&&<section className="racing-lobby" aria-label="Racing lobby"><div><span className="race-eyebrow">ONE SHARED RACE / 24 CAR GRID</span><p>Three laps on Max Secure Circuit; the host sets the lap count on Oval Speedway. At least two players. The host picks the track and sets AI strength; AI fills the remaining places. Invitations stay open for 30 seconds. Signed-in late arrivals can watch.</p></div>{connection!=='Connected'?<button className="race-primary" disabled={connecting} onClick={()=>void connect()}>{connecting?'Connecting…':'Connect to lobby'}</button>:<><div className="online-drivers">{players.map(player=><span key={player.id}>{player.name}{player.busy?' · Entered':' · In lobby'} </span>)}</div>{!room?<button className="race-primary" onClick={()=>raceAction('create-race',track==='oval'?{difficulty,track,laps:ovalLaps}:{difficulty})}>Start race invitation</button>:<div className="race-room"><p>{room.running?(room.players.some(player=>player.id===socket.current?.id)?'Racing':'Watching the race'):`Entries close in ${Math.max(0,Math.ceil((room.expires-clock)/1000))}s`} · {trackFor(room.track).id==='oval'?'Oval Speedway':'Max Secure Circuit'} · {room.players.length} players · {trackFor(room.track).id==='oval'?room.laps??DEFAULT_LAPS:DEFAULT_LAPS} laps · AI strength {room.difficulty}/100</p>{room.players.map(player=><span key={player.id}>{player.name}{player.id===room.host?' · Host':''} </span>)}{!room.running&&!room.players.some(player=>player.id===socket.current?.id)&&<button className="race-primary" onClick={()=>raceAction('join-race',{})}>Join race</button>}{room.players.some(player=>player.id===socket.current?.id)&&<button onClick={leaveRoom}>Leave race</button>}</div>}</>}</section>}
    {standings.length>0&&<section className="race-live-standings" aria-label="Current race positions"><div className="race-standings-heading"><span className="race-eyebrow">LIVE POSITIONS</span><small>Top-speed boost · 3s taper after a pass</small></div><ol>{standings.map((car,index)=><li key={car.id} className={car.id===(multiplayer.current?socket.current?.id:'local')?'race-current-driver':undefined}><span className="race-position">{String(index+1).padStart(2,'0')}</span><span className="race-driver-name" style={{color:car.nameColor}}>{car.name}</span><small>{car.finished?'Finished':`+${(positionSpeedBonus(index+1)*100).toFixed(1).replace(/\.0$/,'')}%`}</small></li>)}</ol></section>}
    <div className="race-stage"><div className="race-hud"><div className="race-toolbar race-hud-controls"><div className="race-ai-settings"><label className="race-difficulty"><span>AI strength <output>{difficulty} / 100</output></span><input type="range" min={0} max={100} value={difficulty} disabled={running||Boolean(room)||mode==='time-attack'} aria-describedby={mode==='time-attack'?'race-difficulty-note':undefined} onChange={event=>setDifficulty(Number(event.target.value))}/>{mode==='time-attack'&&<small id="race-difficulty-note">Used for AI in Single Player and multiplayer races</small>}</label>{mode==='practice'&&<label className="race-field-size">AI opponents<select value={opponentCount} disabled={running} onChange={event=>setOpponentCount(Number(event.target.value))}>{Array.from({length:24},(_,count)=><option key={count} value={count}>{count} · {count+1} cars total</option>)}</select></label>}{track==='oval'&&mode!=='time-attack'&&<label className="race-field-size">Laps<input type="number" inputMode="numeric" min={MIN_LAPS} max={MAX_LAPS} step={1} value={ovalLapsInput} disabled={running||Boolean(room)} aria-describedby="race-laps-note" onChange={event=>setOvalLapsInput(event.target.value)} onBlur={()=>setOvalLapsInput(String(ovalLaps))}/><small id="race-laps-note">{MIN_LAPS}–{MAX_LAPS} laps on Oval Speedway</small></label>}</div><div className="race-modes" role="group" aria-label="Racing mode"><button disabled={busy} onClick={()=>{changeMode('time-attack');setHud({lap:0,speed:0,time:0,penalty:'',finished:0,best:0,lastLap:0})}}><RotateCcw size={14}/> New Game</button>{(['time-attack','practice','multiplayer'] as const).map(value=><button key={value} aria-pressed={mode===value} disabled={busy} onClick={()=>changeMode(value)}>{value==='multiplayer'?`Multiplayer (${players.length})`:modeNames[value]}</button>)}</div><div className="race-track-toggle"><span id="race-track-toggle-label">Track</span><button type="button" role="switch" aria-checked={track==='oval'} aria-labelledby="race-track-toggle-label race-track-toggle-oval" aria-describedby="race-track-toggle-current" disabled={busy||running||Boolean(room)} onClick={()=>changeTrack(track==='oval'?'circuit':'oval')}><span aria-hidden={true} className={track==='circuit'?'active':undefined}>{tracks[0].short}</span><span className="race-switch" aria-hidden={true}><span/></span><span id="race-track-toggle-oval" className={track==='oval'?'active':undefined}>{tracks[1].short}</span></button><small id="race-track-toggle-current">{trackInfo.name} · own record books</small></div>{mode==='multiplayer'&&<span className="race-connection">{connection}</span>}</div><div><small>LAP</small><strong>{mode==='time-attack'?hud.lap+1:Math.min(shownLaps,hud.lap+1)}<span> / {mode==='time-attack'?'∞':shownLaps}</span></strong></div><div><small>PACE</small><strong>{hud.speed}<span> u/s</span></strong></div><div><small>{hud.finished?'FINISH TIME':'RACE TIME'}</small><strong>{(hud.finished||hud.time).toFixed(1)}<span> s</span></strong></div>{mode==='time-attack'&&running&&<button onClick={()=>{active.current=false;setRunning(false);input.current={};setNotice('Time Attack ended. Your completed laps remain in the record books.')}}>End session</button>}{mode!=='multiplayer'&&<button className="race-primary" disabled={busy} onClick={practice}><RotateCcw size={15}/>{running?'Restart run':mode==='time-attack'?'Start Time Attack':'Start Single Player'}</button>}<span className="circuit-label">{trackInfo.name.toUpperCase()}<small>{track==='oval'?'STOCK CARS · OUTER WALL · INFIELD SLOWS YOU':'STAY INSIDE THE WHITE LINES'}</small></span></div><canvas ref={canvas} width={raceView.width} height={raceView.height} tabIndex={0} aria-label={`${trackInfo.name}. Use arrow keys to accelerate, reverse and steer. Focus the track to drive.`} onKeyDown={event=>key(event,true)} onKeyUp={event=>key(event,false)} onBlur={()=>{input.current={}}}/><div className="race-track-footer"><span><kbd>↑</kbd> Accelerate <kbd>↓</kbd> Reverse <kbd>←</kbd><kbd>→</kbd> Steer</span><span>{hud.finished?'FINISHED':running?'ON TRACK':'FOCUS THE TRACK TO DRIVE'}</span></div></div>
    <div className="race-touch" aria-label="Touch driving controls">{(['left','up','down','right'] as const).map((control,i)=><button key={control} aria-label={['Steer left','Accelerate','Reverse','Steer right'][i]} onPointerDown={event=>{event.currentTarget.setPointerCapture(event.pointerId);input.current[control]=true}} onPointerUp={()=>{input.current[control]=false}} onPointerCancel={()=>{input.current[control]=false}} onLostPointerCapture={()=>{input.current[control]=false}}>{['←','↑','↓','→'][i]}</button>)}</div>
    <div className="race-brief"><p><strong>Race regulations</strong> {mode==='time-attack'?'Unlimited solo laps':`${shownLaps} ${shownLaps===1?'lap':'laps'}`} · {track==='oval'?'cross the half-way line on the far straight for the lap to count':'checkpoints in order'} · {track==='oval'?'outer wall impact −7.5% to −22.5% by how hard you hit':'wall impact −5%'} · tapers over 1 second · repeated hits restart recovery · gradual steering response · turn taps cap speed at {track==='oval'?'88%':'95%'} of your boosted top speed without stacking · holding a turn increases the cap penalty to {track==='oval'?'62.5%':'50%'} over 1 second · {track==='oval'?'no inner wall · running onto the infield slows you 7.5% at the edge, rising evenly to 30% at a full car width off, only while off the track · oval cars have a 130% higher top speed, 4% quicker acceleration, a 10% tighter turning radius than circuit cars, and coast down at half the usual rate when you lift off the accelerator':'crossing the white lines slows you up to 60% with distance, only while outside the lines'} · more gradual acceleration into top speed and boosts · cars cannot pass through each other but can stay in contact · touching adds light resistance and a non-stacking 10% slowdown, and nudges both cars' steering based on where they meet, with steering assist pulling you back to your intended heading · {track==='oval'?`${MIN_LAPS} to ${MAX_LAPS} laps (your choice) on the oval, 3 laps on the circuit,`:'3 laps'} for Single Player and multiplayer, with cars rolling on for 1 second past the finish, then fading out so they no longer block the track{hud.penalty&&<span className="race-penalty">Latest: {hud.penalty}</span>}</p>{standings.length>1&&<ol aria-label="Race standings">{standings.map(car=><li key={car.id}><b className={car.id===(multiplayer.current?socket.current?.id:'local')?'race-current-driver':undefined}>{car.name}</b><span>{car.finished?`${car.finished.toFixed(1)}s`:`Lap ${Math.min(3,car.lap+1)}`}</span></li>)}</ol>}</div>
    <section className="race-garage" aria-busy={busy}><header><div><span className="race-eyebrow"><Wrench size={14}/> YOUR VEHICLES</span><h2>The Garage<span> / 5 CUSTOM CARS</span></h2><p>Choose one of your custom vehicles. Colors and designs are saved separately for each car type.</p></div><div className="garage-current"><CarPreview scheme={scheme}/><small>SELECTED VEHICLE<strong>{scheme.name}</strong></small></div></header><div className="race-body-styles" role="group" aria-label="Custom vehicle">{vehicles.map(vehicle=><button key={vehicle.id} aria-pressed={scheme.vehicle===vehicle.id} disabled={locked} onClick={()=>void save(vehicle.id)}><CarPreview scheme={{...scheme,vehicle:vehicle.id}}/><strong>{vehicle.name}</strong></button>)}</div><div className="race-paint-controls"><label>Body color<input type="color" disabled={locked} value={scheme.vehiclePaints?.[scheme.vehicle??vehicles[0].id]?.body??'#cb6237'} onChange={event=>updatePaint({body:event.target.value})}/></label><label>Design color<input type="color" disabled={locked} value={scheme.vehiclePaints?.[scheme.vehicle??vehicles[0].id]?.stripe??'#f2e5bd'} onChange={event=>updatePaint({stripe:event.target.value})}/></label><label>Design<select disabled={locked} value={scheme.vehiclePaints?.[scheme.vehicle??vehicles[0].id]?.pattern??'plain'} onChange={event=>updatePaint({pattern:event.target.value as 'plain'|'stripes'|'flames'|'chevrons'|'checker'|'lightning'})}>{['plain','stripes','flames','chevrons','checker','lightning'].map(pattern=><option key={pattern} value={pattern}>{pattern[0].toUpperCase()+pattern.slice(1)}</option>)}</select></label><button disabled={locked||!scheme.vehiclePaints?.[scheme.vehicle??vehicles[0].id]} onClick={()=>void save(scheme.vehicle??vehicles[0].id,true)}>Save paint design</button><small>Preview changes live. Save before switching vehicles.</small></div><div className="race-stock-car"><div><span className="race-eyebrow">OVAL SPEEDWAY</span><h3>Stock car</h3><p>Every Oval Speedway driver races this stock car. Choose its colors and number.</p></div><StockCarPreview paint={stockCarPaint(scheme,username)}/><div className="race-paint-controls"><label>Body color<input type="color" disabled={locked} value={stockCarPaint(scheme,username).body} onChange={event=>updateStockCar({body:event.target.value})}/></label><label>Stripe color<input type="color" disabled={locked} value={stockCarPaint(scheme,username).stripe} onChange={event=>updateStockCar({stripe:event.target.value})}/></label><label>Accent color<input type="color" disabled={locked} value={stockCarPaint(scheme,username).accent} onChange={event=>updateStockCar({accent:event.target.value})}/></label><label>Car number<input type="number" inputMode="numeric" min={0} max={99} step={1} disabled={locked} value={stockCarPaint(scheme,username).number} onChange={event=>{const value=Math.round(Number(event.target.value));if(Number.isFinite(value))updateStockCar({number:Math.max(0,Math.min(99,value))})}}/></label><button disabled={locked} onClick={()=>void saveStockCar()}>Save stock car</button><small>Numbers 0–99. Changes preview live; save to race with them.</small></div></div></section>
    <section className="race-records" aria-labelledby="lap-records-title"><span className="race-eyebrow">{trackInfo.name.toUpperCase()} / {modeNames[recordMode].toUpperCase()} RECORDS</span><h2 id="lap-records-title">The Record Books <span>Top 10 laps</span></h2><p>The ten fastest individual laps on {trackInfo.name} in {modeNames[recordMode]}. Each track and mode has its own record book.</p>{recordStatus&&<p role="status">{recordStatus}</p>}{records.length?<div className="race-record-scroll"><table><thead><tr><th scope="col">Rank</th><th scope="col">Username</th><th scope="col">Date (UTC)</th><th scope="col">Lap time</th><th scope="col">Mode</th></tr></thead><tbody>{records.map((record,index)=><tr key={`${index}:${record.date}`}><td>{String(index+1).padStart(2,'0')}</td><th scope="row">{record.username}</th><td>{new Date(record.date).toISOString().slice(0,10)}</td><td>{(record.milliseconds/1000).toFixed(3)} s</td><td>{record.mode}</td></tr>)}</tbody></table></div>:!recordStatus&&<p>No laps recorded yet. Complete a lap in this mode to open the books.</p>}<button onClick={()=>{const pending=pendingLaps.current.splice(0);void Promise.all(pending.map(body=>api(body).catch(()=>{pendingLaps.current.push(body)}))).then(()=>loadRecords())}}>Refresh / retry saving</button></section>
    <RecordResetDialog buttonLabel={`Reset ${modeNames[recordMode]} records`} title="Reset this record book?" description={`This permanently clears every saved ${modeNames[recordMode]} lap on ${trackInfo.name} for all drivers. Other tracks and modes keep their records. Enter the reset password to confirm.`} confirmLabel="Clear these records" onReset={resetRecords}/>
  </section>
}
function StockCarPreview({paint}:{paint:StockCarPaint}) {
  const canvas=useRef<HTMLCanvasElement>(null)
  useEffect(()=>{
    let frame=0
    const draw=()=>{
      const sprite=stockCarSprite(paint),context=canvas.current?.getContext('2d')
      if(!sprite){frame=requestAnimationFrame(draw);return}
      if(context){context.clearRect(0,0,240,120);context.drawImage(sprite,10,6,220,100)}
    }
    draw();return()=>cancelAnimationFrame(frame)
  },[paint])
  return <canvas ref={canvas} className="car-preview stock-car-preview" width={240} height={112} aria-hidden="true"/>
}
function CarPreview({scheme}:{scheme:Scheme}) {
  const canvas=useRef<HTMLCanvasElement>(null)
  useEffect(()=>{
    const image=new Image()
    image.onload=()=>{const context=canvas.current?.getContext('2d');if(context){context.clearRect(0,0,180,96);context.drawImage(detailedVehicle(image,scheme),20,20,140,56)}}
    image.src=vehicleImage(scheme.vehicle??vehicles[0].id)
    return()=>{image.onload=null}
  },[scheme])
  return <canvas ref={canvas} className="car-preview" width={180} height={96} aria-hidden="true"/>
}
