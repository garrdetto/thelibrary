/**
 * Paint schemes per aircraft family: the colours of the `<family>_paint`, `_stripe` and `_cowl` materials (linear RGB, as in
 * glTF). The first scheme is the factory finish the model was built with. Names are invented and carry no brand. The renderer
 * applies them (`AircraftVisual.applyLivery`); the choice is a per-browser convenience.
 */
export type Rgb = [number, number, number]

export interface Livery {
  id: string
  name: string
  paint: Rgb
  stripe: Rgb
  cowl?: Rgb
}

const scheme = (id: string, name: string, paint: Rgb, stripe: Rgb, cowl?: Rgb): Livery => ({ id, name, paint, stripe, cowl })

export const LIVERIES: Record<string, Livery[]> = {
  wren: [
    scheme('factory', 'Factory white', [0.86, 0.87, 0.88], [0.05, 0.16, 0.36]),
    scheme('signal', 'Signal red', [0.86, 0.86, 0.84], [0.5, 0.05, 0.04]),
    scheme('meadow', 'Meadow green', [0.82, 0.84, 0.78], [0.06, 0.25, 0.1]),
    scheme('sunrise', 'Sunrise yellow', [0.78, 0.6, 0.12], [0.08, 0.08, 0.09]),
  ],
  duet: [
    scheme('factory', 'Factory white', [0.9, 0.9, 0.88], [0.55, 0.12, 0.1]),
    scheme('harbour', 'Harbour blue', [0.86, 0.88, 0.9], [0.04, 0.15, 0.4]),
    scheme('graphite', 'Graphite', [0.16, 0.17, 0.18], [0.7, 0.55, 0.12]),
  ],
  sprite: [
    scheme('factory', 'Factory white', [0.88, 0.9, 0.92], [0.1, 0.35, 0.55]),
    scheme('copper', 'Copper', [0.88, 0.86, 0.82], [0.45, 0.16, 0.05]),
    scheme('night', 'Night blue', [0.05, 0.08, 0.16], [0.75, 0.75, 0.78]),
  ],
  vesta: [
    scheme('factory', 'Factory white', [0.93, 0.93, 0.94], [0.42, 0.44, 0.48]),
    scheme('champagne', 'Champagne', [0.78, 0.7, 0.55], [0.2, 0.17, 0.13]),
    scheme('racing', 'Racing green', [0.9, 0.91, 0.9], [0.03, 0.18, 0.09]),
  ],
  haulmaster: [
    scheme('factory', 'Freight yellow', [0.9, 0.86, 0.62], [0.2, 0.22, 0.24]),
    scheme('utility', 'Utility grey', [0.55, 0.57, 0.58], [0.85, 0.36, 0.05]),
    scheme('relief', 'Relief white', [0.92, 0.92, 0.92], [0.55, 0.05, 0.05]),
  ],
}

export function liveriesFor(family: string): Livery[] {
  return LIVERIES[family] ?? []
}

export function liveryFor(family: string, id: string | undefined): Livery | null {
  const list = liveriesFor(family)
  return list.find((livery) => livery.id === id) ?? list[0] ?? null
}
