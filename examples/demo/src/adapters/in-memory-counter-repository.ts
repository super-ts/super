import type { CounterRepository } from '../ports/counter-repository';

/** Adapter (user-land) en mémoire : pratique pour les tests et les démos sans persistance. */
export function createInMemoryCounterRepository(
  initial: Record<string, number> = {},
): CounterRepository & { stored: Record<string, number> } {
  return {
    stored: { ...initial },
    async loadAll() {
      return { ...this.stored };
    },
    async save(id, count) {
      this.stored = { ...this.stored, [id]: count };
    },
  };
}
