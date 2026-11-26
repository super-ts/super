import { describe, expect, test } from 'vitest';
import { createInMemoryProductCatalog } from '../../adapters/in-memory-product-catalog';
import type { Product } from '../../domain/catalog';
import { CatalogStore } from './store';

const PRODUCTS: Product[] = [
  { id: 1, title: 'Chaise', brand: 'Bois', price: 40, rating: 4.1 },
  { id: 2, title: 'Armoire', brand: 'Bois', price: 300, rating: 3.2 },
  { id: 3, title: 'Lampe', brand: null, price: 25, rating: 4.8 },
];

describe('CatalogStore', () => {
  test('charge une page triée, et le total', async () => {
    const store = CatalogStore.create({ productCatalog: createInMemoryProductCatalog({ products: PRODUCTS }) });
    await store.send('load', { page: 1, pageSize: 2, sort: 'price', order: 'desc' });
    expect(store.selectors.products().map((p) => p.title)).toEqual(['Armoire', 'Chaise']);
    expect(store.selectors.total()).toBe(3);
  });

  test('une réponse dépassée par une demande plus récente est ignorée', async () => {
    const slow = createInMemoryProductCatalog({ products: PRODUCTS, delay: 30 });
    const store = CatalogStore.create({ productCatalog: slow });
    const first = store.send('load', { page: 1, pageSize: 3, sort: 'title', order: 'asc' });
    const second = store.send('load', { page: 1, pageSize: 3, sort: 'title', order: 'desc' });
    await Promise.all([first, second]);
    expect(store.selectors.products().map((p) => p.title)).toEqual(['Lampe', 'Chaise', 'Armoire']);
  });

  test('une panne réseau : un message, et l’échec network', async () => {
    const store = CatalogStore.create({ productCatalog: createInMemoryProductCatalog({ products: PRODUCTS, offline: true }) });
    await expect(store.send('load', { page: 1, pageSize: 2, sort: null, order: 'asc' })).rejects.toMatchObject({ reason: 'network' });
    expect(store.selectors.loadErrorMessage()).toBe('Le catalogue ne répond pas.');
  });
});

describe('CatalogStore : recherche', () => {
  test('seule la dernière frappe part au serveur, et donne les suggestions', async () => {
    const catalog = createInMemoryProductCatalog({ products: PRODUCTS });
    const store = CatalogStore.create({ productCatalog: catalog, searchDelay: 20 });
    const typing = ['l', 'la', 'lam'].map((text) => store.send('search', { text }));
    await Promise.all(typing);
    expect(catalog.searches).toEqual(['lam']);
    expect(store.selectors.suggestions().map((p) => p.title)).toEqual(['Lampe']);
  });

  test('une saisie vide efface les suggestions sans rien demander', async () => {
    const catalog = createInMemoryProductCatalog({ products: PRODUCTS });
    const store = CatalogStore.create({ productCatalog: catalog, searchDelay: 0 });
    await store.send('search', { text: 'ch' });
    await store.send('search', { text: '  ' });
    expect(store.selectors.suggestions()).toEqual([]);
    expect(catalog.searches).toEqual(['ch']);
  });
});
