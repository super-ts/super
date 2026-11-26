import { type StoreHandle, SuperContract } from '@super-ts/core';
import { registerContract } from '@super-ts/core/internal';
import type { Screen, Selected } from './element.ts';

type Simplify<T> = { [K in keyof T]: T[K] } & {};

/* ------------------------------------------------------------------------------------------ */
/* Routes declared by a string: '/counters/:id?sort&tag[]'                                    */
/* ------------------------------------------------------------------------------------------ */

/** Path part of a declaration: `'/counters/:id?tab'` gives `'/counters/:id'`. */
type PathPart<P extends string> = P extends `${infer Path}?${string}` ? Path : P;
/** Query part of a declaration: `'/counters?sort&tag[]'` gives `'sort&tag[]'`. */
type QueryPart<P extends string> = P extends `${string}?${infer Query}` ? Query : '';

type SegmentNames<P extends string> = P extends `${string}:${infer Name}/${infer Rest}`
  ? Name | SegmentNames<`/${Rest}`>
  : P extends `${string}:${infer Name}`
    ? Name
    : never;
/** The parameter names of a path: `'/a/:x/b/:y'` gives `'x' | 'y'`. */
export type ParamNames<P extends string> = SegmentNames<PathPart<P>>;

type QueryEntries<Q extends string> = Q extends `${infer Key}&${infer Rest}` ? Key | QueryEntries<Rest> : Q extends '' ? never : Q;
/** Single-valued query keys: `sort` in `?sort&tag[]`. */
type SingleKeys<P extends string> = Exclude<QueryEntries<QueryPart<P>>, `${string}[]`>;
/** Query keys that are lists: `tag` in `?sort&tag[]`. */
type ListKeys<P extends string> = QueryEntries<QueryPart<P>> extends infer K ? (K extends `${infer Name}[]` ? Name : never) : never;

/** `'/counters/:id'` gives `{ id: string }`, `'/'` gives `{}`. The declared query is not part of it. */
export type PathParams<P extends string> = string extends P ? Record<string, string> : { [K in ParamNames<P>]: string };

/**
 * Query of a string: `'/counters?sort&tag[]'` gives `{ sort?: string; tag: string[] }`. A single
 * key may be missing; a list is `[]` if absent.
 */
export type QueryParams<P extends string> = string extends P
  ? Record<string, string | string[]>
  : Simplify<{ [K in SingleKeys<P>]?: string } & { [K in ListKeys<P>]: string[] }>;

/* ------------------------------------------------------------------------------------------ */
/* Described routes: { path, params: params<T>({…}), query: query<T>({…}) }                     */
/* ------------------------------------------------------------------------------------------ */

declare const DESCRIBED: unique symbol;

/** A list of allowed values: `{ oneOf: ['label', 'value'] }`. */
type OneOf<V> = { readonly oneOf: readonly V[] };

/**
 * How a value of type `V` is read from the URL: `String`, `Number`, `Boolean`, or the list
 * of allowed values (`{ oneOf: [...] }`) for a union of literals.
 */
export type ValueSpec<V> = [V] extends [string]
  ? string extends V
    ? StringConstructor
    : OneOf<V>
  : [V] extends [number]
    ? number extends V
      ? NumberConstructor
      : OneOf<V>
    : [V] extends [boolean]
      ? BooleanConstructor
      : never;

/** The same, with a default value: `{ type: Number, default: 1 }`, `{ oneOf: [...], default: 'label' }`. */
type WithDefault<V> = (ValueSpec<V> extends infer S ? (S extends OneOf<unknown> ? S : { readonly type: S }) : never) & {
  readonly default: V;
};

type IsOptional<T, K extends keyof T> = {} extends Pick<T, K> ? true : false;

/** Description of a path's parameters: one value per parameter, always present. */
export type ParamsSpec<T> = { readonly [K in keyof T]-?: IsOptional<T, K> extends true ? never : ValueSpec<T[K]> };

/**
 * Description of a query key, according to its type:
 * - a list (`string[]`): `[String]`, `[Number]`, `[{ oneOf: [...] }]`; is `[]` if absent;
 * - an optional key (`search?: string`): `String`, `Number`, `Boolean` or `{ oneOf }`;
 * - a required key (`page: number`): with its default value, used if it is absent.
 */
export type QueryFieldSpec<T, K extends keyof T> =
  NonNullable<T[K]> extends readonly (infer E)[]
    ? readonly [ValueSpec<E>]
    : IsOptional<T, K> extends true
      ? ValueSpec<NonNullable<T[K]>>
      : WithDefault<T[K]>;

