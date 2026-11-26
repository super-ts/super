/**
 * Contrats d'essai pour les tests de composants (component.test.ts, component.test-d.ts). Le
 * registre est rempli à la main : dans une app, c'est le plugin Vite qui s'en charge.
 */
import { type Outcome, SuperContract } from '@super-ts/core';
import { registerContract } from '@super-ts/core/internal';

export type ClockState = { now: number };

/** Une horloge : un compteur qu'on fait avancer. */
export class CmpClockContract extends SuperContract<{ state: ClockState; commands: { tick(): void } }> {
  constructor() {
    super({ name: 'cmp-clock' });
  }
  now(s: ClockState) {
    return s.now;
  }
}

export type BoardState = { scores: Readonly<Record<string, number>>; status: string };

/** Un tableau de scores, et un statut qui n'a rien à voir avec eux. */
export class CmpBoardContract extends SuperContract<{
  state: BoardState;
  commands: { score(input: { id: string; value: number }): void; setStatus(status: string): void };
}> {
  constructor() {
    super({ name: 'cmp-board' });
  }
  scores(s: BoardState) {
    return s.scores;
  }
  score(s: BoardState, id: string) {
    return s.scores[id];
  }
  /** Un objet neuf à chaque lecture. */
  pair(s: BoardState) {
    return { a: s.scores.a, b: s.scores.b };
  }
}

export type ListedState = { items: Readonly<Record<string, number>>; note: string };

/** Une liste construite à chaque lecture, et une note hors liste. */
export class CmpListedContract extends SuperContract<{
  state: ListedState;
  commands: { add(sku: string): void; note(text: string): void };
}> {
  constructor() {
    super({ name: 'cmp-listed' });
  }
  /** Un tableau neuf à chaque lecture. */
  labels(s: ListedState) {
    return Object.entries(s.items).map(([sku, qty]) => `${sku}${qty}`);
  }
}

export type SaverState = { saved: number };

/** Une sauvegarde qui peut être refusée (échec déclaré) ou planter (exception inattendue). */
export class CmpSaverContract extends SuperContract<{
  state: SaverState;
  commands: { save(input: { id: string }): Outcome<void, 'refused'>; crash(): void };
}> {
  constructor() {
    super({ name: 'cmp-saver' });
  }
  saved(s: SaverState) {
    return s.saved;
  }
}

/** Un store qui ne fait qu'émettre un événement. */
export class CmpPingContract extends SuperContract<{ state: {}; events: { pinged: void } }> {
  constructor() {
    super({ name: 'cmp-ping' });
  }
}

export type CounterState = { n: number };

/** Un compteur qui émet `ticked`. */
export class CmpCounterContract extends SuperContract<{
  state: CounterState;
  commands: { inc(by: number): void };
  events: { ticked: void };
}> {
  constructor() {
    super({ name: 'cmp-counter' });
  }
  n(s: CounterState) {
    return s.n;
  }
}

export type ShelfState = { items: Readonly<Record<string, number>>; note: string };

/** Pour les tests de types : un état dont seule une partie est exposée par sélecteur. */
export class CmpShelfContract extends SuperContract<{ state: ShelfState; commands: { add(sku: string): void } }> {
  constructor() {
    super({ name: 'cmp-shelf' });
  }
  quantity(s: ShelfState, sku: string) {
    return s.items[sku] ?? 0;
  }
}

declare module '@super-ts/core' {
  interface Contracts {
    'cmp-clock': CmpClockContract;
    'cmp-board': CmpBoardContract;
    'cmp-listed': CmpListedContract;
    'cmp-saver': CmpSaverContract;
    'cmp-ping': CmpPingContract;
    'cmp-counter': CmpCounterContract;
    'cmp-shelf': CmpShelfContract;
  }
}

registerContract('cmp-clock', () => CmpClockContract);
registerContract('cmp-board', () => CmpBoardContract);
registerContract('cmp-listed', () => CmpListedContract);
registerContract('cmp-saver', () => CmpSaverContract);
registerContract('cmp-ping', () => CmpPingContract);
registerContract('cmp-counter', () => CmpCounterContract);
registerContract('cmp-shelf', () => CmpShelfContract);
