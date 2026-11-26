import { type StoreHandle, SuperContract } from '@super-ts/core';
import { registerContract } from '@super-ts/core/internal';
import type { Screen, Selected } from './element.ts';

type Simplify<T> = { [K in keyof T]: T[K] } & {};

/* ------------------------------------------------------------------------------------------ */
/* Routes déclarées par une chaîne : '/counters/:id?sort&tag[]'                                */
/* ------------------------------------------------------------------------------------------ */

/** Partie chemin d'une déclaration : `'/counters/:id?tab'` donne `'/counters/:id'`. */
type PathPart<P extends string> = P extends `${infer Path}?${string}` ? Path : P;
/** Partie query d'une déclaration : `'/counters?sort&tag[]'` donne `'sort&tag[]'`. */
type QueryPart<P extends string> = P extends `${string}?${infer Query}` ? Query : '';

type SegmentNames<P extends string> = P extends `${string}:${infer Name}/${infer Rest}`
  ? Name | SegmentNames<`/${Rest}`>
  : P extends `${string}:${infer Name}`
    ? Name
    : never;
/** Les noms des paramètres d'un chemin : `'/a/:x/b/:y'` donne `'x' | 'y'`. */
export type ParamNames<P extends string> = SegmentNames<PathPart<P>>;

type QueryEntries<Q extends string> = Q extends `${infer Key}&${infer Rest}` ? Key | QueryEntries<Rest> : Q extends '' ? never : Q;
/** Clés de query à une valeur : `sort` dans `?sort&tag[]`. */
type SingleKeys<P extends string> = Exclude<QueryEntries<QueryPart<P>>, `${string}[]`>;
/** Clés de query qui sont des listes : `tag` dans `?sort&tag[]`. */
type ListKeys<P extends string> = QueryEntries<QueryPart<P>> extends infer K ? (K extends `${infer Name}[]` ? Name : never) : never;

/** `'/counters/:id'` donne `{ id: string }`, `'/'` donne `{}`. La query déclarée n'en fait pas partie. */
export type PathParams<P extends string> = string extends P ? Record<string, string> : { [K in ParamNames<P>]: string };

/**
 * Query d'une chaîne : `'/counters?sort&tag[]'` donne `{ sort?: string; tag: string[] }`. Une clé
 * simple peut manquer ; une liste vaut `[]` si absente.
 */
export type QueryParams<P extends string> = string extends P
  ? Record<string, string | string[]>
  : Simplify<{ [K in SingleKeys<P>]?: string } & { [K in ListKeys<P>]: string[] }>;

/* ------------------------------------------------------------------------------------------ */
/* Routes décrites : { path, params: params<T>({…}), query: query<T>({…}) }                     */
/* ------------------------------------------------------------------------------------------ */

declare const DESCRIBED: unique symbol;

/** Une liste de valeurs permises : `{ oneOf: ['label', 'value'] }`. */
type OneOf<V> = { readonly oneOf: readonly V[] };

/**
 * Comment se lit une valeur de type `V` dans l'URL : `String`, `Number`, `Boolean`, ou la liste
 * des valeurs permises (`{ oneOf: [...] }`) pour une union de littéraux.
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

/** La même, avec une valeur par défaut : `{ type: Number, default: 1 }`, `{ oneOf: [...], default: 'label' }`. */
type WithDefault<V> = (ValueSpec<V> extends infer S ? (S extends OneOf<unknown> ? S : { readonly type: S }) : never) & {
  readonly default: V;
};

type IsOptional<T, K extends keyof T> = {} extends Pick<T, K> ? true : false;

/** Description des paramètres d'un chemin : une valeur par paramètre, toujours présente. */
export type ParamsSpec<T> = { readonly [K in keyof T]-?: IsOptional<T, K> extends true ? never : ValueSpec<T[K]> };

/**
 * Description d'une clé de query, selon son type :
 * - une liste (`string[]`) : `[String]`, `[Number]`, `[{ oneOf: [...] }]` ; vaut `[]` si absente ;
 * - une clé facultative (`search?: string`) : `String`, `Number`, `Boolean` ou `{ oneOf }` ;
 * - une clé obligatoire (`page: number`) : avec sa valeur par défaut, prise si elle est absente.
 */
