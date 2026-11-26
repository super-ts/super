import { type Outcome, SuperContract } from '@super-ts/core';
import { COUNTERS, MIN_COUNT } from '../../domain/counter';

export type CounterState = {
  counts: Readonly<Record<string, number>>;
  loadErrorMessage: string | null;
};

export type CounterTypes = {
  state: CounterState;
  // composant -> store : le paramètre est le body. Rien ne revient à l'appelant :
  // Super publie l'issue (`increment:done` avec le résultat, `increment:failed` avec la raison).
  commands: {
    load(): void;
    increment(input: { id: string }): Outcome<{ count: number }, 'unknown' | 'storage'>;
    decrement(input: { id: string }): Outcome<{ count: number }, 'unknown' | 'below-min' | 'storage'>;
    reset(input: { id: string }): Outcome<{ count: number }, 'unknown' | 'storage'>;
  };
};

// Les seules lectures autorisées de l'état. Un composant lit par là (plus `pending`, fourni par Super).
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
