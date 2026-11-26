import { describe, expect, test } from 'vitest';
import type { ProfileInput } from '../domain/profile';
import { createFakeProfileClient } from './fake-profile-client';

const profile = (overrides: Partial<ProfileInput> = {}): ProfileInput => ({
  name: 'Ada',
  email: 'ada@example.com',
  password: 'longpassword',
  age: null,
  website: '',
  bio: '',
  country: 'FR',
  languages: ['fr'],
  plan: 'free',
  newsletter: false,
  interests: [],
  birthdate: '',
  meetingTime: '',
  color: '#000000',
  volume: 50,
  avatar: null,
  phones: [],
  ...overrides,
});

describe('createFakeProfileClient', () => {
  test('saves a profile and returns an identifier', async () => {
    const client = createFakeProfileClient({ delay: 0 });
    await expect(client.save(profile())).resolves.toEqual({ ok: true, id: 'p1' });
    expect(client.saved).toHaveLength(1);
  });

  test('refuses a taken address and an image that is too large', async () => {
    const client = createFakeProfileClient({ delay: 0, maxAvatarSize: 10 });
    await expect(client.save(profile({ email: 'taken@example.com' }))).resolves.toEqual({ ok: false, reason: 'email-taken' });
    const avatar = new File(['x'.repeat(20)], 'big.png', { type: 'image/png' });
    await expect(client.save(profile({ avatar }))).resolves.toEqual({ ok: false, reason: 'avatar-too-large' });
    expect(await client.isEmailAvailable('taken@example.com')).toBe(false);
    expect(await client.isEmailAvailable('ada@example.com')).toBe(true);
  });

  test('an address containing "offline" simulates a network failure', async () => {
    const client = createFakeProfileClient({ delay: 0 });
    await expect(client.save(profile({ email: 'offline@example.com' }))).rejects.toThrow('Network unavailable');
    await expect(client.isEmailAvailable('offline@example.com')).rejects.toThrow('Network unavailable');
  });
});
