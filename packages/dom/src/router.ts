import type { BoundContractSelectors, ContractName, Contracts } from '@super-ts/core';
import { buildStore, compileContract, readStore, type StoreTools } from '@super-ts/core/internal';
import { html } from 'lit-html';
import { keyed } from 'lit-html/directives/keyed.js';
import { ERROR_EVENT, type ErrorDetail } from './component.ts';
import { renderScreen, type Screen, type Selected, SuperElement } from './element.ts';
import { configureTitle, type TitleOptions } from './page.ts';
import {
  type CheckedRoutes,
  type ErrorScreen,
  type HrefArgs,
  type NavigateTargetOf,
  type Redirect,
  ROUTER_NAME,
  type RouteAt,
  type RouterCommands,
  type RouterEvents,
  type RouterHandle,
  RouterSelectors,
  type RouteState,
  type RouteTable,
  routeValues,
  type ScreensFor,
} from './router-contract.ts';
import { routerAttachments, routerHrefs, type StoreLookup } from './router-link.ts';

export type {
  CurrentRoute,
  ErrorScreen,
  HrefArgs,
  NavigateTargetOf,
  ParamsDescription,
  ParamsOf,
  ParamsSpec,
  PathParams,
  QueryDescription,
  QueryOf,
  QueryParams,
  QuerySpec,
  Redirect,
  RouteAt,
  RouteDeclaration,
  RouteInput,
  RouterCommands,
  RouterEvents,
  RouterHandle,
  RouteState,
  RouteTable,
  RouteValue,
  ScreenRoutes,
  ScreensFor,
} from './router-contract.ts';
export { params, query } from './router-contract.ts';

/* ------------------------------------------------------------------------------------------ */
/* Router declaration                                                                          */
/* ------------------------------------------------------------------------------------------ */

/**
 * The app's screens: one per path (or a redirect), plus two optional screens:
 * `'*'` when no path matches, `'!'` when a screen crashes without being caught.
 */
export type ScreensDeclaration<T extends RouteTable> = ScreensFor<T> & {
  '*'?: Screen<{}>;
  '!'?: ErrorScreen;
};

/** Result of a guard: `true` to let through, a target to redirect. */
export type GuardResult<T extends RouteTable> = true | NavigateTargetOf<T>;

/**
 * One guard per route, optional, which receives its route as `this.router.at(…)` gives it:
 * `({ params }) => params.id.isValid() || { to: 'counters' }`.
 */
export type GuardsFor<T extends RouteTable> = {
  [N in keyof T & string]?: (route: RouteAt<T, N>) => GuardResult<T>;
};

/** What guards receive: `read('cart')` reads a store provided by the application. */
export interface GuardTools {
  /** The selectors of the store provided for this contract, read on call: `read('cart').isEmpty()`. */
  read<N extends ContractName>(name: N): BoundContractSelectors<Contracts[N]>;
}

/** Redirect to declare in place of a screen: `stats: redirect({ to: 'home' })`. */
export function redirect<const Target extends { to: string; params?: object; query?: object }>(target: Target): Redirect<Target> {
  return Object.freeze({ [REDIRECT_KEY]: true, target }) as unknown as Redirect<Target>;
}

const REDIRECT_KEY = Symbol('super.redirect');
const isRedirect = (value: unknown): value is Redirect => typeof value === 'object' && value !== null && REDIRECT_KEY in value;

/**
 * The app's router, declared by `defineRouter`: its paths, its guards, its screens, and
 * `Router.href(…)` to build a link outside a component. In a component, the router is read through
 * `this.router` (active route, navigation, `href`).
 *
 * `Ready` becomes `true` once `.screens()` is called: `createRouter` only accepts that case.
 */
