/** Test contract for the testing package's tests, registered by hand as the Vite plugin would do. */
import { SuperContract } from '@super-ts/core';
import { registerContract } from '@super-ts/core/internal';

export type TstInboxState = { unread: number };

export type TstInboxTypes = {
  state: TstInboxState;
  commands: { markAllRead(): void; archive(input: { id: string }): void };
  events: { cleared: { marked: number } };
};

export class TstInboxContract extends SuperContract<TstInboxTypes> {
  constructor() {
    super({ name: 'tst-inbox' });
  }
  unread(s: TstInboxState) {
    return s.unread;
  }
}

declare module '@super-ts/core' {
  interface Contracts {
    'tst-inbox': TstInboxContract;
  }
}

registerContract('tst-inbox', () => TstInboxContract);
