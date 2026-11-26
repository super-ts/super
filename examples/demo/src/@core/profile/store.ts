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

  // Le store traduit les réponses du serveur en issue de commande : un résultat, ou une raison d'échec.
  async save(input: ProfileInput) {
    const result = await this.#client.save(input).catch(() => this.fail('network'));
    if (!result.ok) return this.fail(result.reason); // fail ne revient pas : ensuite, le compilateur sait que result.ok est vrai
    return { id: result.id };
  }

  async checkEmail({ email }: { email: string }) {
    const available = await this.#client.isEmailAvailable(email).catch(() => this.fail('network'));
    return { available };
  }
}
