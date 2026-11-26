import type { Product, ProductPage, ProductQuery } from '../domain/catalog';
import type { ProductCatalog } from '../ports/product-catalog';

type Options = { products: Product[]; delay?: number; offline?: boolean };

const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/** Adapter (user-land) en mémoire, pour les tests : il trie, pagine et cherche comme le ferait le serveur. */
export function createInMemoryProductCatalog({
  products,
  delay = 0,
  offline = false,
}: Options): ProductCatalog & { queries: ProductQuery[]; searches: string[] } {
  const queries: ProductQuery[] = [];
  const searches: string[] = [];
  return {
    queries,
    searches,
    async search(text, limit) {
      searches.push(text);
      await wait(delay);
      if (offline) throw new Error('réseau indisponible');
      const wanted = text.toLowerCase();
      return products.filter((p) => p.title.toLowerCase().includes(wanted)).slice(0, limit);
    },
    async list(query): Promise<ProductPage> {
      queries.push(query);
      await wait(delay);
      if (offline) throw new Error('réseau indisponible');
      const { page, pageSize, sort, order } = query;
      const sorted = sort
        ? [...products].sort((a, b) => {
            const [x, y] = [a[sort], b[sort]];
            const compared = typeof x === 'number' && typeof y === 'number' ? x - y : String(x ?? '').localeCompare(String(y ?? ''));
            return order === 'asc' ? compared : -compared;
          })
        : products;
      return { products: sorted.slice((page - 1) * pageSize, page * pageSize), total: products.length };
    },
  };
}
