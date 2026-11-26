/** Le métier des compteurs. Ni Super, ni DOM. */

export const MIN_COUNT = 0;

export type CounterDefinition = { id: string; label: string };

/** Catalogue des compteurs de l'app. */
export const COUNTERS: readonly CounterDefinition[] = [
  { id: 'cafes', label: 'Cafés' },
  { id: 'pompes', label: 'Pompes' },
  { id: 'livres', label: 'Livres lus' },
];

export type CounterChange = 'increment' | 'decrement' | 'reset';

/** Pourquoi une écriture peut échouer : à chaque raison, l'écran associe son message. */
export type CounterFailure = 'unknown' | 'below-min' | 'storage';
