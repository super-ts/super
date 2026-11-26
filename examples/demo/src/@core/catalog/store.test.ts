import { describe, expect, test } from 'vitest';
import { createInMemoryProductCatalog } from '../../adapters/in-memory-product-catalog';
import type { Product } from '../../domain/catalog';
import { CatalogStore } from './store';

const PRODUCTS: Product[] = [
  { id: 1, title: 'Chair', brand: 'Wood', price: 40, rating: 4.1 },
  { id: 2, title: 'Wardrobe', brand: 'Wood', price: 300, rating: 3.2 },
  { id: 3, title: 'Lamp', brand: null, price: 25, rating: 4.8 },
];

describe('CatalogStore', () => {
  test('loads a sorted page, and the total', async () => {
    const store = CatalogStore.create({ productCatalog: createInMemoryProductCatalog({ products: PRODUCTS }) });
    await store.send('load', { page: 1, pageSize: 2, sort: 'price', order: 'desc' });
    expect(store.selectors.products().map((p) => p.title)).toEqual(['Wardrobe', 'Chair']);
    expect(store.selectors.total()).toBe(3);
  });

  test('a response overtaken by a more recent request is ignored', async () => {
    const slow = createInMemoryProductCatalog({ products: PRODUCTS, delay: 30 });
    const store = CatalogStore.create({ productCatalog: slow });
    const first = store.send('load', { page: 1, pageSize: 3, sort: 'title', order: 'asc' });
    const second = store.send('load', { page: 1, pageSize: 3, sort: 'title', order: 'desc' });
    await Promise.all([first, second]);
    expect(store.selectors.products().map((p) => p.title)).toEqual(['Wardrobe', 'Lamp', 'Chair']);
  });

  test('a network failure: a message, and the network failure reason', async () => {
    const store = CatalogStore.create({ productCatalog: createInMemoryProductCatalog({ products: PRODUCTS, offline: true }) });
    await expect(store.send('load', { page: 1, pageSize: 2, sort: null, order: 'asc' })).rejects.toMatchObject({ reason: 'network' });
    expect(store.selectors.loadErrorMessage()).toBe('The catalogue is not responding.');
  });
});

describe('CatalogStore: search', () => {
  test('only the last keystroke goes to the server, and gives the suggestions', async () => {
    const catalog = createInMemoryProductCatalog({ products: PRODUCTS });
    const store = CatalogStore.create({ productCatalog: catalog, searchDelay: 20 });
    const typing = ['l', 'la', 'lam'].map((text) => store.send('search', { text }));
    await Promise.all(typing);
    expect(catalog.searches).toEqual(['lam']);
    expect(store.selectors.suggestions().map((p) => p.title)).toEqual(['Lamp']);
  });

  test('an empty input clears the suggestions without requesting anything', async () => {
    const catalog = createInMemoryProductCatalog({ products: PRODUCTS });
    const store = CatalogStore.create({ productCatalog: catalog, searchDelay: 0 });
    await store.send('search', { text: 'ch' });
    await store.send('search', { text: '  ' });
    expect(store.selectors.suggestions()).toEqual([]);
    expect(catalog.searches).toEqual(['ch']);
  });
});
