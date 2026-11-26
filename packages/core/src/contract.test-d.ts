/**
 * Tests d'inférence des sélecteurs : vérifiés par `npm run typecheck`. Chaque `@ts-expect-error`
 * échoue la compilation si l'erreur attendue disparaît.
 */

import { type Commands, type StoreOfContract, SuperContract, SuperStore } from '@super-ts/core';
import { expectTypeOf, test } from 'vitest';
import type { CartContract, CartState } from './__fixtures__/cart';

declare const cart: StoreOfContract<'core-cart'>;

test('les sélecteurs sont typés par l’état ; le handle les expose sans le paramètre state', () => {
  expectTypeOf(cart.selectors.quantity('a')).toBeNumber();
  expectTypeOf(cart.selectors.busy()).toBeBoolean();
  // @ts-expect-error paramètre requis
  cart.selectors.quantity();
  // @ts-expect-error sélecteur inconnu
  cart.selectors.nope();

  class Bad extends SuperContract<{ state: CartState }> {
    constructor() {
      super({ name: 'core-bad' });
    }
    nope(s: CartState) {
      // @ts-expect-error un sélecteur ne lit que l'état du contrat
      return s.missing;
    }
  }
});

test('le store reçoit `this.selectors`, typés par le contrat', () => {
  class Store extends SuperStore<CartContract> implements Commands<Store> {
    constructor() {
      super({ contract: 'core-cart', initialState: { items: {}, busy: false } });
    }
    add({ sku }: { sku: string }) {
      expectTypeOf(this.selectors.quantity(sku)).toBeNumber();
      // @ts-expect-error paramètre requis
      this.selectors.quantity();
      // @ts-expect-error sélecteur inconnu
      this.selectors.nope();
    }
  }
});
