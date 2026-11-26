import { record } from '@super-ts/testing';
import { describe, expect, test } from 'vitest';
import { PRODUCTS } from '../../domain/shop';
import { CartStore } from './store';

describe('CartStore', () => {
  test('adds, removes, computes the total', async () => {
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

  test('emits emptied when the cart becomes empty, through clear or the last remove', async () => {
    const cart = CartStore.create();
    const emptied = record(cart, 'emptied');

    await cart.send('add', { sku: 'mug' });
    await cart.send('remove', { sku: 'mug' });
    await cart.send('add', { sku: 'tshirt' });
    await cart.send('clear');
    await cart.send('clear'); // already empty: nothing

    expect(emptied.calls).toHaveLength(2);
  });
});

describe('CartStore: starting cart', () => {
  test('starts from the received cart (read back from storage by main.ts)', () => {
    const cart = CartStore.create({ quantities: { [PRODUCTS[0]!.sku]: 2 } });
    expect(cart.selectors.count()).toBe(2);
  });
});
