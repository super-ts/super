/**
 * Test contracts for the command lifecycle (`command.test.ts`, `command.test-d.ts`). The registry is
 * filled by hand: in an app, the Vite plugin takes care of it.
 */
import { type Outcome, SuperContract } from '@super-ts/core';
import { registerContract } from '@super-ts/core/internal';

export type CounterState = { counts: Record<string, number> };

export class CounterContract extends SuperContract<{
  state: CounterState;
  commands: {
    load(): void;
    increment(input: { id: string }): Outcome<{ count: number }, 'unknown' | 'storage'>;
    explode(): void;
  };
}> {
  constructor() {
    super({ name: 'core-counter' });
  }
  count(s: CounterState, id: string) {
    return s.counts[id] ?? 0;
  }
}

export type ShelfState = { items: string[] };

export class ShelfContract extends SuperContract<{
  state: ShelfState;
  commands: {
    add(input: { sku: string }): Outcome<{ total: number }, 'out-of-stock'>;
    clear(): void;
  };
}> {
  constructor() {
    super({ name: 'core-shelf' });
  }
}

declare module '@super-ts/core' {
  interface Contracts {
    'core-counter': CounterContract;
    'core-shelf': ShelfContract;
  }
}

registerContract('core-counter', () => CounterContract);
registerContract('core-shelf', () => ShelfContract);
