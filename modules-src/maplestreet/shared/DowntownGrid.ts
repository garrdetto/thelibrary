/**
 * The downtown grid east of Market Ave: three avenues and two new streets
 * crossing Main, Commerce and South St make twelve blocks. Eleven are lined
 * with buildings on both street fronts; the twelfth, just south of Main St,
 * is the town square (Maple Commons). Pure data shared by client and server.
 *
 * Grid buildings are scenery (not shops): they get lighter facades than the
 * original strip, with only the street front and any end exposed to an
 * avenue painted in detail.
 */
import type { Building, RectXZ, Sidewalk } from './WorldLayout';

const ROAD_W = 10;
const WALK = 4;

/** Avenue centerlines: Market Ave (already there), Second Ave, Third Ave, Shoreline Dr. */
export const GRID_X = [260, 356, 452, 548] as const;
/** Street centerlines: Mill St, Commerce St, Main St, South St, Park St. */
export const GRID_Z = [-110, -54, 0, 54, 110] as const;
export const GRID_EAST = GRID_X[GRID_X.length - 1] + ROAD_W / 2;

export interface GridBlock { col: number; row: number; x0: number; x1: number; z0: number; z1: number }

/** Buildable interior of every block (inside the 4 m sidewalks). */
export const GRID_BLOCKS: GridBlock[] = (() => {
  const out: GridBlock[] = [];
  for (let c = 0; c < GRID_X.length - 1; c++) for (let r = 0; r < GRID_Z.length - 1; r++) {
    out.push({ col: c, row: r, x0: GRID_X[c] + ROAD_W / 2 + WALK, x1: GRID_X[c + 1] - ROAD_W / 2 - WALK, z0: GRID_Z[r] + ROAD_W / 2 + WALK, z1: GRID_Z[r + 1] - ROAD_W / 2 - WALK });
  }
  return out;
})();

/** Maple Commons: the block south of Main St between Market and Second Ave. */
export const TOWN_SQUARE = GRID_BLOCKS.find(b => b.col === 0 && b.row === 2)!;
export const TOWN_SQUARE_RECT: RectXZ = { cx: (TOWN_SQUARE.x0 + TOWN_SQUARE.x1) / 2, cz: (TOWN_SQUARE.z0 + TOWN_SQUARE.z1) / 2, sx: TOWN_SQUARE.x1 - TOWN_SQUARE.x0, sz: TOWN_SQUARE.z1 - TOWN_SQUARE.z0 };

/** Everything the grid covers, streets and outer sidewalks included (kept clear of the woods). */
export const GRID_AREA = { x0: GRID_X[0] - ROAD_W / 2 - 2, x1: GRID_EAST + WALK + 8, z0: GRID_Z[0] - ROAD_W / 2 - WALK - 8, z1: GRID_Z[GRID_Z.length - 1] + ROAD_W / 2 + WALK + 8 };

const span = (a: number, b: number) => ({ c: (a + b) / 2, s: b - a });

/** New roads. Main, Commerce and South St are lengthened in WorldLayout instead. */
export const GRID_ROADS: { name: string; rect: RectXZ }[] = [
  ...GRID_X.slice(1).map((x, i) => ({ name: ['Second Ave', 'Third Ave', 'Shoreline Dr'][i], rect: { cx: x, cz: 0, sx: ROAD_W, sz: GRID_Z[4] * 2 + ROAD_W } })),
  ...[GRID_Z[0], GRID_Z[4]].map((z, i) => {
    const { c, s } = span(GRID_X[0] - ROAD_W / 2, GRID_EAST);
    return { name: ['Mill St', 'Park St'][i], rect: { cx: c, cz: z, sx: s, sz: ROAD_W } };
  }),
];

