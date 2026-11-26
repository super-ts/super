import { type StoreOfContract, SuperStore } from '@super-ts/core';
import { describe, expect, test } from 'vitest';
import type { BasketContract } from './__fixtures__/basket';
import './__fixtures__/basket';
import type { Commands } from './classes';

type Backend = { save(id: string, count: number): Promise<boolean> };

class BasketStore extends SuperStore<BasketContract> implements Commands<BasketStore> {
  #backend: Backend;

  constructor({ backend }: { backend: Backend }) {
    super({ contract: 'basket', initialState: { items: {} } });
    this.#backend = backend;
  }

  add({ sku }: { sku: string }) {
    this.#increment(sku);
  }

  clear() {
    if (this.selectors.count() === 0) return;
    this.set({ items: {} });
    this.emit('emptied');
  }

  async save({ id }: { id: string }) {
    const count = this.selectors.count();
    if (count === 0) return this.fail('empty');
    if (!(await this.#backend.save(id, count))) return this.fail('offline');
    this.emit('saved', { id });
    return { count };
  }

  #increment(sku: string) {
    this.set({ items: { ...this.get().items, [sku]: this.selectors.quantity(sku) + 1 } });
  }
}

const backend = (ok = true): Backend => ({ save: async () => ok });

describe('SuperStore', () => {
  test('create renvoie le handle : commandes, sélecteurs, état', async () => {
    const basket = BasketStore.create({ backend: backend() });
    await basket.send('add', { sku: 'mug' });
    await basket.send('add', { sku: 'mug' });

    expect(basket.selectors.quantity('mug')).toBe(2);
    expect(basket.selectors.count()).toBe(2);
    expect(basket.state()).toEqual({ items: { mug: 2 } });
    expect(basket.contract.name).toBe('basket');
    expect('add' in basket).toBe(false); // l'instance ne sort pas du store
  });

  test('les helpers #privés ne sont pas des commandes', async () => {
    const basket = BasketStore.create({ backend: backend() });
    const send = basket.send.bind(basket) as (name: string) => Promise<void>;
    await expect(send('increment')).rejects.toThrow('commande inconnue "increment"');
  });

  test('emit publie les événements du contrat', async () => {
    const basket = BasketStore.create({ backend: backend() });
    const emptied: unknown[] = [];
    basket.on('emptied', () => emptied.push(true));
    await basket.send('add', { sku: 'mug' });
    await basket.send('clear');
    await basket.send('clear');
    expect(emptied).toHaveLength(1);
  });

  test('le résultat est publié dans :done, fail dans :failed avec sa raison', async () => {
    const basket = BasketStore.create({ backend: backend(false) });
    const failed: string[] = [];
    basket.on('save:failed', ({ reason }) => failed.push(reason));
    await basket.send('save', { id: 'a' }).catch(() => {});
    await basket.send('add', { sku: 'mug' });
    await basket.send('save', { id: 'b' }).catch(() => {});
    expect(failed).toEqual(['empty', 'offline']);

    const ok = BasketStore.create({ backend: backend() });
    const done: unknown[] = [];
    ok.on('save:done', ({ result }) => done.push(result));
    await ok.send('add', { sku: 'mug' });
    await ok.send('save', { id: 'c' });
    expect(done).toEqual([{ count: 1 }]);
  });

  test('pending suit les commandes en cours', async () => {
    let release!: (ok: boolean) => void;
    const slow: Backend = { save: () => new Promise((resolve) => (release = resolve)) };
    const basket = BasketStore.create({ backend: slow });
    await basket.send('add', { sku: 'mug' });
    const saving = basket.send('save', { id: 'a' });
    await Promise.resolve();
    expect(basket.selectors.pending('save')).toBe(true);
    release(true);
    await saving;
    expect(basket.selectors.pending('save')).toBe(false);
  });

  test('un contrat inconnu est signalé à la création', () => {
    class Orphan extends SuperStore<BasketContract> {
      constructor() {
        super({ contract: 'nope' as 'basket', initialState: { items: {} } });
      }
    }
    expect(() => Orphan.create()).toThrow('aucun contrat nommé "nope"');
  });

  test('un store lit son état après sa création, pas dans son constructeur', () => {
    class Eager extends SuperStore<BasketContract> {
      constructor() {
        super({ contract: 'basket', initialState: { items: {} } });
        this.get();
      }
    }
    expect(() => Eager.create()).toThrow('constructeur');
  });

  test('un store reçu en dépendance s’arrête d’écouter au dispose()', async () => {
    const basket = BasketStore.create({ backend: backend() });

    class Watcher extends SuperStore<BasketContract> {
      constructor({ basket }: { basket: StoreOfContract<'basket'> }) {
        super({ contract: 'basket', initialState: { items: {} } });
        basket.on('add:done', () => seen.push(basket.selectors.count()));
      }
    }
    const seen: number[] = [];
    const watcher = Watcher.create({ basket });
    await basket.send('add', { sku: 'mug' });
    watcher.dispose();
    await basket.send('add', { sku: 'mug' });
    expect(seen).toEqual([1]);
  });
});
