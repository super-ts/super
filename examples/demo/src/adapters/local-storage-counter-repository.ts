import type { CounterRepository } from '../ports/counter-repository';

type Options = {
  storage?: Pick<Storage, 'getItem' | 'setItem'>;
  key?: string;
};

/** Adapter (user-land) : persiste les compteurs dans le localStorage, sous une seule clé JSON. */
export function createLocalStorageCounterRepository({
  storage = window.localStorage,
  key = 'super.counters',
}: Options = {}): CounterRepository {
  function read(): Record<string, number> {
    const raw = storage.getItem(key);
    if (raw === null) return {};
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch {
      throw new Error(`Valeur stockée invalide pour "${key}"`);
    }
    const valid =
      typeof parsed === 'object' &&
      parsed !== null &&
      !Array.isArray(parsed) &&
      Object.values(parsed).every((value) => Number.isInteger(value));
    if (!valid) throw new Error(`Valeur stockée invalide pour "${key}"`);
    return parsed as Record<string, number>;
  }

  return {
    async loadAll() {
      return read();
    },
    async save(id, count) {
      storage.setItem(key, JSON.stringify({ ...read(), [id]: count }));
    },
  };
}
