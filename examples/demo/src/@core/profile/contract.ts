import { type Outcome, SuperContract } from '@super-ts/core';
import type { ProfileInput } from '../../domain/profile';

// This store has no state: it acts as the go-between with the server. Its commands and their lifecycle
// (pending, succeeded, failed) are enough for the form.
export class ProfileContract extends SuperContract<{
  state: {};
  commands: {
    // The form submission: its outcome feeds "pending" and the server errors.
    save(input: ProfileInput): Outcome<{ id: string }, 'email-taken' | 'avatar-too-large' | 'network'>;
    // The asynchronous check of the address, while typing.
    checkEmail(input: { email: string }): Outcome<{ available: boolean }, 'network'>;
  };
}> {
  constructor() {
    super({ name: 'profile' });
  }
}
