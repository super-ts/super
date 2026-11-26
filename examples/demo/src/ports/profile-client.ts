import type { ProfileInput } from '../domain/profile';

/** Refusals the server can return when saving. */
export type SaveResult = { ok: true; id: string } | { ok: false; reason: 'email-taken' | 'avatar-too-large' };

/**
 * Port (user-land): what the profile store needs to talk to the server.
 * Both methods reject on a network failure.
 */
export interface ProfileClient {
  isEmailAvailable(email: string): Promise<boolean>;
  save(profile: ProfileInput): Promise<SaveResult>;
}
