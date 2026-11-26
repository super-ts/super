import type { ProfileInput } from '../domain/profile';

/** Refus prévus par le serveur à l'enregistrement. */
export type SaveResult = { ok: true; id: string } | { ok: false; reason: 'email-taken' | 'avatar-too-large' };

/**
 * Port (user-land) : ce dont le store de profil a besoin pour parler au serveur.
 * Les deux méthodes rejettent en cas de panne réseau.
 */
export interface ProfileClient {
  isEmailAvailable(email: string): Promise<boolean>;
  save(profile: ProfileInput): Promise<SaveResult>;
}
