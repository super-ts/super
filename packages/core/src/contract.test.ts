import { type Commands, SuperContract, SuperStore } from '@super-ts/core';
import { compileContract, share } from '@super-ts/core/internal';
import { beforeEach, describe, expect, test } from 'vitest';
import type { CartContract, LinesContract } from './__fixtures__/cart.ts';
import { calls } from './__fixtures__/cart.ts';

class CartStore extends SuperStore<CartContract> implements Commands<CartStore> {
  #seen: number[];

  constructor({ seen = [] }: { seen?: number[] } = {}) {
    super({ contract: 'core-cart', initialState: { items: {}, busy: false } });
    this.#seen = seen;
  }

  add({ sku }: { sku: string }) {
    this.set({ items: { ...this.get().items, [sku]: this.selectors.quantity(sku) + 1 } });
    this.#seen.push(this.selectors.quantity(sku)); // already up to date right after the set
  }
}

class LinesStore extends SuperStore<LinesContract> implements Commands<LinesStore> {
  #seen: unknown[];

  constructor({ seen = [] }: { seen?: unknown[] } = {}) {
    super({ contract: 'core-lines', initialState: { items: { a: 1 }, note: '' } });
    this.#seen = seen;
  }

  add({ sku }: { sku: string }) {
    this.set({ items: { ...this.get().items, [sku]: (this.get().items[sku] ?? 0) + 1 } });
  }

  annotate({ note }: { note: string }) {
    this.set({ note });
  }

  touch() {
    this.#seen.push(this.selectors.lines(), this.selectors.lines());
  }

  mutate() {
    this.get().items.a = 2;
  }
}

/** Replaces `items` with a fresh object with identical content. */
class SameItemsStore extends SuperStore<LinesContract> implements Commands<SameItemsStore> {
  constructor() {
    super({ contract: 'core-lines', initialState: { items: { a: 1 }, note: '' } });
  }
  add(_: { sku: string }) {
    this.set({ items: { a: 1 } });
  }
  annotate(_: { note: string }) {}
  touch() {}
  mutate() {}
}

describe('contract selectors', () => {
  test('the handle selectors read the current state, state supplied', async () => {
    const cart = CartStore.create();
    await cart.send('add', { sku: 'a' });
    await cart.send('add', { sku: 'a' });
    await cart.send('add', { sku: 'b' });

    expect(cart.selectors.quantity('a')).toBe(2);
    expect(cart.selectors.quantity('z')).toBe(0);
    expect(cart.selectors.total()).toBe(3);
    expect(cart.selectors.busy()).toBe(false);
  });

  test('the store reads `this.selectors`, which reread the current state at each call', async () => {
    const seen: number[] = [];
    const store = CartStore.create({ seen });

    await store.send('add', { sku: 'a' });
    await store.send('add', { sku: 'a' });

    expect(seen).toEqual([1, 2]);
    expect(store.selectors.quantity('a')).toBe(2);
  });

  describe('memoisation', () => {
    beforeEach(() => {
      calls.n = 0;
    });

    test('same state, no recomputation', () => {
      const store = LinesStore.create();

      expect(store.selectors.lines()).toBe(store.selectors.lines());
      expect(calls.n).toBe(1);
    });

    test('a field the selector does not read changes: no recomputation, same reference', async () => {
      const store = LinesStore.create();
      const first = store.selectors.lines();

      await store.send('annotate', { note: 'x' });
      expect(store.selectors.lines()).toBe(first);
      expect(calls.n).toBe(1);
    });

    test('a field read changes but the result is equal: the previous reference is kept', async () => {
      const store = SameItemsStore.create();
      const first = store.selectors.lines();

      await store.send('add', { sku: 'a' }); // new items object, same content: recomputation, same reference
      expect(store.selectors.lines()).toBe(first);
    });

    test('result changed: new reference, the unchanged parts are reused', async () => {
      const store = LinesStore.create();
      const first = store.selectors.lines();

      await store.send('add', { sku: 'b' });
      const second = store.selectors.lines();
      expect(second).not.toBe(first);
      expect(second).toEqual([
        { sku: 'a', qty: 1 },
        { sku: 'b', qty: 1 },
      ]);
      expect(second[0]).toBe(first[0]);
    });

    test('a selector that walks the whole state depends on everything', async () => {
      const store = LinesStore.create();
      store.selectors.everything();

      await store.send('annotate', { note: 'x' });
      store.selectors.everything();
      expect(calls.n).toBe(2);
    });

    test('a selector that returns the state returns the state, not the tracking proxy', () => {
      const store = LinesStore.create();

      expect(store.selectors.raw()).toBe(store.state());
    });

    test('the cache is specific to each argument list', () => {
      const store = LinesStore.create();

      expect(store.selectors.line('a')).toEqual({ sku: 'a', qty: 1 });
      expect(store.selectors.line('b')).toEqual({ sku: 'b', qty: 0 });
      expect(store.selectors.line('a')).toBe(store.selectors.line('a'));
    });

    test('the cache is specific to each store', async () => {
      const one = LinesStore.create();
      const two = LinesStore.create();
      await two.send('add', { sku: 'b' });

      one.selectors.lines();
      two.selectors.lines();
      one.selectors.lines();
      expect(calls.n).toBe(2);
    });

    test('the store `this.selectors` go through the same cache as the handle', async () => {
      const seen: unknown[] = [];
      const store = LinesStore.create({ seen });

      await store.send('touch');
      expect(seen[0]).toBe(seen[1]);
      expect(store.selectors.lines()).toBe(seen[0]);
      expect(calls.n).toBe(1);
    });

    test('the state is deeply frozen: an in-place mutation throws an error', async () => {
      const store = LinesStore.create();

      await expect(store.send('mutate')).rejects.toThrow(TypeError);
      expect(store.state().items.a).toBe(1);
    });
  });

  describe('share', () => {
    test('an insertion at the head keeps the existing elements', () => {
      const a = { id: 'a' };
      const b = { id: 'b' };
      const previous = [a, b];
      const next = share(previous, [{ id: 'z' }, a, b]) as object[];

      expect(next[1]).toBe(a);
      expect(next[2]).toBe(b);
    });

    test('a sort returns the new array, with the same elements', () => {
      const a = { id: 'a' };
      const b = { id: 'b' };
      const sorted = [b, a];

      expect(share([a, b], sorted)).toBe(sorted);
    });

    test('a frozen result stays frozen after sharing', () => {
      const kept = { id: 'a', tags: ['x'] };
      const next = share(
        [kept],
        Object.freeze([
          { id: 'a', tags: ['x'] },
          { id: 'b', tags: [] },
        ]),
      );

      expect(Object.isFrozen(next)).toBe(true);
      expect((next as object[])[0]).toBe(kept);
    });
  });

  test('"pending" is a reserved selector name', () => {
    type State = { busy: boolean };
    class Reserved extends SuperContract<{ state: State }> {
      constructor() {
        super({ name: 'core-reserved' });
      }
      pending(s: State) {
        return s.busy;
      }
    }

    expect(() => compileContract(Reserved)).toThrow(/"pending" is reserved/);
  });
});
