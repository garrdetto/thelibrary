/** Paints the region map off the main thread (`shadeMap`) at each requested size in turn (a quick coarse pass, then the sharp one) and posts each back as a transferable. */
import { shadeMap } from './MapShade'

const scope = self as unknown as { onmessage: ((event: MessageEvent<{ sizes: number[] }>) => void) | null; postMessage(message: unknown, transfer: Transferable[]): void }

scope.onmessage = (event) => {
  for (const size of event.data.sizes) {
    const pixels = shadeMap(size)
    scope.postMessage({ size, pixels, last: size === event.data.sizes[event.data.sizes.length - 1] }, [pixels.buffer])
  }
}
