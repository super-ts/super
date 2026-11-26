import { createSavedCart } from './saved-cart';

/** Un stockage en mémoire, à la place du localStorage. */
function memoryStorage(initial: Record<string, string> = {}) {
  const values = new Map(Object.entries(initial));
  return { getItem: (key: string) => values.get(key) ?? null, setItem: (key: string, value: string) => void values.set(key, value) };
}

describe('createSavedCart', () => {
  test('relit ce qui a été enregistré', () => {
    const storage = memoryStorage();
    createSavedCart({ storage }).save({ mug: 2 });
    expect(createSavedCart({ storage }).load()).toEqual({ mug: 2 });
  });

  test('un panier absent ou illisible est vide', () => {
    expect(createSavedCart({ storage: memoryStorage() }).load()).toEqual({});
    expect(createSavedCart({ storage: memoryStorage({ 'super.cart': '{oups' }) }).load()).toEqual({});
    expect(createSavedCart({ storage: memoryStorage({ 'super.cart': '{"mug":-1}' }) }).load()).toEqual({});
  });
});
