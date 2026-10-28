/**
 * Buy-mode catalog, organized the way The Sims 4 does it: every item belongs
 * to a ROOM (Living, Kitchen, …) and a FUNCTION (Seating, Surfaces, …), so the
 * UI can browse either way. Footprints are in grid cells (1 cell = 1 m).
 *
 * Layers let things stack the way they do in a real house: a rug under a
 * sofa, a painting on the wall above it and a ceiling light overhead each
 * occupy their own layer of the same cell.
 *
 * Visual builders live on the client (src/build/Furniture.ts) keyed by id.
 */
export type CatalogRoom = 'living' | 'kitchen' | 'dining' | 'bath' | 'bedroom' | 'study' | 'kids' | 'outdoor';
export type CatalogFunc = 'seating' | 'surfaces' | 'appliances' | 'plumbing' | 'beds' | 'storage' | 'electronics' | 'decor' | 'lighting' | 'activities' | 'plants';
export type ObjectLayer = 'floor' | 'rug' | 'wall' | 'ceiling';
/** What a Sim-style interaction does (validated server-side). */
export type UseAction = 'sleep' | 'eat' | 'fun' | 'refresh';

export interface CatalogItem {
  id: string;
  name: string;
  room: CatalogRoom;
  func: CatalogFunc;
  w: number;        // cells along local X
  d: number;        // cells along local Z (front faces +Z)
  h: number;        // collider height in meters
  price: number;
  indoor: boolean;  // requires a floor under every footprint cell
  solid: boolean;   // gets a physics collider
  layer: ObjectLayer;
  tintable: boolean;
  use?: UseAction;
}

const I = (id: string, name: string, room: CatalogRoom, func: CatalogFunc, w: number, d: number, h: number, price: number, o: Partial<CatalogItem> = {}): CatalogItem =>
  ({ id, name, room, func, w, d, h, price, indoor: true, solid: true, layer: 'floor', tintable: false, ...o });