export type QueryFieldSpec<T, K extends keyof T> =
  NonNullable<T[K]> extends readonly (infer E)[]
    ? readonly [ValueSpec<E>]
    : IsOptional<T, K> extends true
      ? ValueSpec<NonNullable<T[K]>>
      : WithDefault<T[K]>;

export type QuerySpec<T> = { readonly [K in keyof T]-?: QueryFieldSpec<T, K> };

/** Les paramètres décrits d'une route, typés par `T`. */
export interface ParamsDescription<T> {
  readonly [DESCRIBED]?: T;
  readonly kind: 'params';
  readonly spec: object;
}

/** La query décrite d'une route, typée par `T`. */
export interface QueryDescription<T> {
  readonly [DESCRIBED]?: T;
  readonly kind: 'query';
  readonly spec: object;
}

/**
 * Les paramètres du chemin d'une route, typés par `T` et décrits pour la lecture de l'URL :
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
 * La query d'une route, typée par `T` et décrite pour la lecture de l'URL :
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

/** Une route : son chemin seul (`'/counters/:id?sort'`), ou son chemin et ses descriptions. */
export type RouteDeclaration =
  | string
  | { readonly path: string; readonly params?: ParamsDescription<any>; readonly query?: QueryDescription<any> };

/** Les routes de l'app, par nom. */
export type RouteTable = Record<string, RouteDeclaration>;

/** Le chemin d'une route, sans query : `'/counters/:id'`. */
export type PathOf<D> = D extends string ? PathPart<D> : D extends { readonly path: infer P extends string } ? P : never;

/** Les paramètres d'une route, typés : `{ id: number }`. */
export type ParamsOf<D> = D extends string
  ? PathParams<D>
  : D extends { readonly params: ParamsDescription<infer T> }
    ? T
    : PathParams<PathOf<D>>;

/** La query d'une route, typée : `{ sort: 'label' | 'value'; tag: string[] }`. */
export type QueryOf<D> = D extends string ? QueryParams<D> : D extends { readonly query: QueryDescription<infer T> } ? T : {};

/**
 * Refuse à la compilation une route décrite dont les paramètres ne sont pas ceux du chemin, ou
 * dont le chemin porte une query (elle se décrit par `query`).
 */
export type CheckedRoutes<T extends RouteTable> = {
  [N in keyof T]: T[N] extends { readonly path: infer P extends string }
    ? P extends `${string}?${string}`
      ? `[super] route "${N & string}" : la query se décrit par query<T>({…}), pas dans le chemin`
      : T[N] extends { readonly params: ParamsDescription<infer X> }
        ? [Exclude<keyof X, ParamNames<P>> | Exclude<ParamNames<P>, keyof X>] extends [never]
          ? T[N]
          : `[super] route "${N & string}" : params doit décrire exactement les paramètres du chemin (${ParamNames<P> & string})`
        : T[N]
    : T[N];
};

/* ------------------------------------------------------------------------------------------ */
/* Construire une URL : href, navigate, redirect                                                */
/* ------------------------------------------------------------------------------------------ */

type QueryInputOf<D> = {
  [K in keyof QueryOf<D>]?: NonNullable<QueryOf<D>[K]> extends readonly (infer E)[] ? readonly E[] : QueryOf<D>[K];
};

type ParamsPart<D> = [keyof ParamsOf<D>] extends [never] ? { params?: Record<string, never> } : { params: ParamsOf<D> };
type QueryPartOf<D> = [keyof QueryOf<D>] extends [never] ? { query?: Record<string, never> } : { query?: QueryInputOf<D> };

/**
 * Ce qu'on donne pour construire l'URL d'une route : ses paramètres (requis s'il y en a), et sa
 * query (facultative). Une route sans paramètre ni query refuse toute clé.
 */
export type RouteInput<D> = Simplify<ParamsPart<D> & QueryPartOf<D>>;

export type NavigateTargetOf<T extends RouteTable> = {
  [N in keyof T & string]: Simplify<{ to: N } & RouteInput<T[N]>>;
}[keyof T & string];

export type HrefArgs<T extends RouteTable, N extends keyof T> =
  {} extends RouteInput<T[N]> ? [input?: RouteInput<T[N]>] : [input: RouteInput<T[N]>];

