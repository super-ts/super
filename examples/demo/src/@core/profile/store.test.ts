import { record } from '@super-ts/testing';
import { describe, expect, test } from 'vitest';
import { createFakeProfileClient } from '../../adapters/fake-profile-client';
import type { ProfileInput } from '../../domain/profile';
import { ProfileStore } from './store';

const input = (email: string): ProfileInput => ({
  name: 'Ada',
  email,
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
});

describe('ProfileStore', () => {
  test('save : succès, puis raison email-taken, puis network', async () => {
    const store = ProfileStore.create({ profileClient: createFakeProfileClient({ delay: 0 }) });
    const done = record(store, 'save:done');
    const failed = record(store, 'save:failed');

    await store.send('save', input('ada@example.com'));
    await store.send('save', input('taken@example.com')).catch(() => {});
    await store.send('save', input('offline@example.com')).catch(() => {});

    expect(done.calls.map((c) => c.result)).toEqual([{ id: 'p1' }]);
    expect(failed.calls.map((c) => c.reason)).toEqual(['email-taken', 'network']);
  });

  test('checkEmail renvoie la disponibilité', async () => {
    const store = ProfileStore.create({ profileClient: createFakeProfileClient({ delay: 0 }) });
    const done = record(store, 'checkEmail:done');

    await store.send('checkEmail', { email: 'taken@example.com' });

    expect(done.last).toEqual({ input: { email: 'taken@example.com' }, result: { available: false } });
  });
});
