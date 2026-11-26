/**
 * Tests d'inférence du cycle de vie des commandes : vérifiés par `npm run typecheck`. Chaque
 * `@ts-expect-error` échoue la compilation si l'erreur attendue disparaît.
 */

import { type Commands, type StoreOfContract, SuperContract, SuperStore } from '@super-ts/core';
import { expectTypeOf, test } from 'vitest';
import type { ShelfContract } from './__fixtures__/counter.ts';

declare const cart: StoreOfContract<'core-shelf'>;

test('le contrat : une commande a au plus un paramètre', () => {
  // @ts-expect-error deux paramètres : une commande n'a qu'un body
  class Bad extends SuperContract<{ state: {}; commands: { add(a: number, b: number): void } }> {}
});

test('les événements de cycle de vie sont typés par le contrat', () => {
  cart.on('add:done', ({ input, result }) => {
    expectTypeOf(input).toEqualTypeOf<{ sku: string }>();
    expectTypeOf(result).toEqualTypeOf<{ total: number }>();
  });
  cart.on('add:failed', ({ reason, error }) => {
    expectTypeOf(reason).toEqualTypeOf<'out-of-stock' | 'error'>();
    expectTypeOf(error).toEqualTypeOf<Error | null>();
  });
  cart.on('clear:failed', ({ reason }) => expectTypeOf(reason).toEqualTypeOf<'error'>());
  // @ts-expect-error commande inconnue
  cart.on('remove:done', () => {});
  expectTypeOf(cart.pending('add', { sku: 'a' })).toBeBoolean();
  // @ts-expect-error champ absent du body
  cart.pending('add', { id: 'a' });
});

test('le handler : fail typé par les raisons déclarées, résultat obligatoire', () => {
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
    // @ts-expect-error add doit renvoyer { total }
    add(_: { sku: string }) {}
    clear() {}
  }
});