const LIST: CatalogItem[] = [
  // Living
  I('sofa', 'Three-Seat Sofa', 'living', 'seating', 3, 1, 0.85, 900, { tintable: true }),
  I('loveseat', 'Loveseat', 'living', 'seating', 2, 1, 0.85, 620, { tintable: true }),
  I('armchair', 'Wingback Armchair', 'living', 'seating', 1, 1, 0.95, 350, { tintable: true }),
  I('recliner', 'Recliner', 'living', 'seating', 1, 1, 1.0, 480, { tintable: true, use: 'fun' }),
  I('coffeeTable', 'Coffee Table', 'living', 'surfaces', 2, 1, 0.45, 220, { tintable: true }),
  I('endTable', 'End Table with Lamp', 'living', 'surfaces', 1, 1, 0.6, 160, { tintable: true }),
  I('tvStand', 'Media Console + 65" TV', 'living', 'electronics', 2, 1, 1.3, 1400, { use: 'fun' }),
  I('wallTv', 'Wall-Mounted TV', 'living', 'electronics', 2, 1, 0, 1600, { layer: 'wall', solid: false, use: 'fun' }),
  I('bookshelf', 'Bookshelf', 'living', 'storage', 1, 1, 2.0, 300, { tintable: true }),
  I('fireplace', 'Stone Fireplace', 'living', 'decor', 2, 1, 1.4, 2200),
  I('piano', 'Upright Piano', 'living', 'activities', 2, 1, 1.3, 3200, { use: 'fun' }),
  // Kitchen
  I('counter', 'Kitchen Counter', 'kitchen', 'surfaces', 1, 1, 0.92, 420, { tintable: true }),
  I('sinkCounter', 'Counter with Sink', 'kitchen', 'plumbing', 1, 1, 0.92, 560, { tintable: true }),
  I('stove', 'Range / Oven', 'kitchen', 'appliances', 1, 1, 0.95, 850),
  I('fridge', 'Refrigerator', 'kitchen', 'appliances', 1, 1, 1.8, 1600, { use: 'eat' }),
  I('dishwasher', 'Dishwasher', 'kitchen', 'appliances', 1, 1, 0.9, 700),
  I('island', 'Kitchen Island', 'kitchen', 'surfaces', 2, 1, 0.92, 980, { tintable: true }),
  I('barStool', 'Bar Stool', 'kitchen', 'seating', 1, 1, 0.75, 90, { tintable: true }),
  // Dining
  I('diningSet', 'Dining Table + 4 Chairs', 'dining', 'surfaces', 2, 2, 0.76, 760, { tintable: true }),
  I('sideboard', 'Sideboard', 'dining', 'storage', 2, 1, 0.9, 520, { tintable: true }),
  // Bath
  I('toilet', 'Toilet', 'bath', 'plumbing', 1, 1, 0.8, 260),
  I('bathtub', 'Soaking Tub', 'bath', 'plumbing', 2, 1, 0.6, 700, { use: 'refresh' }),
  I('shower', 'Glass Shower', 'bath', 'plumbing', 1, 1, 2.1, 900, { use: 'refresh' }),
  I('vanity', 'Vanity Sink', 'bath', 'plumbing', 1, 1, 0.9, 380, { tintable: true }),
  I('doubleVanity', 'Double Vanity', 'bath', 'plumbing', 2, 1, 0.9, 820, { tintable: true }),
  // Bedroom
  I('bed', 'Queen Bed', 'bedroom', 'beds', 2, 3, 1.1, 1200, { tintable: true, use: 'sleep' }),
  I('twinBed', 'Twin Bed', 'bedroom', 'beds', 1, 2, 0.9, 520, { tintable: true, use: 'sleep' }),
  I('nightstand', 'Nightstand', 'bedroom', 'surfaces', 1, 1, 0.6, 140, { tintable: true }),
  I('dresser', 'Dresser', 'bedroom', 'storage', 2, 1, 1.0, 480, { tintable: true }),
  I('wardrobe', 'Wardrobe', 'bedroom', 'storage', 2, 1, 2.1, 760, { tintable: true }),
  // Study / kids
  I('desk', 'Writing Desk + Chair', 'study', 'surfaces', 2, 1, 0.76, 340, { tintable: true }),
  I('computer', 'Computer Desk', 'study', 'electronics', 2, 1, 1.2, 1800, { use: 'fun' }),
  I('bunkBed', 'Bunk Bed', 'kids', 'beds', 1, 2, 1.7, 690, { tintable: true, use: 'sleep' }),
  I('toyChest', 'Toy Chest', 'kids', 'storage', 1, 1, 0.5, 120, { tintable: true, use: 'fun' }),
  // Decor & lighting
  I('plant', 'Potted Fig', 'living', 'plants', 1, 1, 1.5, 60, { indoor: false, solid: false }),
  I('tallPlant', 'Snake Plant', 'living', 'plants', 1, 1, 1.1, 45, { indoor: false, solid: false }),
  I('rugSmall', 'Wool Rug (2×2)', 'living', 'decor', 2, 2, 0, 180, { layer: 'rug', solid: false, tintable: true }),
  I('rugLarge', 'Wool Rug (3×2)', 'living', 'decor', 3, 2, 0, 260, { layer: 'rug', solid: false, tintable: true }),
  I('painting', 'Landscape Painting', 'living', 'decor', 1, 1, 0, 240, { layer: 'wall', solid: false, tintable: true }),
  I('mirror', 'Wall Mirror', 'bath', 'decor', 1, 1, 0, 150, { layer: 'wall', solid: false }),
  I('wallClock', 'Wall Clock', 'kitchen', 'decor', 1, 1, 0, 60, { layer: 'wall', solid: false }),
  I('shelf', 'Floating Shelf', 'living', 'storage', 1, 1, 0, 90, { layer: 'wall', solid: false, tintable: true }),
  I('floorLamp', 'Floor Lamp', 'living', 'lighting', 1, 1, 1.7, 90, { solid: false }),
  I('ceilingLight', 'Ceiling Light', 'living', 'lighting', 1, 1, 0, 80, { layer: 'ceiling', solid: false }),
  I('chandelier', 'Chandelier', 'dining', 'lighting', 1, 1, 0, 420, { layer: 'ceiling', solid: false }),
  // Outdoor & activities
  I('grill', 'Gas Grill', 'outdoor', 'appliances', 1, 1, 1.1, 450, { indoor: false, use: 'eat' }),
  I('patioSet', 'Patio Table Set', 'outdoor', 'surfaces', 2, 2, 0.75, 520, { indoor: false, tintable: true }),
  I('lounger', 'Pool Lounger', 'outdoor', 'seating', 1, 2, 0.5, 210, { indoor: false, tintable: true }),
  I('hotTub', 'Hot Tub', 'outdoor', 'activities', 2, 2, 0.9, 4200, { indoor: false, use: 'fun' }),
  I('hoop', 'Driveway Basketball Hoop', 'outdoor', 'activities', 1, 1, 3.1, 380, { indoor: false, use: 'fun' }),
  I('court', 'Half Basketball Court', 'outdoor', 'activities', 7, 8, 0, 2800, { indoor: false, solid: false, use: 'fun' }),
  I('swingSet', 'Swing Set', 'kids', 'activities', 3, 2, 2.2, 640, { indoor: false, use: 'fun' }),
  I('trampoline', 'Trampoline', 'kids', 'activities', 3, 3, 0.9, 520, { indoor: false, use: 'fun' }),
  I('divingBoard', 'Diving Board', 'outdoor', 'activities', 1, 2, 0.4, 350, { indoor: false, use: 'fun' }),
  I('bench', 'Garden Bench', 'outdoor', 'seating', 2, 1, 0.9, 160, { indoor: false, tintable: true }),
  I('lampPost', 'Lamp Post', 'outdoor', 'lighting', 1, 1, 2.6, 180, { indoor: false }),
  I('shrub', 'Boxwood Shrub', 'outdoor', 'plants', 1, 1, 0.9, 45, { indoor: false, solid: false }),
  I('flowerBed', 'Flower Bed', 'outdoor', 'plants', 2, 1, 0.5, 70, { indoor: false, solid: false, tintable: true }),
  I('tree', 'Maple Sapling', 'outdoor', 'plants', 1, 1, 4.0, 150, { indoor: false }),
  I('doghouse', 'Doghouse', 'outdoor', 'decor', 1, 1, 1.0, 140, { indoor: false, tintable: true }),
  I('stairs', 'Straight Staircase', 'living', 'decor', 1, 4, 0, 900, { tintable: true }),
];

export const CATALOG: Record<string, CatalogItem> = Object.fromEntries(LIST.map(i => [i.id, i]));

/** Design-tool swatches (index 0 = the item's default look). */
export const SWATCHES = ['#6b7b8c', '#b89b72', '#8b3a3a', '#3f5e46', '#2e3a55', '#d9d2c3', '#2b2b2b', '#c27b4f'];

/** Footprint dimensions after rotation (rot = quarter turns). */
export function footprint(item: CatalogItem, rot: number): { w: number; d: number } {
  return rot % 2 === 0 ? { w: item.w, d: item.d } : { w: item.d, d: item.w };
}
