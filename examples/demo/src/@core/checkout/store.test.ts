import { record } from '@super-ts/testing';
import { describe, expect, test } from 'vitest';
import { createFakeOrderClient } from '../../adapters/fake-order-client';
import { CartStore } from '../cart/store';
import { CheckoutStore } from './store';

function setup() {
  const cart = CartStore.create();
  const orderClient = createFakeOrderClient({ delay: 0 });
  const checkout = CheckoutStore.create({ cart, orderClient });
  return { cart, orderClient, checkout };
}

describe('CheckoutStore, qui dépend du panier', () => {
  test('passe la commande avec le contenu du panier, puis vide le panier', async () => {
    const { cart, orderClient, checkout } = setup();
    await cart.send('add', { sku: 'tshirt' });

    await checkout.send('placeOrder', { address: '12 rue des Lilas' });

    expect(orderClient.orders).toEqual([{ address: '12 rue des Lilas', lines: [{ sku: 'tshirt', quantity: 1 }], total: 2500 }]);
    expect(cart.selectors.isEmpty()).toBe(true);
    expect(checkout.state().lastOrder).toEqual({ orderId: 'C0001', total: 2500 });
  });

  test('chaque refus a sa raison : panier vide, paiement refusé, panne réseau', async () => {
    const { cart, checkout } = setup();
    const failed = record(checkout, 'placeOrder:failed');

    await checkout.send('placeOrder', { address: 'peu importe' }).catch(() => {});
    await cart.send('add', { sku: 'mug' });
    await checkout.send('placeOrder', { address: 'refus de carte' }).catch(() => {});
    await checkout.send('placeOrder', { address: 'offline' }).catch(() => {});

    expect(failed.calls.map((c) => c.reason)).toEqual(['empty-cart', 'payment-refused', 'network']);
    expect(cart.selectors.count()).toBe(1); // le panier n'est vidé qu'après une commande réussie
  });

  test('écoute le panier : un nouvel ajout efface la confirmation précédente', async () => {
    const { cart, checkout } = setup();
    await cart.send('add', { sku: 'mug' });
    await checkout.send('placeOrder', { address: '12 rue des Lilas' });
    expect(checkout.state().lastOrder).not.toBeNull();

    await cart.send('add', { sku: 'sticker' });

    expect(checkout.state().lastOrder).toBeNull();
  });

  test('libéré, il n’écoute plus le panier (sans signal à passer)', async () => {
    const { cart, checkout } = setup();
    await cart.send('add', { sku: 'mug' });
    await checkout.send('placeOrder', { address: '12 rue des Lilas' });
    checkout.dispose();

    await cart.send('add', { sku: 'sticker' });

    expect(checkout.state().lastOrder).not.toBeNull();
  });
});
