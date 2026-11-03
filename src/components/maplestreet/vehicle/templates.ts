import { VEHICLES } from '../../../../modules-src/maplestreet/shared/Economy'
import type { DriveTemplate } from '../../../../modules-src/maplestreet/shared/CustomVehicles'

/** Dealer defaults per "drives like" template, from the built-in vehicle of that class. */
export const ECONOMY_TEMPLATES: Record<DriveTemplate, { price: number; fuel: 'gas' | 'electric'; tank: number; mpg: number }> = Object.fromEntries(
  (['sedan', 'truck', 'coupe', 'hdtruck', 'golfcart', 'atv'] as const).map(t => {
    const v = VEHICLES[t]
    return [t, { price: v.price || 22_000, fuel: v.fuel === 'electric' ? 'electric' : 'gas', tank: v.tank, mpg: v.mpg }]
  }),
) as Record<DriveTemplate, { price: number; fuel: 'gas' | 'electric'; tank: number; mpg: number }>
