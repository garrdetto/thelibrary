/** Paints the region map off the main thread (`shadeMap`) and posts the pixels back as a transferable. */
import { shadeMap } from './MapShade'

const scope = self as unknown as { onmessage: ((event: MessageEvent<{ size: number }>) => void) | null; postMessage(message: unknown, transfer: Transferable[]): void }

scope.onmessage = (event) => {
  const pixels = shadeMap(event.data.size)
  scope.postMessage({ size: event.data.size, pixels }, [pixels.buffer])
}
