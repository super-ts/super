/**
 * Selector inference tests: checked by `npm run typecheck`. Each `@ts-expect-error` fails the
 * compilation if the expected error disappears.
 */

import { type Commands, type StoreOfContract, SuperContract, SuperStore } from '@super-ts/core';
import { expectTypeOf, test } from 'vitest';
import type { CartContract, CartState } from './__fixtures__/cart.ts';

declare const cart: StoreOfContract<'core-cart'>;

test('selectors are typed by the state; the handle exposes them without the state parameter', () => {
  expectTypeOf(cart.selectors.quantity('a')).toBeNumber();
  expectTypeOf(cart.selectors.busy()).toBeBoolean();
  // @ts-expect-error required parameter
  cart.selectors.quantity();
  // @ts-expect-error unknown selector
  cart.selectors.nope();

  class Bad extends SuperContract<{ state: CartState }> {
    constructor() {
      super({ name: 'core-bad' });
    }
    nope(s: CartState) {
      // @ts-expect-error a selector only reads the contract's state
      return s.missing;
    }
  }
});

test('the store receives `this.selectors`, typed by the contract', () => {
  class Store extends SuperStore<CartContract> implements Commands<Store> {
    constructor() {
      super({ contract: 'core-cart', initialState: { items: {}, busy: false } });
    }
    add({ sku }: { sku: string }) {
      expectTypeOf(this.selectors.quantity(sku)).toBeNumber();
      // @ts-expect-error required parameter
      this.selectors.quantity();
      // @ts-expect-error unknown selector
      this.selectors.nope();
    }
  }
});
