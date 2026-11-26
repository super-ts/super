/** The counters domain. Neither Super nor DOM. */

export const MIN_COUNT = 0;

export type CounterDefinition = { id: string; label: string };

/** Catalogue of the app's counters. */
export const COUNTERS: readonly CounterDefinition[] = [
  { id: 'coffees', label: 'Coffees' },
  { id: 'pushups', label: 'Push-ups' },
  { id: 'books', label: 'Books read' },
];

export type CounterChange = 'increment' | 'decrement' | 'reset';

/** Why a write can fail: the screen maps each reason to its message. */
export type CounterFailure = 'unknown' | 'below-min' | 'storage';
