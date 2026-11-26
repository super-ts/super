type Options = {
  storage?: Pick<Storage, 'getItem' | 'setItem'>;
  key?: string;
};

/**
 * Adapter (user-land): the cart saved in localStorage, so that it survives a page reload.
 * The store does not know about it: `main.ts` reads the saved cart back when the store is created,
 * then saves it on every change (`cart.subscribe`).
 */
export function createSavedCart({ storage = window.localStorage, key = 'super.cart' }: Options = {}) {
  return {
    /** The saved cart; empty if nothing is saved or if the value is unreadable. */
    load(): Record<string, number> {
      try {
        const parsed: unknown = JSON.parse(storage.getItem(key) ?? '{}');
        const valid =
          typeof parsed === 'object' &&
          parsed !== null &&
          !Array.isArray(parsed) &&
          Object.values(parsed).every((value) => Number.isInteger(value) && (value as number) >= 0);
        return valid ? (parsed as Record<string, number>) : {};
      } catch {
        return {};
      }
    },
    save(quantities: Readonly<Record<string, number>>): void {
      storage.setItem(key, JSON.stringify(quantities));
    },
  };
}
