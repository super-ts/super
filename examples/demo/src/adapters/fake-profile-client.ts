import type { ProfileInput } from '../domain/profile';
import type { ProfileClient, SaveResult } from '../ports/profile-client';

type Options = {
  /** Latence simulée du serveur, en millisecondes. */
  delay?: number;
  takenEmails?: string[];
  maxAvatarSize?: number;
};

const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Adapter (user-land) qui simule un serveur, avec de la latence :
 * - une adresse de `takenEmails` est déjà prise ;
 * - une image plus lourde que `maxAvatarSize` est refusée ;
 * - une adresse qui contient « offline » provoque une panne réseau.
 */
export function createFakeProfileClient({
  delay = 600,
  takenEmails = ['taken@example.com'],
  maxAvatarSize = 1_000_000,
}: Options = {}): ProfileClient & { saved: ProfileInput[] } {
  const saved: ProfileInput[] = [];
  const offline = (email: string) => email.includes('offline');

  return {
    saved,
    async isEmailAvailable(email) {
      await wait(delay / 2);
      if (offline(email)) throw new Error('Réseau indisponible');
      return !takenEmails.includes(email.toLowerCase());
    },
    async save(profile): Promise<SaveResult> {
      await wait(delay);
      if (offline(profile.email)) throw new Error('Réseau indisponible');
      if (takenEmails.includes(profile.email.toLowerCase())) return { ok: false, reason: 'email-taken' };
      if (profile.avatar && profile.avatar.size > maxAvatarSize) return { ok: false, reason: 'avatar-too-large' };
      saved.push(profile);
      return { ok: true, id: `p${saved.length}` };
    },
  };
}
