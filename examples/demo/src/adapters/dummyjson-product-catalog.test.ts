import { describe, expect, test, vi } from 'vitest';
import { createDummyJsonProductCatalog } from './dummyjson-product-catalog';

const reply = (body: unknown, ok = true) =>
  vi.fn(async (_url: string) => ({ ok, status: ok ? 200 : 503, json: async () => body }) as Response);

describe('adapter dummyjson.com', () => {
  test('asks the server for the page and the sort, and fills in the missing brand', async () => {
    const fetch = reply({ products: [{ id: 1, title: 'Lamp', price: 25, rating: 4.8 }], total: 194 });
    const page = await createDummyJsonProductCatalog(fetch as unknown as typeof globalThis.fetch).list({
      page: 3,
      pageSize: 8,
      sort: 'price',
      order: 'desc',
    });

    const url = new URL(fetch.mock.calls[0]![0]);
    expect(url.origin + url.pathname).toBe('https://dummyjson.com/products');
    expect(Object.fromEntries(url.searchParams)).toEqual({
      limit: '8',
      skip: '16',
      select: 'title,brand,price,rating',
      sortBy: 'price',
      order: 'desc',
    });
    expect(page).toEqual({ products: [{ id: 1, title: 'Lamp', brand: null, price: 25, rating: 4.8 }], total: 194 });
  });

  test('without a sort, no sort parameter; an error response rejects', async () => {
    const fetch = reply({ products: [], total: 0 });
    await createDummyJsonProductCatalog(fetch as unknown as typeof globalThis.fetch).list({
      page: 1,
      pageSize: 8,
      sort: null,
      order: 'asc',
    });
    expect(new URL(fetch.mock.calls[0]![0]).searchParams.has('sortBy')).toBe(false);

    await expect(
      createDummyJsonProductCatalog(reply({}, false) as unknown as typeof globalThis.fetch).list({
        page: 1,
        pageSize: 8,
        sort: null,
        order: 'asc',
      }),
    ).rejects.toThrow('503');
  });
});

describe('adapter dummyjson.com: search', () => {
  test('searches through /products/search, limited', async () => {
    const fetch = reply({ products: [{ id: 2, title: 'iPhone X', brand: 'Apple', price: 899, rating: 4 }], total: 1 });
    const found = await createDummyJsonProductCatalog(fetch as unknown as typeof globalThis.fetch).search('phone', 8);
    const url = new URL(fetch.mock.calls[0]![0]);
    expect(url.pathname).toBe('/products/search');
    expect(Object.fromEntries(url.searchParams)).toEqual({ q: 'phone', limit: '8', select: 'title,brand,price,rating' });
    expect(found).toEqual([{ id: 2, title: 'iPhone X', brand: 'Apple', price: 899, rating: 4 }]);
  });
});
