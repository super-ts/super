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
  test('adding to the cart updates the lines and the total', async () => {
    const { ui } = await setup();

    await userEvent.click(ui.getByRole('button', { name: 'Add Super mug' }));
    await userEvent.click(ui.getByRole('button', { name: 'Add Sticker pack' }));
    await userEvent.click(ui.getByRole('button', { name: 'Add one Super mug' }));

    expect(ui.getByText('€28.00')).toBeTruthy(); // total: 2 × €12 + €4
  });

  test('emptying the cart goes through a dialog: cancel changes nothing, confirm empties', async () => {
    const { ui } = await setup();
    await userEvent.click(ui.getByRole('button', { name: 'Add Super mug' }));

    await userEvent.click(ui.getByRole('button', { name: 'Empty the cart' }));
    expect(ui.getByRole('dialog')).toBeTruthy();
    await userEvent.click(ui.getByRole('button', { name: 'Cancel' }));
    expect(ui.queryByRole('dialog')).toBeNull();
    expect(ui.getByText('Super mug', { selector: '.cart span' })).toBeTruthy();

    await userEvent.click(ui.getByRole('button', { name: 'Empty the cart' }));
    await userEvent.click(ui.getByRole('button', { name: 'Confirm' }));
    await flush();

    expect(ui.getByText('Your cart is empty.')).toBeTruthy(); // the message comes from the emptied event
  });
});
