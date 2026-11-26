import { record } from '@super-ts/testing';
import { describe, expect, test } from 'vitest';
import { createInMemoryCounterRepository } from '../../adapters/in-memory-counter-repository';
import { CounterStore } from './store';

// Store testé sans DOM, sur un adapter en mémoire.
describe('CounterStore', () => {
  test('load lit les valeurs persistées', async () => {
    const store = CounterStore.create({ counterRepository: createInMemoryCounterRepository({ cafes: 5 }) });

    await store.send('load');

    expect(store.state()).toMatchObject({ counts: { cafes: 5 }, loadErrorMessage: null });
    expect(store.pending('load')).toBe(false);
    expect(store.selectors.count('pompes')).toBe(0);
  });

  test('increment persiste, met à jour l’état, et Super publie increment:done avec le résultat', async () => {
    const counterRepository = createInMemoryCounterRepository({ cafes: 1 });
    const store = CounterStore.create({ counterRepository });
    const done = record(store, 'increment:done');
    await store.send('load');

    await store.send('increment', { id: 'cafes' });

    expect(store.selectors.count('cafes')).toBe(2);
    expect(counterRepository.stored).toEqual({ cafes: 2 });
    expect(done.calls).toEqual([{ input: { id: 'cafes' }, result: { count: 2 } }]);
  });

  test('les compteurs sont indépendants', async () => {
    const store = CounterStore.create({ counterRepository: createInMemoryCounterRepository({ cafes: 3 }) });
    await store.send('load');

    await store.send('increment', { id: 'pompes' });

    expect(store.state().counts).toEqual({ cafes: 3, pompes: 1 });
  });

  test('decrement refuse de descendre sous 0 : decrement:failed avec la raison below-min', async () => {
    const store = CounterStore.create({ counterRepository: createInMemoryCounterRepository() });
    const failed = record(store, 'decrement:failed');

    await expect(store.send('decrement', { id: 'cafes' })).rejects.toMatchObject({ reason: 'below-min' });

    expect(failed.calls).toEqual([{ input: { id: 'cafes' }, reason: 'below-min', error: null }]);
    expect(store.selectors.canDecrement('cafes')).toBe(false);
  });

  test('un compteur hors catalogue est refusé', async () => {
    const counterRepository = createInMemoryCounterRepository();
    const store = CounterStore.create({ counterRepository });
    const failed = record(store, 'increment:failed');

    await expect(store.send('increment', { id: 'inconnu' })).rejects.toMatchObject({ reason: 'unknown' });

    expect(failed.last).toEqual({ input: { id: 'inconnu' }, reason: 'unknown', error: null });
    expect(counterRepository.stored).toEqual({});
  });

  test('un échec de sauvegarde donne la raison storage et conserve la valeur', async () => {
    const store = CounterStore.create({
      counterRepository: { loadAll: async () => ({ cafes: 3 }), save: async () => Promise.reject(new Error('quota dépassé')) },
    });
    const failed = record(store, 'increment:failed');
    await store.send('load');

    await store.send('increment', { id: 'cafes' }).catch(() => {});

    expect(failed.last).toEqual({ input: { id: 'cafes' }, reason: 'storage', error: null });
    expect(store.state().counts).toEqual({ cafes: 3 });
    expect(store.pending()).toBe(false); // plus rien en cours, même après un échec
  });

  test('un échec de chargement alimente loadErrorMessage', async () => {
    const store = CounterStore.create({
      counterRepository: { loadAll: async () => Promise.reject(new Error('stockage indisponible')), save: async () => {} },
    });

    await store.send('load');

    expect(store.state()).toMatchObject({ loadErrorMessage: 'stockage indisponible' });
  });
});
