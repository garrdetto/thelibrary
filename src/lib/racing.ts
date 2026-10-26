import type { Scheme, StockCarPaint } from '../../server/racing-engine.mjs'
export type { Scheme, StockCarPaint, Car, Controls, TrackId, RaceTrack } from '../../server/racing-engine.mjs'
const names=['Executive','Midnight','Apex','Carbon','Grand Touring','Studio','Velocity','Graphite','Circuit','Endurance','Titanium','Signature','Sprint','Heritage','Silverline','Precision','Urban','Vanguard','Performance','Special Edition']
export const presets:Scheme[]=names.map((name,i)=>({name,body:['#dce2df','#293441','#b3b8ab','#c8b892','#587879','#a9b8c6','#adbd9b','#926a54','#d3c3a1','#525b66'][i%10],stripe:['#263d51','#d2b76b','#784f3d','#334b4b','#e1d9b8'][(i+Math.floor(i/10)*2)%5]}))
export const vehicles=[{id:'challenger',name:'Orange Challenger'},{id:'muscle-red',name:'Red Challenger'},{id:'lamborghini',name:'Lamborghini'},{id:'escalade',name:'Escalade'},{id:'ram',name:'Ram truck'}] as const
export type VehicleId=typeof vehicles[number]['id']
export const vehicleImage=(vehicle:VehicleId)=>`/images/vehicles/${vehicle}.png`
export const stockCarImage='/images/vehicles/stock-car.webp'
export const defaultStockCar:StockCarPaint={body:'#1f5fd6',stripe:'#d61c24',accent:'#fafafa',number:24}
export const tracks=[{id:'circuit',name:'Max Secure Circuit',short:'Circuit'},{id:'oval',name:'Oval Speedway',short:'Oval'}] as const
export type RaceRoom = {id:string;track?:'circuit'|'oval';running:boolean;host:string;expires:number;difficulty:number;laps?:number;players:{id:string;name:string;ready:boolean}[]}

export function displayScheme(scheme:Scheme):Scheme {
  const vehicle=vehicles.find(item=>item.id===scheme.vehicle)??vehicles[0]
  return {...scheme,vehicle:vehicle.id,name:vehicle.name}
}

export function randomOpponentScheme():Scheme {
  const vehicle=vehicles[Math.floor(Math.random()*vehicles.length)]
  const hue=Math.floor(Math.random()*360)
  const color=(value:number,saturation:number,lightness:number)=>{
    const chroma=(1-Math.abs(2*lightness-1))*saturation,sector=value/60,secondary=chroma*(1-Math.abs(sector%2-1)),offset=lightness-chroma/2
    const channels=sector<1?[chroma,secondary,0]:sector<2?[secondary,chroma,0]:sector<3?[0,chroma,secondary]:sector<4?[0,secondary,chroma]:sector<5?[secondary,0,chroma]:[chroma,0,secondary]
    return '#'+channels.map(channel=>Math.round((channel+offset)*255).toString(16).padStart(2,'0')).join('')
  }
  const body=color(hue,.45+Math.random()*.4,.3+Math.random()*.3)
  const stripe=color((hue+120+Math.random()*120)%360,.2+Math.random()*.5,Math.random()<.5?.16:.86)
  const patterns=['plain','stripes','flames','chevrons','checker','lightning'] as const
  const pattern=patterns[Math.floor(Math.random()*patterns.length)]
  const accent=color((hue+180)%360,.15+Math.random()*.4,Math.random()<.7?.92:.2)
  return {name:vehicle.name,vehicle:vehicle.id,body,stripe,vehiclePaints:{[vehicle.id]:{body,stripe,pattern}},stockCar:{body,stripe,accent,number:Math.floor(Math.random()*100)}}
}