export type QuerySpec<T> = { readonly [K in keyof T]-?: QueryFieldSpec<T, K> };

/** The described parameters of a route, typed by `T`. */
export interface ParamsDescription<T> {
  readonly [DESCRIBED]?: T;
  readonly kind: 'params';
  readonly spec: object;
}

/** The described query of a route, typed by `T`. */
export interface QueryDescription<T> {
  readonly [DESCRIBED]?: T;
  readonly kind: 'query';
  readonly spec: object;
}

/**
 * The path parameters of a route, typed by `T` and described for reading the URL:
 *
 * ```ts
 * type CounterParams = { id: number };
 * counter: { path: '/counters/:id', params: params<CounterParams>({ id: Number }) }
 * ```
 */
export function params<T>(spec: ParamsSpec<T>): ParamsDescription<T> {
  return Object.freeze({ kind: 'params', spec: Object.freeze({ ...spec }) });
}

/**
 * The query of a route, typed by `T` and described for reading the URL:
 *
 * ```ts
 * type CountersQuery = { sort: 'label' | 'value'; page: number; tag: string[]; search?: string };
 * counters: {
 *   path: '/counters',
 *   query: query<CountersQuery>({
 *     sort: { oneOf: ['label', 'value'], default: 'label' },
 *     page: { type: Number, default: 1 },
 *     tag: [String],
 *     search: String,
 *   }),
 * }
 * ```
 */
export function query<T>(spec: QuerySpec<T>): QueryDescription<T> {
  return Object.freeze({ kind: 'query', spec: Object.freeze({ ...spec }) });
}

/** A route: its path alone (`'/counters/:id?sort'`), or its path and its descriptions. */
export type RouteDeclaration =
  | string
  | { readonly path: string; readonly params?: ParamsDescription<any>; readonly query?: QueryDescription<any> };

/** The app's routes, by name. */
export type RouteTable = Record<string, RouteDeclaration>;

/** The path of a route, without query: `'/counters/:id'`. */
export type PathOf<D> = D extends string ? PathPart<D> : D extends { readonly path: infer P extends string } ? P : never;

/** The parameters of a route, typed: `{ id: number }`. */
export type ParamsOf<D> = D extends string
  ? PathParams<D>
  : D extends { readonly params: ParamsDescription<infer T> }
    ? T
    : PathParams<PathOf<D>>;

/** The query of a route, typed: `{ sort: 'label' | 'value'; tag: string[] }`. */
export type QueryOf<D> = D extends string ? QueryParams<D> : D extends { readonly query: QueryDescription<infer T> } ? T : {};

/**
 * Rejects at compile time a described route whose parameters are not those of the path, or
 * whose path carries a query (it is described with `query`).
 */
export type CheckedRoutes<T extends RouteTable> = {
  [N in keyof T]: T[N] extends { readonly path: infer P extends string }
    ? P extends `${string}?${string}`
      ? `[super] route "${N & string}": the query is described with query<T>({…}), not in the path`
      : T[N] extends { readonly params: ParamsDescription<infer X> }
        ? [Exclude<keyof X, ParamNames<P>> | Exclude<ParamNames<P>, keyof X>] extends [never]
          ? T[N]
          : `[super] route "${N & string}": params must describe exactly the path parameters (${ParamNames<P> & string})`
        : T[N]
    : T[N];
};

/* ------------------------------------------------------------------------------------------ */
/* Building a URL: href, navigate, redirect                                                    */
/* ------------------------------------------------------------------------------------------ */

type QueryInputOf<D> = {
  [K in keyof QueryOf<D>]?: NonNullable<QueryOf<D>[K]> extends readonly (infer E)[] ? readonly E[] : QueryOf<D>[K];
};

type ParamsPart<D> = [keyof ParamsOf<D>] extends [never] ? { params?: Record<string, never> } : { params: ParamsOf<D> };
type QueryPartOf<D> = [keyof QueryOf<D>] extends [never] ? { query?: Record<string, never> } : { query?: QueryInputOf<D> };

/**
 * What you give to build a route's URL: its parameters (required if there are any), and its
 * query (optional). A route without parameters or query rejects any key.
 */
export type RouteInput<D> = Simplify<ParamsPart<D> & QueryPartOf<D>>;

export type NavigateTargetOf<T extends RouteTable> = {
  [N in keyof T & string]: Simplify<{ to: N } & RouteInput<T[N]>>;
}[keyof T & string];

export type HrefArgs<T extends RouteTable, N extends keyof T> =
  {} extends RouteInput<T[N]> ? [input?: RouteInput<T[N]>] : [input: RouteInput<T[N]>];

