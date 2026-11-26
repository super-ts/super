import type { Product, ProductPage, ProductQuery } from '../domain/catalog';

/**
 * Port (user-land): what the catalogue store needs to read products, page by page,
 * sorted on the server, and to search them. Rejects on a network failure.
 */
export interface ProductCatalog {
  list(query: ProductQuery): Promise<ProductPage>;
  /** The products whose name or description contains `text`, at most `limit`. */
  search(text: string, limit: number): Promise<Product[]>;
}
