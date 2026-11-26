import { type Commands, type StoreOfContract, SuperStore } from '@super-ts/core';
import type { OrderClient } from '../../ports/order-client';
import type { CheckoutContract } from './contract';

// Ce store dépend d'un autre store : il reçoit le panier en dépendance, le lit, lui envoie une
// commande et écoute ses événements. Ses écoutes s'arrêtent d'elles-mêmes à son dispose().
type Deps = { cart: StoreOfContract<'cart'>; orderClient: OrderClient };

export class CheckoutStore extends SuperStore<CheckoutContract> implements Commands<CheckoutStore> {
  #cart: Deps['cart'];
  #orderClient: OrderClient;

  constructor({ cart, orderClient }: Deps) {
    super({ contract: 'checkout', initialState: { lastOrder: null } });
    this.#cart = cart;
    this.#orderClient = orderClient;
    // Un nouvel achat commence : la confirmation de la commande précédente n'a plus lieu d'être.
    cart.on('add:done', () => this.set({ lastOrder: null }));
  }

  async placeOrder({ address }: { address: string }) {
    const cart = this.#cart.selectors; // l'état du panier, lu par ses sélecteurs
    if (cart.isEmpty()) return this.fail('empty-cart');

    const lines = cart.lines().map((line) => ({ sku: line.product.sku, quantity: line.quantity }));
    const total = cart.total();
    const result = await this.#orderClient.place({ address, lines, total }).catch(() => this.fail('network'));
    if (!result.ok) return this.fail(result.reason);

    await this.#cart.send('clear'); // une commande envoyée à l'autre store, attendue jusqu'à la fin
    const order = { orderId: result.orderId, total };
    this.set({ lastOrder: order });
    return order;
  }
}