declare const REDIRECT: unique symbol;

/** Redirect declared in place of a screen: `redirect({ to: 'home' })`. */
export interface Redirect<Target extends { to: string } = { to: string; params?: object; query?: object }> {
  readonly [REDIRECT]: true;
  readonly target: Target;
}

/**
 * For each route, a screen without required props (it reads the route through `this.router.current`),
 * or a redirect to another route.
 */
export type ScreensFor<T extends RouteTable> = {
  [N in keyof T]: Screen<{}> | Redirect<NavigateTargetOf<T>>;
};

/** Screen displayed when a screen crashes without being caught: it receives the error and the path. */
export type ErrorScreen = Screen<{ error: Error; path: string }>;

/* ------------------------------------------------------------------------------------------ */
/* Reading the active route: this.router.current                                               */
/* ------------------------------------------------------------------------------------------ */

/**
 * A value of the active route, to call to read it: `current.params.id()`. It is passed
 * as is to `this.selector(…)`. `isValid()` tells whether the URL contained a value conforming to the
 * description; after this test, the value has the described type (`number` and not `number | undefined`).
 */
export interface RouteValue<V, Valid = V> {
  (): V;
  isValid(): this is RouteValue<Valid, Valid>;
}

/** A `string` path parameter is always valid; another type may be missing (`/counters/abc`). */
type ParamValue<V> = string extends V ? V : V | undefined;

type KeysOver<U> = U extends unknown ? keyof U & string : never;

/** The path parameters of the routes `R`, merged: a key absent from a route is `undefined` there. */
export type ParamValues<T extends RouteTable, R extends keyof T> = {
  readonly [K in KeysOver<{ [N in R]: ParamsOf<T[N]> }[R]>]: RouteValue<
    { [N in R]: K extends keyof ParamsOf<T[N]> ? ParamValue<ParamsOf<T[N]>[K]> : undefined }[R],
    { [N in R]: K extends keyof ParamsOf<T[N]> ? ParamsOf<T[N]>[K] : never }[R]
  >;
};

/** The query of the routes `R`, merged: a key absent from a route is `undefined` there. */
export type QueryValues<T extends RouteTable, R extends keyof T> = {
  readonly [K in KeysOver<{ [N in R]: QueryOf<T[N]> }[R]>]: RouteValue<
    { [N in R]: K extends keyof QueryOf<T[N]> ? QueryOf<T[N]>[K] : undefined }[R],
    { [N in R]: K extends keyof QueryOf<T[N]> ? QueryOf<T[N]>[K] : never }[R]
  >;
};

/** A specific route, seen through `this.router.at('counter')` or by its guard. */
export interface RouteAt<T extends RouteTable, N extends keyof T> {
  readonly params: ParamValues<T, N>;
  readonly query: QueryValues<T, N>;
}

/**
 * The active route, read through `this.router.current`. In a screen, `R` is its route (link generated
 * by the Vite plugin); elsewhere, all the app's routes.
 */
export interface CurrentRoute<T extends RouteTable, R extends keyof T> extends RouteAt<T, R> {
  /** Name of the active route, `null` if none matches. */
  name(): Selected<(R & string) | null>;
  /** Current path, as navigated (query and hash included). */
  path(): Selected<string>;
}

/* ------------------------------------------------------------------------------------------ */
/* Router contract                                                                             */
/* ------------------------------------------------------------------------------------------ */

export type RouteState<T extends RouteTable = RouteTable> = {
  /** Current path, as navigated (query and hash included). */
  path: string;
  /** Name of the active route, `null` if none matches. */
  name: (keyof T & string) | null;
  /** Path parameters, converted; `undefined` for an invalid parameter. */
  params: Readonly<Record<string, unknown>>;
  /** Query declared by the active route, converted: default or `undefined` if absent or invalid, `[]` for a list. */
  query: Readonly<Record<string, unknown>>;
  /** The keys for which the URL carried an invalid value. */
  invalid: { readonly params: readonly string[]; readonly query: readonly string[] };
  /** Screen to display by `RouterOutlet` (the `'*'` screen if no route matches). */
  screen: Screen<any> | null;
  /** `'!'` screen, displayed by `RouterOutlet` if the screen crashes without being caught. */
  errorScreen: ErrorScreen | null;
};

export type RouterCommands<T extends RouteTable = RouteTable> = {
  /** Navigation typed by route name: `{ to: 'counter', params: { id: 42 }, query: { tab: 'x' } }`. */
  navigate(target: NavigateTargetOf<T>): void;
  /** Navigation by raw path (used for `<a href>` links). */
  visit(path: string): void;
  back(): void;
};

