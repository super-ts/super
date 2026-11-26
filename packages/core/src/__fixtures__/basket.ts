/**
 * Test contract and store for the class API tests. The registry is filled by hand: in an app, the
 * Vite plugin takes care of it.
 */
import { type Outcome, SuperContract } from '@super-ts/core';
import { registerContract } from '@super-ts/core/internal';

export type BasketState = { items: Readonly<Record<string, number>> };

export type BasketTypes = {
  state: BasketState;
  commands: {
    add(input: { sku: string }): void;
    clear(): void;
    save(input: { id: string }): Outcome<{ count: number }, 'empty' | 'offline'>;
  };
  events: { emptied: void; saved: { id: string } };
};

export class BasketContract extends SuperContract<BasketTypes> {
  constructor() {
    super({ name: 'basket' });
  }
  quantity(s: BasketState, sku: string) {
    return s.items[sku] ?? 0;
  }
  count(s: BasketState) {
    return Object.values(s.items).reduce((sum, n) => sum + n, 0);
  }
  /** A fresh array on every read, like the lines of a basket. */
  entries(s: BasketState) {
    return Object.entries(s.items).filter(([, n]) => n > 0);
  }
  isEmpty(s: BasketState) {
    return Object.values(s.items).every((n) => n === 0);
  }
  lastSaved(_s: BasketState): string | null {
    return null;
  }
}

declare module '@super-ts/core' {
  interface Contracts {
    basket: BasketContract;
  }
}

registerContract('basket', () => BasketContract);
