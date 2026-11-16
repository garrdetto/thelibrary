/**
 * Montello's map baked ahead for Fox Lake (Life Sim), so the page does less on every load.
 *
 * Tello's files (`public/modules/tello/montello.json` and `.bin`) are the survey as baked from Montello. Before Fox Lake can
 * use them, every load used to repair the streets (`fixStreets`: about 3 s of work on a fast desktop). `packFoxLakeMap`
 * does that once, at build time (`vite.modules.ts`, `thelibrary:foxlake-map`), and stores the grids as differences from
 * their neighbours (`filterGrid`), which gzip packs into about two thirds of the original download. The heights stay the
 * survey's: the World Editor's edits are written against them, and the page replays those and then moves everything down
 * to Lake Montello's level (`rebaseLand`) as before. The page loads the pair through `foxlake-map/manifest.json`
 * (`loadPacked` in `index.ts`), whose file names carry a hash of everything the bake read, so they are cached for a year
 * and a change to the map or the street fixes gets new names.
 *
 * Renderer-free: the build and the tests run it in Node.
 */
import { filterGrid, writeGrids, type GridSection, type MapDoc, type MapGrids, type SectionFilter } from '../../tello/data/MapData'
import { fixStreets } from '../../tello/data/Streets'

/** The folder under `public/modules/` the packed map is written to and read from. */
export const MAP_PACK_DIR = 'foxlake-map'

export interface MapPackManifest {
  doc: string
  grids: string
}

/**
 * How each grid is stored. Picked by packing the survey every way (`left` wins on tone, play and the tree columns, `up` on
 * the pavement field, `grad` on the ground; cover, water and canopy pack smaller as they are).
 */
const FILTERS: Partial<Record<keyof MapGrids, SectionFilter>> = { ground: 'grad', tone: 'left', clear: 'up', play: 'left', treeX: 'left', treeZ: 'left' }

/** Repairs the streets on `doc` and `grids` (both are changed) and returns the doc's JSON and the grid file, unpacked: gzip it to serve it. */
export function packFoxLakeMap(doc: MapDoc, grids: MapGrids): { doc: string; grids: Uint8Array } {
  if (doc.prepared) throw new Error('Montello map is already baked')
  fixStreets(doc, grids)
  doc.prepared = { streets: 1 }
  const grid = (name: keyof MapGrids, type: GridSection['type'], side: number): GridSection => {
    const data = grids[name] as GridSection['data']
    const filter = FILTERS[name]
    return { name, type, side, data: filter ? filterGrid(data, side || data.length, filter) : data, ...(filter ? { filter } : {}) }
  }
  const n = grids.side
  const sections = [
    grid('ground', 'u16', n),
    grid('water', 'u16', n),
    grid('cover', 'u8', n),
    grid('tone', 'u8', n),
    grid('canopy', 'u8', n),
    grid('clear', 'i8', grids.fineSide),
    grid('play', 'i8', n),
    grid('treeX', 'u16', 0),
    grid('treeZ', 'u16', 0),
    grid('treeS', 'u8', 0),
    grid('treeH', 'u8', 0),
  ]
  return { doc: JSON.stringify(doc), grids: writeGrids(sections) }
}
