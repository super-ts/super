import { type Outcome, SuperContract } from '@super-ts/core';
import { COUNTERS, MIN_COUNT } from '../../domain/counter';

export type CounterState = {
  counts: Readonly<Record<string, number>>;
  loadErrorMessage: string | null;
};

export type CounterTypes = {
  state: CounterState;
  // component -> store: the parameter is the body. Nothing comes back to the caller:
  // Super publishes the outcome (`increment:done` with the result, `increment:failed` with the reason).
  commands: {
    load(): void;
    increment(input: { id: string }): Outcome<{ count: number }, 'unknown' | 'storage'>;
    decrement(input: { id: string }): Outcome<{ count: number }, 'unknown' | 'below-min' | 'storage'>;
    reset(input: { id: string }): Outcome<{ count: number }, 'unknown' | 'storage'>;
  };
};

// The only allowed reads of the state. A component reads through these (plus `pending`, provided by Super).
export class CounterContract extends SuperContract<CounterTypes> {
  constructor() {
    super({ name: 'counter' });
  }

  catalog(_s: CounterState) {
    return COUNTERS;
  }
  find(_s: CounterState, id: string) {
    return COUNTERS.find((counter) => counter.id === id) ?? null;
  }
  count(s: CounterState, id: string) {
    return s.counts[id] ?? 0;
  }
  label(_s: CounterState, id: string) {
    return COUNTERS.find((counter) => counter.id === id)?.label ?? null;
  }
  loadErrorMessage(s: CounterState) {
    return s.loadErrorMessage;
  }
  canDecrement(s: CounterState, id: string) {
    return (s.counts[id] ?? 0) > MIN_COUNT;
  }
}
