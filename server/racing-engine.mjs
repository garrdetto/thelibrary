const AI_STRENGTH_SCALE = 1.5
export const CAR_SCALE = 1.1 * 1.15 * 1.15 * 1.2 * 1.33
export const TOP_SPEED_SCALE = 1.25 * 1.25 * 1.3 * 1.1 * 1.25 * 1.1 * 1.15
export const STEERING_STRENGTH_SCALE = .9
export const CAR_WIDTH = 14 * CAR_SCALE
export const CAR_LENGTH = 26 * CAR_SCALE
export const TRACK_WIDTH_SCALE = 1.15 * 1.15
export const TRACK_MAP_SCALE = 1.6
export const TRACK_SCENE_WIDTH = Math.round(1408 * TRACK_MAP_SCALE)
export const TRACK_SCENE_HEIGHT = Math.round(768 * TRACK_MAP_SCALE)
export const TRACK_RUNOFF = 14 * TRACK_MAP_SCALE * TRACK_WIDTH_SCALE
export const TRACK_ROAD_WIDTH = 62 * TRACK_MAP_SCALE * TRACK_WIDTH_SCALE
export const TRACK_LINE_PENALTY = .95
export const TRACK_WALL_WIDTH = 8
export const TRACK_WALLS = []
export const ROLLING_START = 3
const ROLLING_PACE = .3, ROLLING_GAP = 1.5, ROLLING_LAUNCH = 2.5
export function createTrack(id,rawAnchors,{carScale:baseCarScale=1,laneFraction=0,carAspect=26/14,groove=false,outerWall=false,outerWallOffset=0,runoffPenalty=.60,speedScale=1,turnRadiusScale=1,turnPenaltyScale=1,turnTapPenalty=.05*turnPenaltyScale,infieldSteeringLock=0,halfwayLine=false,steeringStrengthScale=STEERING_STRENGTH_SCALE,accelerationScale=1,coastScale=1}={}) {
  const anchors = rawAnchors.map(([x,y,width])=>[x*TRACK_MAP_SCALE,y*TRACK_MAP_SCALE,width*TRACK_MAP_SCALE*TRACK_WIDTH_SCALE/2])
  const courseSamples = anchors.flatMap((p,i)=>{
    const a=anchors[(i+anchors.length-1)%anchors.length],b=anchors[(i+1)%anchors.length],c=anchors[(i+2)%anchors.length]
    return Array.from({length:8},(_,j)=>{const t=j/8;return [...[0,1].map(k=>.5*((2*p[k])+(-a[k]+b[k])*t+(2*a[k]-5*p[k]+4*b[k]-c[k])*t*t+(-a[k]+3*p[k]-3*b[k]+c[k])*t*t*t)),p[2]+(b[2]-p[2])*t]})
  })
  const COURSE = courseSamples.map(([x,y])=>[x,y])
  const COURSE_HALF_WIDTHS = courseSamples.map(sample=>sample[2])
  const TRACK_WIDTH = 2 * (Math.max(...COURSE_HALF_WIDTHS) + TRACK_RUNOFF)
  const CAR_WIDTH=laneFraction?2*Math.min(...COURSE_HALF_WIDTHS)*laneFraction:14*CAR_SCALE*baseCarScale,CAR_LENGTH=CAR_WIDTH*carAspect
  const carScale=CAR_WIDTH/(14*CAR_SCALE)
  const WAYPOINTS = COURSE
  const courseArea=COURSE.reduce((sum,[x,y],index)=>{const [nextX,nextY]=COURSE[(index+1)%COURSE.length];return sum+x*nextY-nextX*y},0)
  const outerSide=courseArea>0?-1:1
  const CAR_REACH=Math.hypot(CAR_LENGTH/2,CAR_WIDTH/2)
  const courseDistances=[0]
  for(let index=0;index<COURSE.length;index++){
    const start=COURSE[index],end=COURSE[(index+1)%COURSE.length]
    courseDistances.push(courseDistances[index]+Math.hypot(end[0]-start[0],end[1]-start[1]))
  }
  const courseLength=courseDistances[COURSE.length]
  const roadSegments=COURSE.map((start,index)=>{
    const end=COURSE[(index+1)%COURSE.length],dx=end[0]-start[0],dy=end[1]-start[1]
    const startWidth=COURSE_HALF_WIDTHS[index],endWidth=COURSE_HALF_WIDTHS[(index+1)%COURSE.length]
    return {index,x:start[0],y:start[1],dx,dy,lengthSquared:dx*dx+dy*dy,startWidth,endWidth,maxWidth:Math.max(startWidth,endWidth),minX:Math.min(start[0],end[0]),maxX:Math.max(start[0],end[0]),minY:Math.min(start[1],end[1]),maxY:Math.max(start[1],end[1])}
  })
  function roadDistance(x,y) {
    let best=Infinity
    for(const segment of roadSegments){
      const boxX=Math.max(segment.minX-x,0,x-segment.maxX),boxY=Math.max(segment.minY-y,0,y-segment.maxY)
      if(boxX*boxX+boxY*boxY>=best)continue
      const offsetX=x-segment.x,offsetY=y-segment.y
      const fraction=Math.max(0,Math.min(1,(offsetX*segment.dx+offsetY*segment.dy)/segment.lengthSquared))
      const dx=offsetX-fraction*segment.dx,dy=offsetY-fraction*segment.dy
      best=Math.min(best,dx*dx+dy*dy)
    }
    return Math.sqrt(best)
  }
  function segmentTree(segments) {
    const node={minX:Infinity,maxX:-Infinity,minY:Infinity,maxY:-Infinity,maxWidth:0}
    for(const segment of segments){node.minX=Math.min(node.minX,segment.minX);node.maxX=Math.max(node.maxX,segment.maxX);node.minY=Math.min(node.minY,segment.minY);node.maxY=Math.max(node.maxY,segment.maxY);node.maxWidth=Math.max(node.maxWidth,segment.maxWidth)}
    if(segments.length<=8)return {...node,segments}
    const axis=node.maxX-node.minX>node.maxY-node.minY?'X':'Y'
    segments.sort((a,b)=>(a['min'+axis]+a['max'+axis])-(b['min'+axis]+b['max'+axis]))
    const middle=Math.floor(segments.length/2)
    return {...node,left:segmentTree(segments.slice(0,middle)),right:segmentTree(segments.slice(middle))}
  }
  const roadTree=segmentTree([...roadSegments])
  const boxDistance=(node,x,y)=>Math.hypot(Math.max(node.minX-x,0,x-node.maxX),Math.max(node.minY-y,0,y-node.maxY))
  function queryRoad(x,y,edge=false) {
    let best=Infinity,closest,closestFraction=0
    function visit(node) {
      if(boxDistance(node,x,y)-(edge?node.maxWidth:0)>=best)return
      if(node.segments){
        for(const segment of node.segments){
          const fraction=Math.max(0,Math.min(1,((x-segment.x)*segment.dx+(y-segment.y)*segment.dy)/segment.lengthSquared))
          const distance=Math.hypot(x-segment.x-fraction*segment.dx,y-segment.y-fraction*segment.dy)-(edge?segment.startWidth+(segment.endWidth-segment.startWidth)*fraction:0)
          if(distance<best){best=distance;closest=segment;closestFraction=fraction}
        }
      }else{
        const leftDistance=boxDistance(node.left,x,y)-(edge?node.left.maxWidth:0),rightDistance=boxDistance(node.right,x,y)-(edge?node.right.maxWidth:0)
        if(leftDistance<rightDistance){visit(node.left);visit(node.right)}else{visit(node.right);visit(node.left)}
      }
    }
    visit(roadTree)
    return {distance:best,segment:closest,fraction:closestFraction}
  }
  function nearestRoad(x,y) {
    const {distance,segment,fraction}=queryRoad(x,y)
    return {x:segment.x+segment.dx*fraction,y:segment.y+segment.dy*fraction,distance,angle:Math.atan2(segment.dy,segment.dx),halfWidth:segment.startWidth+(segment.endWidth-segment.startWidth)*fraction}
  }
  function lineDistance(x,y) {return queryRoad(x,y,true).distance}
  function isOuterSide(x,y) {
    const {segment,fraction}=queryRoad(x,y,true)
    return Math.sign(segment.dx*(y-segment.y-segment.dy*fraction)-segment.dy*(x-segment.x-segment.dx*fraction))===outerSide
  }
  function beyondLimit(x,y) {
    const distance=lineDistance(x,y)
    if(outerWall)return distance>outerWallOffset&&isOuterSide(x,y)
    return distance>TRACK_RUNOFF
  }
  function offTrackPenalty(car) {
    if(lineDistance(car.x,car.y)<=-CAR_REACH)return 0
    if(!outerWall)return runoffPenalty*Math.max(0,Math.min(1,Math.max(...corners(car).map(([x,y])=>lineDistance(x,y)))/TRACK_RUNOFF))
    const depth=Math.max(...corners(car).map(([x,y])=>isOuterSide(x,y)?0:lineDistance(x,y)))
    return depth>0?.15+.45*Math.min(1,depth/CAR_WIDTH):0
  }
  function wallImpactPenalty(car) {
    if(!outerWall)return 1-TRACK_LINE_PENALTY
    const {segment}=queryRoad(car.x,car.y,true)
    const normalSpeed=Math.abs(car.speed*Math.sin(car.angle-Math.atan2(segment.dy,segment.dx)))
    return .075+.15*Math.min(1,normalSpeed/(.35*FORWARD_TOP_SPEED))
  }
  const finishAngle=nearestRoad(...COURSE[0]).angle
  const halfwayIndex=Math.round(COURSE.length/2),halfwayAngle=nearestRoad(...COURSE[halfwayIndex]).angle
  const lineReach=Math.hypot(COURSE[halfwayIndex][0]-COURSE[0][0],COURSE[halfwayIndex][1]-COURSE[0][1])/2
  function crossedLine(point,angle,before,after,reach) {
    const along=p=>(p.x-point[0])*Math.cos(angle)+(p.y-point[1])*Math.sin(angle)
    return along(before)<0&&along(after)>=0&&Math.hypot(after.x-point[0],after.y-point[1])<reach
  }
  const courseNormals=COURSE.map((_,index)=>{
    const previous=COURSE[(index+COURSE.length-1)%COURSE.length],next=COURSE[(index+1)%COURSE.length],angle=Math.atan2(next[1]-previous[1],next[0]-previous[0])
    return [-Math.sin(angle),Math.cos(angle)]
  })
  const courseHeadings=courseNormals.map(([x,y])=>Math.atan2(-x,y))
  function racingGroove() {
    const count=48,stride=COURSE.length/count
    const controls=Array.from({length:count},(_,control)=>{
      const index=Math.round(control*stride)%COURSE.length
      return {index,x:COURSE[index][0],y:COURSE[index][1],nx:courseNormals[index][0],ny:courseNormals[index][1],limit:Math.max(0,COURSE_HALF_WIDTHS[index]-CAR_WIDTH/2-5)}
    })
    const lanes=new Float64Array(count)
    const at=(values,control)=>values[(control+count)%count]
    for(let iteration=0;iteration<20000;iteration++){
      const points=controls.map((control,index)=>[control.x+control.nx*lanes[index],control.y+control.ny*lanes[index]])
      const curvature=points.map((point,index)=>{const previous=at(points,index-1),next=at(points,index+1);return [previous[0]-2*point[0]+next[0],previous[1]-2*point[1]+next[1]]})
      for(let index=0;index<count;index++){
        const previous=at(curvature,index-1),current=curvature[index],next=at(curvature,index+1),control=controls[index]
        const gradient=(previous[0]-2*current[0]+next[0])*control.nx+(previous[1]-2*current[1]+next[1])*control.ny
        lanes[index]=Math.max(-control.limit,Math.min(control.limit,lanes[index]-gradient*.05))
      }
    }
    return COURSE.map((_,index)=>{
      const position=index/stride,first=Math.floor(position)%count,second=(first+1)%count,fraction=position-Math.floor(position)
      return lanes[first]+(lanes[second]-lanes[first])*fraction
    })
  }
  const grooveLanes=groove?racingGroove():null
  const aiDecisions=new WeakMap()
  const parked=(car,elapsed)=>Boolean(car.finished)&&elapsed-car.finished>=1
  function corners(car) { const c=Math.cos(car.angle),s=Math.sin(car.angle);return [[-CAR_LENGTH/2,-CAR_WIDTH/2],[CAR_LENGTH/2,-CAR_WIDTH/2],[CAR_LENGTH/2,CAR_WIDTH/2],[-CAR_LENGTH/2,CAR_WIDTH/2]].map(([x,y])=>[car.x+x*c-y*s,car.y+x*s+y*c]) }
  function dividerContactAngle(car) {
    const cos=Math.cos(car.angle),sin=Math.sin(car.angle)
    const halfLength=CAR_LENGTH/2+TRACK_WALL_WIDTH/2,halfWidth=CAR_WIDTH/2+TRACK_WALL_WIDTH/2
    for(const wall of TRACK_WALLS)for(let index=1;index<wall.length;index++){
      const start=wall[index-1],end=wall[index]
      const x=(start[0]-car.x)*cos+(start[1]-car.y)*sin,y=-(start[0]-car.x)*sin+(start[1]-car.y)*cos
      const dx=(end[0]-start[0])*cos+(end[1]-start[1])*sin,dy=-(end[0]-start[0])*sin+(end[1]-start[1])*cos
      let entry=0,exit=1
      for(const [offset,delta,extent] of [[x,dx,halfLength],[y,dy,halfWidth]]){
        if(Math.abs(delta)<1e-8){if(Math.abs(offset)>extent){exit=-1;break}}
        else {const first=(-extent-offset)/delta,last=(extent-offset)/delta;entry=Math.max(entry,Math.min(first,last));exit=Math.min(exit,Math.max(first,last))}
      }
      if(entry<=exit)return Math.atan2(end[1]-start[1],end[0]-start[0])
    }
    return null
  }
  function onRoad(car) {
    if(dividerContactAngle(car)!==null)return false
    const centerDistance=lineDistance(car.x,car.y)
    if(beyondLimit(car.x,car.y))return false
    if(centerDistance<=(outerWall?outerWallOffset:TRACK_RUNOFF)-CAR_REACH)return true
    if(outerWall&&centerDistance>=CAR_REACH&&!isOuterSide(car.x,car.y))return true
    const c=Math.cos(car.angle),s=Math.sin(car.angle)
    for(let index=0;index<=16;index++){
      const x=-CAR_LENGTH/2+CAR_LENGTH*index/16
      for(const y of [-CAR_WIDTH/2,CAR_WIDTH/2])if(beyondLimit(car.x+x*c-y*s,car.y+x*s+y*c))return false
    }
    for(let index=1;index<8;index++){
      const y=-CAR_WIDTH/2+CAR_WIDTH*index/8
      for(const x of [-CAR_LENGTH/2,CAR_LENGTH/2])if(beyondLimit(car.x+x*c-y*s,car.y+x*s+y*c))return false
    }
    return true
  }
  function insideLines(car) {
    if(lineDistance(car.x,car.y)<=-Math.hypot(CAR_LENGTH/2,CAR_WIDTH/2))return true
    return corners(car).every(([x,y])=>lineDistance(x,y)<=0)
  }
  let rollingSpeed=0
  function rollingPace() {
    if(rollingSpeed)return rollingSpeed
    const profile=speedProfile('center',.9,400),reach=ROLLING_START*FORWARD_TOP_SPEED*ROLLING_PACE+12*CAR_LENGTH*ROLLING_GAP
    let pace=FORWARD_TOP_SPEED*ROLLING_PACE
    for(let index=0;index<COURSE.length;index++)if(courseLength-courseDistances[index]<=reach)pace=Math.min(pace,profile[index])
    return rollingSpeed=pace
  }
  function placeRolling(car,elapsed) {
    const index=car.grid??0,pace=rollingPace()
    const behind=1+Math.floor(index/2)*CAR_LENGTH*ROLLING_GAP+pace*Math.min(ROLLING_START,Math.max(0,-elapsed))
    const distance=((courseLength-behind)%courseLength+courseLength)%courseLength
    let segment=COURSE.length-1
    for(let i=0;i<COURSE.length;i++)if(courseDistances[i+1]>distance){segment=i;break}
    const start=COURSE[segment],end=COURSE[(segment+1)%COURSE.length]
    const fraction=(distance-courseDistances[segment])/Math.max(1e-6,courseDistances[segment+1]-courseDistances[segment])
    const angle=Math.atan2(end[1]-start[1],end[0]-start[0]),side=(index%2?1:-1)*(CAR_WIDTH/2+4)
    car.x=start[0]+(end[0]-start[0])*fraction-Math.sin(angle)*side
    car.y=start[1]+(end[1]-start[1])*fraction+Math.cos(angle)*side
    car.angle=angle;car.steeringResponse=0
  }
  function paceRace(cars,elapsed) {
    for(const car of cars){if(car.finished)continue;placeRolling(car,elapsed);car.speed=rollingPace()}
  }
  function makeCar(id,name,index=0,scheme={name:'Executive',body:'#e4e7de',stripe:'#253e51'}) {
    const car={id,name,aiSeed:Math.random(),grid:index,x:0,y:0,angle:0,speed:0,lap:0,checkpoint:0,started:false,lapStarted:0,lapTimes:[],finished:0,penalty:'',wall:false,lastBump:-10,lastWall:-10,catchupBonus:0,catchupTarget:0,catchupDecay:0,bumpSteering:0,scheme:{...scheme,vehicle:['challenger','muscle-red','lamborghini','escalade','ram'].includes(scheme.vehicle)?scheme.vehicle:'challenger'}}
    placeRolling(car,-ROLLING_START)
    return car
  }
  function raceProgress(car) {
    if(!car.started){
      const finish=COURSE[0],angle=finishAngle
      return Math.min(0,((car.x-finish[0])*Math.cos(angle)+(car.y-finish[1])*Math.sin(angle)))
    }
    if(halfwayLine){
      let distance=car.courseDistance??0
      if(!car.halfway&&distance>courseLength*.75)distance-=courseLength
      else if(car.halfway&&distance<courseLength*.25)distance+=courseLength
      return car.lap*courseLength+distance
    }
    const previousIndex=(car.checkpoint+COURSE.length-1)%COURSE.length
    const start=COURSE[previousIndex],end=COURSE[car.checkpoint],dx=end[0]-start[0],dy=end[1]-start[1]
    const fraction=((car.x-start[0])*dx+(car.y-start[1])*dy)/(dx*dx+dy*dy)
    return car.lap*courseLength+courseDistances[previousIndex]+fraction*Math.hypot(dx,dy)
  }
  function raceStandings(cars) {
    return [...cars].sort((a,b)=>a.finished&&b.finished?a.finished-b.finished:a.finished?-1:b.finished?1:raceProgress(b)-raceProgress(a))
  }
  function positionSpeedBonus(position) {
    if(position<=1)return 0
    if(position<=5)return .05+(position-2)*.02
    return .12+(Math.min(24,position)-6)*(.08/18)
  }
  function trafficInput(car,input,cars,elapsed) {
    const cos=Math.cos(car.angle),sin=Math.sin(car.angle)
    let speedLimit=Infinity
    for(const other of cars){
      if(other===car||parked(other,elapsed))continue
      const dx=other.x-car.x,dy=other.y-car.y
      const forward=dx*cos+dy*sin,lateral=-dx*sin+dy*cos
      if(forward<=0||forward>CAR_LENGTH+Math.max(90,car.speed*1.2)||Math.abs(lateral)>CAR_WIDTH+10)continue
      if(-dx*Math.cos(other.angle)-dy*Math.sin(other.angle)>0)continue
      const leadSpeed=Math.max(0,other.speed*Math.cos(other.angle-car.angle))
      const gap=Math.max(0,forward-CAR_LENGTH)
      const safeGap=12+Math.max(0,car.speed)*.3
      speedLimit=Math.min(speedLimit,Math.max(0,leadSpeed+(gap-safeGap)*1.5))
    }
    return {...input,speedLimit}
  }
  const FORWARD_TOP_SPEED=(95/.65)*TOP_SPEED_SCALE*speedScale
  const steeringCapacity=speed=>{const fraction=Math.min(1,Math.abs(speed)/FORWARD_TOP_SPEED);return 1.875*1.05*1.1*1.1*steeringStrengthScale/turnRadiusScale*(1+.2*(1-fraction)**2)*Math.min(1,Math.abs(speed)/30)}
  const offsetPath=lanes=>COURSE.map(([x,y],index)=>[x+courseNormals[index][0]*lanes[index],y+courseNormals[index][1]*lanes[index]])
  function pathCurvature(path) {
    return path.map((_,index)=>{
      const a=path[(index+path.length-4)%path.length],b=path[index],c=path[(index+4)%path.length]
      const turn=Math.atan2(c[1]-b[1],c[0]-b[0])-Math.atan2(b[1]-a[1],b[0]-a[0])
      return Math.abs(Math.atan2(Math.sin(turn),Math.cos(turn)))/Math.max(1,Math.hypot(b[0]-a[0],b[1]-a[1])+Math.hypot(c[0]-b[0],c[1]-b[1]))*2
    })
  }
  const lineCurvature={center:pathCurvature(COURSE),groove:grooveLanes&&pathCurvature(offsetPath(grooveLanes))}
  const speedProfiles=new Map()
  function speedProfile(line,steering,braking) {
    const key=`${line}:${steering.toFixed(3)}:${braking.toFixed(0)}`,cached=speedProfiles.get(key)
    if(cached)return cached
    const curvature=lineCurvature[line],count=COURSE.length
    const profile=curvature.map(bend=>{
      let speed=FORWARD_TOP_SPEED
      for(let pass=0;pass<6&&bend>0;pass++)speed=Math.min(FORWARD_TOP_SPEED,Math.max(40,steering*steeringCapacity(speed)/bend))
      return speed
    })
    for(let pass=0;pass<2;pass++)for(let index=count-1;index>=0;index--){
      const next=(index+1)%count,distance=courseDistances[index+1]-courseDistances[index]
      profile[index]=Math.min(profile[index],Math.sqrt(profile[next]**2+2*braking*distance))
    }
    speedProfiles.set(key,profile);return profile
  }
  function courseAhead(index,distance) {
    let travelled=0,current=index
    while(travelled<distance){const next=(current+1)%COURSE.length;travelled+=courseDistances[current+1]-courseDistances[current];current=next}
    return current
  }
  function aiInput(car,difficulty=50,cars=[],elapsed=0) {
    if(car.finished)return {}
    const cached=aiDecisions.get(car)
    const launching=elapsed>=0&&elapsed<ROLLING_LAUNCH
    if(cached&&elapsed>=cached.at&&elapsed<cached.next&&cached.difficulty===difficulty)return launching?cached.input:trafficInput(car,cached.input,cars,elapsed)
    const personality=car.aiSeed??.5
    const strength=(Math.max(0,Math.min(100,difficulty))/100+.25)*AI_STRENGTH_SCALE,focus=Math.min(1,strength),looseness=Math.max(.05,1.2-strength)
    let closest=0,best=Infinity
    WAYPOINTS.forEach((p,i)=>{const d=(p[0]-car.x)**2+(p[1]-car.y)**2;if(d<best){best=d;closest=i}})
    const speed=Math.max(0,car.speed)
    const targetIndex=courseAhead(closest,Math.max(55,Math.min(240,speed*(.42+strength*.16)))*carScale),target=WAYPOINTS[targetIndex]
    const [normalX,normalY]=courseNormals[targetIndex]
    const road=nearestRoad(car.x,car.y),cos=Math.cos(road.angle),sin=Math.sin(road.angle)
    const currentLane=(car.x-road.x)*-sin+(car.y-road.y)*cos
    const laneLimit=Math.max(0,road.halfWidth-CAR_WIDTH/2-5)
    const targetLimit=Math.max(0,COURSE_HALF_WIDTHS[targetIndex]-CAR_WIDTH/2-5)
    const cornerIndex=courseAhead(closest,Math.max(90,speed*.9)*carScale)
    const cornerTurn=Math.atan2(Math.sin(courseHeadings[cornerIndex]-courseHeadings[closest]),Math.cos(courseHeadings[cornerIndex]-courseHeadings[closest]))
    const insideSign=Math.abs(cornerTurn)>.22?Math.sign(cornerTurn):0
    const opponents=[]
    let blocked=false,insideCar=null
    for(const other of cars){
      if(other.id===car.id||parked(other,elapsed))continue
      const dx=other.x-car.x,dy=other.y-car.y
      const forward=dx*cos+dy*sin,lateral=-dx*sin+dy*cos
      if(forward < -40-CAR_LENGTH || forward > CAR_LENGTH+Math.max(150,car.speed*1.2) || Math.abs(lateral)>TRACK_WIDTH)continue
      const otherLane=currentLane+lateral
      const opponent={forward,lane:otherLane,speed:other.speed,inside:false}
      if(insideSign&&forward>-CAR_LENGTH*1.2&&forward<CAR_LENGTH*.85&&lateral*insideSign>CAR_WIDTH*.45&&lateral*insideSign<CAR_WIDTH*2.4&&(!insideCar||lateral*insideSign<(insideCar.lane-currentLane)*insideSign)){opponent.inside=true;if(insideCar)insideCar.inside=false;insideCar=opponent}
      if(forward>=-40)opponents.push(opponent)
      else if(opponent.inside)opponents.push(opponent)
      if(forward>0&&forward<CAR_LENGTH*(2+strength*2.5)&&Math.abs(lateral)<CAR_WIDTH+5)blocked=true
    }
    if(insideCar){
      if(car.insideYield===undefined||car.insideSide!==insideSign||elapsed-(car.insideSeen??-Infinity)>1){
        const ease=(1-Math.max(0,Math.min(100,difficulty))/100)/AI_STRENGTH_SCALE,yieldChance=Math.max(0,Math.min(1,ease*(1.3+(personality-.5)*.3)-.15))
        car.insideYield=Math.random()<yieldChance
      }
      car.insideSide=insideSign;car.insideSeen=elapsed
    }else if(elapsed-(car.insideSeen??-Infinity)>1)car.insideYield=undefined
    const yielding=!launching&&Boolean(insideCar&&car.insideYield)
    const grooveWeight=grooveLanes?focus*(blocked||yielding?.4:1):0
    const grooveLane=grooveLanes?Math.max(-targetLimit,Math.min(targetLimit,grooveLanes[targetIndex]*.88)):0
    const preferredLane=Math.max(-targetLimit,Math.min(targetLimit,(personality*2-1)*targetLimit*.6*(1-grooveWeight)+grooveLane*grooveWeight))
    let lane=preferredLane,bestScore=Infinity
    const roomLane=yielding?Math.max(-laneLimit,Math.min(laneLimit,insideCar.lane-insideSign*(CAR_WIDTH+8))):null
    for(const candidate of [-laneLimit,-laneLimit/2,preferredLane,currentLane,0,laneLimit/2,laneLimit,...(roomLane===null?[]:[roomLane])]){
      let score=Math.abs(candidate-preferredLane)*(.5+grooveWeight)+Math.abs(candidate-currentLane)*(blocked?.25:.6)*looseness
      if(yielding)score+=Math.max(0,(candidate-roomLane)*insideSign)*40
      for(const other of opponents){
        if(other.inside&&!yielding)continue
        const predicted=other.forward+(other.speed-car.speed)*(.4+strength*.6)
        const separation=Math.abs(candidate-other.lane)
        if(predicted>-CAR_LENGTH&&predicted<CAR_LENGTH*(2.5+strength*2)){
          score+=Math.max(0,CAR_WIDTH+8-separation)*(predicted<CAR_LENGTH*1.2?12:4)
        }
        if(other.forward>-CAR_LENGTH*1.3&&other.forward<CAR_LENGTH*1.3&&other.lane>=Math.min(currentLane,candidate)-CAR_WIDTH&&other.lane<=Math.max(currentLane,candidate)+CAR_WIDTH)score+=180
      }
      if(score<bestScore){bestScore=score;lane=candidate}
    }
    if(launching)lane=currentLane
    lane=Math.max(-targetLimit,Math.min(targetLimit,lane))
    const aimX=target[0]+normalX*lane-car.x,aimY=target[1]+normalY*lane-car.y
    const lookahead=Math.max(1,Math.hypot(aimX,aimY))
    const delta=Math.atan2(Math.sin(Math.atan2(aimY,aimX)-car.angle),Math.cos(Math.atan2(aimY,aimX)-car.angle))
    const capacity=steeringCapacity(Math.max(speed,30))
    const desiredSteering=Math.max(-1,Math.min(1,2*Math.sin(delta)/lookahead*Math.max(speed,30)/capacity))
    const steeringError=desiredSteering-(car.steeringResponse??0)
    const deadband=.16-focus*.11
    let steer=steeringError>deadband*(desiredSteering<0?2:1)?1:steeringError<-deadband*(desiredSteering>0?2:1)?-1:0
    if(steer&&steer===car.turnDirection&&(car.turnHeld??0)>.5-focus*.3&&Math.abs(desiredSteering)<.92)steer=0
    const steeringMargin=Math.min(groove?.98:.93,.52+strength*.38),braking=160+strength*260
    const centerProfile=speedProfile('center',steeringMargin,braking)
    const profile=grooveLanes?speedProfile('groove',steeringMargin,braking):centerProfile
    const lineSpeed=centerProfile[closest]+(profile[closest]-centerProfile[closest])*grooveWeight
    const cornerSpeed=Math.min(FORWARD_TOP_SPEED*(.84+strength*.16)*(1+car.catchupBonus),lineSpeed)*(1+(personality-.5)*.06*looseness)
    let desiredSpeed=cornerSpeed
    if(yielding&&insideCar.forward>-CAR_LENGTH*.6)desiredSpeed=Math.min(desiredSpeed,Math.max(45,insideCar.speed*.97))
    if(!launching)for(const other of opponents){
      if(other.forward>0&&other.forward<CAR_LENGTH+18&&Math.abs(lane-other.lane)<CAR_WIDTH+3){
        desiredSpeed=Math.min(desiredSpeed,Math.max(45,other.speed-5+strength*8))
      }
    }
    const input={up:car.speed<desiredSpeed,down:strength>.35&&car.speed>cornerSpeed*1.08+12,left:steer<0,right:steer>0,ai:true}
    aiDecisions.set(car,{at:elapsed,next:elapsed+Math.max(.008,.012+(1-strength)*.07)+personality*.02,difficulty,input})
    return launching?input:trafficInput(car,input,cars,elapsed)
  }

  function randomGrid(size) {
    const positions=Array.from({length:size},(_,index)=>index)
    for(let index=size-1;index>0;index--){
      const swap=Math.floor(Math.random()*(index+1))
      const previous=positions[index]
      positions[index]=positions[swap];positions[swap]=previous
    }
    return positions
  }
  function overlap(a,b) {
    const dx=b.x-a.x,dy=b.y-a.y
    if(dx*dx+dy*dy>=CAR_LENGTH*CAR_LENGTH+CAR_WIDTH*CAR_WIDTH)return null
    const ac=Math.cos(a.angle),as=Math.sin(a.angle),bc=Math.cos(b.angle),bs=Math.sin(b.angle)
    let best=null
    for(let axisIndex=0;axisIndex<4;axisIndex++){
      const x=axisIndex===0?ac:axisIndex===1?-as:axisIndex===2?bc:-bs
      const y=axisIndex===0?as:axisIndex===1?ac:axisIndex===2?bs:bc
      const projection=dx*x+dy*y
      const radiusA=CAR_LENGTH/2*Math.abs(ac*x+as*y)+CAR_WIDTH/2*Math.abs(-as*x+ac*y)
      const radiusB=CAR_LENGTH/2*Math.abs(bc*x+bs*y)+CAR_WIDTH/2*Math.abs(-bs*x+bc*y)
      const penetration=radiusA+radiusB-Math.abs(projection)
      if(penetration<=0)return null
      if(!best||penetration<best.depth)best={x:projection<0?-x:x,y:projection<0?-y:y,depth:penetration}
    }
    return best
  }
  function contactCorner(car,normalX,normalY) {
    let best=null,bestProjection=-Infinity
    for(const [x,y] of corners(car)){const projection=(x-car.x)*normalX+(y-car.y)*normalY;if(projection>bestProjection){bestProjection=projection;best=[x,y]}}
    return best
  }
  const CONTACT_SLOP=.6,CONTACT_TRANSFER=.55,CONTACT_GRIP=.8,CONTACT_LOOSENESS=(1-CONTACT_GRIP)/.08,CONTACT_LABEL=`Contact −${Math.round((1-CONTACT_GRIP)*100)}%`
  function closingSpeed(car,normalX,normalY) {return car.speed*(Math.cos(car.angle)*normalX+Math.sin(car.angle)*normalY)}
  function resolveContacts(cars,elapsed) {
    for(let pass=0;pass<2;pass++){
      for(let i=0;i<cars.length;i++)for(let j=i+1;j<cars.length;j++){
        const a=cars[i],b=cars[j]
        if(parked(a,elapsed)||parked(b,elapsed))continue
        const hit=overlap(a,b)
        if(!hit||hit.depth<=CONTACT_SLOP)continue
        const correction=hit.depth-CONTACT_SLOP
        const aFixed=parked(a,elapsed),bFixed=parked(b,elapsed)
        const closingA=closingSpeed(a,hit.x,hit.y),closingB=-closingSpeed(b,hit.x,hit.y)
        let weightA=aFixed?0:Math.max(0,closingA),weightB=bFixed?0:Math.max(0,closingB)
        if(weightA+weightB<=0){weightA=aFixed?0:1;weightB=bFixed?0:1}
        if(weightA+weightB<=0)continue
        const shareA=weightA/(weightA+weightB)
        const impulse=Math.max(0,closingA+closingB)*CONTACT_TRANSFER
        for(const [car,direction,share,closing] of [[a,-1,shareA,closingA],[b,1,1-shareA,closingB]]){
          const nx=hit.x*direction,ny=hit.y*direction
          if(share){car.x+=nx*correction*share;car.y+=ny*correction*share}
          if(pass||parked(car,elapsed))continue
          if(closing>0)car.speed*=1-.015*Math.min(1,closing/Math.max(1,Math.abs(car.speed)))
          const headingX=Math.cos(car.angle),headingY=Math.sin(car.angle)
          const along=headingX*nx+headingY*ny
          car.speed+=impulse*along
          const severity=Math.min(1,impulse/(FORWARD_TOP_SPEED*.1))
          const corner=contactCorner(car,-nx,-ny)
          const leverX=corner[0]-car.x,leverY=corner[1]-car.y
          const forward=leverX*headingX+leverY*headingY
          const torque=(leverX*ny-leverY*nx)/Math.hypot(CAR_LENGTH/2,CAR_WIDTH/2)
          const yaw=Math.max(-.018,Math.min(.018,torque*Math.abs(forward)/(CAR_LENGTH/2)*.018))
          car.angle+=yaw;car.contactYaw=(car.contactYaw??0)+yaw
          if(forward<-CAR_LENGTH/4&&severity>0){
            const sideways=-headingY*nx+headingX*ny
            car.slipX=(car.slipX??0)+(nx-along*headingX)*impulse*.45*CONTACT_LOOSENESS
            car.slipY=(car.slipY??0)+(ny-along*headingY)*impulse*.45*CONTACT_LOOSENESS
            car.yawRate=Math.max(-.9*CONTACT_LOOSENESS,Math.min(.9*CONTACT_LOOSENESS,(car.yawRate??0)-sideways*severity*.9*CONTACT_LOOSENESS))
            if(along>.5)car.wiggle=Math.min(.045*CONTACT_LOOSENESS,Math.max(car.wiggle??0,severity*along*.045*CONTACT_LOOSENESS))
          }
        }
      }
    }
  }
  function recoverToRoad(car,reference=car) {
    const road=nearestRoad(reference.x,reference.y)
    const centered={x:road.x,y:road.y,angle:road.angle+(Math.cos(car.angle-road.angle)<0?Math.PI:0)}
    if(onRoad(centered)){Object.assign(car,centered);return}
    const candidates=[]
    for(const segment of roadSegments){
      const fraction=Math.max(0,Math.min(1,((reference.x-segment.x)*segment.dx+(reference.y-segment.y)*segment.dy)/segment.lengthSquared))
      const x=segment.x+segment.dx*fraction,y=segment.y+segment.dy*fraction
      const tangent=Math.atan2(segment.dy,segment.dx)
      const angle=tangent+(Math.cos(car.angle-tangent)<0?Math.PI:0)
      for(const offset of [0,-CAR_WIDTH,CAR_WIDTH]){
        const candidate={x:x-Math.sin(tangent)*offset,y:y+Math.cos(tangent)*offset,angle}
        const score=(candidate.x-reference.x)**2+(candidate.y-reference.y)**2
        candidates.push({candidate,score})
      }
    }
    candidates.sort((a,b)=>a.score-b.score)
    const best=candidates.find(({candidate})=>onRoad(candidate))
    if(best)Object.assign(car,best.candidate)
  }
  function slideAlongWall(car,previous,dt,dividerAngle) {
    const road=nearestRoad(previous.x,previous.y)
    const tangent=dividerAngle??road.angle
    const direction=Math.cos(car.angle-tangent)>=0?1:-1
    const heading=tangent+(direction<0?Math.PI:0)
    Object.assign(car,previous)
    if(!onRoad(car))recoverToRoad(car,previous)
    const delta=Math.atan2(Math.sin(heading-car.angle),Math.cos(heading-car.angle))
    const travel=car.speed*dt
    const center=nearestRoad(car.x,car.y)
    const distance=Math.hypot(center.x-car.x,center.y-car.y)
    const inset=Math.min(distance,Math.max(1,Math.abs(travel)*.5))
    for(const alignment of [1-Math.exp(-12*dt),.5,1]){
      const candidate={...car,angle:car.angle+delta*alignment,
        x:car.x+Math.cos(heading)*travel+(distance?(center.x-car.x)/distance*inset:0),
        y:car.y+Math.sin(heading)*travel+(distance?(center.y-car.y)/distance*inset:0)}
      if(onRoad(candidate)){Object.assign(car,{x:candidate.x,y:candidate.y,angle:candidate.angle});return}
    }
    recoverToRoad(car,previous)
    const candidate={...car,x:car.x+Math.cos(car.angle)*travel,y:car.y+Math.sin(car.angle)*travel}
    if(onRoad(candidate)){car.x=candidate.x;car.y=candidate.y}
  }
  function raceComplete(cars,elapsed) {return cars.every(car=>parked(car,elapsed))}
  function stepRace(cars,inputs,dt,elapsed,contacts=new Set(),lapLimit=3) {
    const previous=new Map(cars.map(car=>[car.id,{x:car.x,y:car.y,angle:car.angle}]))
    const touching=new Set()
    for(let i=0;i<cars.length;i++)for(let j=i+1;j<cars.length;j++){
      if(!parked(cars[i],elapsed)&&!parked(cars[j],elapsed)&&overlap(cars[i],cars[j])){touching.add(cars[i]);touching.add(cars[j])}
    }
    const standings=raceStandings(cars)
    for(const [position,car] of standings.entries()) {
      if(parked(car,elapsed)){car.speed=0;continue}
      const target=positionSpeedBonus(position+1)
      const previousBonus=car.catchupBonus
      if(target!==car.catchupTarget){
        car.catchupTarget=target
        car.catchupDecay=Math.max(0,car.catchupBonus-target)/3
        if(target>car.catchupBonus)car.catchupBonus=target
      }
      car.catchupBonus=Math.max(target,car.catchupBonus-car.catchupDecay*dt)
      if(car.catchupBonus<previousBonus)car.speed*=(1+car.catchupBonus)/(1+previousBonus)
      const previousWallFactor=car.wallFactor??1
      car.wallFactor=1-(car.wallPenalty??1-TRACK_LINE_PENALTY)*Math.max(0,1-(elapsed-car.lastWall))
      const speedMultiplier=1+car.catchupBonus
      const input=inputs[car.id]??{}
      const steeringLocked=infieldSteeringLock>0&&elapsed<(car.infieldRelease??-Infinity)
      const steering=steeringLocked?0:(input.right?1:0)-(input.left?1:0)
      if(steeringLocked)car.steeringResponse=0
      car.turnHeld=steering?(car.turnDirection===steering?(car.turnHeld??0):0)+dt:0
      car.turnDirection=steering
      car.turnFactor=steering?1-Math.min(1,turnTapPenalty+(.5*turnPenaltyScale-turnTapPenalty)*Math.min(1,Math.max(0,(car.turnHeld-.00001)/.99999))):1
      car.speed*=Math.min(1,car.wallFactor/previousWallFactor)
      car.contactFactor=touching.has(car)?CONTACT_GRIP:1
      car.offTrackFactor=1-offTrackPenalty(car)
      const gripFactor=car.wallFactor*car.turnFactor*(car.offTrackFactor??1)*car.contactFactor
      const forwardTopSpeed=FORWARD_TOP_SPEED*speedMultiplier
      if(steering||car.contactFactor<1||car.offTrackFactor<1)car.speed=Math.max(-55*gripFactor,Math.min(car.speed,forwardTopSpeed*gripFactor))
      let targetSpeed=input.up?forwardTopSpeed*gripFactor:input.down?-55*gripFactor:0
      const trafficBraking=input.ai&&Number.isFinite(input.speedLimit)&&car.speed>input.speedLimit
      if(input.ai&&Number.isFinite(input.speedLimit))targetSpeed=trafficBraking?Math.min(car.speed,input.speedLimit):Math.min(targetSpeed,input.speedLimit)
      const accelerationTime=trafficBraking ? .12 : input.up ? 1.2/accelerationScale : input.down ? 1.1 : 1/(.65*coastScale)
      car.speed+=(targetSpeed-car.speed)*(1-Math.exp(-dt/accelerationTime))
      const speedFraction=Math.min(1,Math.abs(car.speed)/forwardTopSpeed)
      const steeringGain=1.1*1.1*(1+.2*(1-speedFraction)**2)
      car.steeringResponse=(car.steeringResponse??0)+(steering-(car.steeringResponse??0))*(1-Math.exp(-dt/.3))
      car.angle+=car.steeringResponse*1.875*1.05*steeringStrengthScale/turnRadiusScale*steeringGain*Math.min(1,Math.abs(car.speed)/30)*Math.sign(car.speed)*dt
      const contactCorrection=(car.contactYaw??0)*(1-Math.exp(-dt/.18))
      car.angle-=contactCorrection;car.contactYaw=Math.abs((car.contactYaw??0)-contactCorrection)<.0005?0:(car.contactYaw??0)-contactCorrection
      car.bumpSteering=dt?-contactCorrection/dt:0
      if(car.yawRate){car.angle+=car.yawRate*dt;car.yawRate=Math.abs(car.yawRate)<.002?0:car.yawRate*Math.exp(-dt/.22)}
      if(car.wiggle||car.wiggleOffset){
        car.wigglePhase=(car.wigglePhase??0)+dt*15
        const offset=(car.wiggle??0)*Math.sin(car.wigglePhase)
        car.angle+=offset-(car.wiggleOffset??0);car.wiggleOffset=offset
        car.wiggle=(car.wiggle??0)<.0005?0:car.wiggle*Math.exp(-dt/.35)
        if(!car.wiggle&&Math.abs(offset)<.0005){car.wiggleOffset=0;car.wigglePhase=0}
      }
      const slipX=car.slipX??0,slipY=car.slipY??0
      car.x+=(Math.cos(car.angle)*car.speed+slipX)*dt;car.y+=(Math.sin(car.angle)*car.speed+slipY)*dt
      if(slipX||slipY){const decay=Math.exp(-dt/.25);car.slipX=Math.abs(slipX)<.5?0:slipX*decay;car.slipY=Math.abs(slipY)<.5?0:slipY*decay}
      const dividerAngle=dividerContactAngle(car)
      if(dividerAngle!==null||!onRoad(car)){
        const hitFactor=Math.min(car.wallFactor,1-wallImpactPenalty(car))
        car.speed*=hitFactor/car.wallFactor;car.wallFactor=hitFactor;car.wallPenalty=1-hitFactor;car.lastWall=elapsed;car.penalty=`Wall −${Math.round((1-hitFactor)*100)}% · 1s recovery`
        slideAlongWall(car,previous.get(car.id),dt,dividerAngle)
        car.slipX=0;car.slipY=0
        car.wall=true
      }else car.wall=false
      const previousOffTrackFactor=car.offTrackFactor??1
      car.offTrackFactor=1-offTrackPenalty(car)
      car.speed*=Math.min(1,car.offTrackFactor/previousOffTrackFactor)
      if(infieldSteeringLock>0&&car.offTrackFactor<1)car.infieldRelease=elapsed+infieldSteeringLock
      if(!car.wall){
        if(car.offTrackFactor<1)car.penalty=`${outerWall?'Infield':'White line'} −${Math.round((1-car.offTrackFactor)*100)}%${infieldSteeringLock>0?' · steering locked':''}`
        else if(steeringLocked||elapsed<(car.infieldRelease??-Infinity))car.penalty='Steering locked'
        else if(car.contactFactor<1)car.penalty=CONTACT_LABEL
        else if(steering)car.penalty=`Turning −${Math.round((1-car.turnFactor)*100)}%`
        else if(elapsed-car.lastWall>=1)car.penalty=''
      }
    }
    const next=new Set(),nextTouching=new Set()
    for(let i=0;i<cars.length;i++)for(let j=i+1;j<cars.length;j++){
      const a=cars[i],b=cars[j]
      if(parked(a,elapsed)||parked(b,elapsed)||!overlap(a,b))continue
      const key=[a.id,b.id].sort().join(':');next.add(key)
      nextTouching.add(a);nextTouching.add(b)
    }
    resolveContacts(cars,elapsed)
    for(const car of cars){
      car.contactFactor=nextTouching.has(car)?CONTACT_GRIP:1
      if(parked(car,elapsed)){car.speed=0;continue}
      if(car.finished){car.penalty='';continue}
      if(car.contactFactor<1){
        const limit=FORWARD_TOP_SPEED*(1+car.catchupBonus)*(car.wallFactor??1)*(car.turnFactor??1)*(car.offTrackFactor??1)*car.contactFactor
        car.speed=Math.max(-55*car.contactFactor,Math.min(car.speed,limit))
        car.penalty=CONTACT_LABEL
      }else if(car.penalty===CONTACT_LABEL)car.penalty=''
      const before=previous.get(car.id),input=inputs[car.id]??{}
      const expectedTravel=Math.abs(car.speed)*dt
      const stalled=(input.up||input.down)&&expectedTravel>.01&&elapsed-car.lastWall<.5&&Math.hypot(car.x-before.x,car.y-before.y)<expectedTravel*.2
      car.blockedTime=stalled?(car.blockedTime??0)+dt:0
      if(car.blockedTime>.35){
        recoverToRoad(car)
        const direction=Math.sign(car.speed)||1
        for(const distance of [CAR_LENGTH*.5,CAR_LENGTH,CAR_LENGTH*1.5]){
          const candidate={...car,x:car.x+Math.cos(car.angle)*distance*direction,y:car.y+Math.sin(car.angle)*distance*direction}
          if(onRoad(candidate)&&!cars.some(other=>other!==car&&!parked(other,elapsed)&&overlap(candidate,other))){car.x=candidate.x;car.y=candidate.y;break}
        }
        car.blockedTime=0
      }
      if(halfwayLine){
        const {segment,fraction}=queryRoad(car.x,car.y)
        car.checkpoint=(segment.index+1)%COURSE.length
        car.courseDistance=courseDistances[segment.index]+fraction*Math.sqrt(segment.lengthSquared)
        if(car.started&&!car.halfway&&crossedLine(COURSE[halfwayIndex],halfwayAngle,before,car,lineReach))car.halfway=true
        if(crossedLine(COURSE[0],finishAngle,before,car,lineReach)&&(!car.started||car.halfway)){
          if(car.started){car.lapTimes.push(Math.round((elapsed-car.lapStarted)*1000));car.lap++;if(car.lap===lapLimit)car.finished=elapsed}
          car.started=true;car.lapStarted=elapsed;car.halfway=false
        }
        continue
      }
      const target=COURSE[car.checkpoint]
      const crossed=crossedLine(COURSE[0],finishAngle,before,car,TRACK_WIDTH/2)
      if(car.checkpoint===0?crossed:Math.hypot(car.x-target[0],car.y-target[1])<TRACK_WIDTH/2){
        if(car.checkpoint===0){
          if(car.started){car.lapTimes.push(Math.round((elapsed-car.lapStarted)*1000));car.lap++;if(car.lap===lapLimit)car.finished=elapsed}
          car.started=true;car.lapStarted=elapsed
        }
        car.checkpoint=(car.checkpoint+1)%COURSE.length
      }
    }

    contacts.clear();for(const key of next)contacts.add(key)
  }
  return {id,carScale,outerSide,outerWall,CAR_WIDTH,CAR_LENGTH,COURSE,COURSE_HALF_WIDTHS,TRACK_WIDTH,WAYPOINTS,roadDistance,nearestRoad,lineDistance,corners,onRoad,insideLines,makeCar,paceRace,raceProgress,raceStandings,positionSpeedBonus,aiInput,randomGrid,raceComplete,stepRace}
}
const circuitAnchors=[[522,634,64],[399,633,64],[261,636,64],[172,618,65],[139,577,68],[142,524,67],[178,475,63],[229,405,64],[223,343,64],[179,295,59],[117,229,61],[123,154,61],[156,124,58],[230,110,55],[314,140,54],[389,194,54],[474,241,56],[560,257,51],[659,252,50],[738,263,55],[773,329,62],[791,394,65],[850,410,59],[915,382,55],[973,350,58],[998,284,63],[954,228,61],[957,176,60],[993,153,57],[1101,148,57],[1228,151,57],[1274,168,62],[1286,199,64],[1262,262,62],[1199,318,62],[1171,370,69],[1191,422,65],[1234,466,61],[1278,518,65],[1286,569,68],[1264,608,67],[1206,634,65],[1000,636,64],[759,638,64]]
export const OVAL_BACKDROP={src:'/images/oval-speedway.webp',width:1536,height:1024,centerX:755,centerY:476,sceneX:705*TRACK_MAP_SCALE,sceneY:375*TRACK_MAP_SCALE,scale:1.34}
const ovalQuarter=[[0,-311,70],[-45,-311,70],[-90,-311,70],[-135,-311,70],[-180,-311,70],[-225,-311,70],[-270,-311,68],[-315,-308,69],[-359,-304,69],[-403,-292,70],[-446,-278,73],[-485,-257,74],[-522,-232,77],[-556,-202,79],[-585,-167,81],[-609,-130,84],[-627,-89,85],[-637,-45,85],[-642,0,86]]
const ovalAnchors=(()=>{
  const head=ovalQuarter.slice(0,-1),tail=[...ovalQuarter].reverse().slice(0,-1)
  const {sceneX,sceneY,scale}=OVAL_BACKDROP
  return [...head.map(([x,y,half])=>[-x,-y,half]),...tail.map(([x,y,half])=>[-x,y,half]),...head,...tail.map(([x,y,half])=>[x,-y,half])]
    .map(([x,y,half])=>[(sceneX+x*scale)/TRACK_MAP_SCALE,(sceneY+y*scale)/TRACK_MAP_SCALE,2*(half*scale-20)/(TRACK_MAP_SCALE*TRACK_WIDTH_SCALE)])
})()
export const CIRCUIT_TRACK=createTrack('circuit',circuitAnchors)
export const OVAL_TRACK=createTrack('oval',ovalAnchors,{laneFraction:.3796875,carAspect:552/250,groove:true,outerWall:true,outerWallOffset:20,speedScale:2.1,turnRadiusScale:1,turnPenaltyScale:1.25,turnTapPenalty:.24,halfwayLine:true,steeringStrengthScale:1,accelerationScale:1.04,coastScale:.5})
export const TRACKS={circuit:CIRCUIT_TRACK,oval:OVAL_TRACK}
export const trackFor=id=>TRACKS[id]??CIRCUIT_TRACK
export const {COURSE,COURSE_HALF_WIDTHS,TRACK_WIDTH,WAYPOINTS,roadDistance,nearestRoad,lineDistance,corners,onRoad,insideLines,makeCar,paceRace,raceProgress,raceStandings,positionSpeedBonus,aiInput,randomGrid,raceComplete,stepRace}=CIRCUIT_TRACK