export interface RouterDefinition<T extends RouteTable = RouteTable, Ready extends boolean = boolean> {
  /** The declared routes, by name. */
  readonly paths: T;
  /**
   * Path of a named route: `href('counter', { params: { id: 42 } })` gives `'/counters/42'`,
   * and `href('counters', { query: { tag: ['a', 'b'] } })` gives `'/counters?tag=a&tag=b'`.
   */
  href<N extends keyof T & string>(name: N, ...input: HrefArgs<T, N>): string;
  /**
   * One screen per route, without required props: it reads its route through `this.router.current`. And
   * `'*'`, optional, for the screen displayed when no path matches.
   * Given by a function, read by `createRouter`: the screens import the router, which imports them.
   *
   * This call must stay the last one of the declaration: the router's type then depends only on the
   * paths, and the compiler types it without reading the screens, so without a circular dependency.
   */
  screens(define: () => ScreensDeclaration<T>): RouterDefinition<T, true>;
  /**
   * One guard per route, optional, called before each navigation to it: `true` to let
   * through, a target to redirect. Guards read stores by their contract (`read`),
   * provided by the application that receives the router.
   *
   * Call it before `.screens()`: guards depend only on the paths, and `.screens()` must
   * stay the last call. After `.screens()`, `guards` does not exist (does not compile).
   */
  readonly guards: Ready extends true ? never : (define: (tools: GuardTools) => GuardsFor<T>) => RouterDefinition<T, false>;
  /** Type marker only. */
  readonly __ready?: Ready;
}

type Declaration = {
  paths: RouteTable;
  described: Map<string, Described>;
  screens: (() => ScreensDeclaration<RouteTable>) | null;
  guards: ((tools: GuardTools) => GuardsFor<RouteTable>) | null;
};

/** Internal access to the declaration, without exposing it on the public object. */
const declarations = new WeakMap<object, Declaration>();

function declare(declaration: Declaration): RouterDefinition {
  const router: RouterDefinition = Object.freeze({
    paths: declaration.paths,
    href: ((name: string, input?: RouteValues) => buildPath(declaration.described, name, input)) as RouterDefinition['href'],
    screens: (screens: () => ScreensDeclaration<RouteTable>) => declare({ ...declaration, screens }) as RouterDefinition<RouteTable, true>,
    guards: ((guards: (tools: GuardTools) => GuardsFor<RouteTable>) => {
      if (declaration.screens) throw new Error('[super] declare the guards with .guards(...) before .screens(...)');
      return declare({ ...declaration, guards });
    }) as RouterDefinition['guards'],
  });
  declarations.set(router, declaration);
  return router;
}

/**
 * Declares the app's router from its named routes, then its screens. A route is a
 * path (`'/counters/:id'`, a `:name` segment being a parameter; after `?`, the query keys,
 * `[]` marking a list: `'/counters?sort&tag[]'`), or a path with the typed description of
 * its parameters and its query:
 *
 * ```ts
 * export const Router = defineRouter({
 *   home: '/',
 *   counter: { path: '/counters/:id', params: params<{ id: number }>({ id: Number }) },
 * }).screens(() => ({ home: HomeScreen, counter: CounterScreen, '*': NotFoundScreen }));
 * ```
 *
 * The routes are set in `defineRouter`, apart from the screens: the router's type then depends
 * only on them, and the screens can use it without a circular dependency.
 */
export function defineRouter<const T extends RouteTable & { '*'?: never; '!'?: never }>(
  paths: T & CheckedRoutes<T>,
): RouterDefinition<T, false> {
  const described = new Map<string, Described>();
  for (const [name, declaration] of Object.entries(paths as RouteTable)) {
    if (name === '*') throw new Error('[super] "*" is reserved for the screen displayed when no path matches');
    if (name === '!') throw new Error('[super] "!" is reserved for the screen displayed when a screen crashes');
    described.set(name, describe(name, declaration));
  }
  return declare({ paths: Object.freeze({ ...paths }), described, screens: null, guards: null }) as unknown as RouterDefinition<T, false>;
}

/* ------------------------------------------------------------------------------------------ */
/* Reading and writing a route's values                                                        */
/* ------------------------------------------------------------------------------------------ */

/** The type of a value in the URL. */
type Scalar = { kind: 'string' } | { kind: 'number' } | { kind: 'boolean' } | { kind: 'oneOf'; values: readonly unknown[] };
type QueryField = { key: string; scalar: Scalar; list: boolean; fallback: unknown };

/** A route, ready to read and write its URLs. */
type Described = { pathname: string; keys: string[]; params: Map<string, Scalar>; query: QueryField[] };

const STRING: Scalar = { kind: 'string' };

function scalarOf(spec: unknown, where: string): Scalar {
  if (spec === String) return STRING;
  if (spec === Number) return { kind: 'number' };
  if (spec === Boolean) return { kind: 'boolean' };
  if (typeof spec === 'object' && spec !== null) {
    if ('oneOf' in spec && Array.isArray(spec.oneOf)) return { kind: 'oneOf', values: spec.oneOf };
    if ('type' in spec) return scalarOf(spec.type, where);
  }
  throw new Error(`[super] ${where}: expected String, Number, Boolean or { oneOf: [...] }`);
}

