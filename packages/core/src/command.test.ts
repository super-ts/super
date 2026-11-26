import { CommandFailure, type Commands, SuperStore } from '@super-ts/core';
import { record } from '@super-ts/testing';
import { describe, expect, test } from 'vitest';
import type { CounterContract } from './__fixtures__/counter.ts';
import './__fixtures__/counter.ts';

class CounterStore extends SuperStore<CounterContract> implements Commands<CounterStore> {
  #loading: Promise<void>;

  constructor({ loading }: { loading: Promise<void> }) {
    super({ contract: 'core-counter', initialState: { counts: { coffees: 1 } } });
    this.#loading = loading;
  }

  load() {
    return this.#loading;
  }

  async increment({ id }: { id: string }) {
    if (id === 'unknown') this.fail('unknown');
    if (id === 'full') this.fail('storage');
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

describe('command lifecycle', () => {
  test('a successful command emits name:done, with its body and its result', async () => {
    const { store } = createStore();
    const done = record(store, 'increment:done');

    await store.send('increment', { id: 'coffees' });

    expect(done.calls).toEqual([{ input: { id: 'coffees' }, result: { count: 2 } }]);
  });

  test('fail(reason) emits name:failed and rejects send with a CommandFailure', async () => {
    const { store } = createStore();
    const failed = record(store, 'increment:failed');

    await expect(store.send('increment', { id: 'unknown' })).rejects.toMatchObject({ reason: 'unknown' });
    await expect(store.send('increment', { id: 'full' })).rejects.toBeInstanceOf(CommandFailure);

    expect(failed.calls).toEqual([
      { input: { id: 'unknown' }, reason: 'unknown', error: null },
      { input: { id: 'full' }, reason: 'storage', error: null },
    ]);
  });

  test('an unexpected exception gives the reason "error", with the exception attached', async () => {
    const { store } = createStore();
    const failed = record(store, 'explode:failed');

    await expect(store.send('explode')).rejects.toThrow('bug');

    expect(failed.last).toMatchObject({ input: undefined, reason: 'error', error: { message: 'bug' } });
  });

  test('pending: true during the command, for all, one command or one body', async () => {
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

  test('pending filters by body, and name:done listeners see the command finished', async () => {
    const { store } = createStore();
    const seen: boolean[] = [];
    store.on('increment:done', () => seen.push(store.pending('increment', { id: 'coffees' })));

    const sending = store.send('increment', { id: 'coffees' });
    expect(store.pending('increment', { id: 'coffees' })).toBe(true);
    expect(store.pending('increment', { id: 'pushups' })).toBe(false);
    await sending;

    expect(seen).toEqual([false]);
  });

  test('subscribers are notified when a command starts and finishes', async () => {
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
