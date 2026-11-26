import { CommandFailure, type Commands, SuperStore } from '@super-ts/core';
import { record } from '@super-ts/testing';
import { describe, expect, test } from 'vitest';
import type { CounterContract } from './__fixtures__/counter.ts';
import './__fixtures__/counter.ts';

class CounterStore extends SuperStore<CounterContract> implements Commands<CounterStore> {
  #loading: Promise<void>;

  constructor({ loading }: { loading: Promise<void> }) {
    super({ contract: 'core-counter', initialState: { counts: { cafes: 1 } } });
    this.#loading = loading;
  }

  load() {
    return this.#loading;
  }

  async increment({ id }: { id: string }) {
    if (id === 'inconnu') this.fail('unknown');
    if (id === 'plein') this.fail('storage');
    const count = this.selectors.count(id) + 1;
    this.set((s) => ({ counts: { ...s.counts, [id]: count } }));
    return { count };
  }

  explode() {
    throw new Error('bug');
  }
}

function createStore() {
  let release: () => void = () => {};
  const loading = new Promise<void>((resolve) => (release = resolve));
  return { store: CounterStore.create({ loading }), release: () => release() };
}

describe('cycle de vie des commandes', () => {
  test('une commande réussie émet nom:done, avec son body et son résultat', async () => {
    const { store } = createStore();
    const done = record(store, 'increment:done');

    await store.send('increment', { id: 'cafes' });

    expect(done.calls).toEqual([{ input: { id: 'cafes' }, result: { count: 2 } }]);
  });

  test('fail(raison) émet nom:failed et rejette send avec une CommandFailure', async () => {
    const { store } = createStore();
    const failed = record(store, 'increment:failed');

    await expect(store.send('increment', { id: 'inconnu' })).rejects.toMatchObject({ reason: 'unknown' });
    await expect(store.send('increment', { id: 'plein' })).rejects.toBeInstanceOf(CommandFailure);

    expect(failed.calls).toEqual([
      { input: { id: 'inconnu' }, reason: 'unknown', error: null },
      { input: { id: 'plein' }, reason: 'storage', error: null },
    ]);
  });

  test('une exception inattendue donne la raison "error", avec l’exception jointe', async () => {
    const { store } = createStore();
    const failed = record(store, 'explode:failed');

    await expect(store.send('explode')).rejects.toThrow('bug');

    expect(failed.last).toMatchObject({ input: undefined, reason: 'error', error: { message: 'bug' } });
  });

  test('pending : vrai pendant la commande, pour toutes, une commande ou un body', async () => {
    const { store, release } = createStore();
    expect(store.pending()).toBe(false);

    const loading = store.send('load');
    expect(store.pending()).toBe(true);
    expect(store.pending('load')).toBe(true);
    expect(store.pending('increment')).toBe(false);

    release();
    await loading;
    expect(store.pending()).toBe(false);
  });

  test('pending filtre par body, et les écouteurs de nom:done voient la commande terminée', async () => {
    const { store } = createStore();
    const seen: boolean[] = [];
    store.on('increment:done', () => seen.push(store.pending('increment', { id: 'cafes' })));

    const sending = store.send('increment', { id: 'cafes' });
    expect(store.pending('increment', { id: 'cafes' })).toBe(true);
    expect(store.pending('increment', { id: 'pompes' })).toBe(false);
    await sending;

    expect(seen).toEqual([false]);
  });

  test('les abonnés sont prévenus quand une commande commence et finit', async () => {
    const { store, release } = createStore();
    const pendings: boolean[] = [];
    store.subscribe(() => pendings.push(store.pending('load')));

    const loading = store.send('load');
    await Promise.resolve();
    release();
    await loading;
    await Promise.resolve();

    expect(pendings).toEqual([true, false]);
  });
});
