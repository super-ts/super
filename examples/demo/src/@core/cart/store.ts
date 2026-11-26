import { type Commands, SuperStore } from '@super-ts/core';
import type { CartContract } from './contract';

export class CartStore extends SuperStore<CartContract> implements Commands<CartStore> {
  /** `quantities` : le panier de départ (relu du stockage par `main.ts`), vide par défaut. */
  constructor({ quantities = {} }: { quantities?: Readonly<Record<string, number>> } = {}) {
    super({ contract: 'cart', initialState: { quantities } });
  }

  add({ sku }: { sku: string }) {
    this.#setQuantity(sku, this.selectors.quantity(sku) + 1);
  }

  remove({ sku }: { sku: string }) {
    if (this.selectors.quantity(sku) === 0) return;
    this.#setQuantity(sku, this.selectors.quantity(sku) - 1);
    if (this.selectors.isEmpty()) this.emit('emptied');
  }

  clear() {
    if (this.selectors.isEmpty()) return;
    this.set({ quantities: {} });
    this.emit('emptied');
  }

  #setQuantity(sku: string, quantity: number) {
    this.set({ quantities: { ...this.get().quantities, [sku]: quantity } });
  }
}
