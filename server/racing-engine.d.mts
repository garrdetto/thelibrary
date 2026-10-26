export type VehiclePaint = {body:string;stripe:string;pattern:'plain'|'stripes'|'flames'|'chevrons'|'checker'|'lightning'}
export type StockCarPaint = {body:string;stripe:string;accent:string;number:number}
export type Scheme = {stockCar?:StockCarPaint;vehiclePaints?:Partial<Record<string,VehiclePaint>>;name:string;body:string;stripe:string;asset?:string;bodyStyle?:'gt'|'coupe'|'muscle'|'prototype';vehicle?:'challenger'|'escalade'|'lamborghini'|'ram'|'muscle-red'}
export type Car = {id:string;name:string;aiSeed?:number;grid?:number;nameColor?:string;x:number;y:number;angle:number;speed:number;lap:number;started:boolean;lapStarted:number;lapTimes:number[];checkpoint:number;halfway?:boolean;courseDistance?:number;finished:number;penalty:string;wall:boolean;wallFactor?:number;wallPenalty?:number;turnFactor?:number;turnHeld?:number;turnDirection?:number;offTrackFactor?:number;contactFactor?:number;steeringResponse?:number;infieldRelease?:number;blockedTime?:number;lastBump:number;lastWall:number;catchupBonus:number;catchupTarget:number;catchupDecay:number;bumpSteering:number;contactYaw?:number;yawRate?:number;slipX?:number;slipY?:number;wiggle?:number;wigglePhase?:number;wiggleOffset?:number;insideYield?:boolean;insideSide?:number;insideSeen?:number;scheme:Scheme}
export type Controls = {up?:boolean;down?:boolean;left?:boolean;right?:boolean;ai?:boolean;speedLimit?:number}
export const CAR_SCALE:number
export const TOP_SPEED_SCALE:number
export const STEERING_STRENGTH_SCALE:number
export const CAR_WIDTH:number
export const CAR_LENGTH:number
export const TRACK_MAP_SCALE:number
export const TRACK_WIDTH_SCALE:number
export const TRACK_WALL_WIDTH:number
export const TRACK_WALLS:number[][][]
export const ROLLING_START:number
export const TRACK_WIDTH:number
export const TRACK_RUNOFF:number
export const TRACK_ROAD_WIDTH:number
export const TRACK_LINE_PENALTY:number
export const COURSE_HALF_WIDTHS:number[]
export const TRACK_SCENE_WIDTH:number
export const TRACK_SCENE_HEIGHT:number
export const COURSE:number[][]
export const WAYPOINTS:number[][]
export function roadDistance(x:number,y:number):number
export function lineDistance(x:number,y:number):number
export function corners(car:Car):number[][]
export function onRoad(car:Car):boolean
export function insideLines(car:Car):boolean
export function makeCar(id:string,name:string,index?:number,scheme?:Scheme):Car
export function aiInput(car:Car,difficulty?:number,cars?:Car[],elapsed?:number):Controls
export function paceRace(cars:Car[],elapsed:number):void
export function stepRace(cars:Car[],inputs:Record<string,Controls>,dt:number,elapsed:number,contacts?:Set<string>,lapLimit?:number):void

export function nearestRoad(x:number,y:number):{x:number;y:number;distance:number;angle:number;halfWidth:number}

export type TrackId = 'circuit'|'oval'
export type RaceTrack = {id:TrackId;carScale:number;outerSide:number;outerWall:boolean;CAR_WIDTH:number;CAR_LENGTH:number;COURSE:number[][];COURSE_HALF_WIDTHS:number[];TRACK_WIDTH:number;WAYPOINTS:number[][];roadDistance:typeof roadDistance;nearestRoad:typeof nearestRoad;lineDistance:typeof lineDistance;corners:typeof corners;onRoad:typeof onRoad;insideLines:typeof insideLines;makeCar:typeof makeCar;paceRace:typeof paceRace;raceProgress:typeof raceProgress;raceStandings:typeof raceStandings;positionSpeedBonus:typeof positionSpeedBonus;aiInput:typeof aiInput;randomGrid:typeof randomGrid;raceComplete:typeof raceComplete;stepRace:typeof stepRace}
export function createTrack(id:TrackId,anchors:number[][],options?:{carScale?:number;laneFraction?:number;carAspect?:number;groove?:boolean;outerWall?:boolean;outerWallOffset?:number;runoffPenalty?:number;speedScale?:number;turnRadiusScale?:number;turnPenaltyScale?:number;turnTapPenalty?:number;infieldSteeringLock?:number;halfwayLine?:boolean}):RaceTrack
export const OVAL_BACKDROP:{src:string;width:number;height:number;centerX:number;centerY:number;sceneX:number;sceneY:number;scale:number}
export const CIRCUIT_TRACK:RaceTrack
export const OVAL_TRACK:RaceTrack
export const TRACKS:Record<TrackId,RaceTrack>
export function trackFor(id:unknown):RaceTrack

export function positionSpeedBonus(position:number):number
export function raceProgress(car:Car):number
export function raceStandings(cars:Car[]):Car[]
export function raceComplete(cars:Car[],elapsed:number):boolean

export function randomGrid(size:number):number[]
