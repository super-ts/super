import { type Outcome, SuperContract } from '@super-ts/core';
import type { Product, ProductQuery } from '../../domain/catalog';

export type CatalogState = { products: Product[]; total: number; loadErrorMessage: string | null; suggestions: Product[] };

export type CatalogTypes = {
  state: CatalogState;
  commands: {
    /** Charge une page de produits, triée par le serveur. */
    load(input: ProductQuery): Outcome<void, 'network'>;
    /** Cherche des produits par leur nom, pour des suggestions. */
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
