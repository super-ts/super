import { type Commands, SuperStore } from '@super-ts/core';
import type { ProductQuery } from '../../domain/catalog';
import type { ProductCatalog } from '../../ports/product-catalog';
import type { CatalogContract } from './contract';

type Deps = {
  productCatalog: ProductCatalog;
  /** Wait after the last keystroke before searching, in milliseconds (default 250). */
  searchDelay?: number;
};

const SUGGESTIONS = 8;
const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

export class CatalogStore extends SuperStore<CatalogContract> implements Commands<CatalogStore> {
  #catalog: ProductCatalog;
  /** The latest request: an older response arriving after it is ignored. */
  #latest = 0;
  #latestSearch = 0;
  #searchDelay: number;

  constructor({ productCatalog, searchDelay = 250 }: Deps) {
    super({ contract: 'catalog', initialState: { products: [], total: 0, loadErrorMessage: null, suggestions: [] } });
    this.#catalog = productCatalog;
    this.#searchDelay = searchDelay;
  }

  /**
   * One search per keystroke: wait a short moment, and only the latest request goes to the
   * server. A response overtaken by a more recent keystroke is ignored.
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
      if (request === this.#latest) this.set({ loadErrorMessage: 'The catalogue is not responding.' });
      return this.fail('network');
    });
    if (request !== this.#latest) return; // a more recent sort or page was requested in the meantime
    this.set({ products: page.products, total: page.total });
  }
}