declare const REDIRECT: unique symbol;

/** Redirection déclarée à la place d'un écran : `redirect({ to: 'home' })`. */
export interface Redirect<Target extends { to: string } = { to: string; params?: object; query?: object }> {
  readonly [REDIRECT]: true;
  readonly target: Target;
}

/**
 * Pour chaque route, un écran sans props obligatoire (il lit la route par `this.router.current`),
 * ou une redirection vers une autre route.
 */
export type ScreensFor<T extends RouteTable> = {
  [N in keyof T]: Screen<{}> | Redirect<NavigateTargetOf<T>>;
};

/** Écran affiché quand un écran plante sans être rattrapé : il reçoit l'erreur et le chemin. */
export type ErrorScreen = Screen<{ error: Error; path: string }>;

/* ------------------------------------------------------------------------------------------ */
/* Lire la route active : this.router.current                                                   */
/* ------------------------------------------------------------------------------------------ */

/**
 * Une valeur de la route active, à appeler pour la lire : `current.params.id()`. Elle se passe
 * telle quelle à `this.selector(…)`. `isValid()` dit si l'URL contenait une valeur conforme à la
 * description ; après ce test, la valeur est du type décrit (`number` et non `number | undefined`).
 */
export interface RouteValue<V, Valid = V> {
  (): V;
  isValid(): this is RouteValue<Valid, Valid>;
}

/** Un paramètre de chemin `string` est toujours valide ; un autre type peut manquer (`/counters/abc`). */
type ParamValue<V> = string extends V ? V : V | undefined;

type KeysOver<U> = U extends unknown ? keyof U & string : never;

/** Les paramètres de chemin des routes `R`, réunis : une clé absente d'une route y vaut `undefined`. */
export type ParamValues<T extends RouteTable, R extends keyof T> = {
  readonly [K in KeysOver<{ [N in R]: ParamsOf<T[N]> }[R]>]: RouteValue<
    { [N in R]: K extends keyof ParamsOf<T[N]> ? ParamValue<ParamsOf<T[N]>[K]> : undefined }[R],
    { [N in R]: K extends keyof ParamsOf<T[N]> ? ParamsOf<T[N]>[K] : never }[R]
  >;
};

/** La query des routes `R`, réunie : une clé absente d'une route y vaut `undefined`. */
export type QueryValues<T extends RouteTable, R extends keyof T> = {
  readonly [K in KeysOver<{ [N in R]: QueryOf<T[N]> }[R]>]: RouteValue<
    { [N in R]: K extends keyof QueryOf<T[N]> ? QueryOf<T[N]>[K] : undefined }[R],
    { [N in R]: K extends keyof QueryOf<T[N]> ? QueryOf<T[N]>[K] : never }[R]
  >;
};

/** Une route précise, vue par `this.router.at('counter')` ou par son guard. */
export interface RouteAt<T extends RouteTable, N extends keyof T> {
  readonly params: ParamValues<T, N>;
  readonly query: QueryValues<T, N>;
}

/**
 * La route active, lue par `this.router.current`. Dans un écran, `R` est sa route (lien généré
 * par le plugin Vite) ; ailleurs, toutes les routes de l'app.
 */
export interface CurrentRoute<T extends RouteTable, R extends keyof T> extends RouteAt<T, R> {
  /** Nom de la route active, `null` si aucune ne correspond. */
  name(): Selected<(R & string) | null>;
  /** Chemin courant, tel que navigué (query et hash compris). */
  path(): Selected<string>;
}

/* ------------------------------------------------------------------------------------------ */
/* Contrat du router                                                                           */
/* ------------------------------------------------------------------------------------------ */

export type RouteState<T extends RouteTable = RouteTable> = {
  /** Chemin courant, tel que navigué (query et hash compris). */
  path: string;
  /** Nom de la route active, `null` si aucune ne correspond. */
  name: (keyof T & string) | null;
  /** Paramètres du chemin, convertis ; `undefined` pour un paramètre invalide. */
  params: Readonly<Record<string, unknown>>;
  /** Query déclarée par la route active, convertie : défaut ou `undefined` si absente ou invalide, `[]` pour une liste. */
  query: Readonly<Record<string, unknown>>;
  /** Les clés dont l'URL portait une valeur invalide. */
  invalid: { readonly params: readonly string[]; readonly query: readonly string[] };
  /** Écran à afficher par `RouterOutlet` (l'écran `'*'` si aucune route ne correspond). */
  screen: Screen<any> | null;
  /** Écran `'!'`, affiché par `RouterOutlet` si l'écran plante sans être rattrapé. */
  errorScreen: ErrorScreen | null;
};

