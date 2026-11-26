/**
 * Test contract for the store inference tests (`store.test-d.ts`). The registry is filled by hand:
 * in an app, the Vite plugin takes care of it.
 */
import { SuperContract } from '@super-ts/core';
import { registerContract } from '@super-ts/core/internal';

export type ShopState = { cart: string[] };

export class ShopContract extends SuperContract<{
  state: ShopState;
  commands: {
    load(): void;
    add(input: { sku: string; qty: number }): void;
    toggle(): void;
  };
  events: { added: { sku: string }; emptied: void };
}> {
  constructor() {
    super({ name: 'core-shop' });
  }
}

declare module '@super-ts/core' {
  interface Contracts {
    'core-shop': ShopContract;
  }
}

registerContract('core-shop', () => ShopContract);
