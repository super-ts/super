import { createRouter } from '@super-ts/dom';
import { flush, mount } from '@super-ts/testing';
import { CartStore } from '@core/cart/store';
import { within } from '@testing-library/dom';
import userEvent from '@testing-library/user-event';
import { describe, expect, test } from 'vitest';
import { Router } from '../../routes';
import { ShopScreen } from '.';

async function setup() {
  const cart = CartStore.create();
  const router = createRouter(Router, { mode: 'memory', initialPath: '/shop' });
  const { container } = await mount(ShopScreen, { stores: [cart], router });
  return { cart, ui: within(container) };
}

describe('ShopScreen', () => {
  test('ajouter au panier met à jour les lignes et le total', async () => {
    const { ui } = await setup();

    await userEvent.click(ui.getByRole('button', { name: 'Ajouter Mug Super' }));
    await userEvent.click(ui.getByRole('button', { name: 'Ajouter Lot de stickers' }));
    await userEvent.click(ui.getByRole('button', { name: 'Ajouter un Mug Super' }));

    expect(ui.getByText('28,00 €')).toBeTruthy(); // total : 2 × 12 € + 4 €
  });

  test('vider le panier passe par un dialogue : annuler ne change rien, confirmer vide', async () => {
    const { ui } = await setup();
    await userEvent.click(ui.getByRole('button', { name: 'Ajouter Mug Super' }));

    await userEvent.click(ui.getByRole('button', { name: 'Vider le panier' }));
    expect(ui.getByRole('dialog')).toBeTruthy();
    await userEvent.click(ui.getByRole('button', { name: 'Annuler' }));
    expect(ui.queryByRole('dialog')).toBeNull();
    expect(ui.getByText('Mug Super', { selector: '.cart span' })).toBeTruthy();

    await userEvent.click(ui.getByRole('button', { name: 'Vider le panier' }));
    await userEvent.click(ui.getByRole('button', { name: 'Confirmer' }));
    await flush();

    expect(ui.getByText('Ton panier est vide.')).toBeTruthy(); // le message vient de l'événement emptied
  });
});
