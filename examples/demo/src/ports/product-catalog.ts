import type { Product, ProductPage, ProductQuery } from '../domain/catalog';

/**
 * Port (user-land) : ce dont le store du catalogue a besoin pour lire les produits, page par page,
 * triés côté serveur, et pour en chercher. Rejette en cas de panne réseau.
 */
export interface ProductCatalog {
  list(query: ProductQuery): Promise<ProductPage>;
  /** Les produits dont le nom ou la description contient `text`, au plus `limit`. */
  search(text: string, limit: number): Promise<Product[]>;
}