function queryFieldOf(key: string, spec: unknown, where: string): QueryField {
  if (Array.isArray(spec)) {
    if (spec.length !== 1) throw new Error(`[super] ${where}: a list is described by a single type, like [String]`);
    return { key, scalar: scalarOf(spec[0], where), list: true, fallback: [] };
  }
  const fallback = typeof spec === 'object' && spec !== null && 'default' in spec ? spec.default : undefined;
  return { key, scalar: scalarOf(spec, where), list: false, fallback };
}

/** Splits and checks a route declaration. */
function describe(name: string, declaration: RouteDeclarationValue): Described {
  const path = typeof declaration === 'string' ? declaration : declaration.path;
  if (typeof path !== 'string' || !path.startsWith('/')) {
    throw new Error(`[super] the path "${path}" of the route "${name}" must start with "/"`);
  }
  const [pathname = '', search] = path.split('?', 2) as [string, string | undefined];
  const keys = [...pathname.matchAll(/:([^/]+)/g)].map((found) => found[1]!);
  const params = new Map<string, Scalar>(keys.map((key) => [key, STRING]));
  let query: QueryField[] = [];
  if (typeof declaration === 'string') {
    if (search !== undefined) {
      query = search.split('&').map((entry) => {
        const list = entry.endsWith('[]');
        const key = list ? entry.slice(0, -2) : entry;
        return { key, scalar: STRING, list, fallback: list ? [] : undefined };
      });
    }
  } else {
    if (search !== undefined) throw new Error(`[super] route "${name}": the query is described with query<T>({…}), not in the path`);
    if (declaration.params) {
      const described = Object.keys(declaration.params.spec);
      const mismatch = described.length !== keys.length || described.some((key) => !keys.includes(key));
      if (mismatch) throw new Error(`[super] route "${name}": params must describe exactly the path parameters (${keys.join(', ')})`);
      for (const [key, spec] of Object.entries(declaration.params.spec))
        params.set(key, scalarOf(spec, `parameter "${key}" of the route "${name}"`));
    }
    if (declaration.query) {
      query = Object.entries(declaration.query.spec).map(([key, spec]) => queryFieldOf(key, spec, `key "${key}" of the route "${name}"`));
    }
  }
  const seen = new Set<string>();
  for (const { key } of query) {
    if (!key) throw new Error(`[super] empty query key in the path "${path}" of the route "${name}"`);
    if (seen.has(key)) throw new Error(`[super] "${key}" appears twice in the query of the route "${name}"`);
    seen.add(key);
  }
  return { pathname, keys, params, query };
}

type RouteDeclarationValue = string | { path: string; params?: { spec: object }; query?: { spec: object } };

const NUMBER = /^[+-]?(\d+(\.\d*)?|\.\d+)(e[+-]?\d+)?$/i;

/** Reads a value from the URL: `{ ok: false }` if it does not conform. */
function parse(scalar: Scalar, raw: string): { ok: true; value: unknown } | { ok: false } {
  switch (scalar.kind) {
    case 'string':
      return { ok: true, value: raw };
    case 'number':
      return NUMBER.test(raw) ? { ok: true, value: Number(raw) } : { ok: false };
    case 'boolean':
      return raw === 'true' ? { ok: true, value: true } : raw === 'false' ? { ok: true, value: false } : { ok: false };
    case 'oneOf': {
      const index = scalar.values.findIndex((value) => String(value) === raw);
      return index < 0 ? { ok: false } : { ok: true, value: scalar.values[index] };
    }
  }
}

/** What you give to build a path: parameters and query, separate. */
type RouteValues = { params?: Record<string, unknown>; query?: Record<string, unknown> };

function buildPath(described: Map<string, Described>, name: string, input: RouteValues = {}): string {
  const route = described.get(name);
  if (!route) throw new Error(`[super] unknown route "${name}"`);
  const built = route.pathname.replace(/:([^/]+)/g, (_, key: string) => {
    const value = input.params?.[key];
    if (value === undefined) throw new Error(`[super] parameter "${key}" missing for the route "${name}"`);
    return encodeURIComponent(String(value));
  });
  const search = new URLSearchParams();
  for (const { key, list } of route.query) {
    const value = input.query?.[key];
    if (value === undefined) continue;
    for (const item of list && Array.isArray(value) ? value : [value]) search.append(key, String(item));
  }
  const encoded = search.toString();
  return encoded ? `${built}?${encoded}` : built;
}

