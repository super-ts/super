import type { Product, ProductPage, ProductQuery } from '../domain/catalog';
import type { ProductCatalog } from '../ports/product-catalog';

const API = 'https://dummyjson.com/products';

type Raw = { products: Array<{ id: number; title: string; brand?: string; price: number; rating: number }>; total: number };

const SELECT = 'title,brand,price,rating';
const toProducts = (raw: Raw): Product[] => raw.products.map((p) => ({ ...p, brand: p.brand ?? null }));

/**
 * Adapter (user-land) over the public test API dummyjson.com: pagination (`limit`, `skip`),
 * sorting (`sortBy`, `order`) and search (`/search?q=`) done by the server.
 */
export function createDummyJsonProductCatalog(fetchImpl: typeof fetch = fetch): ProductCatalog {
  const get = async (url: string): Promise<Raw> => {
    const response = await fetchImpl(url);
    if (!response.ok) throw new Error(`dummyjson: ${response.status}`);
    return (await response.json()) as Raw;
  };
  return {
    async list({ page, pageSize, sort, order }: ProductQuery): Promise<ProductPage> {
      const params = new URLSearchParams({
        limit: String(pageSize),
        skip: String((page - 1) * pageSize),
        select: SELECT,
        ...(sort ? { sortBy: sort, order } : {}),
      });
      const raw = await get(`${API}?${params}`);
      return { products: toProducts(raw), total: raw.total };
    },
    async search(text, limit) {
      const params = new URLSearchParams({ q: text, limit: String(limit), select: SELECT });
      return toProducts(await get(`${API}/search?${params}`));
    },
  };
}
