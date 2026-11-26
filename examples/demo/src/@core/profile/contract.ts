import { type Outcome, SuperContract } from '@super-ts/core';
import type { ProfileInput } from '../../domain/profile';

// Ce store n'a pas d'état : il fait l'intermédiaire avec le serveur. Ses commandes et leur cycle de vie
// (en cours, réussie, échouée) suffisent au formulaire.
export class ProfileContract extends SuperContract<{
  state: {};
  commands: {
    // La soumission du formulaire : son issue alimente « en cours » et les erreurs du serveur.
    save(input: ProfileInput): Outcome<{ id: string }, 'email-taken' | 'avatar-too-large' | 'network'>;
    // La vérification asynchrone de l'adresse, pendant la saisie.
    checkEmail(input: { email: string }): Outcome<{ available: boolean }, 'network'>;
  };
}> {
  constructor() {
    super({ name: 'profile' });
  }
}
