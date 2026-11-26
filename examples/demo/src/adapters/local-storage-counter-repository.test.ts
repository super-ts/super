import { beforeEach, describe, expect, test } from 'vitest';
import { createLocalStorageCounterRepository } from './local-storage-counter-repository';

describe('createLocalStorageCounterRepository', () => {
  beforeEach(() => localStorage.clear());

  test('ne retourne rien quand rien n’est stocké', async () => {
    await expect(createLocalStorageCounterRepository().loadAll()).resolves.toEqual({});
  });

  test('relit ce qui a été sauvegardé, sous la clé choisie, sans écraser les autres compteurs', async () => {
    const repository = createLocalStorageCounterRepository({ key: 'test.counters' });

    await repository.save('cafes', 7);
    await repository.save('pompes', 2);

    expect(JSON.parse(localStorage.getItem('test.counters')!)).toEqual({ cafes: 7, pompes: 2 });
    await expect(createLocalStorageCounterRepository({ key: 'test.counters' }).loadAll()).resolves.toEqual({ cafes: 7, pompes: 2 });
  });

  test.each(['abc', '[1]', '{"cafes":"x"}'])('rejette une valeur stockée invalide : %s', async (raw) => {
    localStorage.setItem('super.counters', raw);

    await expect(createLocalStorageCounterRepository().loadAll()).rejects.toThrow(/invalide/);
  });

  test('accepte n’importe quel objet compatible Storage', async () => {
    const memory = new Map<string, string>();
    const repository = createLocalStorageCounterRepository({
      storage: { getItem: (k) => memory.get(k) ?? null, setItem: (k, v) => void memory.set(k, v) },
    });

    await repository.save('cafes', 3);

    expect(memory.get('super.counters')).toBe('{"cafes":3}');
  });
});