export type RouterCommands<T extends RouteTable = RouteTable> = {
  /** Navigation typée par nom de route : `{ to: 'counter', params: { id: 42 }, query: { tab: 'x' } }`. */
  navigate(target: NavigateTargetOf<T>): void;
  /** Navigation par chemin brut (utilisée pour les liens `<a href>`). */
  visit(path: string): void;
  back(): void;
};

export type RouterEvents = { navigated: { from: string; to: string } };

/** Le handle du router créé par `createRouter` : à passer à `createApp({ router })` ou `mount(…, { router })`. */
export type RouterHandle<T extends RouteTable = RouteTable> = StoreHandle<RouteState<T>, RouterCommands<T>, RouterEvents>;

type RouterTypes<T extends RouteTable> = { state: RouteState<T>; commands: RouterCommands<T>; events: RouterEvents };

/**
 * Le contrat du router d'une app, typé par ses routes. Inscrit sous le nom `'router'` dans le
 * dictionnaire des contrats généré par le plugin Vite ; un composant le lit par `this.router`.
 */
export interface AppRouterContract<T extends RouteTable = RouteTable> extends SuperContract<RouterTypes<T>> {
  /** Fantôme : les routes de l'app. */
  readonly __routes?: T;
}

/** Les routes d'un contrat de router. */
export type PathsOfRouter<K> = K extends AppRouterContract<infer T> ? T : never;

/** Le contrat du router d'une app, à partir de sa déclaration : `AppRouterContractOf<typeof Router>`. */
export type AppRouterContractOf<R> = R extends { readonly paths: infer T extends RouteTable } ? AppRouterContract<T> : never;

const has = (record: Readonly<Record<string, unknown>>, key: string) => Object.hasOwn(record, key);

/** Sous le capot : les sélecteurs du router, lus par `this.router.current` et par `RouterOutlet`. */
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

/** Le nom sous lequel le router est fourni aux composants (`this.router`) et à l'outlet. */
export const ROUTER_NAME = 'router';

registerContract(ROUTER_NAME, () => RouterSelectors);

/* ------------------------------------------------------------------------------------------ */
/* Le lien écran → route, généré par le plugin Vite                                             */
/* ------------------------------------------------------------------------------------------ */

/**
 * Le lien entre le tag d'un écran et sa route, rempli par le plugin Vite à partir de
 * `.screens(…)` : `'counter-screen': 'counter'`. Un écran y trouve le type de sa route.
 */
// biome-ignore lint/suspicious/noEmptyInterface: complétée par le fichier de types généré
export interface ScreenRoutes {}

/** Les routes de l'app (`never` si elle n'a pas de router). */
export type AppRouteNames = import('@super-ts/core').Contracts extends { router: infer K } ? keyof PathsOfRouter<K> & string : never;

/** La route d'un écran par son tag ; toutes les routes pour un composant qui n'est pas un écran. */
export type RouteOfTag<Tag extends string> = Tag extends keyof ScreenRoutes ? ScreenRoutes[Tag] & AppRouteNames : AppRouteNames;

/* ------------------------------------------------------------------------------------------ */
/* Sous le capot : les valeurs de route, à l'exécution                                          */
/* ------------------------------------------------------------------------------------------ */

/** Marque d'une valeur de route : `this.selector(…)` lui ajoute `isValid()`. */
export const ROUTE_VALUE = Symbol('super.route-value');

/** Une valeur de route à l'exécution : une fonction qui lit, et `isValid`. */
export type RuntimeRouteValue = (() => unknown) & { isValid(): boolean; readonly [ROUTE_VALUE]: true };

/**
 * Les valeurs d'une route, par clé (`params.id`, `query.sort`), lues à l'appel. Une clé donne
 * toujours la même fonction : la déstructuration (`const { id } = current.params`) la garde.
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
