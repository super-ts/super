import { type Commands, type StoreOfContract, SuperStore } from '@super-ts/core';
import type { OrderClient } from '../../ports/order-client';
import type { CheckoutContract } from './contract';

// This store depends on another store: it receives the cart as a dependency, reads it, sends it a
// command and listens to its events. Its listeners stop by themselves on its dispose().
type Deps = { cart: StoreOfContract<'cart'>; orderClient: OrderClient };

export class CheckoutStore extends SuperStore<CheckoutContract> implements Commands<CheckoutStore> {
  #cart: Deps['cart'];
  #orderClient: OrderClient;

  constructor({ cart, orderClient }: Deps) {
    super({ contract: 'checkout', initialState: { lastOrder: null } });
    this.#cart = cart;
    this.#orderClient = orderClient;
    // A new purchase starts: the confirmation of the previous order is no longer relevant.
    cart.on('add:done', () => this.set({ lastOrder: null }));
  }

  async placeOrder({ address }: { address: string }) {
    const cart = this.#cart.selectors; // the cart state, read through its selectors
    if (cart.isEmpty()) return this.fail('empty-cart');

    const lines = cart.lines().map((line) => ({ sku: line.product.sku, quantity: line.quantity }));
    const total = cart.total();
    const result = await this.#orderClient.place({ address, lines, total }).catch(() => this.fail('network'));
    if (!result.ok) return this.fail(result.reason);

    await this.#cart.send('clear'); // a command sent to the other store, awaited until it finishes
    const order = { orderId: result.orderId, total };
    this.set({ lastOrder: order });
    return order;
  }
}
