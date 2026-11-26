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

describe('CheckoutStore, which depends on the cart', () => {
  test('places the order with the cart contents, then empties the cart', async () => {
    const { cart, orderClient, checkout } = setup();
    await cart.send('add', { sku: 'tshirt' });

    await checkout.send('placeOrder', { address: '12 Lilac Street' });

    expect(orderClient.orders).toEqual([{ address: '12 Lilac Street', lines: [{ sku: 'tshirt', quantity: 1 }], total: 2500 }]);
    expect(cart.selectors.isEmpty()).toBe(true);
    expect(checkout.state().lastOrder).toEqual({ orderId: 'C0001', total: 2500 });
  });

  test('each refusal has its reason: empty cart, payment refused, network failure', async () => {
    const { cart, checkout } = setup();
    const failed = record(checkout, 'placeOrder:failed');

    await checkout.send('placeOrder', { address: 'whatever' }).catch(() => {});
    await cart.send('add', { sku: 'mug' });
    await checkout.send('placeOrder', { address: 'refuse card' }).catch(() => {});
    await checkout.send('placeOrder', { address: 'offline' }).catch(() => {});

    expect(failed.calls.map((c) => c.reason)).toEqual(['empty-cart', 'payment-refused', 'network']);
    expect(cart.selectors.count()).toBe(1); // the cart is only emptied after a successful order
  });

  test('listens to the cart: a new addition clears the previous confirmation', async () => {
    const { cart, checkout } = setup();
    await cart.send('add', { sku: 'mug' });
    await checkout.send('placeOrder', { address: '12 Lilac Street' });
    expect(checkout.state().lastOrder).not.toBeNull();

    await cart.send('add', { sku: 'sticker' });

    expect(checkout.state().lastOrder).toBeNull();
  });

  test('once disposed, it no longer listens to the cart (no signal to pass)', async () => {
    const { cart, checkout } = setup();
    await cart.send('add', { sku: 'mug' });
    await checkout.send('placeOrder', { address: '12 Lilac Street' });
    checkout.dispose();

    await cart.send('add', { sku: 'sticker' });

    expect(checkout.state().lastOrder).not.toBeNull();
  });
});
