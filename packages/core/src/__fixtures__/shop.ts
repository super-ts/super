/**
 * Contrat d'essai des tests d'inférence des stores (`store.test-d.ts`). Le registre est rempli à la
 * main : dans une app, c'est le plugin Vite qui s'en charge.
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
