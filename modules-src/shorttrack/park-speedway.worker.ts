/** Worker: builds the Thrill Park 2 park around Thrill Park Speedway off the main thread and sends the typed arrays back without copying them. */
import data from './data/park.json'
import { buildParkScenery, payloadBuffers, type ParkSceneryData } from '../demoderby/models/parkSceneryBuild'

const scope = self as unknown as { onmessage: ((event: MessageEvent<{ reach: number }>) => void) | null; postMessage(message: unknown, transfer: Transferable[]): void }

scope.onmessage = (event) => {
  try {
    const payload = buildParkScenery(data as ParkSceneryData, event.data.reach)
    scope.postMessage({ payload }, payloadBuffers(payload))
  } catch (error) {
    scope.postMessage({ error: error instanceof Error ? error.message : String(error) }, [])
  }
}
