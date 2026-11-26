/**
 * Contrats d'essai des sélecteurs (`contract.test.ts`, `contract.test-d.ts`). Le registre est rempli
 * à la main : dans une app, c'est le plugin Vite qui s'en charge.
 */
import { SuperContract } from '@super-ts/core';
import { registerContract } from '@super-ts/core/internal';

export type CartState = { items: Record<string, number>; busy: boolean };

export class CartContract extends SuperContract<{ state: CartState; commands: { add(input: { sku: string }): void } }> {
  constructor() {
    super({ name: 'core-cart' });
  }
  quantity(s: CartState, sku: string) {
    return s.items[sku] ?? 0;
  }
  total(s: CartState) {
    return Object.values(s.items).reduce((sum, qty) => sum + qty, 0);
  }
  busy(s: CartState) {
    return s.busy;
  }
}

export type LinesState = { items: Record<string, number>; note: string };

/** Nombre de calculs des sélecteurs `lines` et `everything`, remis à zéro par chaque test. */
export const calls = { n: 0 };

const toLines = (items: Record<string, number>) => Object.entries(items).map(([sku, qty]) => ({ sku, qty }));

export class LinesContract extends SuperContract<{
  state: LinesState;
  commands: { add(input: { sku: string }): void; annotate(input: { note: string }): void; touch(): void; mutate(): void };
}> {
  constructor() {
    super({ name: 'core-lines' });
  }
  lines(s: LinesState) {
    calls.n++;
    return toLines(s.items);
  }
  line(s: LinesState, sku: string) {
    return { sku, qty: s.items[sku] ?? 0 };
  }
  everything(s: LinesState) {
    calls.n++;
    return Object.keys(s).length;
  }
  raw(s: LinesState) {
    return s;
  }
}

declare module '@super-ts/core' {
  interface Contracts {
    'core-cart': CartContract;
    'core-lines': LinesContract;
  }
}

registerContract('core-cart', () => CartContract);
registerContract('core-lines', () => LinesContract);
