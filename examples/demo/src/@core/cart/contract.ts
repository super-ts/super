import { SuperContract } from '@super-ts/core';
import { linesOf, PRODUCTS } from '../../domain/shop';

export type CartState = { quantities: Readonly<Record<string, number>> };

export type CartTypes = {
  state: CartState;
  commands: {
    add(input: { sku: string }): void;
    remove(input: { sku: string }): void;
    clear(): void;
  };
  // Un événement écrit à la main : un fait qui n'est pas l'issue d'une seule commande.
  // Le panier devient vide après `clear`, ou après le `remove` du dernier article.
  events: {
    emptied: void;
  };
};

export class CartContract extends SuperContract<CartTypes> {
  constructor() {
    super({ name: 'cart' });
  }

  catalog(_s: CartState) {
    return PRODUCTS;
  }
  lines(s: CartState) {
    return linesOf(s.quantities);
  }
  quantity(s: CartState, sku: string) {
    return s.quantities[sku] ?? 0;
  }
  count(s: CartState) {
    return Object.values(s.quantities).reduce((sum, n) => sum + n, 0);
  }
  total(s: CartState) {
    return linesOf(s.quantities).reduce((sum, line) => sum + line.subtotal, 0);
  }
  isEmpty(s: CartState) {
    return Object.values(s.quantities).every((n) => n === 0);
  }
}
