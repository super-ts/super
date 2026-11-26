import type { BoundContractSelectors, ContractName, Contracts } from '@super-ts/core';
import { buildStore, compileContract, readStore, type StoreTools } from '@super-ts/core/internal';
import { html } from 'lit-html';
import { keyed } from 'lit-html/directives/keyed.js';
import { ERROR_EVENT, type ErrorDetail } from './component';
import { renderScreen, type Screen, type Selected, SuperElement } from './element';
import { configureTitle, type TitleOptions } from './page';
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
} from './router-contract';
import { routerAttachments, routerHrefs, type StoreLookup } from './router-link';

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
} from './router-contract';
export { params, query } from './router-contract';

/* ------------------------------------------------------------------------------------------ */
/* Déclaration du router                                                                       */
/* ------------------------------------------------------------------------------------------ */

/**
 * Les écrans de l'app : un par chemin (ou une redirection), plus deux écrans facultatifs :
 * `'*'` quand aucun chemin ne correspond, `'!'` quand un écran plante sans être rattrapé.
 */
export type ScreensDeclaration<T extends RouteTable> = ScreensFor<T> & {
  '*'?: Screen<{}>;
  '!'?: ErrorScreen;
};

/** Résultat d'un guard : `true` pour laisser passer, une cible pour rediriger. */
export type GuardResult<T extends RouteTable> = true | NavigateTargetOf<T>;

/**
 * Un guard par route, facultatif, qui reçoit sa route comme `this.router.at(…)` la donne :
 * `({ params }) => params.id.isValid() || { to: 'counters' }`.
 */
export type GuardsFor<T extends RouteTable> = {
  [N in keyof T & string]?: (route: RouteAt<T, N>) => GuardResult<T>;
};

/** Ce que reçoivent les guards : `read('cart')` lit un store fourni par l'application. */
export interface GuardTools {
  /** Les sélecteurs du store fourni pour ce contrat, lus à l'appel : `read('cart').isEmpty()`. */
  read<N extends ContractName>(name: N): BoundContractSelectors<Contracts[N]>;
}

/** Redirection à déclarer à la place d'un écran : `stats: redirect({ to: 'home' })`. */
export function redirect<const Target extends { to: string; params?: object; query?: object }>(target: Target): Redirect<Target> {
  return Object.freeze({ [REDIRECT_KEY]: true, target }) as unknown as Redirect<Target>;
}

const REDIRECT_KEY = Symbol('super.redirect');
const isRedirect = (value: unknown): value is Redirect => typeof value === 'object' && value !== null && REDIRECT_KEY in value;

/**
 * Le router de l'app, déclaré par `defineRouter` : ses chemins, ses guards, ses écrans, et
 * `Router.href(…)` pour construire un lien hors composant. Dans un composant, le router se lit par
 * `this.router` (route active, navigation, `href`).
 *
 * `Ready` passe à `true` une fois `.screens()` appelé : `createRouter` n'accepte que ce cas.
 */
export interface RouterDefinition<T extends RouteTable = RouteTable, Ready extends boolean = boolean> {
  /** Les routes déclarées, par nom. */
  readonly paths: T;
  /**
   * Chemin d'une route nommée : `href('counter', { params: { id: 42 } })` donne `'/counters/42'`,
   * et `href('counters', { query: { tag: ['a', 'b'] } })` donne `'/counters?tag=a&tag=b'`.
   */
  href<N extends keyof T & string>(name: N, ...input: HrefArgs<T, N>): string;
  /**
   * Un écran par route, sans props obligatoire : il lit sa route par `this.router.current`. Et
   * `'*'`, facultatif, pour l'écran affiché quand aucun chemin ne correspond.
   * Donnés par une fonction, lue par `createRouter` : les écrans importent le router, qui les importe.
   *
   * Cet appel doit rester le dernier de la déclaration : le type du router ne dépend alors que des
   * chemins, et le compilateur le type sans lire les écrans, donc sans dépendance circulaire.
   */
  screens(define: () => ScreensDeclaration<T>): RouterDefinition<T, true>;
  /**
   * Un guard par route, facultatif, appelé avant chaque navigation vers elle : `true` pour laisser
   * passer, une cible pour rediriger. Les guards lisent les stores par leur contrat (`read`),
   * fournis par l'application qui reçoit le router.
   *
   * À appeler avant `.screens()` : les guards ne dépendent que des chemins, et `.screens()` doit
   * rester le dernier appel. Après `.screens()`, `guards` n'existe pas (ne compile pas).
   */
  readonly guards: Ready extends true ? never : (define: (tools: GuardTools) => GuardsFor<T>) => RouterDefinition<T, false>;
  /** Marqueur de type seulement. */
  readonly __ready?: Ready;
}

