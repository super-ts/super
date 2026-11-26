/**
 * Inference tests: checked by `npm run typecheck`. Each `@ts-expect-error`
 * fails the compilation if the expected error disappears.
 */

import { type Commands, type StoreOfContract, SuperContract, SuperStore } from '@super-ts/core';
import { expectTypeOf, test } from 'vitest';
import type { ShopContract } from './__fixtures__/shop.ts';

declare const shop: StoreOfContract<'core-shop'>;

test('a command returns nothing: the contract rejects a response', () => {
  // @ts-expect-error a command returns no data
  class Async extends SuperContract<{ state: {}; commands: { add(): Promise<number> } }> {}
  // @ts-expect-error even synchronous
  class Sync extends SuperContract<{ state: {}; commands: { add(): number } }> {}
  class Ok extends SuperContract<{ state: {}; commands: { add(): void; load(): Promise<void> } }> {}
});

test('send infers the body; its promise carries no data', () => {
  expectTypeOf(shop.send('load')).toEqualTypeOf<Promise<void>>();
  expectTypeOf(shop.send('add', { sku: 'a', qty: 1 })).toEqualTypeOf<Promise<void>>();
  expectTypeOf(shop.send('toggle')).toEqualTypeOf<Promise<void>>();

  // @ts-expect-error unknown command
  void shop.send('remove');
  // @ts-expect-error missing body
  void shop.send('add');
  // @ts-expect-error wrongly typed body
  void shop.send('add', { sku: 'a', qty: '1' });
  // @ts-expect-error extra argument
  void shop.send('load', 1);
});

test('on infers the payload', () => {
  shop.on('added', (payload) => expectTypeOf(payload).toEqualTypeOf<{ sku: string }>());
  // @ts-expect-error unknown event
  shop.on('removed', () => {});
});

test('state is read-only', () => {
  expectTypeOf(shop.state()).toEqualTypeOf<Readonly<{ cart: string[] }>>();
});

test('emit types the payload of each event', () => {
  class Store extends SuperStore<ShopContract> implements Commands<Store> {
    constructor() {
      super({ contract: 'core-shop', initialState: { cart: [] } });
    }
    load() {}
    add({ sku }: { sku: string; qty: number }) {
      // @ts-expect-error wrongly typed event payload
      this.emit('added', { sku: 1 });
      this.emit('added', { sku });
    }
    toggle() {
      this.emit('emptied');
    }
  }
});

test('create type checks the constructor dependencies', () => {
  class Store extends SuperStore<ShopContract> implements Commands<Store> {
    #api: { fetchCart(): Promise<string[]> };

    constructor({ api }: { api: { fetchCart(): Promise<string[]> } }) {
      super({ contract: 'core-shop', initialState: { cart: [] } });
      this.#api = api;
    }
    async load() {
      this.set({ cart: await this.#api.fetchCart() });
    }
    add(_: { sku: string; qty: number }) {}
    toggle() {}
  }

  Store.create({ api: { fetchCart: async () => [] } });
  // @ts-expect-error wrongly typed dependency
  Store.create({ api: { fetchCart: () => 42 } });

  class NoDeps extends SuperStore<ShopContract> implements Commands<NoDeps> {
    constructor() {
      super({ contract: 'core-shop', initialState: { cart: [] } });
    }
    load() {}
    add(_: { sku: string; qty: number }) {}
    toggle() {}
  }
  NoDeps.create();
  // @ts-expect-error a store without dependencies receives none
  NoDeps.create({ api: 1 });
});
