/**
 * Mémoïsation des sélecteurs. Interne à Super : exposé aux autres paquets par `@super-ts/core/internal`,
 * jamais par `@super-ts/core`.
 */

type AnySelector = (state: any, ...args: any[]) => unknown;

/** Les champs de premier niveau lus par un sélecteur, ou `ALL` s'il a parcouru l'état entier. */
const ALL = Symbol('all');
type Deps = Set<PropertyKey> | typeof ALL;

/**
 * Un emplacement de cache par liste d'arguments : un niveau par argument, le résultat au bout.
 * Les arguments objets passent par une `WeakMap` pour ne pas les retenir.
 */
type Slot = {
  prims?: Map<unknown, Slot>;
  objs?: WeakMap<object, Slot>;
  has?: boolean;
  state?: object;
  deps?: Deps;
  value?: unknown;
};

function slotFor(root: Slot, args: readonly unknown[]): Slot {
  let slot = root;
  for (const arg of args) {
    let child: Slot | undefined;
    if ((typeof arg === 'object' && arg !== null) || typeof arg === 'function') {
      slot.objs ??= new WeakMap();
      child = slot.objs.get(arg);
      if (!child) slot.objs.set(arg, (child = {}));
    } else {
      slot.prims ??= new Map();
      child = slot.prims.get(arg);
      if (!child) slot.prims.set(arg, (child = {}));
    }
    slot = child;
  }
  return slot;
}

/**
 * Exécute `select` sur un proxy de l'état qui note les champs de premier niveau lus. Le suivi ne
 * descend pas plus bas : l'état est gelé, et un proxy doit rendre telle quelle une propriété gelée.
 */
function tracked(select: AnySelector, state: object, args: readonly unknown[]): { value: unknown; deps: Deps } {
  let deps: Deps = new Set();
  let active = true;
  const note = (key: PropertyKey) => {
    if (active && deps !== ALL) deps.add(key);
  };
  const proxy = new Proxy(state, {
    get: (target, key) => (note(key), Reflect.get(target, key)),
    has: (target, key) => (note(key), Reflect.has(target, key)),
    getOwnPropertyDescriptor: (target, key) => (note(key), Reflect.getOwnPropertyDescriptor(target, key)),
    ownKeys: (target) => {
      if (active) deps = ALL;
      return Reflect.ownKeys(target);
    },
  });
  try {
    const value = select(proxy, ...args);
    // `(s) => s` ne doit pas laisser fuir le proxy.
    return { value: value === proxy ? state : value, deps };
  } finally {
    active = false; // un proxy capturé par le résultat ne fausse plus les dépendances
  }
}

const unchanged = (deps: Deps, previous: object, next: object) =>
  deps !== ALL &&
  [...deps].every((key) => Object.is((previous as Record<PropertyKey, unknown>)[key], (next as Record<PropertyKey, unknown>)[key]));

/**
 * Cache des sélecteurs d'un store : créé avec lui, libéré avec lui. Pour chaque sélecteur et liste
 * d'arguments :
 * - même état, ou aucun champ lu n'a changé de référence : le résultat précédent, sans recalcul ;
 * - sinon : recalcul, puis partage structurel avec le résultat précédent (voir `share`).
 */
export class SelectorCache {
  #roots = new WeakMap<AnySelector, Slot>();

  run(select: AnySelector, state: object, args: readonly unknown[]): unknown {
    let root = this.#roots.get(select);
    if (!root) this.#roots.set(select, (root = {}));
    const slot = slotFor(root, args);
    if (slot.has && (slot.state === state || unchanged(slot.deps!, slot.state!, state))) {
      slot.state = state;
      return slot.value;
    }
    const { value, deps } = tracked(select, state, args);
    slot.value = slot.has ? share(slot.value, value) : value;
    slot.deps = deps;
    slot.state = state;
    slot.has = true;
    return slot.value;
  }
}

/** Égalité par référence, ou clé par clé sur un seul niveau pour les objets et les tableaux. */
export function shallowEqual(a: unknown, b: unknown): boolean {
  if (Object.is(a, b)) return true;
  if (typeof a !== 'object' || typeof b !== 'object' || a === null || b === null) return false;
  if (Array.isArray(a) !== Array.isArray(b)) return false;
  const keysA = Object.keys(a);
  if (keysA.length !== Object.keys(b).length) return false;
  return keysA.every((key) => Object.hasOwn(b, key) && Object.is((a as any)[key], (b as any)[key]));
}

const isPlainObject = (value: unknown): value is Record<string, unknown> => {
  if (typeof value !== 'object' || value === null) return false;
  const proto = Object.getPrototypeOf(value);
  return proto === Object.prototype || proto === null;
};

/**
 * Partage structurel : renvoie `previous` si `next` lui est structurellement égal, sinon `next` en
 * reprenant les parties de `previous` qui n'ont pas changé. Ne descend que dans les tableaux et les
 * objets simples ; tout le reste (Date, Map, instances) se compare par référence.
 *
 * Dans un tableau, un élément déjà présent tel quel dans l'ancien tableau est gardé sans être
 * parcouru : une insertion ou un tri ne coûte qu'une comparaison de références par élément.
 */
export function share(previous: unknown, next: unknown): unknown {
  if (Object.is(previous, next)) return previous;

  if (Array.isArray(previous) && Array.isArray(next)) {
    let known: Set<unknown> | undefined;
    const shared = next.map((item, i) => {
      if (i < previous.length && Object.is(previous[i], item)) return item;
      known ??= new Set(previous);
      if (known.has(item)) return item;
      return i < previous.length ? share(previous[i], item) : item;
    });
    if (shared.length === previous.length && shared.every((item, i) => item === previous[i])) return previous;
    return shared.every((item, i) => item === next[i]) ? next : sameFreeze(next, shared);
  }

  if (isPlainObject(previous) && isPlainObject(next)) {
    const keys = Object.keys(next);
    const shared: Record<string, unknown> = Object.create(Object.getPrototypeOf(next));
    for (const key of keys) shared[key] = Object.hasOwn(previous, key) ? share(previous[key], next[key]) : next[key];
    const sameKeys = keys.length === Object.keys(previous).length && keys.every((key) => Object.hasOwn(previous, key));
    if (sameKeys && keys.every((key) => shared[key] === previous[key])) return previous;
    return keys.every((key) => shared[key] === next[key]) ? next : sameFreeze(next, shared);
  }

  return next;
}

/** La copie garde le gel de l'original : un résultat figé par le sélecteur le reste. */
const sameFreeze = <T>(original: unknown, copy: T): T => (Object.isFrozen(original) ? Object.freeze(copy) : copy);

const deeplyFrozen = new WeakSet<object>();

/**
 * Gèle en profondeur les tableaux et objets simples de l'état. Une mutation en place lève alors une
 * erreur au point où elle est écrite, au lieu de passer inaperçue du suivi des sélecteurs. Les
 * sous-arbres déjà gelés par Super sont sautés : le coût suit ce que le `set` vient de créer.
 */
export function deepFreeze<T>(value: T): T {
  if ((!Array.isArray(value) && !isPlainObject(value)) || deeplyFrozen.has(value)) return value;
  for (const child of Object.values(value)) deepFreeze(child);
  Object.freeze(value);
  deeplyFrozen.add(value);
  return value;
}
