import { type Outcome, SuperContract } from '@super-ts/core';
import type { Order } from '../../domain/shop';

export type CheckoutState = { lastOrder: Order | null };

export type CheckoutTypes = {
  state: CheckoutState;
  commands: {
    placeOrder(input: { address: string }): Outcome<Order, 'empty-cart' | 'payment-refused' | 'network'>;
  };
};

export class CheckoutContract extends SuperContract<CheckoutTypes> {
  constructor() {
    super({ name: 'checkout' });
  }

  lastOrder(s: CheckoutState) {
    return s.lastOrder;
  }
}
