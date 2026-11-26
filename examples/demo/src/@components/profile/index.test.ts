import { flush, mount } from '@super-ts/testing';
import { ProfileStore } from '@core/profile/store';
import { within } from '@testing-library/dom';
import userEvent from '@testing-library/user-event';
import { describe, expect, test } from 'vitest';
import { createFakeProfileClient } from '../../adapters/fake-profile-client';
import { ProfileScreen } from '.';

async function setup() {
  const profileClient = createFakeProfileClient({ delay: 0, maxAvatarSize: 10 });
  const store = ProfileStore.create({ profileClient });
  const { container } = await mount(ProfileScreen, { stores: [store] });
  return { profileClient, ui: within(container), container };
}

async function fillValid(ui: ReturnType<typeof within>, email = 'ada@example.com') {
  await userEvent.type(ui.getByLabelText('Name'), 'Ada');
  await userEvent.type(ui.getByLabelText('Email'), email);
  await userEvent.type(ui.getByLabelText('Password'), 'longpassword');
  await userEvent.type(ui.getByLabelText('Confirmation'), 'longpassword');
  await userEvent.selectOptions(ui.getByLabelText('Languages'), ['fr']);
  await userEvent.type(ui.getByLabelText('Number'), '06 12 34 56 78');
}
const settleCheck = () => new Promise((resolve) => setTimeout(resolve, 450));

describe('ProfileScreen', () => {
  test('submitting empty shows the rule errors, without sending anything', async () => {
    const { profileClient, ui } = await setup();

    await userEvent.click(ui.getByRole('button', { name: 'Save' }));

    expect(ui.getByText('Name required')).toBeTruthy();
    expect(ui.getByText('Choose at least one language')).toBeTruthy();
    expect(ui.getByText('Invalid number')).toBeTruthy();
    expect(profileClient.saved).toEqual([]);
  });

  test('the asynchronous check flags a taken address while typing', async () => {
    const { ui } = await setup();

    await userEvent.type(ui.getByLabelText('Email'), 'taken@example.com');
    await settleCheck();
    await flush();

    expect(ui.getByText('Address already in use')).toBeTruthy();
  });

  test('a network failure on save is shown for the whole form', async () => {
    const { ui } = await setup();
    await fillValid(ui, 'offline@example.com');
    await settleCheck();

    await userEvent.click(ui.getByRole('button', { name: 'Save' }));

    expect(await ui.findByText('Could not connect, try again.')).toBeTruthy();
  });

  test('an image refused by the server is shown under the avatar field', async () => {
    const { ui } = await setup();
    await fillValid(ui);
    await userEvent.upload(ui.getByLabelText('Avatar'), new File(['x'.repeat(20)], 'big.png', { type: 'image/png' }));
    await settleCheck();

    await userEvent.click(ui.getByRole('button', { name: 'Save' }));

    expect(await ui.findByText('Image too large (1 MB maximum)')).toBeTruthy();
  });

  test('add and remove phones, then clear all', async () => {
    const { ui } = await setup();

    await userEvent.click(ui.getByRole('button', { name: 'Add a number' }));
    expect(ui.getAllByLabelText('Number')).toHaveLength(2);
    await userEvent.click(ui.getAllByRole('button', { name: 'Remove' })[0]!);
    expect(ui.getAllByLabelText('Number')).toHaveLength(1);

    await userEvent.type(ui.getByLabelText('Name'), 'Ada');
    await userEvent.click(ui.getByRole('button', { name: 'Clear all' }));
    expect((ui.getByLabelText('Name') as HTMLInputElement).value).toBe('');
  });
});
