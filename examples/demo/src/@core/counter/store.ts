import { type Commands, SuperStore } from '@super-ts/core';
import { MIN_COUNT } from '../../domain/counter';
import type { CounterRepository } from '../../ports/counter-repository';
import type { CounterContract } from './contract';

/** Dependencies are whatever you want: Super never inspects them. */
type Deps = { counterRepository: CounterRepository };

const message = (error: unknown) => (error instanceof Error ? error.message : String(error));

// No "pending" flag and no event to emit: Super tracks each command and publishes its
// outcome. The handler does its work, fails with `this.fail(reason)`, or returns its result.
export class CounterStore extends SuperStore<CounterContract> implements Commands<CounterStore> {
  #repository: CounterRepository;

  constructor({ counterRepository }: Deps) {
    super({ contract: 'counter', initialState: { counts: {}, loadErrorMessage: null } });
    this.#repository = counterRepository;
  }

  // The load error stays in the state: it must remain visible, even for a screen mounted later.
  async load() {
    this.set({ loadErrorMessage: null });
    try {
      this.set({ counts: await this.#repository.loadAll() });
    } catch (error) {
      this.set({ loadErrorMessage: message(error) });
    }
  }

  increment({ id }: { id: string }) {
    return this.#write(id, this.selectors.count(id) + 1);
  }

  decrement({ id }: { id: string }) {
    if (this.selectors.find(id) && this.selectors.count(id) <= MIN_COUNT) this.fail('below-min');
    return this.#write(id, this.selectors.count(id) - 1);
  }

  reset({ id }: { id: string }) {
    return this.#write(id, MIN_COUNT);
  }

  /** The code shared by the three writes: a private method, not a command. */
  async #write(id: string, next: number) {
    if (!this.selectors.find(id)) this.fail('unknown');
    await this.#repository.save(id, next).catch(() => this.fail('storage'));
    this.set((s) => ({ counts: { ...s.counts, [id]: next } }));
    return { count: next };
  }
}
