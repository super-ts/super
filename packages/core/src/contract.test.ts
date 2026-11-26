import { type Commands, SuperContract, SuperStore } from '@super-ts/core';
import { compileContract, share } from '@super-ts/core/internal';
import { beforeEach, describe, expect, test } from 'vitest';
import type { CartContract, LinesContract } from './__fixtures__/cart';
import { calls } from './__fixtures__/cart';

class CartStore extends SuperStore<CartContract> implements Commands<CartStore> {
  #seen: number[];

  constructor({ seen = [] }: { seen?: number[] } = {}) {
    super({ contract: 'core-cart', initialState: { items: {}, busy: false } });
    this.#seen = seen;
  }

  add({ sku }: { sku: string }) {
    this.set({ items: { ...this.get().items, [sku]: this.selectors.quantity(sku) + 1 } });
    this.#seen.push(this.selectors.quantity(sku)); // déjà à jour juste après le set
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

/** Remplace `items` par un objet neuf au contenu identique. */
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

describe('sélecteurs de contrat', () => {
  test('les sélecteurs du handle lisent l’état courant, état fourni', async () => {
    const cart = CartStore.create();
    await cart.send('add', { sku: 'a' });
    await cart.send('add', { sku: 'a' });
    await cart.send('add', { sku: 'b' });

    expect(cart.selectors.quantity('a')).toBe(2);
    expect(cart.selectors.quantity('z')).toBe(0);
    expect(cart.selectors.total()).toBe(3);
    expect(cart.selectors.busy()).toBe(false);
  });

  test('le store lit `this.selectors`, qui relisent l’état courant à chaque appel', async () => {
    const seen: number[] = [];
    const store = CartStore.create({ seen });

    await store.send('add', { sku: 'a' });
    await store.send('add', { sku: 'a' });

    expect(seen).toEqual([1, 2]);
    expect(store.selectors.quantity('a')).toBe(2);
  });

  describe('mémoïsation', () => {
    beforeEach(() => {
      calls.n = 0;
    });

    test('même état, pas de recalcul', () => {
      const store = LinesStore.create();

      expect(store.selectors.lines()).toBe(store.selectors.lines());
      expect(calls.n).toBe(1);
    });

    test('un champ que le sélecteur ne lit pas change : pas de recalcul, même référence', async () => {
      const store = LinesStore.create();
      const first = store.selectors.lines();

      await store.send('annotate', { note: 'x' });
      expect(store.selectors.lines()).toBe(first);
      expect(calls.n).toBe(1);
    });

    test('un champ lu change mais le résultat est égal : la référence précédente est gardée', async () => {
      const store = SameItemsStore.create();
      const first = store.selectors.lines();

      await store.send('add', { sku: 'a' }); // nouvel objet items, même contenu : recalcul, même référence
      expect(store.selectors.lines()).toBe(first);
    });

    test('résultat changé : nouvelle référence, les parties inchangées sont reprises', async () => {
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

    test('un sélecteur qui parcourt tout l’état dépend de tout', async () => {
      const store = LinesStore.create();
      store.selectors.everything();

      await store.send('annotate', { note: 'x' });
      store.selectors.everything();
      expect(calls.n).toBe(2);
    });

    test('un sélecteur qui renvoie l’état renvoie l’état, pas le proxy de suivi', () => {
      const store = LinesStore.create();

      expect(store.selectors.raw()).toBe(store.state());
    });

    test('le cache est propre à chaque liste d’arguments', () => {
      const store = LinesStore.create();

      expect(store.selectors.line('a')).toEqual({ sku: 'a', qty: 1 });
      expect(store.selectors.line('b')).toEqual({ sku: 'b', qty: 0 });
      expect(store.selectors.line('a')).toBe(store.selectors.line('a'));
    });

    test('le cache est propre à chaque store', async () => {
      const one = LinesStore.create();
      const two = LinesStore.create();
      await two.send('add', { sku: 'b' });

      one.selectors.lines();
      two.selectors.lines();
      one.selectors.lines();
      expect(calls.n).toBe(2);
    });

    test('`this.selectors` du store passent par le même cache que le handle', async () => {
      const seen: unknown[] = [];
      const store = LinesStore.create({ seen });

      await store.send('touch');
      expect(seen[0]).toBe(seen[1]);
      expect(store.selectors.lines()).toBe(seen[0]);
      expect(calls.n).toBe(1);
    });

    test('l’état est gelé en profondeur : une mutation en place lève une erreur', async () => {
      const store = LinesStore.create();

      await expect(store.send('mutate')).rejects.toThrow(TypeError);
      expect(store.state().items.a).toBe(1);
    });
  });

  describe('share', () => {
    test('une insertion en tête garde les éléments existants', () => {
      const a = { id: 'a' };
      const b = { id: 'b' };
      const previous = [a, b];
      const next = share(previous, [{ id: 'z' }, a, b]) as object[];

      expect(next[1]).toBe(a);
      expect(next[2]).toBe(b);
    });

    test('un tri renvoie le nouveau tableau, avec les mêmes éléments', () => {
      const a = { id: 'a' };
      const b = { id: 'b' };
      const sorted = [b, a];

      expect(share([a, b], sorted)).toBe(sorted);
    });

    test('un résultat figé reste figé après partage', () => {
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

  test('"pending" est un nom de sélecteur réservé', () => {
    type State = { busy: boolean };
    class Reserved extends SuperContract<{ state: State }> {
      constructor() {
        super({ name: 'core-reserved' });
      }
      pending(s: State) {
        return s.busy;
      }
    }

    expect(() => compileContract(Reserved)).toThrow(/"pending" est réservé/);
  });
});
