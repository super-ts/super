import { record } from '@super-ts/testing';
import { describe, expect, test } from 'vitest';
import { createInMemoryCounterRepository } from '../../adapters/in-memory-counter-repository';
import { CounterStore } from './store';

// Store tested without a DOM, on an in-memory adapter.
describe('CounterStore', () => {
  test('load reads the persisted values', async () => {
    const store = CounterStore.create({ counterRepository: createInMemoryCounterRepository({ coffees: 5 }) });

    await store.send('load');

    expect(store.state()).toMatchObject({ counts: { coffees: 5 }, loadErrorMessage: null });
    expect(store.pending('load')).toBe(false);
    expect(store.selectors.count('pushups')).toBe(0);
  });

  test('increment persists, updates the state, and Super publishes increment:done with the result', async () => {
    const counterRepository = createInMemoryCounterRepository({ coffees: 1 });
    const store = CounterStore.create({ counterRepository });
    const done = record(store, 'increment:done');
    await store.send('load');

    await store.send('increment', { id: 'coffees' });

    expect(store.selectors.count('coffees')).toBe(2);
    expect(counterRepository.stored).toEqual({ coffees: 2 });
    expect(done.calls).toEqual([{ input: { id: 'coffees' }, result: { count: 2 } }]);
  });

  test('counters are independent', async () => {
    const store = CounterStore.create({ counterRepository: createInMemoryCounterRepository({ coffees: 3 }) });
    await store.send('load');

    await store.send('increment', { id: 'pushups' });

    expect(store.state().counts).toEqual({ coffees: 3, pushups: 1 });
  });

  test('decrement refuses to go below 0: decrement:failed with the reason below-min', async () => {
    const store = CounterStore.create({ counterRepository: createInMemoryCounterRepository() });
    const failed = record(store, 'decrement:failed');

    await expect(store.send('decrement', { id: 'coffees' })).rejects.toMatchObject({ reason: 'below-min' });

    expect(failed.calls).toEqual([{ input: { id: 'coffees' }, reason: 'below-min', error: null }]);
    expect(store.selectors.canDecrement('coffees')).toBe(false);
  });

  test('a counter outside the catalogue is refused', async () => {
    const counterRepository = createInMemoryCounterRepository();
    const store = CounterStore.create({ counterRepository });
    const failed = record(store, 'increment:failed');

    await expect(store.send('increment', { id: 'unknown-id' })).rejects.toMatchObject({ reason: 'unknown' });

    expect(failed.last).toEqual({ input: { id: 'unknown-id' }, reason: 'unknown', error: null });
    expect(counterRepository.stored).toEqual({});
  });

  test('a save failure gives the reason storage and keeps the value', async () => {
    const store = CounterStore.create({
      counterRepository: { loadAll: async () => ({ coffees: 3 }), save: async () => Promise.reject(new Error('quota exceeded')) },
    });
    const failed = record(store, 'increment:failed');
    await store.send('load');

    await store.send('increment', { id: 'coffees' }).catch(() => {});

    expect(failed.last).toEqual({ input: { id: 'coffees' }, reason: 'storage', error: null });
    expect(store.state().counts).toEqual({ coffees: 3 });
    expect(store.pending()).toBe(false); // nothing pending any more, even after a failure
  });

  test('a load failure feeds loadErrorMessage', async () => {
    const store = CounterStore.create({
      counterRepository: { loadAll: async () => Promise.reject(new Error('storage unavailable')), save: async () => {} },
    });

    await store.send('load');

    expect(store.state()).toMatchObject({ loadErrorMessage: 'storage unavailable' });
  });
});