type Declaration = {
  paths: RouteTable;
  described: Map<string, Described>;
  screens: (() => ScreensDeclaration<RouteTable>) | null;
  guards: ((tools: GuardTools) => GuardsFor<RouteTable>) | null;
};

/** Accès interne à la déclaration, sans l'exposer sur l'objet public. */
const declarations = new WeakMap<object, Declaration>();

function declare(declaration: Declaration): RouterDefinition {
  const router: RouterDefinition = Object.freeze({
    paths: declaration.paths,
    href: ((name: string, input?: RouteValues) => buildPath(declaration.described, name, input)) as RouterDefinition['href'],
    screens: (screens: () => ScreensDeclaration<RouteTable>) => declare({ ...declaration, screens }) as RouterDefinition<RouteTable, true>,
    guards: ((guards: (tools: GuardTools) => GuardsFor<RouteTable>) => {
      if (declaration.screens) throw new Error('[super] déclare les guards avec .guards(...) avant .screens(...)');
      return declare({ ...declaration, guards });
    }) as RouterDefinition['guards'],
  });
  declarations.set(router, declaration);
  return router;
}

/**
 * Déclare le router de l'app à partir de ses routes nommées, puis ses écrans. Une route est un
 * chemin (`'/counters/:id'`, un segment `:nom` étant un paramètre ; après `?`, les clés de query,
 * `[]` marquant une liste : `'/counters?sort&tag[]'`), ou un chemin avec la description typée de
 * ses paramètres et de sa query :
 *
 * ```ts
 * export const Router = defineRouter({
 *   home: '/',
 *   counter: { path: '/counters/:id', params: params<{ id: number }>({ id: Number }) },
 * }).screens(() => ({ home: HomeScreen, counter: CounterScreen, '*': NotFoundScreen }));
 * ```
 *
 * Les routes sont posées dans `defineRouter`, à part des écrans : le type du router ne dépend
 * alors que d'elles, et les écrans peuvent l'utiliser sans dépendance circulaire.
 */
export function defineRouter<const T extends RouteTable & { '*'?: never; '!'?: never }>(
  paths: T & CheckedRoutes<T>,
): RouterDefinition<T, false> {
  const described = new Map<string, Described>();
  for (const [name, declaration] of Object.entries(paths as RouteTable)) {
    if (name === '*') throw new Error('[super] "*" est réservé à l\'écran affiché quand aucun chemin ne correspond');
    if (name === '!') throw new Error('[super] "!" est réservé à l\'écran affiché quand un écran plante');
    described.set(name, describe(name, declaration));
  }
  return declare({ paths: Object.freeze({ ...paths }), described, screens: null, guards: null }) as unknown as RouterDefinition<T, false>;
}

/* ------------------------------------------------------------------------------------------ */
/* Lire et écrire les valeurs d'une route                                                       */
/* ------------------------------------------------------------------------------------------ */

/** Le type d'une valeur dans l'URL. */
type Scalar = { kind: 'string' } | { kind: 'number' } | { kind: 'boolean' } | { kind: 'oneOf'; values: readonly unknown[] };
type QueryField = { key: string; scalar: Scalar; list: boolean; fallback: unknown };

/** Une route, prête à lire et à écrire ses URL. */
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
  throw new Error(`[super] ${where} : attendu String, Number, Boolean ou { oneOf: [...] }`);
}

function queryFieldOf(key: string, spec: unknown, where: string): QueryField {
  if (Array.isArray(spec)) {
    if (spec.length !== 1) throw new Error(`[super] ${where} : une liste se décrit par un seul type, comme [String]`);
    return { key, scalar: scalarOf(spec[0], where), list: true, fallback: [] };
  }
  const fallback = typeof spec === 'object' && spec !== null && 'default' in spec ? spec.default : undefined;
  return { key, scalar: scalarOf(spec, where), list: false, fallback };
}

