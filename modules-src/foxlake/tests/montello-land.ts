import { readFileSync } from 'node:fs'
import { gunzipSync } from 'node:zlib'
import { isGzip, parseGrids, type MapDoc } from '../../tello/data/MapData'
import { foxLakeLand } from '../lake/Land'
import { findLakeSite } from '../lake/LakeSite'

const dir = 'public/modules/tello/'

export const doc = JSON.parse(readFileSync(`${dir}montello.json`, 'utf8')) as MapDoc
const packed = new Uint8Array(readFileSync(`${dir}montello.bin`))
export const land = foxLakeLand(doc, parseGrids(isGzip(packed) ? new Uint8Array(gunzipSync(packed)) : packed))
export const site = findLakeSite(land)
