/**
 * Test contracts for the store runtime (`store.test.ts`). The registry is filled by hand: in an app,
 * the Vite plugin takes care of it.
 */
import { SuperContract } from '@super-ts/core';
import { registerContract } from '@super-ts/core/internal';

export type TodosState = { items: string[]; filter: 'all' | 'done' };

export class TodosContract extends SuperContract<{
  state: TodosState;
  commands: {
    add(input: { label: string }): void;
    clear(): void;
    explode(): void;
  };
  events: { added: { label: string }; cleared: void };
}> {
  constructor() {
    super({ name: 'core-todos' });
  }
}

export class StatsContract extends SuperContract<{ state: { added: number } }> {
  constructor() {
    super({ name: 'core-stats' });
  }
}

export class WatcherContract extends SuperContract<{ state: {}; commands: { add(label: string): void } }> {
  constructor() {
    super({ name: 'core-watcher' });
  }
}

declare module '@super-ts/core' {
  interface Contracts {
    'core-todos': TodosContract;
    'core-stats': StatsContract;
    'core-watcher': WatcherContract;
  }
}

registerContract('core-todos', () => TodosContract);
registerContract('core-stats', () => StatsContract);
registerContract('core-watcher', () => WatcherContract);
