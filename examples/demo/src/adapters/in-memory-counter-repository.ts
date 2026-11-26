import type { CounterRepository } from '../ports/counter-repository';

/** In-memory adapter (user-land): handy for tests and demos without persistence. */
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