/** The path without query or hash: what identifies the mounted screen. */
const pathnameOf = (path: string) => normalize(path.split(/[?#]/)[0] || '/');

/* ------------------------------------------------------------------------------------------ */
/* The router is a store                                                                       */
/* ------------------------------------------------------------------------------------------ */

interface HistoryDriver {
  current(): string;
  push(path: string): void;
  /** Replaces the current entry (redirect): the back button does not return to the refused path. */
  replace(path: string): void;
  back(): void;
  listen(onChange: (path: string) => void, signal: AbortSignal): void;
}

const browserHistory = (): HistoryDriver => ({
  current: () => location.pathname + location.search + location.hash,
  push: (path) => history.pushState(null, '', path),
  replace: (path) => history.replaceState(null, '', path),
  back: () => history.back(),
  listen: (onChange, signal) =>
    window.addEventListener('popstate', () => onChange(location.pathname + location.search + location.hash), { signal }),
});

const memoryHistory = (initialPath: string): HistoryDriver => {
  const stack = [initialPath];
  let notify: ((path: string) => void) | null = null;
  return {
    current: () => stack.at(-1)!,
    push: (path) => void stack.push(path),
    replace: (path) => void (stack[stack.length - 1] = path),
    back() {
      if (stack.length < 2) return;
      stack.pop();
      notify?.(stack.at(-1)!);
    },
    listen: (onChange) => void (notify = onChange),
  };
};

type CompiledRoute = { name: string; screen: Screen<any> | Redirect; regex: RegExp; route: Described };

const escapeRegex = (value: string) => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const normalize = (pathname: string) => (pathname.length > 1 ? pathname.replace(/\/+$/, '') : pathname);

function compile(described: Map<string, Described>, table: ScreensFor<RouteTable>): CompiledRoute[] {
  return [...described].map(([name, route]) => {
    const pattern = normalize(route.pathname)
      .split('/')
      .map((segment) => (segment.startsWith(':') ? '([^/]+)' : escapeRegex(segment)))
      .join('/');
    return { name, screen: table[name]!, route, regex: new RegExp(`^${pattern}$`) };
  });
}

type Values = { values: Record<string, unknown>; invalid: string[] };

/** The path parameters, converted: an invalid parameter is `undefined`. */
function readParams(route: Described, found: RegExpExecArray): Values {
  const values: Record<string, unknown> = {};
  const invalid: string[] = [];
  route.keys.forEach((key, i) => {
    const parsed = parse(route.params.get(key)!, decodeURIComponent(found[i + 1]!));
    values[key] = parsed.ok ? parsed.value : undefined;
    if (!parsed.ok) invalid.push(key);
  });
  return { values, invalid };
}

/**
 * The declared query, converted: an absent or invalid key takes its default value (or
 * `undefined`); a list is `[]` if absent, and loses its invalid items.
 */
function readQuery(path: string, fields: QueryField[]): Values {
  const values: Record<string, unknown> = {};
  const invalid: string[] = [];
  if (fields.length === 0) return { values, invalid };
  const beforeHash = path.split('#')[0]!;
  const start = beforeHash.indexOf('?');
  const search = new URLSearchParams(start < 0 ? '' : beforeHash.slice(start + 1));
  for (const { key, scalar, list, fallback } of fields) {
    if (list) {
      const items = search.getAll(key).map((raw) => parse(scalar, raw));
      values[key] = items.flatMap((item) => (item.ok ? [item.value] : []));
      if (items.some((item) => !item.ok)) invalid.push(key);
      continue;
    }
    const raw = search.get(key);
    const parsed = raw === null ? null : parse(scalar, raw);
    values[key] = parsed?.ok ? parsed.value : fallback;
    if (parsed && !parsed.ok) invalid.push(key);
  }
  return { values, invalid };
}

/** The route as its guard receives it: the same values as `this.router.at(…)`. */
function routeAt({ params, query, invalid }: Pick<RouteState, 'params' | 'query' | 'invalid'>) {
  return {
    params: routeValues(
      (key) => params[key],
      (key) => Object.hasOwn(params, key) && !invalid.params.includes(key),
    ),
    query: routeValues(
      (key) => query[key],
      (key) => Object.hasOwn(query, key) && !invalid.query.includes(key),
    ),
  };
}

type RouterDeps = {
  described: Map<string, Described>;
  screens: ScreensFor<RouteTable>;
  notFound: Screen<{}> | null;
  errorScreen: ErrorScreen | null;
  guards: ((tools: GuardTools) => GuardsFor<RouteTable>) | null;
  driver: HistoryDriver;
  /** Receives the function that wires the router to an application (see `createApp`). */
  onAttachable: (attach: (lookup: StoreLookup) => void) => void;
};

const MAX_REDIRECTS = 10;
const NONE_INVALID: RouteState['invalid'] = Object.freeze({ params: [], query: [] });

/** The router's store: its contract is `RouterSelectors`, provided to components under the name 'router'. */
const routerStore = (deps: RouterDeps) =>
  buildStore<RouteState, RouterCommands, RouterEvents>(() => ({
    contract: compileContract(RouterSelectors),
    initialState: { path: '', name: null, params: {}, query: {}, invalid: NONE_INVALID, screen: null, errorScreen: null },
    setup: (tools) => routerSetup(deps, tools),
  }));

function routerSetup(
  { described, screens, notFound, errorScreen, guards, driver, onAttachable }: RouterDeps,
  { get, set, emit, signal }: StoreTools<RouteState, RouterEvents>,
) {
  const compiled = compile(described, screens);
  // Guards only apply once the router is wired to an application: it is the one that provides the stores.
  let guardTable: GuardsFor<RouteTable> | null = null;

  function match(path: string) {
    const pathname = pathnameOf(path);
    for (const candidate of compiled) {
      const found = candidate.regex.exec(pathname);
      if (!found) continue;
      const params = readParams(candidate.route, found);
      const query = readQuery(path, candidate.route.query);
      const invalid = invalidOf(params.invalid, query.invalid);
      return { name: candidate.name, params: params.values, query: query.values, invalid, screen: candidate.screen };
    }
    return null;
  }

  const invalidOf = (params: string[], query: string[]): RouteState['invalid'] =>
    params.length === 0 && query.length === 0 ? NONE_INVALID : { params, query };

  /** Follows redirects (declared or decided by a guard) until a screen to display. */
  function resolve(requested: string): RouteState {
    let path = requested;
    for (let hops = 0; hops <= MAX_REDIRECTS; hops++) {
      const found = match(path);
      if (!found) return { path, name: null, params: {}, query: {}, invalid: NONE_INVALID, screen: notFound, errorScreen };
      const target = isRedirect(found.screen)
        ? found.screen.target
        : (() => {
            const result = guardTable?.[found.name]?.(routeAt(found) as never);
            return result === undefined || result === true ? null : result;
          })();
      if (!target) {
        const { name, params, query, invalid } = found;
        return { path, name, params, query, invalid, screen: found.screen as Screen<any>, errorScreen };
      }
      path = buildPath(described, target.to, target as RouteValues);
    }
    throw new Error(`[super] too many redirects starting from "${requested}"`);
  }

  function apply(next: RouteState) {
    const from = get().path;
    set(next);
    if (from !== next.path) emit('navigated', { from, to: next.path });
  }

  /** Navigation requested by the app: a new history entry, at the final path. */
  function go(path: string) {
    // Same path: nothing enters the history, but `navigated` is emitted anyway. That is what
    // lets you leave the '!' screen by clicking again on the link of the page in error.
    if (path === get().path) {
      emit('navigated', { from: path, to: path });
      return;
    }
    const next = resolve(path);
    if (next.path === get().path) return; // redirected to the current page: nothing changes
    driver.push(next.path);
    apply(next);
  }

  /** Path imposed by the history (back, initial path): a redirect replaces the entry. */
  function arrive(path: string) {
    const next = resolve(path);
    if (next.path !== path) driver.replace(next.path);
    apply(next);
  }

  onAttachable((lookup) => {
    if (!guards) return;
    guardTable = guards({
      read: (name: string) => {
        const store = lookup(name);
        if (!store) throw new Error(`[super] router guard: no store provided for the contract "${name}"`);
        return readStore(store) as never;
      },
    });
    arrive(get().path); // the current path goes through the guards in turn
  });

  driver.listen(arrive, signal);
  arrive(driver.current());

  return {
    navigate: (target) => go(buildPath(described, target.to, target as RouteValues)),
    visit: (path) => go(path),
    back: () => driver.back(),
  } satisfies Handlers;
}

type Handlers = { navigate(target: NavigateTargetOf<RouteTable>): void; visit(path: string): void; back(): void };

export type RouterOptions = {
  /** `browser` (default) syncs the URL; `memory` keeps the history in memory (tests). */
  mode?: 'browser' | 'memory';
  /** Starting path in `memory` mode (default `/`). */
  initialPath?: string;
  /**
   * The page title: `default` when no component sets one (`@title`, `this.page.title`),
   * `suffix` appended to the title set (`{ default: 'My demo', suffix: ' · My demo' }`).
   */
  title?: TitleOptions;
};

/**
 * Creates the app's router from its declaration (screens included). Pass it to
 * `createApp({ router })` or `mount(..., { router })`.
 */
export function createRouter<T extends RouteTable>(router: RouterDefinition<T, true>, options: RouterOptions = {}): RouterHandle<T> {
  const declaration = declarations.get(router);
  if (!declaration) throw new Error('[super] createRouter expects a router declared with defineRouter');
  if (!declaration.screens) throw new Error('[super] the router has no screens: declare them with .screens(...)');
  configureTitle(options.title);
  const driver = options.mode === 'memory' ? memoryHistory(options.initialPath ?? '/') : browserHistory();
  const { '*': notFound = null, '!': errorScreen = null, ...screens } = declaration.screens();
  let attach: ((lookup: StoreLookup) => void) | null = null;
  const store = routerStore({
    described: declaration.described,
    screens: screens as ScreensFor<RouteTable>,
    notFound,
    errorScreen,
    guards: declaration.guards,
    driver,
    onAttachable: (fn) => (attach = fn),
  });
  if (attach) routerAttachments.set(store, attach);
  routerHrefs.set(store, (name, input) => buildPath(declaration.described, name, input as RouteValues));
  return store as unknown as RouterHandle<T>;
}

/* ------------------------------------------------------------------------------------------ */
/* Outlet                                                                                      */
/* ------------------------------------------------------------------------------------------ */

/**
 * Displays the active route's screen, which reads its parameters and its query through `this.router.current`.
 * Each path change mounts a new instance of the screen; a query or hash change
 * alone keeps it (the screen re-renders if it reads a value that changes).
 */
export class RouterOutlet extends SuperElement {
  static tag = 'super-router-outlet';

  // The outlet does not know the app's paths: it reads the router through an untyped view.
  #router = this.router as unknown as OutletView;
  #path = this.selector(this.#router.selectors.path);
  #screen = this.selector(this.#router.selectors.screen);
  #errorScreen = this.selector(this.#router.selectors.errorScreen);
  // Error of a screen that nothing caught: displayed by the '!' screen as long as we stay on this path.
  #failure = this.state({ error: null as Error | null, path: null as string | null });

  constructor() {
    super();
    // Any navigation (including to the current path) forgets the error: the route's screen is remounted afresh.
    this.#router.on('navigated', () => {
      if (this.#failure.get().error) this.#failure.set({ error: null, path: null });
    });
    // Set here, not in mounted(): a screen can crash from the outlet's first render. The listener
    // is on the outlet itself, it lives and dies with it.
    this.addEventListener(ERROR_EVENT, (event) => {
      const errorScreen = this.#router.selectors.errorScreen();
      const detail = (event as CustomEvent<ErrorDetail>).detail;
      if (!errorScreen || detail.tag === errorScreen.tag) return; // the '!' screen itself crashed: let it bubble up
      event.stopPropagation();
      detail.caughtBy = RouterOutlet.tag;
      this.#failure.set({ error: detail.error, path: this.#router.selectors.path() });
    });
  }

  render() {
    const path = this.#path.value;
    const screen = this.#screen.value;
    const errorScreen = this.#errorScreen.value;
    const { error, path: failedPath } = this.#failure.get();
    if (error && errorScreen && failedPath === path) return keyed(`!${path}`, html`${renderScreen(errorScreen, { error, path })}`);
    // The intermediate template guarantees a new instance of the screen for each key. The key is the
    // path without query: changing filter or page keeps the screen and its state.
    return screen ? keyed(pathnameOf(path), html`${renderScreen(screen, {})}`) : null;
  }
}

/** What the outlet reads from the router. */
type OutletView = {
  selectors: {
    path(): Selected<string>;
    screen(): Selected<Screen<any> | null>;
    errorScreen(): Selected<ErrorScreen | null>;
  };
  on(name: 'navigated', listener: () => void): void;
};
