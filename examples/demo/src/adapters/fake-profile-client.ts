import type { ProfileInput } from '../domain/profile';
import type { ProfileClient, SaveResult } from '../ports/profile-client';

type Options = {
  /** Simulated server latency, in milliseconds. */
  delay?: number;
  takenEmails?: string[];
  maxAvatarSize?: number;
};

const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Adapter (user-land) that simulates a server, with latency:
 * - an address from `takenEmails` is already taken;
 * - an image larger than `maxAvatarSize` is refused;
 * - an address containing "offline" causes a network failure.
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
      if (offline(email)) throw new Error('Network unavailable');
      return !takenEmails.includes(email.toLowerCase());
    },
    async save(profile): Promise<SaveResult> {
      await wait(delay);
      if (offline(profile.email)) throw new Error('Network unavailable');
      if (takenEmails.includes(profile.email.toLowerCase())) return { ok: false, reason: 'email-taken' };
      if (profile.avatar && profile.avatar.size > maxAvatarSize) return { ok: false, reason: 'avatar-too-large' };
      saved.push(profile);
      return { ok: true, id: `p${saved.length}` };
    },
  };
}
