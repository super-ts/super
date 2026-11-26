/**
 * Contrat d'essai pour les guards du router. Le registre est rempli à la main : dans une app,
 * c'est le plugin Vite qui s'en charge.
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
