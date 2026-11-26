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
  await userEvent.type(ui.getByLabelText('Nom'), 'Ada');
  await userEvent.type(ui.getByLabelText('E-mail'), email);
  await userEvent.type(ui.getByLabelText('Mot de passe'), 'longpassword');
  await userEvent.type(ui.getByLabelText('Confirmation'), 'longpassword');
  await userEvent.selectOptions(ui.getByLabelText('Langues'), ['fr']);
  await userEvent.type(ui.getByLabelText('Numéro'), '06 12 34 56 78');
}
const settleCheck = () => new Promise((resolve) => setTimeout(resolve, 450));

describe('ProfileScreen', () => {
  test('soumettre vide affiche les erreurs des règles, sans rien envoyer', async () => {
    const { profileClient, ui } = await setup();

    await userEvent.click(ui.getByRole('button', { name: 'Enregistrer' }));

    expect(ui.getByText('Nom obligatoire')).toBeTruthy();
    expect(ui.getByText('Choisis au moins une langue')).toBeTruthy();
    expect(ui.getByText('Numéro invalide')).toBeTruthy();
    expect(profileClient.saved).toEqual([]);
  });

  test('la vérification asynchrone signale une adresse prise pendant la saisie', async () => {
    const { ui } = await setup();

    await userEvent.type(ui.getByLabelText('E-mail'), 'taken@example.com');
    await settleCheck();
    await flush();

    expect(ui.getByText('Adresse déjà utilisée')).toBeTruthy();
  });

  test('une panne réseau à l’enregistrement s’affiche pour tout le formulaire', async () => {
    const { ui } = await setup();
    await fillValid(ui, 'offline@example.com');
    await settleCheck();

    await userEvent.click(ui.getByRole('button', { name: 'Enregistrer' }));

    expect(await ui.findByText('Connexion impossible, réessaie.')).toBeTruthy();
  });

  test('une image refusée par le serveur s’affiche sous le champ avatar', async () => {
    const { ui } = await setup();
    await fillValid(ui);
    await userEvent.upload(ui.getByLabelText('Avatar'), new File(['x'.repeat(20)], 'big.png', { type: 'image/png' }));
    await settleCheck();

    await userEvent.click(ui.getByRole('button', { name: 'Enregistrer' }));

    expect(await ui.findByText('Image trop lourde (1 Mo maximum)')).toBeTruthy();
  });

  test('ajouter et retirer des téléphones, puis tout effacer', async () => {
    const { ui } = await setup();

    await userEvent.click(ui.getByRole('button', { name: 'Ajouter un numéro' }));
    expect(ui.getAllByLabelText('Numéro')).toHaveLength(2);
    await userEvent.click(ui.getAllByRole('button', { name: 'Retirer' })[0]!);
    expect(ui.getAllByLabelText('Numéro')).toHaveLength(1);

    await userEvent.type(ui.getByLabelText('Nom'), 'Ada');
    await userEvent.click(ui.getByRole('button', { name: 'Tout effacer' }));
    expect((ui.getByLabelText('Nom') as HTMLInputElement).value).toBe('');
  });
});