/** Sépare et vérifie une déclaration de route. */
function describe(name: string, declaration: RouteDeclarationValue): Described {
  const path = typeof declaration === 'string' ? declaration : declaration.path;
  if (typeof path !== 'string' || !path.startsWith('/')) {
    throw new Error(`[super] le chemin "${path}" de la route "${name}" doit commencer par "/"`);
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
    if (search !== undefined) throw new Error(`[super] route "${name}" : la query se décrit par query<T>({…}), pas dans le chemin`);
    if (declaration.params) {
      const described = Object.keys(declaration.params.spec);
      const mismatch = described.length !== keys.length || described.some((key) => !keys.includes(key));
      if (mismatch)
        throw new Error(`[super] route "${name}" : params doit décrire exactement les paramètres du chemin (${keys.join(', ')})`);
      for (const [key, spec] of Object.entries(declaration.params.spec))
        params.set(key, scalarOf(spec, `paramètre "${key}" de la route "${name}"`));
    }
    if (declaration.query) {
      query = Object.entries(declaration.query.spec).map(([key, spec]) => queryFieldOf(key, spec, `clé "${key}" de la route "${name}"`));
    }
  }
  const seen = new Set<string>();
  for (const { key } of query) {
    if (!key) throw new Error(`[super] clé de query vide dans le chemin "${path}" de la route "${name}"`);
    if (seen.has(key)) throw new Error(`[super] "${key}" apparaît deux fois dans la query de la route "${name}"`);
    seen.add(key);
  }
  return { pathname, keys, params, query };
}

type RouteDeclarationValue = string | { path: string; params?: { spec: object }; query?: { spec: object } };

const NUMBER = /^[+-]?(\d+(\.\d*)?|\.\d+)(e[+-]?\d+)?$/i;

/** Lit une valeur de l'URL : `{ ok: false }` si elle n'est pas conforme. */
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

/** Ce qu'on donne pour construire un chemin : paramètres et query, séparés. */
type RouteValues = { params?: Record<string, unknown>; query?: Record<string, unknown> };