/** 4 m sidewalks on both sides of every grid street and avenue (none on Market Ave's west side, which the old strip covers). */
export const GRID_SIDEWALKS: Sidewalk[] = (() => {
  const out: Sidewalk[] = [];
  for (const z of GRID_Z) for (let c = 0; c < GRID_X.length - 1; c++) {
    const { c: cx, s } = span(GRID_X[c] + ROAD_W / 2, GRID_X[c + 1] - ROAD_W / 2);
    for (const side of [-1, 1]) out.push({ cx, cz: z + side * (ROAD_W / 2 + WALK / 2), sx: s, sz: WALK, road: side > 0 ? '-z' : '+z' });
  }
  for (let r = 0; r < GRID_Z.length - 1; r++) {
    const { c: cz, s } = span(GRID_Z[r] + ROAD_W / 2 + WALK, GRID_Z[r + 1] - ROAD_W / 2 - WALK);
    GRID_X.forEach((x, i) => {
      for (const side of [-1, 1]) {
        if (i === 0 && side < 0) continue;
        out.push({ cx: x + side * (ROAD_W / 2 + WALK / 2), cz, sx: WALK, sz: s, road: side > 0 ? '-x' : '+x' });
      }
    });
  }
  return out;
})();

/** Named landmarks: block (col,row), which street front, and what stands there. */
const LANDMARKS: { col: number; row: number; front: 'low' | 'high'; at: number; b: Pick<Building, 'id' | 'name' | 'kind' | 'w' | 'h' | 'color'> }[] = [
  { col: 0, row: 3, front: 'low', at: 0.5, b: { id: 'townhall', name: 'Fox Plains Town Hall', kind: 'townhall', w: 30, h: 14, color: '#d6cdbb' } },
  { col: 1, row: 1, front: 'high', at: 0.35, b: { id: 'cinema', name: 'Northwoods Cinema', kind: 'cinema', w: 24, h: 11, color: '#7a2c2c' } },
  { col: 1, row: 2, front: 'low', at: 0.6, b: { id: 'library', name: 'Fox Plains Public Library', kind: 'library', w: 26, h: 10, color: '#9a6b4f' } },
  { col: 2, row: 1, front: 'high', at: 0.5, b: { id: 'hotel', name: 'Lakeside Hotel', kind: 'hotel', w: 28, h: 24, color: '#c7b9a3' } },
  { col: 2, row: 0, front: 'high', at: 0.3, b: { id: 'tower2', name: 'Harbor Point Tower', kind: 'office', w: 22, h: 34, color: '#6f8193' } },
  { col: 1, row: 0, front: 'high', at: 0.7, b: { id: 'tower3', name: 'Commerce Center', kind: 'office', w: 20, h: 28, color: '#86929e' } },
];

const RETAIL = [
  'Sweet Maple Bakery', 'Corner Books', 'Pine & Pour', 'Northwoods Outfitters', 'Second Street Antiques', 'Ladle & Loaf',
  'Main Street Pharmacy', 'Glass House Florist', 'Badger Barber Co.', 'Lakeside Supper Club', 'Scoops Ice Cream', 'Old Mill Hardware & Hobby',
  'Cedar Creek Coffee', 'Two Rivers Records', 'Harbor Light Optics', 'Prairie Toy Shop', 'Copper Kettle Diner', 'Driftwood Gallery',
  'Fox Valley Bikes', 'Juniper Yoga', 'Birch Bark Tailors', 'Kettle Moraine Deli', 'Sunday Market Cheese', 'Larch Lane Stationery',
];
const APARTMENTS = ['Harbor Lofts', 'Mill Race Flats', 'Cedar Row', 'Lakeview Commons', 'Ironworks Lofts', 'Parkside Place', 'Birchwood Court', 'Station House'];
const OFFICES = ['Lakeshore Building', 'Founders Hall', 'Northern Trust Building', 'Commerce Exchange'];
const COLORS = ['#a9654a', '#8e5b45', '#c49a6c', '#d8cbb0', '#7d6a5a', '#b3846a', '#c2b59b', '#9c7d66', '#e0d3bd', '#6e5446', '#a8a39a', '#bf8f73'];
const WIDTHS = [14, 16, 18, 20, 24, 26];

