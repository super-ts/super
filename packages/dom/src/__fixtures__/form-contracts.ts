/**
 * Contrats d'essai pour les tests de formulaires. Le registre est rempli à la main : dans une app,
 * c'est le plugin Vite qui s'en charge.
 */
import { type Outcome, SuperContract } from '@super-ts/core';
import { registerContract } from '@super-ts/core/internal';

/** Inscription : une commande de soumission et une vérification d'adresse. */
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

/** Une sauvegarde dont le store peut planter sans raison déclarée. */
export class FormCrashyContract extends SuperContract<{
  state: {};
  commands: { save(input: { name: string }): Outcome<void, 'network'> };
}> {
  constructor() {
    super({ name: 'form-crashy' });
  }
}

/** Pour les tests de types : plusieurs raisons d'échec et une vérification. */
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
