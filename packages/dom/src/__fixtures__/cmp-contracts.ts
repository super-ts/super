/**
 * Test contracts for the component tests (component.test.ts, component.test-d.ts). The
 * registry is filled by hand: in an app, the Vite plugin takes care of it.
 */
import { type Outcome, SuperContract } from '@super-ts/core';
import { registerContract } from '@super-ts/core/internal';

export type ClockState = { now: number };

/** A clock: a counter you move forward. */
export class CmpClockContract extends SuperContract<{ state: ClockState; commands: { tick(): void } }> {
  constructor() {
    super({ name: 'cmp-clock' });
  }
  now(s: ClockState) {
    return s.now;
  }
}

export type BoardState = { scores: Readonly<Record<string, number>>; status: string };

/** A score board, and a status unrelated to the scores. */
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
  /** A new object on every read. */
  pair(s: BoardState) {
    return { a: s.scores.a, b: s.scores.b };
  }
}

export type ListedState = { items: Readonly<Record<string, number>>; note: string };

/** A list built on every read, and a note outside the list. */
export class CmpListedContract extends SuperContract<{
  state: ListedState;
  commands: { add(sku: string): void; note(text: string): void };
}> {
  constructor() {
    super({ name: 'cmp-listed' });
  }
  /** A new array on every read. */
  labels(s: ListedState) {
    return Object.entries(s.items).map(([sku, qty]) => `${sku}${qty}`);
  }
}

export type SaverState = { saved: number };

/** A save that can be refused (declared failure) or crash (unexpected exception). */
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

/** A store that only emits an event. */
export class CmpPingContract extends SuperContract<{ state: {}; events: { pinged: void } }> {
  constructor() {
    super({ name: 'cmp-ping' });
  }
}

export type CounterState = { n: number };

/** A counter that emits `ticked`. */
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

/** For the type tests: a state of which only part is exposed by selector. */
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