function rng(seed: number) { return () => { seed = (seed * 16807) % 2147483647; return (seed - 1) / 2147483646; }; }

/** Splits a frontage into parcel widths that add up exactly, with landmarks reserved. */
function parcels(len: number, r: () => number, reserved: { at: number; w: number }[]) {
  const spans: { x: number; w: number; landmark?: number }[] = [];
  const marks = reserved.map((m, i) => ({ i, x0: Math.max(0, Math.min(len - m.w, Math.round(len * m.at - m.w / 2))), w: m.w })).sort((a, b) => a.x0 - b.x0);
  let cursor = 0;
  const fill = (to: number) => {
    while (to - cursor >= 12) {
      let w = WIDTHS[Math.floor(r() * WIDTHS.length) % WIDTHS.length];
      if (to - cursor - w < 12) w = to - cursor;
      spans.push({ x: cursor, w }); cursor += w;
    }
    if (to - cursor > 0 && spans.length && spans[spans.length - 1].landmark === undefined) { spans[spans.length - 1].w += to - cursor; cursor = to; }
    else if (to - cursor > 0) { spans.push({ x: cursor, w: to - cursor }); cursor = to; }
  };
  for (const m of marks) { fill(m.x0); spans.push({ x: m.x0, w: m.w, landmark: m.i }); cursor = m.x0 + m.w; }
  fill(len);
  return spans;
}

/** Every building on the grid, in a stable order (ids never change between builds). */
export const GRID_BUILDINGS: Building[] = (() => {
  const out: Building[] = [];
  let retail = 0, apt = 0, off = 0, color = 0;
  for (const blk of GRID_BLOCKS) {
    if (blk === TOWN_SQUARE) continue;
    const depth = Math.floor((blk.z1 - blk.z0) / 2);
    const len = blk.x1 - blk.x0;
    const onMain = blk.row === 1 || blk.row === 2;
    for (const front of ['low', 'high'] as const) {
      const r = rng(1 + blk.col * 97 + blk.row * 31 + (front === 'high' ? 7 : 0));
      const marks = LANDMARKS.filter(m => m.col === blk.col && m.row === blk.row && m.front === front);
      const mainFront = onMain && ((blk.row === 1 && front === 'high') || (blk.row === 2 && front === 'low'));
      const list = parcels(len, r, marks.map(m => ({ at: m.at, w: m.b.w })));
      list.forEach((p, i) => {
        const x = blk.x0 + p.x + p.w / 2;
        const facing: Building['facing'] = front === 'low' ? '-z' : '+z';
        const z = front === 'low' ? blk.z0 + depth / 2 : blk.z1 - depth / 2;
        const ends = { w: i === 0, e: i === list.length - 1 };
        const id = `g${blk.col}${blk.row}${front[0]}${i}`;
        if (p.landmark !== undefined) {
          const m = marks[p.landmark].b;
          out.push({ ...m, x, z, w: p.w, d: depth, facing, lite: true, ends });
          return;
        }
        const roll = r();
        let kind: Building['kind'], name: string, h: number;
        if (mainFront || roll < 0.55) { kind = 'retail'; name = RETAIL[retail++ % RETAIL.length]; h = 7 + Math.floor(r() * 3) * 3.4; }
        else if (roll < 0.85) { kind = 'apartments'; name = APARTMENTS[apt++ % APARTMENTS.length]; h = 13 + Math.floor(r() * 3) * 3.4; }
        else { kind = 'office'; name = OFFICES[off++ % OFFICES.length]; h = 18 + Math.floor(r() * 4) * 3.4; }
        out.push({ id, name, kind, x, z, w: p.w, d: depth, h: Math.round(h * 10) / 10, facing, color: COLORS[color++ % COLORS.length], lite: true, ends });
      });
    }
  }
  return out;
})();
