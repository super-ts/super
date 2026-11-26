type Options = {
  storage?: Pick<Storage, 'getItem' | 'setItem'>;
  key?: string;
};

/**
 * Adapter (user-land) : le panier enregistré dans le localStorage, pour qu'il survive au
 * rechargement de la page. Le store ne le connaît pas : `main.ts` relit le panier enregistré à la
 * création du store, puis l'enregistre à chaque changement (`cart.subscribe`).
 */
export function createSavedCart({ storage = window.localStorage, key = 'super.cart' }: Options = {}) {
  return {
    /** Le panier enregistré ; vide si rien n'est enregistré ou si la valeur est illisible. */
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
