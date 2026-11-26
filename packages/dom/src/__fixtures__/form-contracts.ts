/**
 * Test contracts for the form tests. The registry is filled by hand: in an app,
 * the Vite plugin takes care of it.
 */
import { type Outcome, SuperContract } from '@super-ts/core';
import { registerContract } from '@super-ts/core/internal';

/** Sign-up: a submit command and an address check. */
export class FormAccountContract extends SuperContract<{
  state: {};
  commands: {
    register(input: Record<string, unknown>): Outcome<{ id: string }, 'email-taken' | 'network'>;
    checkEmail(input: { email: string }): Outcome<{ available: boolean }, 'network'>;
  };
}> {
  constructor() {
    super({ name: 'form-account' });
  }
}

/** A save whose store can crash without a declared reason. */
export class FormCrashyContract extends SuperContract<{
  state: {};
  commands: { save(input: { name: string }): Outcome<void, 'network'> };
}> {
  constructor() {
    super({ name: 'form-crashy' });
  }
}

/** For the type tests: several failure reasons and a check. */
export class FormProfileContract extends SuperContract<{
  state: {};
  commands: {
    save(input: { name: string; plan: string }): Outcome<{ id: string }, 'email-taken' | 'network' | 'rate'>;
    checkEmail(input: { email: string }): Outcome<{ available: boolean }, 'network'>;
  };
}> {
  constructor() {
    super({ name: 'form-profile' });
  }
}

declare module '@super-ts/core' {
  interface Contracts {
    'form-account': FormAccountContract;
    'form-crashy': FormCrashyContract;
    'form-profile': FormProfileContract;
  }
}

registerContract('form-account', () => FormAccountContract);
registerContract('form-crashy', () => FormCrashyContract);
registerContract('form-profile', () => FormProfileContract);
