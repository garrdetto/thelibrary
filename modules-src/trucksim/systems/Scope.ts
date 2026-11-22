/**
 * Ownership scopes for Truck Simulator resources. Every mesh, material, texture, observer and listener is tracked by exactly one
 * scope, and disposing a scope tears down its child scopes first and then its own items in reverse order of creation, so nothing
 * created for a screen, a chunk or a vehicle outlives it. One failing dispose is logged and never stops the rest.
 */

export interface Disposable {
  dispose(): void
}

type Teardown = () => void

/** A named group of resources that are released together; scopes nest through `child`. */
export class Scope {
  readonly name: string
  private readonly items: Teardown[] = []
  private readonly children: Scope[] = []
  private parentScope: Scope | null
  private isDisposed = false

  constructor(name: string, parent?: Scope) {
    this.name = name
    this.parentScope = parent ?? null
    parent?.adopt(this)
  }

  get disposed(): boolean {
    return this.isDisposed
  }

  /** Number of tracked items plus live child scopes. */
  get size(): number {
    return this.items.length + this.children.length
  }

  /** Registers an object with a `dispose()` and returns it. Added to an already disposed scope it is disposed immediately. */
  track<T extends Disposable>(item: T): T {
    this.defer(() => item.dispose())
    return item
  }

  /** Registers a teardown function, for observers, listeners, timers and anything without `dispose()`. */
  defer(teardown: Teardown): void {
    if (this.isDisposed) {
      Scope.run(this.name, teardown)
      return
    }
    this.items.push(teardown)
  }

  child(name: string): Scope {
    return new Scope(`${this.name}/${name}`, this)
  }

  dispose(): void {
    if (this.isDisposed) return
    this.isDisposed = true
    for (let index = this.children.length - 1; index >= 0; index--) this.children[index].dispose()
    this.children.length = 0
    for (let index = this.items.length - 1; index >= 0; index--) Scope.run(this.name, this.items[index])
    this.items.length = 0
    this.parentScope?.release(this)
    this.parentScope = null
  }

  private adopt(child: Scope): void {
    if (this.isDisposed) return
    this.children.push(child)
  }

  private release(child: Scope): void {
    const index = this.children.indexOf(child)
    if (index >= 0) this.children.splice(index, 1)
  }

  private static run(scopeName: string, teardown: Teardown): void {
    try {
      teardown()
    } catch (error) {
      console.error(`Scope ${scopeName}: dispose failed`, error)
    }
  }
}
