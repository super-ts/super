/**
 * Selector memoisation. Internal to Super: exposed to the other packages through `@super-ts/core/internal`,
 * never through `@super-ts/core`.
 */

type AnySelector = (state: any, ...args: any[]) => unknown;

/** The top-level fields read by a selector, or `ALL` if it walked the whole state. */
const ALL = Symbol('all');
type Deps = Set<PropertyKey> | typeof ALL;

/**
 * One cache slot per argument list: one level per argument, the result at the end.
 * Object arguments go through a `WeakMap` so they are not retained.
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
 * Runs `select` on a proxy of the state that records the top-level fields read. Tracking goes no
 * deeper: the state is frozen, and a proxy must return a frozen property as is.
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
    // `(s) => s` must not leak the proxy.
    return { value: value === proxy ? state : value, deps };
  } finally {
    active = false; // a proxy captured by the result no longer skews the dependencies
  }
}

const unchanged = (deps: Deps, previous: object, next: object) =>
  deps !== ALL &&
  [...deps].every((key) => Object.is((previous as Record<PropertyKey, unknown>)[key], (next as Record<PropertyKey, unknown>)[key]));

/**
 * Selector cache of a store: created with it, released with it. For each selector and argument
 * list:
 * - same state, or no field read has changed reference: the previous result, without recomputing;
 * - otherwise: recompute, then structural sharing with the previous result (see `share`).
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

/** Equality by reference, or key by key on a single level for objects and arrays. */
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
 * Structural sharing: returns `previous` if `next` is structurally equal to it, otherwise `next`
 * reusing the parts of `previous` that have not changed. Only descends into arrays and plain
 * objects; everything else (Date, Map, instances) is compared by reference.
 *
 * In an array, an element already present as is in the old array is kept without being walked:
 * an insertion or a sort only costs one reference comparison per element.
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

/** The copy keeps the original's freeze: a result frozen by the selector stays frozen. */
const sameFreeze = <T>(original: unknown, copy: T): T => (Object.isFrozen(original) ? Object.freeze(copy) : copy);

const deeplyFrozen = new WeakSet<object>();

/**
 * Deep-freezes the arrays and plain objects of the state. An in-place mutation then throws an
 * error where it is written, instead of going unnoticed by selector tracking. Subtrees already
 * frozen by Super are skipped: the cost follows what the `set` has just created.
 */
export function deepFreeze<T>(value: T): T {
  if ((!Array.isArray(value) && !isPlainObject(value)) || deeplyFrozen.has(value)) return value;
  for (const child of Object.values(value)) deepFreeze(child);
  Object.freeze(value);
  deeplyFrozen.add(value);
  return value;
}
