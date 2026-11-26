/**
 * Contrat d'essai pour les tests du kit. Le registre est rempli à la main : dans une app, c'est le
 * plugin Vite qui s'en charge.
 */
import { type Outcome, SuperContract } from '@super-ts/core';
import { registerContract } from '@super-ts/core/internal';

export type Book = { id: number; title: string; year: number };
export type UiLibraryState = { books: Book[]; total: number; suggestions: string[] };

export class UiLibraryContract extends SuperContract<{
  state: UiLibraryState;
  commands: {
    save(input: Record<string, unknown>): Outcome<{ id: string }, 'network'>;
    checkName(input: { name: string }): Outcome<{ available: boolean }, 'network'>;
    load(input: { id: number; sort: string; page: number }): Outcome<void, 'network'>;
    search(input: { text: string }): Outcome<void, 'network'>;
    remove(input: { id: number }): Outcome<void, 'locked'>;
  };
  events: { removed: { id: number } };
}> {
  constructor() {
    super({ name: 'ui-library' });
  }
  books(s: UiLibraryState) {
    return s.books;
  }
  total(s: UiLibraryState) {
    return s.total;
  }
  suggestions(s: UiLibraryState) {
    return s.suggestions;
  }
}

declare module '@super-ts/core' {
  interface Contracts {
    'ui-library': UiLibraryContract;
  }
}

registerContract('ui-library', () => UiLibraryContract);
