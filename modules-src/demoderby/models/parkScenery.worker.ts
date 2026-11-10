/** Worker: builds the Thrill Park scenery off the main thread (see `parkSceneryBuild.ts`) and sends the typed arrays back without copying them. */
import data from '../data/park.json'
import { buildParkScenery, payloadBuffers, type ParkSceneryData } from './parkSceneryBuild'

const scope = self as unknown as { onmessage: ((event: MessageEvent<{ reach: number }>) => void) | null; postMessage(message: unknown, transfer: Transferable[]): void }

scope.onmessage = (event) => {
  try {
    const payload = buildParkScenery(data as ParkSceneryData, event.data.reach)
    scope.postMessage({ payload }, payloadBuffers(payload))
  } catch (error) {
    scope.postMessage({ error: error instanceof Error ? error.message : String(error) }, [])
  }
}
