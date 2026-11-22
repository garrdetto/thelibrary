import { test } from 'node:test'
import assert from 'node:assert/strict'
import { Scope } from '../systems/Scope'

function silenced<T>(run: () => T): T {
  const original = console.error
  console.error = () => {}
  try {
    return run()
  } finally {
    console.error = original
  }
}

test('children are disposed before the parent items, each in reverse order', () => {
  const order: string[] = []
  const root = new Scope('root')
  root.track({ dispose: () => order.push('a') })
  root.defer(() => order.push('b'))
  const child = root.child('child')
  child.track({ dispose: () => order.push('c1') })
  child.defer(() => order.push('c2'))
  root.dispose()
  assert.deepEqual(order, ['c2', 'c1', 'b', 'a'])
  assert.equal(root.disposed, true)
  assert.equal(child.disposed, true)
})

test('dispose is idempotent and track returns the item', () => {
  let count = 0
  const scope = new Scope('once')
  const item = scope.track({ dispose: () => { count++ } })
  assert.equal(scope.size, 1)
  scope.dispose()
  scope.dispose()
  assert.equal(count, 1)
  assert.equal(scope.size, 0)
  assert.ok(item)
})

test('an error in one dispose does not stop the others', () => {
  const order: string[] = []
  const scope = new Scope('errors')
  scope.defer(() => order.push('first'))
  scope.defer(() => { throw new Error('boom') })
  scope.defer(() => order.push('last'))
  silenced(() => scope.dispose())
  assert.deepEqual(order, ['last', 'first'])
})

test('a disposed child detaches from its parent and late items are disposed at once', () => {
  const parent = new Scope('parent')
  const child = parent.child('child')
  child.dispose()
  assert.equal(parent.size, 0)
  let late = 0
  child.defer(() => { late++ })
  assert.equal(late, 1)
})
