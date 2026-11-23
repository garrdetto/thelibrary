/**
 * Builds terrain tile data off the main thread: the page posts tile requests, this runs `buildTileData` (the same pure builder the
 * page uses while loading) and posts the arrays back as transferables.
 */
import { buildTileData } from './TerrainTile'

export interface TileRequest {
  key: string
  x0: number
  z0: number
  size: number
}

const scope = self as unknown as { onmessage: ((event: MessageEvent<TileRequest>) => void) | null; postMessage(message: unknown, transfer: Transferable[]): void }

scope.onmessage = (event) => {
  const { key, x0, z0, size } = event.data
  const data = buildTileData(x0, z0, size)
  scope.postMessage({ key, data }, [data.positions.buffer, data.normals.buffer, data.colors.buffer, data.uvs.buffer, data.morph.buffer])
}
