/**
 * Tests d'inférence : vérifiés par `npm run typecheck`. Chaque `@ts-expect-error`
 * échoue la compilation si l'erreur attendue disparaît.
 */

import { type Commands, type StoreOfContract, SuperContract, SuperStore } from '@super-ts/core';
import { expectTypeOf, test } from 'vitest';
import type { ShopContract } from './__fixtures__/shop';

declare const shop: StoreOfContract<'core-shop'>;

test('une commande ne renvoie rien : le contrat refuse une réponse', () => {
  // @ts-expect-error une commande ne renvoie pas de donnée
  class Async extends SuperContract<{ state: {}; commands: { add(): Promise<number> } }> {}
  // @ts-expect-error même synchrone
  class Sync extends SuperContract<{ state: {}; commands: { add(): number } }> {}
  class Ok extends SuperContract<{ state: {}; commands: { add(): void; load(): Promise<void> } }> {}
});

test('send infère le body ; sa promesse ne porte aucune donnée', () => {
  expectTypeOf(shop.send('load')).toEqualTypeOf<Promise<void>>();
  expectTypeOf(shop.send('add', { sku: 'a', qty: 1 })).toEqualTypeOf<Promise<void>>();
  expectTypeOf(shop.send('toggle')).toEqualTypeOf<Promise<void>>();

  // @ts-expect-error commande inconnue
  void shop.send('remove');
  // @ts-expect-error body manquant
  void shop.send('add');
  // @ts-expect-error body mal typé
  void shop.send('add', { sku: 'a', qty: '1' });
  // @ts-expect-error argument en trop
  void shop.send('load', 1);
});

test('on infère le payload', () => {
  shop.on('added', (payload) => expectTypeOf(payload).toEqualTypeOf<{ sku: string }>());
  // @ts-expect-error événement inconnu
  shop.on('removed', () => {});
});

test('state est en lecture seule', () => {
  expectTypeOf(shop.state()).toEqualTypeOf<Readonly<{ cart: string[] }>>();
});

test('emit type le payload de chaque événement', () => {
  class Store extends SuperStore<ShopContract> implements Commands<Store> {
    constructor() {
      super({ contract: 'core-shop', initialState: { cart: [] } });
    }
    load() {}
    add({ sku }: { sku: string; qty: number }) {
      // @ts-expect-error payload d'événement mal typé
      this.emit('added', { sku: 1 });
      this.emit('added', { sku });
    }
    toggle() {
      this.emit('emptied');
    }
  }
});

test('create type-checke les dépendances du constructeur', () => {
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
  // @ts-expect-error dépendance mal typée
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
  // @ts-expect-error un store sans dépendance n'en reçoit pas
  NoDeps.create({ api: 1 });
});
