import { type Commands, SuperStore } from '@super-ts/core';
import type { ProfileInput } from '../../domain/profile';
import type { ProfileClient } from '../../ports/profile-client';
import type { ProfileContract } from './contract';

type Deps = { profileClient: ProfileClient };

export class ProfileStore extends SuperStore<ProfileContract> implements Commands<ProfileStore> {
  #client: ProfileClient;

  constructor({ profileClient }: Deps) {
    super({ contract: 'profile', initialState: {} });
    this.#client = profileClient;
  }

  // The store turns the server responses into a command outcome: a result, or a failure reason.
  async save(input: ProfileInput) {
    const result = await this.#client.save(input).catch(() => this.fail('network'));
    if (!result.ok) return this.fail(result.reason); // fail does not return: afterwards, the compiler knows result.ok is true
    return { id: result.id };
  }

  async checkEmail({ email }: { email: string }) {
    const available = await this.#client.isEmailAvailable(email).catch(() => this.fail('network'));
    return { available };
  }
}
