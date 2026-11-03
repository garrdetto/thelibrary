/**
 * Admin-published Buy-mode items. The admin editor (src/components/maplestreet/)
 * uploads a .glb with a scale vector; /api/maplestreet-items stores the file in
 * KV and the record in D1. Every authority (the shared-world Durable Object,
 * solo hosts, PeerJS hosts) and every client registers the same records here
 * before loading saved builds, so placed custom items survive normalizeBuild.
 *
 * A custom model is drawn as: yaw (quarter turns) > scale > offset that puts
 * the unscaled bounds' center on the footprint center and its bottom on the
 * floor. Scaling around that origin keeps the model centered and grounded.
 */
import { isAssetStatus, type AssetStatus } from './Assets';
import { CATALOG, CATALOG_FUNCS, CATALOG_ROOMS, type CatalogFunc, type CatalogItem, type CatalogRoom } from './Catalog';

export const CUSTOM_PREFIX = 'custom:';
export const CUSTOM_LIMITS = {
  nameMin: 2,
  nameMax: 40,
  priceMin: 1,
  priceMax: 100000,
  scaleMin: 0.001,
  scaleMax: 1000,
  footprintMax: 8,
  heightMax: 8,
  modelBytes: 15 * 1024 * 1024,
} as const;

export interface Vector3Like { x: number; y: number; z: number }

/** The public shape returned by GET /api/maplestreet-items. */
export interface CustomItemRecord {
  id: string;
  name: string;
  price: number;
  room: CatalogRoom;
  func: CatalogFunc;
  indoor: boolean;
  solid: boolean;
  scale: Vector3Like;
  yaw: number;
  /** Footprint cells along world X and Z with yaw applied, and collider height in meters. */
  w: number;
  d: number;
  h: number;
  modelUrl: string;
  active: boolean;
  /** Missing on records cached before drafts existed: those were all published or retired. */
  status?: AssetStatus;
  updatedAt: number;
}

export const customCatalogId = (id: string) => `${CUSTOM_PREFIX}${id}`;
export const isCustomCatalogId = (catalogId: string) => catalogId.startsWith(CUSTOM_PREFIX);

const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));

/** Grid footprint (cells) and collider height (m) of a model whose scaled bounds are `size`. */
export function footprintFromSize(size: Vector3Like, yaw: number): { w: number; d: number; h: number } {
  const turned = ((yaw % 4) + 4) % 2 === 1;
  const sx = turned ? size.z : size.x, sz = turned ? size.x : size.z;
  const cells = (meters: number) => clamp(Math.ceil(meters - 0.05), 1, CUSTOM_LIMITS.footprintMax);
  return { w: cells(sx), d: cells(sz), h: clamp(Math.round(size.y * 100) / 100, 0, CUSTOM_LIMITS.heightMax) };
}

function toCatalogItem(r: CustomItemRecord): CatalogItem {
  return {
    id: customCatalogId(r.id),
    name: r.name,
    room: r.room,
    func: r.func,
    w: r.w,
    d: r.d,
    h: r.h,
    price: r.price,
    indoor: r.indoor,
    solid: r.solid && r.h > 0,
    layer: 'floor',
    tintable: false,
    hidden: !r.active,
    custom: { url: r.modelUrl, scale: { ...r.scale }, yaw: r.yaw },
  };
}

/**
 * Adds or refreshes custom items in CATALOG. Records that disappear stay
 * registered (as hidden) so houses that already own them keep them.
 */
export function registerCustomItems(records: readonly CustomItemRecord[]): CatalogItem[] {
  const seen = new Set<string>();
  const added: CatalogItem[] = [];
  for (const r of records) {
    if (!isValidRecord(r)) continue;
    const item = toCatalogItem(r);
    CATALOG[item.id] = item;
    seen.add(item.id);
    added.push(item);
  }
  for (const id in CATALOG) if (isCustomCatalogId(id) && !seen.has(id)) CATALOG[id].hidden = true;
  return added;
}

const ROOMS = new Set<string>(CATALOG_ROOMS);
const FUNCS = new Set<string>(CATALOG_FUNCS);
const finite = (v: unknown, min: number, max: number) => typeof v === 'number' && Number.isFinite(v) && v >= min && v <= max;

/** Light structural check for records read from the network or a cache. */
export function isValidRecord(r: unknown): r is CustomItemRecord {
  if (!r || typeof r !== 'object') return false;
  const o = r as CustomItemRecord;
  return typeof o.id === 'string' && /^[a-z0-9-]{8,64}$/.test(o.id)
    && typeof o.name === 'string' && o.name.length >= 1 && o.name.length <= CUSTOM_LIMITS.nameMax
    && finite(o.price, CUSTOM_LIMITS.priceMin, CUSTOM_LIMITS.priceMax) && Number.isInteger(o.price)
    && typeof o.modelUrl === 'string' && o.modelUrl.length < 512
    && !!o.scale && finite(o.scale.x, CUSTOM_LIMITS.scaleMin, CUSTOM_LIMITS.scaleMax) && finite(o.scale.y, CUSTOM_LIMITS.scaleMin, CUSTOM_LIMITS.scaleMax) && finite(o.scale.z, CUSTOM_LIMITS.scaleMin, CUSTOM_LIMITS.scaleMax)
    && Number.isInteger(o.yaw) && o.yaw >= 0 && o.yaw <= 3
    && Number.isInteger(o.w) && o.w >= 1 && o.w <= CUSTOM_LIMITS.footprintMax
    && Number.isInteger(o.d) && o.d >= 1 && o.d <= CUSTOM_LIMITS.footprintMax
    && finite(o.h, 0, CUSTOM_LIMITS.heightMax)
    && ROOMS.has(o.room) && FUNCS.has(o.func)
    && typeof o.indoor === 'boolean' && typeof o.solid === 'boolean' && typeof o.active === 'boolean'
    && (o.status === undefined || isAssetStatus(o.status));
}
