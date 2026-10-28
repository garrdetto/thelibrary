/**
 * Furniture / object catalog shared by client and server.
 * Footprints are in grid cells (1 cell = 1 m). Visual builders live on the
 * client (src/build/Furniture.ts) keyed by the same id.
 */
export type CatalogCategory = 'living' | 'bedroom' | 'kitchen' | 'bath' | 'outdoor' | 'decor';

export interface CatalogItem {
  id: string;
  name: string;
  category: CatalogCategory;
  w: number;        // cells along local X
  d: number;        // cells along local Z
  h: number;        // collider height in meters
  price: number;
  indoor: boolean;  // requires a floor under every footprint cell
  solid: boolean;   // gets a physics collider
}

export const CATALOG: Record<string, CatalogItem> = {
  sofa:        { id: 'sofa',        name: 'Three-Seat Sofa',   category: 'living',  w: 3, d: 1, h: 0.85, price: 900,  indoor: true,  solid: true },
  armchair:    { id: 'armchair',    name: 'Armchair',          category: 'living',  w: 1, d: 1, h: 0.9,  price: 350,  indoor: true,  solid: true },
  coffeeTable: { id: 'coffeeTable', name: 'Coffee Table',      category: 'living',  w: 2, d: 1, h: 0.45, price: 220,  indoor: true,  solid: true },
  tvStand:     { id: 'tvStand',     name: 'TV + Media Stand',  category: 'living',  w: 2, d: 1, h: 1.3,  price: 1400, indoor: true,  solid: true },
  bookshelf:   { id: 'bookshelf',   name: 'Bookshelf',         category: 'living',  w: 1, d: 1, h: 2.0,  price: 300,  indoor: true,  solid: true },
  bed:         { id: 'bed',         name: 'Queen Bed',         category: 'bedroom', w: 2, d: 3, h: 1.1,  price: 1200, indoor: true,  solid: true },
  nightstand:  { id: 'nightstand',  name: 'Nightstand',        category: 'bedroom', w: 1, d: 1, h: 0.6,  price: 140,  indoor: true,  solid: true },
  dresser:     { id: 'dresser',     name: 'Dresser',           category: 'bedroom', w: 2, d: 1, h: 1.0,  price: 480,  indoor: true,  solid: true },
  counter:     { id: 'counter',     name: 'Kitchen Counter',   category: 'kitchen', w: 1, d: 1, h: 0.92, price: 420,  indoor: true,  solid: true },
  stove:       { id: 'stove',       name: 'Range / Oven',      category: 'kitchen', w: 1, d: 1, h: 0.95, price: 850,  indoor: true,  solid: true },
  fridge:      { id: 'fridge',      name: 'Refrigerator',      category: 'kitchen', w: 1, d: 1, h: 1.8,  price: 1600, indoor: true,  solid: true },
  diningSet:   { id: 'diningSet',   name: 'Dining Table + 4',  category: 'kitchen', w: 2, d: 2, h: 0.76, price: 760,  indoor: true,  solid: true },
  toilet:      { id: 'toilet',      name: 'Toilet',            category: 'bath',    w: 1, d: 1, h: 0.8,  price: 260,  indoor: true,  solid: true },
  bathtub:     { id: 'bathtub',     name: 'Bathtub',           category: 'bath',    w: 2, d: 1, h: 0.6,  price: 700,  indoor: true,  solid: true },
  vanity:      { id: 'vanity',      name: 'Vanity Sink',       category: 'bath',    w: 1, d: 1, h: 0.9,  price: 380,  indoor: true,  solid: true },
  floorLamp:   { id: 'floorLamp',   name: 'Floor Lamp',        category: 'decor',   w: 1, d: 1, h: 1.7,  price: 90,   indoor: true,  solid: false },
  plant:       { id: 'plant',       name: 'Potted Fig',        category: 'decor',   w: 1, d: 1, h: 1.5,  price: 60,   indoor: false, solid: false },
  grill:       { id: 'grill',       name: 'Gas Grill',         category: 'outdoor', w: 1, d: 1, h: 1.1,  price: 450,  indoor: false, solid: true },
  patioSet:    { id: 'patioSet',    name: 'Patio Table Set',   category: 'outdoor', w: 2, d: 2, h: 0.75, price: 520,  indoor: false, solid: true },
  fence:       { id: 'fence',       name: 'Picket Fence (1m)', category: 'outdoor', w: 1, d: 1, h: 1.0,  price: 35,   indoor: false, solid: true },
  shrub:       { id: 'shrub',       name: 'Boxwood Shrub',     category: 'outdoor', w: 1, d: 1, h: 0.9,  price: 45,   indoor: false, solid: false },
};

/** Footprint dimensions after rotation (rot = quarter turns). */
export function footprint(item: CatalogItem, rot: number): { w: number; d: number } {
  return rot % 2 === 0 ? { w: item.w, d: item.d } : { w: item.d, d: item.w };
}
