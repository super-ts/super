import { flush, mount } from '@super-ts/testing';
import { within } from '@testing-library/dom';
import userEvent from '@testing-library/user-event';
import { describe, expect, test } from 'vitest';
import { CompositionScreen } from '.';

async function setup() {
  const { container } = await mount(CompositionScreen);
  return { ui: within(container) };
}

describe('CompositionScreen', () => {
  test('une carte affiche les enfants écrits entre ses balises', async () => {
    const { ui } = await setup();
    const card = within(ui.getByRole('region', { name: 'Des enfants' }));
    expect(card.getByText(/remplit sa prop/)).toBeTruthy();
  });

  test('un emplacement <:actions> : le bouton est celui du parent, et modifie son état', async () => {
    const { ui } = await setup();
    const card = within(ui.getByRole('region', { name: 'Un emplacement <:actions>' }));
    await userEvent.click(card.getByRole('button', { name: 'J’aime' }));
    await flush();
    expect(card.getByText('J’aime : 1')).toBeTruthy();
  });

  test('une méthode #actions(note) remplit l’emplacement de chaque carte de la boucle', async () => {
    const { ui } = await setup();
    const coffee = within(ui.getByRole('region', { name: 'Acheter du café' }));
    await userEvent.click(coffee.getByRole('button', { name: 'Épingler' }));
    await flush();
    const pinned = within(ui.getByRole('region', { name: '📌 Acheter du café' }));
    expect(pinned.getByRole('button', { name: 'Désépingler' })).toBeTruthy();

    await userEvent.click(pinned.getByRole('button', { name: 'Supprimer' }));
    await flush();
    expect(ui.queryByRole('region', { name: /Acheter du café/ })).toBeNull();
    expect(ui.getByRole('region', { name: '📌 Relire la doc des .super' })).toBeTruthy();
  });

  test('des onglets : une liste d’emplacements remplis par des méthodes', async () => {
    const { ui } = await setup();
    expect(ui.getByRole('tabpanel', { name: 'Enfants' }).textContent).toContain('content');
    await userEvent.click(ui.getByRole('tab', { name: 'Emplacements' }));
    await flush();
    expect(ui.getByRole('tabpanel', { name: 'Emplacements' }).textContent).toContain('<:nom>');
  });
});
