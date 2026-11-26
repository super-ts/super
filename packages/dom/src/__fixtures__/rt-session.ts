/**
 * Test contract for the router guards. The registry is filled by hand: in an app,
 * the Vite plugin takes care of it.
 */
import { SuperContract } from '@super-ts/core';
import { registerContract } from '@super-ts/core/internal';

export type RtSessionState = { user: string | null };

export class RtSessionContract extends SuperContract<{ state: RtSessionState; commands: {} }> {
  constructor() {
    super({ name: 'rt-session' });
  }
  isLoggedIn(s: RtSessionState) {
    return s.user !== null;
  }
}

declare module '@super-ts/core' {
  interface Contracts {
    'rt-session': RtSessionContract;
  }
}

registerContract('rt-session', () => RtSessionContract);