export type RouterEvents = { navigated: { from: string; to: string } };

/** The router handle created by `createRouter`: pass it to `createApp({ router })` or `mount(…, { router })`. */
export type RouterHandle<T extends RouteTable = RouteTable> = StoreHandle<RouteState<T>, RouterCommands<T>, RouterEvents>;

type RouterTypes<T extends RouteTable> = { state: RouteState<T>; commands: RouterCommands<T>; events: RouterEvents };

/**
 * The contract of an app's router, typed by its routes. Registered under the name `'router'` in the
 * contract dictionary generated by the Vite plugin; a component reads it through `this.router`.
 */
export interface AppRouterContract<T extends RouteTable = RouteTable> extends SuperContract<RouterTypes<T>> {
  /** Phantom: the app's routes. */
  readonly __routes?: T;
}

/** The routes of a router contract. */
export type PathsOfRouter<K> = K extends AppRouterContract<infer T> ? T : never;

/** The contract of an app's router, from its declaration: `AppRouterContractOf<typeof Router>`. */
export type AppRouterContractOf<R> = R extends { readonly paths: infer T extends RouteTable } ? AppRouterContract<T> : never;

const has = (record: Readonly<Record<string, unknown>>, key: string) => Object.hasOwn(record, key);

/** Under the hood: the router's selectors, read by `this.router.current` and by `RouterOutlet`. */
export class RouterSelectors extends SuperContract<RouterTypes<RouteTable>> {
  constructor() {
    super({ name: ROUTER_NAME });
  }
  route(s: RouteState) {
    return s.name;
  }
  path(s: RouteState) {
    return s.path;
  }
  param(s: RouteState, key: string) {
    return s.params[key];
  }
  paramValid(s: RouteState, key: string) {
    return has(s.params, key) && !s.invalid.params.includes(key);
  }
  query(s: RouteState, key: string) {
    return s.query[key];
  }
  queryValid(s: RouteState, key: string) {
    return has(s.query, key) && !s.invalid.query.includes(key);
  }
  screen(s: RouteState) {
    return s.screen;
  }
  errorScreen(s: RouteState) {
    return s.errorScreen;
  }
}

/** The name under which the router is provided to components (`this.router`) and to the outlet. */
export const ROUTER_NAME = 'router';

registerContract(ROUTER_NAME, () => RouterSelectors);

/* ------------------------------------------------------------------------------------------ */
/* The screen → route link, generated by the Vite plugin                                       */
/* ------------------------------------------------------------------------------------------ */

/**
 * The link between a screen's tag and its route, filled by the Vite plugin from
 * `.screens(…)`: `'counter-screen': 'counter'`. A screen finds its route's type there.
 */
// biome-ignore lint/suspicious/noEmptyInterface: augmented by the generated types file
export interface ScreenRoutes {}

/** The app's routes (`never` if it has no router). */
export type AppRouteNames = import('@super-ts/core').Contracts extends { router: infer K } ? keyof PathsOfRouter<K> & string : never;

/** A screen's route by its tag; all routes for a component that is not a screen. */
export type RouteOfTag<Tag extends string> = Tag extends keyof ScreenRoutes ? ScreenRoutes[Tag] & AppRouteNames : AppRouteNames;

/* ------------------------------------------------------------------------------------------ */
/* Under the hood: route values, at runtime                                                    */
/* ------------------------------------------------------------------------------------------ */

/** Brand of a route value: `this.selector(…)` adds `isValid()` to it. */
export const ROUTE_VALUE = Symbol('super.route-value');

/** A route value at runtime: a function that reads, and `isValid`. */
export type RuntimeRouteValue = (() => unknown) & { isValid(): boolean; readonly [ROUTE_VALUE]: true };

/**
 * The values of a route, by key (`params.id`, `query.sort`), read on call. A key always gives
 * the same function: destructuring (`const { id } = current.params`) keeps it.
 */
export function routeValues(read: (key: string) => unknown, valid: (key: string) => boolean): Record<string, RuntimeRouteValue> {
  const values = new Map<string, RuntimeRouteValue>();
  return new Proxy({} as Record<string, RuntimeRouteValue>, {
    get(_target, key) {
      if (typeof key !== 'string') return undefined;
      let value = values.get(key);
      if (!value) {
        value = Object.assign(() => read(key), { isValid: () => valid(key), [ROUTE_VALUE]: true as const });
        values.set(key, value);
      }
      return value;
    },
  });
}

export const isRouteValue = (value: unknown): value is RuntimeRouteValue => typeof value === 'function' && ROUTE_VALUE in value;
