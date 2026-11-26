import { type Commands, SuperStore } from '@super-ts/core';
import type { ProductQuery } from '../../domain/catalog';
import type { ProductCatalog } from '../../ports/product-catalog';
import type { CatalogContract } from './contract';

type Deps = {
  productCatalog: ProductCatalog;
  /** Attente après la dernière frappe avant de chercher, en millisecondes (défaut 250). */
  searchDelay?: number;
};

const SUGGESTIONS = 8;
const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

export class CatalogStore extends SuperStore<CatalogContract> implements Commands<CatalogStore> {
  #catalog: ProductCatalog;
  /** La dernière demande : une réponse plus ancienne, arrivée après elle, est ignorée. */
  #latest = 0;
  #latestSearch = 0;
  #searchDelay: number;

  constructor({ productCatalog, searchDelay = 250 }: Deps) {
    super({ contract: 'catalog', initialState: { products: [], total: 0, loadErrorMessage: null, suggestions: [] } });
    this.#catalog = productCatalog;
    this.#searchDelay = searchDelay;
  }

  /**
   * Une recherche par frappe : on attend un court instant, et seule la dernière demande part au
   * serveur. Une réponse dépassée par une frappe plus récente est ignorée.
   */
  async search({ text }: { text: string }) {
    const request = ++this.#latestSearch;
    if (text.trim() === '') return this.set({ suggestions: [] });
    await wait(this.#searchDelay);
    if (request !== this.#latestSearch) return;
    const found = await this.#catalog.search(text.trim(), SUGGESTIONS).catch(() => this.fail('network'));
    if (request === this.#latestSearch) this.set({ suggestions: found });
  }

  async load(query: ProductQuery) {
    const request = ++this.#latest;
    this.set({ loadErrorMessage: null });
    const page = await this.#catalog.list(query).catch(() => {
      if (request === this.#latest) this.set({ loadErrorMessage: 'Le catalogue ne répond pas.' });
      return this.fail('network');
    });
    if (request !== this.#latest) return; // un tri ou une page plus récents ont été demandés entre-temps
    this.set({ products: page.products, total: page.total });
  }
}