function buildPath(described: Map<string, Described>, name: string, input: RouteValues = {}): string {
  const route = described.get(name);
  if (!route) throw new Error(`[super] route inconnue "${name}"`);
  const built = route.pathname.replace(/:([^/]+)/g, (_, key: string) => {
    const value = input.params?.[key];
    if (value === undefined) throw new Error(`[super] paramètre "${key}" manquant pour la route "${name}"`);
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

/** Le chemin sans query ni hash : ce qui identifie l'écran monté. */
const pathnameOf = (path: string) => normalize(path.split(/[?#]/)[0] || '/');

/* ------------------------------------------------------------------------------------------ */
/* Le router est un store                                                                      */
/* ------------------------------------------------------------------------------------------ */

interface HistoryDriver {
  current(): string;
  push(path: string): void;
  /** Remplace l'entrée courante (redirection) : le bouton retour ne revient pas sur le chemin refusé. */
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

/** Les paramètres du chemin, convertis : un paramètre invalide vaut `undefined`. */
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
 * La query déclarée, convertie : une clé absente ou invalide prend sa valeur par défaut (ou
 * `undefined`) ; une liste vaut `[]` si absente, et perd ses éléments invalides.
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

/** La route telle que la reçoit son guard : les mêmes valeurs que `this.router.at(…)`. */
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
  /** Reçoit la fonction qui branche le router sur une application (voir `createApp`). */
  onAttachable: (attach: (lookup: StoreLookup) => void) => void;
};

const MAX_REDIRECTS = 10;
const NONE_INVALID: RouteState['invalid'] = Object.freeze({ params: [], query: [] });

/** Le store du router : son contrat est `RouterSelectors`, fourni aux composants sous le nom 'router'. */
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
  // Les guards ne s'appliquent qu'une fois le router branché sur une application : c'est elle qui fournit les stores.
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

  /** Suit les redirections (déclarées ou décidées par un guard) jusqu'à un écran à afficher. */
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
    throw new Error(`[super] trop de redirections à partir de "${requested}"`);
  }

  function apply(next: RouteState) {
    const from = get().path;
    set(next);
    if (from !== next.path) emit('navigated', { from, to: next.path });
  }

  /** Navigation demandée par l'app : une nouvelle entrée d'historique, au chemin final. */
  function go(path: string) {
    // Même chemin : rien n'entre dans l'historique, mais `navigated` part quand même. C'est ce qui
    // permet de quitter l'écran '!' en recliquant sur le lien de la page en erreur.
    if (path === get().path) {
      emit('navigated', { from: path, to: path });
      return;
    }
    const next = resolve(path);
    if (next.path === get().path) return; // redirigé vers la page courante : rien ne change
    driver.push(next.path);
    apply(next);
  }

  /** Chemin imposé par l'historique (retour, chemin initial) : une redirection remplace l'entrée. */
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
        if (!store) throw new Error(`[super] guard du router : aucun store fourni pour le contrat "${name}"`);
        return readStore(store) as never;
      },
    });
    arrive(get().path); // le chemin courant passe à son tour par les guards
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
  /** `browser` (défaut) synchronise l'URL ; `memory` garde l'historique en mémoire (tests). */
  mode?: 'browser' | 'memory';
  /** Chemin de départ en mode `memory` (défaut `/`). */
  initialPath?: string;
  /**
   * Le titre de la page : `default` quand aucun composant n'en pose (`@title`, `this.page.title`),
   * `suffix` ajouté au titre posé (`{ default: 'Ma démo', suffix: ' · Ma démo' }`).
   */
  title?: TitleOptions;
};

/**
 * Crée le router de l'app à partir de sa déclaration (écrans compris). À passer à
 * `createApp({ router })` ou `mount(..., { router })`.
 */
export function createRouter<T extends RouteTable>(router: RouterDefinition<T, true>, options: RouterOptions = {}): RouterHandle<T> {
  const declaration = declarations.get(router);
  if (!declaration) throw new Error('[super] createRouter attend un router déclaré avec defineRouter');
  if (!declaration.screens) throw new Error("[super] le router n'a pas d'écrans : déclare-les avec .screens(...)");
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
 * Affiche l'écran de la route active, qui lit ses paramètres et sa query par `this.router.current`.
 * Chaque changement de chemin monte une nouvelle instance de l'écran ; un changement de query ou de
 * hash seul la garde (l'écran se re-rend s'il lit une valeur qui change).
 */
export class RouterOutlet extends SuperElement {
  static tag = 'super-router-outlet';

  // L'outlet ne connaît pas les chemins de l'app : il lit le router par une vue non typée.
  #router = this.router as unknown as OutletView;
  #path = this.selector(this.#router.selectors.path);
  #screen = this.selector(this.#router.selectors.screen);
  #errorScreen = this.selector(this.#router.selectors.errorScreen);
  // Erreur d'un écran que rien n'a rattrapée : affichée par l'écran '!' tant qu'on reste sur ce chemin.
  #failure = this.state({ error: null as Error | null, path: null as string | null });

  constructor() {
    super();
    // Toute navigation (y compris vers le chemin courant) oublie l'erreur : l'écran de la route est remonté à neuf.
    this.#router.on('navigated', () => {
      if (this.#failure.get().error) this.#failure.set({ error: null, path: null });
    });
    // Posé ici, pas dans mounted() : un écran peut planter dès le premier rendu de l'outlet. L'écouteur
    // est sur l'outlet lui-même, il vit et meurt avec lui.
    this.addEventListener(ERROR_EVENT, (event) => {
      const errorScreen = this.#router.selectors.errorScreen();
      const detail = (event as CustomEvent<ErrorDetail>).detail;
      if (!errorScreen || detail.tag === errorScreen.tag) return; // l'écran '!' a lui-même planté : on laisse remonter
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
    // Le template intermédiaire garantit une nouvelle instance de l'écran à chaque clé. La clé est le
    // chemin sans query : changer de filtre ou de page garde l'écran et son état.
    return screen ? keyed(pathnameOf(path), html`${renderScreen(screen, {})}`) : null;
  }
}

/** Ce que l'outlet lit du router. */
type OutletView = {
  selectors: {
    path(): Selected<string>;
    screen(): Selected<Screen<any> | null>;
    errorScreen(): Selected<ErrorScreen | null>;
  };
  on(name: 'navigated', listener: () => void): void;
};
