/**
 * Command lifecycle inference tests: checked by `npm run typecheck`. Each `@ts-expect-error` fails
 * the compilation if the expected error disappears.
 */

import { type Commands, type StoreOfContract, SuperContract, SuperStore } from '@super-ts/core';
import { expectTypeOf, test } from 'vitest';
import type { ShelfContract } from './__fixtures__/counter.ts';

declare const cart: StoreOfContract<'core-shelf'>;

test('the contract: a command has at most one parameter', () => {
  // @ts-expect-error two parameters: a command has only one body
  class Bad extends SuperContract<{ state: {}; commands: { add(a: number, b: number): void } }> {}
});

test('lifecycle events are typed by the contract', () => {
  cart.on('add:done', ({ input, result }) => {
    expectTypeOf(input).toEqualTypeOf<{ sku: string }>();
    expectTypeOf(result).toEqualTypeOf<{ total: number }>();
  });
  cart.on('add:failed', ({ reason, error }) => {
    expectTypeOf(reason).toEqualTypeOf<'out-of-stock' | 'error'>();
    expectTypeOf(error).toEqualTypeOf<Error | null>();
  });
  cart.on('clear:failed', ({ reason }) => expectTypeOf(reason).toEqualTypeOf<'error'>());
  // @ts-expect-error unknown command
  cart.on('remove:done', () => {});
  expectTypeOf(cart.pending('add', { sku: 'a' })).toBeBoolean();
  // @ts-expect-error field missing from the body
  cart.pending('add', { id: 'a' });
});

test('the handler: fail typed by the declared reasons, result required', () => {
  class Ok extends SuperStore<ShelfContract> implements Commands<Ok> {
    constructor() {
      super({ contract: 'core-shelf', initialState: { items: [] } });
    }
    add({ sku }: { sku: string }) {
      if (sku === '') this.fail('out-of-stock');
      this.set({ items: [...this.get().items, sku] });
      return { total: this.get().items.length };
    }
    clear() {
      this.set({ items: [] });
    }
  }

  class NoResult extends SuperStore<ShelfContract> implements Commands<NoResult> {
    constructor() {
      super({ contract: 'core-shelf', initialState: { items: [] } });
    }
    // @ts-expect-error add must return { total }
    add(_: { sku: string }) {}
    clear() {}
  }
});
