import { record } from '@super-ts/testing';
import { describe, expect, test } from 'vitest';
import { PRODUCTS } from '../../domain/shop';
import { CartStore } from './store';

describe('CartStore', () => {
  test('ajoute, retire, calcule le total', async () => {
    const cart = CartStore.create();
    await cart.send('add', { sku: 'mug' });
    await cart.send('add', { sku: 'mug' });
    await cart.send('add', { sku: 'sticker' });
    await cart.send('remove', { sku: 'mug' });

    const q = cart.selectors;
    expect(q.count()).toBe(2);
    expect(q.total()).toBe(1200 + 400);
    expect(q.lines().map((l) => [l.product.sku, l.quantity])).toEqual([
      ['mug', 1],
      ['sticker', 1],
    ]);
  });

  test('émet emptied quand le panier devient vide, par clear ou par le dernier remove', async () => {
    const cart = CartStore.create();
    const emptied = record(cart, 'emptied');

    await cart.send('add', { sku: 'mug' });
    await cart.send('remove', { sku: 'mug' });
    await cart.send('add', { sku: 'tshirt' });
    await cart.send('clear');
    await cart.send('clear'); // déjà vide : rien

    expect(emptied.calls).toHaveLength(2);
  });
});

describe('CartStore : panier de départ', () => {
  test('part du panier reçu (relu du stockage par main.ts)', () => {
    const cart = CartStore.create({ quantities: { [PRODUCTS[0]!.sku]: 2 } });
    expect(cart.selectors.count()).toBe(2);
  });
});
