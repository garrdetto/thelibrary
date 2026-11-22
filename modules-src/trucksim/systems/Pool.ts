/**
 * A small object pool for things created and dropped constantly (particles, pile meshes, markers). `acquire` reuses a released item
 * or creates one, `release` resets it and keeps it up to `max`, and `drain` hands everything kept to a disposer.
 */
export class Pool<T> {
  private readonly free: T[] = []

  constructor(
    private readonly create: () => T,
    private readonly reset: (item: T) => void,
    private readonly max: number,
  ) {}

  get available(): number {
    return this.free.length
  }

  acquire(): T {
    return this.free.pop() ?? this.create()
  }

  /** Returns true if the item was kept, false if the pool was full and the caller must dispose it. */
  release(item: T): boolean {
    if (this.free.length >= this.max) return false
    this.reset(item)
    this.free.push(item)
    return true
  }

  drain(dispose: (item: T) => void): void {
    while (this.free.length > 0) dispose(this.free.pop() as T)
  }
}
