import { z } from 'zod'
import { ROLLING_START, trackFor } from './racing-engine.mjs'

export function attachRacing(io, origins, hooks = {}) {
  const racing = io.of('/racing'), players = new Map()
  let room = null
  const publish = () => racing.emit('players', [...players.values()].map(p=>({id:p.id,name:p.name,busy:Boolean(room?.ids.includes(p.id))})))
  const state = () => room ? {id:room.id,track:room.track,host:room.host,running:room.running,expires:room.expires,difficulty:room.difficulty,laps:room.laps,players:room.ids.map(id=>({id,name:players.get(id)?.name??'Driver',ready:true}))} : null
  const notify = () => { racing.emit('room',state());publish();hooks.changed?.() }
  const controls = z.object({up:z.boolean(),down:z.boolean(),left:z.boolean(),right:z.boolean()}).strict()
  racing.use(async(socket,next)=>{
    try {
      const origin=socket.handshake.headers.origin
      const trusted=origins.length?origins:['https://myworkhelper.netlify.app']
      if(!trusted.includes(origin))return next(new Error('This site is not authorized.'))
      const ticket=z.string().regex(/^[a-f0-9]{64}$/).parse(socket.handshake.auth.ticket)
      const response=await fetch(`${origin}/api/racing?action=redeem`,{method:'POST',headers:{Authorization:`Bearer ${ticket}`},signal:AbortSignal.timeout(8000)})
      if(!response.ok)return next(new Error('Sign in again to connect.'))
      socket.data.account=await response.json();next()
    } catch { next(new Error('Unable to verify your Racing session.')) }
  })
  function end(message) {
    const id=room?.id
    room=null;racing.emit('ended',message);notify()
    if(id)hooks.closed?.(id)
  }
  function leave(socket) {
    if(room?.ids.includes(socket.id)) {
      room.ids=room.ids.filter(id=>id!==socket.id)
      if(room.running)room.abandoned.add(socket.id)
      else if(room.ids.length)room.host=room.ids[0]
      if(!room.ids.length)end('All drivers left. The lobby is open for a new race.')
    }
    players.delete(socket.id);notify()
  }
  racing.on('connection',socket=>{
    const account=socket.data.account
    for(const p of players.values())if(p.account===account.id)racing.sockets.get(p.id)?.disconnect(true)
    players.set(socket.id,{id:socket.id,account:account.id,name:account.username,scheme:account.scheme})
    notify()
    if(room?.running)socket.emit('start',{track:room.track,laps:room.laps,cars:room.cars,elapsed:room.elapsed})
    socket.on('create-race',(raw,ack)=>{
      if(typeof ack!=='function')return
      const parsed=z.object({difficulty:z.number().int().min(0).max(100),track:z.enum(['circuit','oval']).default('circuit'),laps:z.number().int().min(1).max(50).default(3)}).strict().safeParse(raw)
      if(!parsed.success)return ack({error:'Choose a track and AI strength from 0 to 100.'})
      if(room)return ack({error:'A race is already inviting drivers or running.'})
      room={id:crypto.randomUUID(),track:parsed.data.track,host:socket.id,ids:[socket.id],expires:Date.now()+30000,difficulty:parsed.data.difficulty,laps:parsed.data.track==='oval'?parsed.data.laps:3,running:false,inputs:{},contacts:new Set(),abandoned:new Set(),elapsed:0,cars:[]}
      racing.emit('notice',`${account.username} invited the lobby to ${room.track==='oval'?'Oval Speedway':'Max Secure Circuit'}. Join within 30 seconds.`);notify();ack({ok:true})
      hooks.invite?.({id:room.id,from:account.username,account:account.id,track:room.track,expiresIn:room.expires-Date.now()})
    })
    socket.on('join-race',(_,ack)=>{
      if(typeof ack!=='function')return
      if(!room||room.running||Date.now()>=room.expires)return ack({error:'Entry is closed. Watch this race and join the next one.'})
      if(room.ids.includes(socket.id))return ack({ok:true})
      if(room.ids.length>=24)return ack({error:'The grid is full. You can watch this race.'})
      room.ids.push(socket.id);notify();ack({ok:true})
    })
    socket.on('input',raw=>{
      const parsed=controls.safeParse(raw)
      if(!parsed.success||!room?.running||!room.ids.includes(socket.id))return
      room.inputs[socket.id]={...parsed.data,at:Date.now()}
    })
    socket.on('leave-room',()=>{
      const player=players.get(socket.id);leave(socket)
      if(player)players.set(socket.id,player)
      notify()
    })
    socket.on('disconnect',()=>leave(socket))
  })
  function start() {
    if(room.ids.length<2)return end('At least two players must join. The invitation expired; start a new invite to try again.')
    room.running=true;room.elapsed=-ROLLING_START
    hooks.closed?.(room.id)
    const { makeCar, randomGrid } = trackFor(room.track)
    const positions=randomGrid(24)
    room.cars=Array.from({length:24},(_,i)=>{
      const player=players.get(room.ids[i]),id=player?.id??`ai-${i}`
      const vehicle=['challenger','muscle-red','lamborghini','escalade','ram'][Math.floor(Math.random()*5)]
      const body='#'+Math.floor(Math.random()*0xffffff).toString(16).padStart(6,'0')
      const stockCar={body,stripe:'#'+Math.floor(Math.random()*0xffffff).toString(16).padStart(6,'0'),accent:Math.random()<.7?'#f4f1e8':'#1d1f21',number:Math.floor(Math.random()*100)}
      const scheme=player?.scheme??{name:'AI',vehicle,body,stripe:'#ece1bf',stockCar,vehiclePaints:{[vehicle]:{body,stripe:'#ece1bf',pattern:['plain','stripes','flames','chevrons','checker','lightning'][Math.floor(Math.random()*6)]}}}
      const car=makeCar(id,player?.name??`AI ${i+1}`,positions[i],scheme)
      if(player)car.nameColor=`hsl(${Math.round(i*360/room.ids.length)} 85% 74%)`
      return car
    })
    racing.emit('start',{track:room.track,laps:room.laps,cars:room.cars,elapsed:room.elapsed});notify()
  }
  const timer=setInterval(()=>{
    if(!room)return
    if(!room.running){if(Date.now()>=room.expires)start();return}
    for(const id of room.ids)if(Date.now()-(room.inputs[id]?.at??0)>400)room.inputs[id]={}
    const { stepRace, paceRace, aiInput, raceComplete } = trackFor(room.track)
    for(let i=0;i<6;i++){
      room.elapsed+=1/120
      if(room.elapsed>=0){
        for(const car of room.cars)if(car.id.startsWith('ai-')||room.abandoned.has(car.id))room.inputs[car.id]=aiInput(car,room.difficulty,room.cars,room.elapsed)
        stepRace(room.cars,room.inputs,1/120,room.elapsed,room.contacts,room.laps)
      }else paceRace(room.cars,room.elapsed)
    }
    racing.emit('snapshot',{cars:room.cars,elapsed:room.elapsed})
    if(raceComplete(room.cars,room.elapsed)||room.elapsed>Math.max(600,room.laps*240))end('Race complete. The lobby is open for the next invitation.')
  },50)
  timer.unref()
  return {
    statusOf(accountId) {
      const sockets=[...players.values()].filter(player=>player.account===accountId)
      if(!sockets.length)return null
      return room?.running&&sockets.some(player=>room.ids.includes(player.id)&&!room.abandoned.has(player.id))?'racing':'lobby'
    },
  }
}
