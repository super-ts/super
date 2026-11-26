import { type Outcome, SuperContract } from '@super-ts/core';
import type { Product, ProductQuery } from '../../domain/catalog';

export type CatalogState = { products: Product[]; total: number; loadErrorMessage: string | null; suggestions: Product[] };

export type CatalogTypes = {
  state: CatalogState;
  commands: {
    /** Loads a page of products, sorted by the server. */
    load(input: ProductQuery): Outcome<void, 'network'>;
    /** Searches products by name, for suggestions. */
    search(input: { text: string }): Outcome<void, 'network'>;
  };
};

export class CatalogContract extends SuperContract<CatalogTypes> {
  constructor() {
    super({ name: 'catalog' });
  }

  products(s: CatalogState) {
    return s.products;
  }
  total(s: CatalogState) {
    return s.total;
  }
  loadErrorMessage(s: CatalogState) {
    return s.loadErrorMessage;
  }
  suggestions(s: CatalogState) {
    return s.suggestions;
  }
}
