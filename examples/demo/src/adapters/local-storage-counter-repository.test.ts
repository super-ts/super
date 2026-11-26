import { beforeEach, describe, expect, test } from 'vitest';
import { createLocalStorageCounterRepository } from './local-storage-counter-repository';

describe('createLocalStorageCounterRepository', () => {
  beforeEach(() => localStorage.clear());

  test('returns nothing when nothing is stored', async () => {
    await expect(createLocalStorageCounterRepository().loadAll()).resolves.toEqual({});
  });

  test('reads back what was saved, under the chosen key, without overwriting the other counters', async () => {
    const repository = createLocalStorageCounterRepository({ key: 'test.counters' });

    await repository.save('coffees', 7);
    await repository.save('pushups', 2);

    expect(JSON.parse(localStorage.getItem('test.counters')!)).toEqual({ coffees: 7, pushups: 2 });
    await expect(createLocalStorageCounterRepository({ key: 'test.counters' }).loadAll()).resolves.toEqual({ coffees: 7, pushups: 2 });
  });

  test.each(['abc', '[1]', '{"coffees":"x"}'])('rejects an invalid stored value: %s', async (raw) => {
    localStorage.setItem('super.counters', raw);

    await expect(createLocalStorageCounterRepository().loadAll()).rejects.toThrow(/Invalid/);
  });

  test('accepts any Storage-compatible object', async () => {
    const memory = new Map<string, string>();
    const repository = createLocalStorageCounterRepository({
      storage: { getItem: (k) => memory.get(k) ?? null, setItem: (k, v) => void memory.set(k, v) },
    });

    await repository.save('coffees', 3);

    expect(memory.get('super.counters')).toBe('{"coffees":3}');
  });
});
