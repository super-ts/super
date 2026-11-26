import { createSavedCart } from './saved-cart';

/** An in-memory storage, in place of localStorage. */
function memoryStorage(initial: Record<string, string> = {}) {
  const values = new Map(Object.entries(initial));
  return { getItem: (key: string) => values.get(key) ?? null, setItem: (key: string, value: string) => void values.set(key, value) };
}

describe('createSavedCart', () => {
  test('reads back what was saved', () => {
    const storage = memoryStorage();
    createSavedCart({ storage }).save({ mug: 2 });
    expect(createSavedCart({ storage }).load()).toEqual({ mug: 2 });
  });

  test('a missing or unreadable cart is empty', () => {
    expect(createSavedCart({ storage: memoryStorage() }).load()).toEqual({});
    expect(createSavedCart({ storage: memoryStorage({ 'super.cart': '{oops' }) }).load()).toEqual({});
    expect(createSavedCart({ storage: memoryStorage({ 'super.cart': '{"mug":-1}' }) }).load()).toEqual({});
  });
});
