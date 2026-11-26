/**
 * Contrats d'essai du runtime des stores (`store.test.ts`). Le registre est rempli à la main : dans
 * une app, c'est le plugin Vite qui s'en charge.
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
