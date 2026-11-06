/**
 * The vehicle registry shared with Fox Plains: built-in tuning plus every
 * vehicle published from the admin vehicle editor (and the bundled ones), so
 * a vehicle published there drives the same here. In the developer instance
 * (`?dev=1`) the admin's drafts are loaded too; the server only returns them
 * to the admin.
 */
import { customVehicleRecord, isValidVehicleRecord, registerCustomVehicles, type CustomVehicleRecord } from '../../../maplestreet/shared/CustomVehicles';
import { BUILTIN_VEHICLE_KINDS, TUNING } from '../../../maplestreet/shared/Vehicles';
import { store } from '../../../maplestreet/src/core/Storage';

export const DEV = new URLSearchParams(location.search).get('dev') === '1';
const CACHE = 'maplestreet/custom-vehicles/v1';

export interface VehicleEntry { kind: string; name: string; draft: boolean; topMph: number; mass: number; mower: boolean }

let drafts = new Set<string>();
let draftsAllowed = false;

/** Fetches published (and, for the admin in the developer instance, draft) vehicles and registers them. */
export async function registerVehicles() {
  let list: CustomVehicleRecord[] | null = null;
  if (location.protocol.startsWith('http')) {
    const ctrl = new AbortController(), timer = setTimeout(() => ctrl.abort(), 5000);
    try {
      const res = await fetch(`/api/maplestreet-vehicles${DEV ? '?drafts=1' : ''}`, { credentials: 'same-origin', cache: 'no-store', signal: ctrl.signal });
      if (res.ok) {
        const data = (await res.json()) as { vehicles?: unknown; drafts?: unknown };
        if (Array.isArray(data.vehicles)) {
          draftsAllowed = DEV && data.drafts === true;
          list = data.vehicles.filter(isValidVehicleRecord).filter(r => draftsAllowed || r.status !== 'draft');
          drafts = new Set(list.filter(r => r.status === 'draft').map(r => r.id));
        }
      }
    } catch { /* offline: use the cache */ } finally { clearTimeout(timer); }
  }
  if (list) store.set(CACHE, JSON.stringify(list.filter(r => r.status !== 'draft')));
  registerCustomVehicles(list ?? (store.json<unknown[]>(CACHE) ?? []).filter(isValidVehicleRecord));
}

export function vehicleEntries(): VehicleEntry[] {
  return Object.entries(TUNING).filter(([, t]) => t.engineForce > 0).map(([kind, t]) => {
    const custom = kind.startsWith('custom:');
    const id = custom ? kind.slice(7) : kind;
    const name = custom ? customVehicleRecord(kind)?.name ?? id : (BUILTIN_VEHICLE_KINDS as readonly string[]).includes(kind) ? kind[0].toUpperCase() + kind.slice(1) : id;
    return { kind, name, draft: drafts.has(id), topMph: Math.round(t.topSpeed * 2.237), mass: Math.round(t.mass), mower: !!t.mowerDeck };
  }).sort((a, b) => Number(b.draft) - Number(a.draft) || a.name.localeCompare(b.name));
}

export const canSeeDrafts = () => draftsAllowed;
