import type {
  AllEvents,
  AnyStore,
  BoundContractSelectors,
  CommandMap,
  ContractCommands,
  ContractEvents,
  ContractName,
  Contracts,
  FailureOf,
  ListenOptions,
  PayloadArgs,
  StatePatch,
  Unsubscribe,
} from '@super-ts/core';
import { CommandFailure } from '@super-ts/core';
import { contractByName, readStore, shallowEqual, share } from '@super-ts/core/internal';
import { render } from 'lit-html';
import { createRef, ref } from 'lit-html/directives/ref.js';
import {
  type ChildOptions,
  createLocalState,
  currentRendering,
  ERROR_EVENT,
  ERROR_REPORT,
  type ErrorDetail,
  type ErrorPhase,
  eventName,
  guarded,
  type LocalState,
  REPORT,
  renderingAs,
  toError,
} from './component.ts';
import { requestStore } from './context.ts';
import { createForm, type FormHandle, type FormOptions } from './form.ts';
import { mountChild } from './mount-directive.ts';
import { type Page, pushTitle, removeTitle, type TitleEntry, type TitleValue, updateTitle } from './page.ts';
import {
  type AppRouteNames,
  type CurrentRoute,
  type HrefArgs,
  isRouteValue,
  type PathsOfRouter,
  ROUTER_NAME,
  type RouteAt,
  type RouterCommands,
  type RouterEvents,
  type RouteValue,
  routeValues,
} from './router-contract.ts';
import { routerHrefs } from './router-link.ts';

/* ------------------------------------------------------------------------------------------ */
/* Public types                                                                                */
/* ------------------------------------------------------------------------------------------ */

declare const EVENTS: unique symbol;
declare const PROPS: unique symbol;
declare const ACCEPTS: unique symbol;
declare const SELECTED: unique symbol;

/**
 * A value as returned by a selector, branded for the compiler (the brand does not exist
 * at runtime). It is used like the value itself; `selector` only accepts it.
 * `null` and `undefined` cannot carry a brand: Super checks them at runtime.
 */
export type Selected<T> = T extends null | undefined ? T : T & { readonly [SELECTED]: T };

/** What a `selector` function can return: a selector's value, as is. */
export type SelectorValue = { readonly [SELECTED]: unknown } | null | undefined;

/** The value without its selector brand. */
export type Unselected<R> = R extends { readonly [SELECTED]: infer X } ? X : R;

/** Selectors as seen from a component: their values are branded, for `selector`. */
export type ElementSelectors<N extends ContractName> = {
  [M in keyof BoundContractSelectors<Contracts[N]>]: BoundContractSelectors<Contracts[N]>[M] extends (...args: infer A) => infer R
    ? (...args: A) => Selected<R>
    : never;
};

/** A value read from a store, recomputed on every read of `.value`. */
export interface Selection<T> {
  readonly value: T;
}

declare const CHILDREN: unique symbol;

/**
 * Elements passed to a component, to place in its template with `{this.content}`. A
 * component that accepts them declares it in its props (`@prop content: Children;`, or a named slot
 * `footer?: Children`). They are filled by the children written between its tags, by a
 * `<:footer>…</:footer>` slot, or by calling a method that emits elements.
 */
export interface Children {
  /** Phantom: exists only for the compiler. */
  readonly [CHILDREN]: true;
}

/** A reference to a template element: `<input ref={this.input} />`, then `this.input.value`. */
export interface ElementRef<T extends Element> {
  /** The element, once mounted; `undefined` before. */
  readonly value: T | undefined;
}

/**
 * What a component sees of a store, by its contract's name: its selectors, its commands,
 * its events. Never the raw state, never the instance.
 */
export interface ContractView<N extends ContractName> {
  /** Phantom: the contract's commands, for the compiler (`this.form({ submit: { to } })`). */
  readonly __commands?: ContractCommands<Contracts[N]>;
  /**
   * The contract's selectors, read on the current state at each call. Read during `render`, they
   * subscribe the component to the store, directly as in `this.selector(…)`: it only re-renders if
   * a value read changes.
   */
  readonly selectors: ElementSelectors<N>;
  /**
   * Sends a command and lets it go: nothing to await. The outcome comes back through the selectors, or
   * through `name:done` / `name:failed`.
   */
  send<K extends keyof ContractCommands<Contracts[N]> & string>(name: K, ...args: CommandArgs<ContractCommands<Contracts[N]>[K]>): void;
  /**
   * Listens to a store event, or to a command's life cycle. Active as long as the component
   * is mounted. Forbidden during `render`.
   */
  on<K extends keyof AllEvents<ContractCommands<Contracts[N]>, ContractEvents<Contracts[N]>> & string>(
    name: K,
    listener: (payload: AllEvents<ContractCommands<Contracts[N]>, ContractEvents<Contracts[N]>>[K]) => void,
  ): void;
}

type CommandArgs<F> = F extends (...args: infer A) => any ? A : never;

/** The app's routes, as its router declares them (`never` without a router). */
export type AppRoutes = Contracts extends { router: infer K } ? PathsOfRouter<K> : never;

/**
 * The router as seen from a component (`this.router`): the active route (`current`), a specific route
 * (`at`), navigation (`send`), its events (`on`) and route URLs (`href`). `R` is the
 * screen's route, or all routes for a component that is not a screen.
 */
export interface RouterView<R extends keyof AppRoutes = keyof AppRoutes> {
  /**
   * The active route. Each value is called to be read (`current.params.id()`), or is passed
   * as is to `this.selector(…)`: `id = this.selector(this.router.current.params.id)`.
   * Read during `render`, it subscribes the component to the router.
   */
  readonly current: CurrentRoute<AppRoutes, R>;
  /**
   * A specific route, for a component that is not its screen: its values are typed by
   * it, and reading them throws an error if the active route is another one.
   */
  at<N extends keyof AppRoutes & string>(name: N): RouteAt<AppRoutes, N>;
  /** Navigation: `send('navigate', { to: 'counter', params: { id: 42 } })`, `send('back')`. */
  send<K extends keyof RouterCommands<AppRoutes> & string>(name: K, ...args: CommandArgs<RouterCommands<AppRoutes>[K]>): void;
  /** Listens to a router event (`navigated`). Forbidden during `render`. */
  on<K extends keyof AllEvents<RouterCommands<AppRoutes>, RouterEvents> & string>(
    name: K,
    listener: (payload: AllEvents<RouterCommands<AppRoutes>, RouterEvents>[K]) => void,
  ): void;
  /**
   * `this.router.href('counter', { params: { id: 42 } })` gives `'/counters/42'`. Route and values
   * checked. `href` does not read the active route: it does not subscribe the component to the router.
   */
  href<N extends keyof AppRoutes & string>(name: N, ...input: HrefArgs<AppRoutes, N>): string;
}

/** The contracts a component reads with `this.contract(name)`: all except the router (`this.router`). */
export type StoreContractName = Exclude<ContractName, typeof ROUTER_NAME>;

/** The view of a contract by its name. */
export type ViewOf<N extends ContractName> = N extends 'router' ? RouterView : ContractView<N>;

/**
 * The app's router as seen from a component (`this.router`), for the routes `R`; `never` if the app
 * does not declare one.
 */
export type AppRouterView<R = AppRouteNames> = 0 extends 1 & R
  ? any
  : [AppRoutes] extends [never]
    ? never
    : RouterView<R & keyof AppRoutes>;

/**
 * A value of the active route read by `this.selector(this.router.current.params.id)`:
 * `.value` reads it, `isValid()` tells whether the URL carried a conforming value. After this test,
 * `.value` has the described type.
 */
export interface RouteSelection<V, Valid = V> extends Selection<V> {
  isValid(): this is RouteSelection<Valid, Valid>;
}

/**
 * What a component declares: its props, its events, and for a screen its route, all
 * optional. In a `.super` file, a screen's route is set by the compiler, from the
 * screen → route link generated by the Vite plugin.
 */
export type ElementTypes = { props?: object; emits?: Record<string, unknown>; route?: string };
/** The declared route (all the app's routes without a route). */
// `SuperElement<any>` (any component): its router is `any`, to accept all screens.
export type RouteIn<T> = 0 extends 1 & T ? any : T extends { route: infer R extends string } ? R : AppRouteNames;
/** The declared props (`{}` without props). */
export type PropsIn<T> = 0 extends 1 & T ? any : T extends { props: infer P extends object } ? P : {};
/** The declared events (`{}` without events). */
export type EmitsIn<T> = 0 extends 1 & T ? any : T extends { emits: infer E } ? E : {};

/** The props of a component instance: `PropsOf<CounterScreen>`. */
export type PropsOf<T> = T extends { readonly [PROPS]?: infer P } ? P : never;
/** The events of a component instance. */
export type EventsOf<T> = T extends { readonly [EVENTS]?: infer E } ? E : never;

type CreateArgs<P, E> = {} extends P ? [props?: P, options?: ChildOptions<E>] : [props: P, options?: ChildOptions<E>];

/** A component class: what the router, `mount` and templates accept. */
export interface ElementClass<P extends object = any, E = any> {
  new (): HTMLElement;
  /**
   * The component's props, compared both ways (phantoms): it receives at least `P`
   * (`[ACCEPTS]`, contravariant) and expects nothing more (`[PROPS]`, covariant).
   */
  readonly prototype: { readonly [PROPS]?: P; readonly [ACCEPTS]?: (props: P) => void };
  readonly tag: string;
  create(...args: CreateArgs<P, E>): HTMLElement;
  eventName(name: keyof E & string): string;
}

/* ------------------------------------------------------------------------------------------ */
/* Under the hood: read tracking                                                              */
/* ------------------------------------------------------------------------------------------ */

/** Stores read during the current computation (render, or `selector`). */
let tracking: Set<AnyStore> | null = null;

/**
 * Props of the component being constructed: dropped off by Super just before `new`, and set
 * by the base constructor. The subclass's fields and constructor therefore already read them.
 */
let constructing: object | null = null;

/** Requested renders, done together at the next microtask. */
const pendingRenders = new Map<Element, () => void>();

/**
 * Requests a render. Pending renders run in document order, parents first: a
 * child that its parent's render removes (the screen the outlet replaces) does not re-render with
 * a state that is no longer its own.
 */
function scheduleRender(element: Element, run: () => void) {
  if (pendingRenders.size === 0) queueMicrotask(flushRenders);
  pendingRenders.set(element, run);
}

function flushRenders() {
  const batch = [...pendingRenders].sort(([a], [b]) => (a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING ? -1 : 1));
  pendingRenders.clear();
  for (const [, run] of batch) run();
}

/** Internal: re-renders a component after a hot replacement. */
const HOT_RENDER = Symbol('super.hot-render');

/** Constructs a component with its props, readable from its fields and its constructor. */
function construct<T>(Class: new () => T, props: object, exact = false): T {
  const previous = constructing;
  constructing = props;
  try {
    // Constructs with the code of `Class` (its fields, its constructor), for the tag defined by its relay.
    const relay = relayOf(Class as unknown as ElementClass);
    // Always the current version: a parent that was not reloaded may still hold the old class.
    return Reflect.construct(exact ? Class : relay.current, [], relay.Relay) as T;
  } finally {
    constructing = previous;
  }
}
/** Values returned by selectors during the computation of a `selector`. */
let selected: Set<unknown> | null = null;

function tracked<T>(into: Set<AnyStore>, run: () => T, returns: Set<unknown> | null = null): T {
  const previous = tracking;
  const previousReturns = selected;
  tracking = into;
  selected = returns;
  try {
    return run();
  } finally {
    tracking = previous;
    selected = previousReturns;
  }
}

type ViewEntry = { name: string; store: AnyStore | null };
/** A selector called directly in `render`, and the value it gave. */
type DirectRead = { store: AnyStore; read: () => unknown; value: unknown };
type ListenerEntry = { view: ViewEntry; name: string; listener: (payload: unknown) => void };

class SelectionValue<T> implements Selection<T> {
  #read: () => T;
  #valid: (() => boolean) | null;
  #owner: SuperElement<any>;
  /** Value at the last render, and the stores it depends on. */
  rendered: { value: T } | null = null;
  /** Validity read at the last render (route value only). */
  renderedValid: boolean | null = null;
  readonly stores = new Set<AnyStore>();

  constructor(owner: SuperElement<any>, read: () => T, valid: (() => boolean) | null = null) {
    this.#owner = owner;
    this.#read = read;
    this.#valid = valid;
  }

  /** Route value: did the URL carry a conforming value? */
  isValid(): boolean {
    if (!this.#valid) throw new Error(`[super] <${this.#owner.localName}>: isValid() only exists on a route value`);
    const valid = tracked(this.stores, this.#valid);
    if (currentRendering() === (this.#owner as unknown)) {
      this.renderedValid = valid;
      internalsOf(this.#owner).reads.add(this as SelectionValue<unknown>);
    }
    return valid;
  }

  /** Has what was rendered changed? */
  changed(): boolean {
    if (this.rendered && !Object.is(this.compute(), this.rendered.value)) return true;
    return this.renderedValid !== null && tracked(this.stores, this.#valid!) !== this.renderedValid;
  }

  /** Recomputes, keeping the reference stable as long as the value is deeply equal. */
  compute(): T {
    this.stores.clear();
    if (this.#valid) tracked(this.stores, this.#valid); // validity depends on the same stores
    const returns = new Set<unknown>();
    const next = tracked(this.stores, this.#read, returns);
    // A selector's value is that of a selector, as is: otherwise it could depend on
    // no store (and stay frozen), or mix the store with something else. The compiler already
    // checks it, except for `null` and `undefined`, which carry no brand.
    if (!returns.has(next)) {
      throw new Error(
        `[super] <${this.#owner.localName}>: selector() must return a selector's value, as is. ` +
          'Pass a selector (`this.selector(this.cart.selectors.lines)`) or a function that calls one ' +
          '(`this.selector(() => this.cart.selectors.quantity(this.props.sku))`). If the display depends on a ' +
          'condition or a computation, do it in render: `${this.props.show ? this.count.value : 0}`.',
      );
    }
    return this.rendered ? (share(this.rendered.value, next) as T) : next;
  }

  get value(): T {
    const value = this.compute();
    // Read during its component's render: it is the displayed value, to compare at the next change.
    if (currentRendering() === (this.#owner as unknown)) {
      this.rendered = { value };
      internalsOf(this.#owner).reads.add(this as SelectionValue<unknown>);
    }
    return value;
  }
}

type Internals = {
  props: object;
  views: ViewEntry[];
  /** Bindings to replay at each mount (forms). */
  connectors: Array<(signal: AbortSignal) => void>;
  listeners: ListenerEntry[];
  /** `selector` values read during the last render. */
  reads: Set<SelectionValue<unknown>>;
  /** Stores read directly (without `selector`) during the last render. */
  rawReads: Set<AnyStore>;
  /** The direct reads of the last render: a store change only re-renders if one of them changes. */
  directReads: DirectRead[];
  subscriptions: Map<AnyStore, Unsubscribe>;
  /** The router view, created on first access to `this.router`. */
  router: object | null;
  /** `this.page`, created on first access. */
  page: Page | null;
  /**
   * The title set during preparation (`@title`, reapplied at each mount), the one set once mounted
   * (until unmount), and the component's entry in the title stack (as long as it is mounted).
   */
  title: { declared: TitleValue | null; live: TitleValue | null; entry: TitleEntry | null };
  controller: AbortController | null;
  mounted: boolean;
  renderScheduled: boolean;
  failed: Error | null;
};

const internals = new WeakMap<SuperElement<any>, Internals>();
/** The view of a contract → its entry (and its store, once mounted). */
const viewEntries = new WeakMap<object, ViewEntry>();
const internalsOf = (element: SuperElement<any>) => internals.get(element)!;

/** Adapters for the child directive: one per class, so that it recognises the same component. */
const childDefs = new WeakMap<ElementClass, { tag: string; create(props: object): SuperElement<any> }>();

/* ------------------------------------------------------------------------------------------ */
/* SuperElement                                                                                */
/* ------------------------------------------------------------------------------------------ */

/**
 * A component: a custom element whose class declares its props and its events. It is written
 * in a `.super` file (see packages/lang/SPEC.md):
 *
 * ```tsx
 * export class ShopScreen extends SuperElement {
 *   @tag = 'shop-screen';
 *   @title = 'Shop';
 *   @prop category: string = 'all';
 *   @emit picked: { sku: string };
 *
 *   cart = this.contract('cart');
 *   lines = this.selector(this.cart.selectors.lines);
 *
 *   render() {
 *     <ul>
 *       for (const l of this.lines.value; key l.sku) {
 *         <li>{l.label}</li>
 *       }
 *     </ul>
 *   }
 * }
 * ```
 *
 * The fields and the constructor prepare the component (once); `render` describes the HTML at
 * each render, and can neither read a new contract nor create state.
 */
export abstract class SuperElement<T extends ElementTypes = {}> extends HTMLElement {
  /** Phantoms: exist only for the compiler. */
  declare readonly [PROPS]?: PropsIn<T>;
  declare readonly [ACCEPTS]?: (props: PropsIn<T>) => void;
  declare readonly [EVENTS]?: EmitsIn<T>;

  constructor() {
    super();
    const props = constructing ?? {};
    constructing = null; // consumed: an element constructed afterwards by this constructor does not reuse them
    internals.set(this, {
      props,
      views: [],
      connectors: [],
      listeners: [],
      reads: new Set(),
      rawReads: new Set(),
      directReads: [],
      subscriptions: new Map(),
      router: null,
      page: null,
      title: { declared: null, live: null, entry: null },
      controller: null,
      mounted: false,
      renderScheduled: false,
      failed: null,
    });
  }

  /** Describes the component's HTML. Called at each render. */
  abstract render(): unknown;

  /**
   * Optional: displayed instead of `render` if `render` or a descendant component crashes.
   * If it crashes itself, the error bubbles up to the next parent.
   */
  renderError?(error: Error): unknown;

  /** Called after the first render, at each mount. */
  protected mounted(): void {}

  /** Called at unmount. */
  protected unmounted(): void {}

  /**
   * The props received from the parent, readable from the fields and the constructor. A prop change
   * re-renders the component; a value copied at construction (`this.state({ draft: this.props.text })`)
   * does not follow later changes.
   */
  get props(): Readonly<PropsIn<T>> {
    return internalsOf(this).props as PropsIn<T>;
  }
  set props(value: PropsIn<T>) {
    const state = internalsOf(this);
    if (shallowEqual(state.props, value)) return;
    state.props = value;
    this.#requestRender();
  }

  /* ---------------------------------------------------------------------------------------- */
  /* Preparation: fields and constructor                                                       */
  /* ---------------------------------------------------------------------------------------- */

  /** The store the app provides for this contract, seen through its contract. The router: `this.router`. */
  protected contract<N extends StoreContractName>(name: N): ContractView<N> {
    this.#preparing('contract');
    if ((name as string) === ROUTER_NAME) {
      throw new Error(`[super] <${this.localName}>: the router is read with \`this.router\`, not with \`this.contract('router')\``);
    }
    return this.#view(name) as ContractView<N>;
  }

  /**
   * The app's router: the active route (`this.router.current.params.id`), a specific route
   * (`this.router.at('counter')`), navigation (`this.router.send('navigate', { to: 'shop' })`), and
   * route URLs (`this.router.href('counter', { params: { id } })`). In a screen, `current`
   * is typed by its route. Readable everywhere, `render` included: the view is created on first access, and
   * looks up the router at mount (right away if the component is mounted).
   */
  protected get router(): AppRouterView<RouteIn<T>> {
    const state = internalsOf(this);
    if (!state.router) {
      const view = this.#view(ROUTER_NAME);
      state.router = view;
      // First access once mounted (render, mounted, handler): the mount has already happened.
      if (state.mounted) {
        const entry = viewEntries.get(view)!;
        entry.store = requestStore(this, ROUTER_NAME);
      }
    }
    return state.router as AppRouterView<RouteIn<T>>;
  }

  /**
   * The page: its title (`this.page.title = 'Shop'`), as long as the component is mounted. The title
   * of the last mounted component that sets one wins; at its unmount, the previous one comes back. A
   * function is tracked, recomputed after each render (`() => \`Counter ${this.label.value}\``).
   * `@title = …` in a `.super` file is a shorthand for setting it in a field.
   */
  protected get page(): Page {
    const state = internalsOf(this);
    if (!state.page) {
      const element = this;
      state.page = {
        get title(): never {
          throw new Error(`[super] <${element.localName}>: \`this.page.title\` is set, it cannot be read`);
        },
        set title(value: TitleValue) {
          element.#setTitle(value);
        },
      };
    }
    return state.page;
  }

  #setTitle(value: TitleValue) {
    if (currentRendering() === (this as unknown)) {
      throw new Error(`[super] <${this.localName}>: \`this.page.title\` cannot be set during render`);
    }
    const state = internalsOf(this);
    if (!state.mounted) {
      state.title.declared = value;
      return;
    }
    state.title.live = value;
    state.title.entry ??= pushTitle();
    if (typeof value === 'string') return updateTitle(state.title.entry, value);
    // A function: computed right away, then tracked by the next render (which records its reads).
    try {
      updateTitle(state.title.entry, value());
    } catch {
      // The render recomputes it, and its error will follow the render error path.
    }
    this.#requestRender();
  }

  /** Recomputes the component's title (during render, so that its reads are tracked). */
  #refreshTitle() {
    const { title } = internalsOf(this);
    const value = title.live ?? title.declared;
    if (value === null || !title.entry) return;
    updateTitle(title.entry, typeof value === 'string' ? value : value());
  }

  /** Creates a contract's view, wired to its store at each mount. */
  #view(name: string): object {
    const view: ViewEntry = { name, store: null };
    internalsOf(this).views.push(view);
    const resolved = () => {
      if (!view.store) throw new Error(`[super] <${this.localName}>: contract "${name}" is only readable once the component is mounted`);
      return view.store;
    };
    const selectors = new Proxy({} as Record<string, (...args: unknown[]) => unknown>, {
      get:
        (_target, key: string) =>
        (...args: unknown[]) => {
          const store = resolved();
          tracking?.add(store);
          // Read through the class contract registered under this name (for the router, its selectors).
          const read = () => readStore(store, store.state(), contractByName(name))[key]!(...args);
          const value = read();
          selected?.add(value);
          // Read directly during a render (not in a `selector`): recorded on the rendering component,
          // which may be another one than the view's (a button that reads its parent's contract).
          const reader = internals.get(currentRendering() as SuperElement<any>);
          if (reader && tracking === reader.rawReads) reader.directReads.push({ store, read, value });
          return value;
        },
    });
    const contractView = {
      selectors: selectors as never,
      send: (command: string, ...args: unknown[]) => {
        resolved()
          .send(command, ...args)
          .catch((error: unknown) => {
            // The outcome is published by `name:failed`: only an unexpected exception deserves the console.
            if (!(error instanceof CommandFailure)) console.error(error);
          });
      },
      on: (event: string, listener: (payload: never) => void) => {
        if (currentRendering() === (this as unknown)) {
          throw new Error(`[super] <${this.localName}>: \`on\` cannot be called during render`);
        }
        const entry: ListenerEntry = { view, name: event, listener: listener as (payload: unknown) => void };
        // Declared during preparation: replayed at each mount. Set once mounted (handler,
        // mounted): lives until unmount, and it is up to the code that set it to set it again.
        if (view.store) this.#listen(entry);
        else internalsOf(this).listeners.push(entry);
      },
    } as ContractView<never>;
    if (name === ROUTER_NAME) {
      const read = selectors as Record<string, (...args: unknown[]) => unknown>;
      const valuesOf = (guard: () => void) => ({
        params: routeValues(
          (key) => (guard(), read.param!(key)),
          (key) => (guard(), read.paramValid!(key) as boolean),
        ),
        query: routeValues(
          (key) => (guard(), read.query!(key)),
          (key) => (guard(), read.queryValid!(key) as boolean),
        ),
      });
      Object.assign(contractView, {
        current: { name: () => read.route!(), path: () => read.path!(), ...valuesOf(() => {}) },
        at: (route: string) =>
          valuesOf(() => {
            const active = read.route!();
            if (active !== route) {
              throw new Error(
                `[super] <${this.localName}>: this.router.at('${route}') read while the active route is ${active === null ? 'none' : `'${active}'`}`,
              );
            }
          }),
        href: (route: string, input?: object) => {
          const build = routerHrefs.get(resolved());
          if (!build) throw new Error(`[super] <${this.localName}>: this router was not created by createRouter`);
          return build(route, input);
        },
      });
    }
    viewEntries.set(contractView, view);
    return contractView;
  }

  /**
   * A form: values, rules, asynchronous checks, and a submission that is a
   * store command (`submit.to: this.checkout`). Ready from construction for the render; it
   * wires itself to the store at mount.
   */
  protected form<V, C extends CommandMap, K extends keyof C & string, RF extends FailureOf<C[K]> = never>(
    options: FormOptions<V, C, K, RF>,
  ): FormHandle<V> {
    this.#preparing('form');
    const entry = viewEntries.get(options.submit.to as object);
    if (!entry) throw new Error('[super] form: submit.to must be a contract obtained with this.contract(...)');
    const state = internalsOf(this);
    return createForm(options as never, {
      requestRender: () => this.#requestRender(),
      connect: (attach) => {
        state.connectors.push((signal) => attach(entry.store!, signal));
      },
    }) as FormHandle<V>;
  }

  /**
   * A value read from one or more stores: a selector without parameters
   * (`this.selector(this.cart.selectors.lines)`), or a function that reads selectors
   * (`this.selector(() => this.cart.selectors.quantity(this.props.sku))`). Read with `.value` in
   * `render`, it is recomputed at each render (so at each props change), and the
   * component re-renders when it changes. The function returns a selector's value as
   * is: a condition or a computation goes in `render` (the compiler checks it).
   */
  protected selector<V, Valid>(read: RouteValue<V, Valid>): RouteSelection<V, Valid>;
  protected selector<R extends SelectorValue>(read: () => R): Selection<Unselected<R>>;
  protected selector(read: () => SelectorValue): Selection<unknown> {
    this.#preparing('selector');
    return new SelectionValue(this, read, isRouteValue(read) ? read.isValid : null);
  }

  /**
   * Local state of the component: private to the instance, for UI data. The type is inferred
   * from `initial`: widen the fields that will change type (`null as string | null`).
   */
  protected state<T extends object>(initial: T): LocalState<T> {
    this.#preparing('state');
    return createLocalState(initial, () => this.#requestRender());
  }

  /** A reference to a template element: `<input ref={this.input} />`. */
  protected ref<T extends Element>(): ElementRef<T> {
    this.#preparing('ref');
    const target = createRef<T>();
    const result = ref(target);
    Object.defineProperty(result, 'value', { get: () => target.value });
    return result as unknown as ElementRef<T>;
  }

  /** Emits an event to the parent. */
  protected emit<K extends keyof EmitsIn<T> & string>(name: K, ...args: PayloadArgs<EmitsIn<T>[K]>): void {
    this.dispatchEvent(new CustomEvent(eventName(this.localName, name), { detail: (args as unknown[])[0], bubbles: true, composed: true }));
  }

  /** Aborted at unmount. Pass it to listeners set outside Super (`addEventListener` on `window`…). */
  protected get signal(): AbortSignal {
    const { controller } = internalsOf(this);
    if (!controller) throw new Error(`[super] <${this.localName}>: \`signal\` only exists once the component is mounted`);
    return controller.signal;
  }

  #preparing(name: string) {
    if (currentRendering() === (this as unknown)) {
      throw new Error(`[super] <${this.localName}>: \`${name}\` is declared in a field or the constructor, not during render`);
    }
  }

  /* ---------------------------------------------------------------------------------------- */
  /* Creation                                                                                  */
  /* ---------------------------------------------------------------------------------------- */

  /**
   * Creates the component. In a template, this is what the tag
   * `<ConfirmDialog question={question} on:answered={this.onAnswered} />` calls: it is mounted at that
   * position and updated at each render of the parent. Outside a template (router, tests), returns the element.
   */
  static create<T extends SuperElement<any>>(
    this: (new () => T) & { readonly tag: string },
    ...args: CreateArgs<PropsOf<T>, EventsOf<T>>
  ): T {
    const Class = this as unknown as ElementClass;
    define(Class);
    const [props = {}, options = {}] = args as [object?, ChildOptions<any>?];
    if (currentRendering()) return mountChild(childDef(Class) as never, props, options) as unknown as T;
    const element = construct(Class, props) as unknown as T;
    for (const [name, handler] of Object.entries(options.on ?? {}) as Array<[string, (payload: unknown) => void]>) {
      element.addEventListener(eventName(Class.tag, name), (event) => {
        if (event.target === element) handler((event as CustomEvent).detail);
      });
    }
    return element;
  }

  /** DOM name of an emitted event, for listeners set by hand. */
  static eventName<T extends SuperElement<any>>(this: (new () => T) & { readonly tag: string }, name: keyof EventsOf<T> & string): string {
    return eventName(this.tag, name);
  }

  /* ---------------------------------------------------------------------------------------- */
  /* Life cycle                                                                                */
  /* ---------------------------------------------------------------------------------------- */

  connectedCallback() {
    if (internalsOf(this).mounted) return; // just a move in the DOM: keep the state
    this.#mount();
  }

  disconnectedCallback() {
    // A move disconnects then reconnects in the same task: wait before unmounting.
    queueMicrotask(() => {
      if (!this.isConnected && internalsOf(this).mounted) this.#unmount();
    });
  }

  /** Internal: re-renders after a hot replacement. */
  [HOT_RENDER]() {
    this.#requestRender();
  }

  [REPORT](raw: unknown, phase: ErrorPhase) {
    const detail: ErrorDetail = { error: toError(raw), tag: this.localName, phase, caughtBy: null, reported: false };
    this.dispatchEvent(new CustomEvent(ERROR_REPORT, { bubbles: true, composed: true, detail }));
    if (!detail.reported) console.error(detail.error);
  }

  #mount() {
    const state = internalsOf(this);
    state.mounted = true;
    state.failed = null;
    const controller = new AbortController();
    state.controller = controller;
    const { signal } = controller;
    // Entry taken before the render: the children mounted by this render go above it.
    if (state.title.declared !== null) state.title.entry = pushTitle();

    try {
      for (const view of state.views) view.store = requestStore(this, view.name);
    } catch (error) {
      this.#fail(error, 'setup');
      return;
    }
    for (const entry of state.listeners) this.#listen(entry);
    for (const connect of state.connectors) connect(signal);

    if (this.renderError) {
      this.addEventListener(
        ERROR_EVENT,
        (event) => {
          if (state.failed) return; // already in renderError: the error keeps bubbling up
          const detail = (event as CustomEvent<ErrorDetail>).detail;
          event.stopPropagation();
          detail.caughtBy = this.localName;
          state.failed = detail.error;
          this.#requestRender();
        },
        { signal },
      );
    }

    this.#renderNow();
    if (state.failed) return;
    guarded(this, 'mount', () => this.mounted());
  }

  #unmount() {
    const state = internalsOf(this);
    state.mounted = false;
    state.controller?.abort();
    state.controller = null;
    state.subscriptions.clear();
    state.reads.clear();
    state.rawReads.clear();
    state.directReads = [];
    for (const view of state.views) view.store = null;
    if (state.title.entry) removeTitle(state.title.entry);
    state.title.entry = null;
    state.title.live = null;
    guarded(this, 'mount', () => this.unmounted());
  }

  #listen(entry: ListenerEntry) {
    const { controller } = internalsOf(this);
    if (!controller || !entry.view.store) return;
    entry.view.store.on(entry.name, (payload: unknown) => guarded(this, 'listener', () => entry.listener(payload)), {
      signal: controller.signal,
    } satisfies ListenOptions);
  }

  #requestRender() {
    const state = internalsOf(this);
    if (!state.mounted || state.renderScheduled) return;
    state.renderScheduled = true;
    scheduleRender(this, () => {
      state.renderScheduled = false;
      // Removed from the DOM by a parent's render (the outlet changing screen): it is about to be unmounted.
      if (state.mounted && this.isConnected) this.#renderNow();
    });
  }

  #renderNow() {
    const state = internalsOf(this);
    for (const read of state.reads) read.renderedValid = null;
    state.reads.clear();
    state.rawReads.clear();
    state.directReads = [];
    try {
      if (state.failed) {
        const error = state.failed;
        try {
          renderingAs(this, () => render(this.renderError!(error), this));
        } catch (fallbackError) {
          render(null, this);
          this.#fail(fallbackError, 'renderError');
        }
        return;
      }
      tracked(state.rawReads, () =>
        renderingAs(this, () => {
          render(this.render(), this);
          this.#refreshTitle();
        }),
      );
    } catch (error) {
      this.#fail(error, 'render');
      return;
    }
    this.#subscribe();
  }

  /** Subscribes to each store read during the render (directly, or through a `selector`). */
  #subscribe() {
    const state = internalsOf(this);
    const { controller } = state;
    if (!controller) return;
    const stores = new Set(state.rawReads);
    for (const read of state.reads) for (const store of read.stores) stores.add(store);
    for (const store of stores) {
      if (state.subscriptions.has(store)) continue;
      state.subscriptions.set(
        store,
        store.subscribe(() => this.#storeChanged(store), { signal: controller.signal }),
      );
    }
  }

  #storeChanged(store: AnyStore) {
    const state = internalsOf(this);
    if (state.rawReads.has(store) && this.#directReadChanged(store)) return this.#requestRender();
    for (const read of state.reads) {
      if (!read.stores.has(store)) continue;
      try {
        if (read.changed()) return this.#requestRender();
      } catch {
        // A read that fails (`this.router.at(…)` on another route): the render will redo it,
        // and its error will follow the render error path, not that of the notifying store.
        return this.#requestRender();
      }
    }
  }

  /**
   * Does a direct read of the last render, on this store, give another value? Deeply
   * equal, it has not changed (as for `selector`). A read that fails re-renders: the
   * render will redo it, and its error will follow the render error path.
   */
  #directReadChanged(store: AnyStore): boolean {
    const reads = internalsOf(this).directReads.filter((direct) => direct.store === store);
    if (reads.length === 0) return true; // store read without a recorded read: we cannot tell what changed
    try {
      return reads.some((direct) => share(direct.value, direct.read()) !== direct.value);
    } catch {
      return true;
    }
  }

  /** Switches to `renderError` (its own, or an ancestor's) and reports the error to the application. */
  #fail(raw: unknown, phase: ErrorPhase) {
    const state = internalsOf(this);
    const detail: ErrorDetail = { error: toError(raw), tag: this.localName, phase, caughtBy: null, reported: false };
    if (this.renderError && phase !== 'renderError') {
      detail.caughtBy = this.localName;
      state.failed = detail.error;
      this.#renderNow();
    } else {
      this.parentNode?.dispatchEvent(new CustomEvent(ERROR_EVENT, { bubbles: true, composed: true, detail }));
    }
    this.dispatchEvent(new CustomEvent(ERROR_REPORT, { bubbles: true, composed: true, detail }));
    if (detail.reported) return;
    if (detail.caughtBy) console.error(detail.error);
    else throw detail.error;
  }
}

/* ------------------------------------------------------------------------------------------ */
/* Definition                                                                                  */
/* ------------------------------------------------------------------------------------------ */

const LIFECYCLE = ['connectedCallback', 'disconnectedCallback'] as const;

/**
 * A tag is defined only once with the browser, with a relay class: it inherits from the
 * current version of the component. Hot replacement (`hotReplace`) changes this version without
 * redefining the tag, which `customElements.define` would refuse.
 */
type Relay = { Relay: CustomElementConstructor; current: ElementClass; versions: Set<ElementClass> };
const relays = new Map<string, Relay>();

function relayOf(Class: ElementClass): Relay {
  const relay = relays.get(Class.tag);
  if (!relay) throw new Error(`[super] ${Class.name}: component constructed before being defined`);
  return relay;
}

/** Registers the custom element at the first `create`, after checking the class. */
function define(Class: ElementClass) {
  const { tag } = Class;
  const existing = relays.get(tag);
  if (existing?.versions.has(Class)) return; // the current version, or a hot-replaced version
  if (typeof tag !== 'string' || !tag.includes('-')) {
    throw new Error(
      `[super] ${Class.name}: the tag (\`@tag = '…'\` in a .super file, \`static tag\` in a .ts file) is required and must contain a hyphen (received ${String(tag)})`,
    );
  }
  for (let proto = Class.prototype; proto && proto !== SuperElement.prototype; proto = Object.getPrototypeOf(proto)) {
    for (const hook of LIFECYCLE) {
      if (Object.hasOwn(proto, hook)) {
        throw new Error(`[super] ${Class.name}: do not override ${hook}, use mounted() / unmounted()`);
      }
    }
  }
  if (existing || customElements.get(tag)) throw new Error(`[super] the tag "${tag}" is already used by another component`);
  const Relay = class extends HTMLElement {};
  Object.setPrototypeOf(Relay.prototype, Class.prototype);
  relays.set(tag, { Relay, current: Class, versions: new Set([Class]) });
  customElements.define(tag, Relay);
}

/* ------------------------------------------------------------------------------------------ */
/* Hot replacement (HMR)                                                                       */
/* ------------------------------------------------------------------------------------------ */

/** The fields of an instance: their names, and the code of functions (handlers as arrow fields). */
const fieldsOf = (element: object) =>
  Object.entries(element)
    .filter(([key]) => !key.startsWith('_$')) // set by lit-html on the rendered element, not class fields
    .map(([key, value]) => (typeof value === 'function' ? `${key}=${String(value)}` : key))
    .sort()
    .join('\n');

/**
 * Internal, called by the code the Vite plugin adds to component modules in dev: replaces
 * the version of already defined components with that of the reloaded module. Displayed elements keep
 * their state and re-render with the new methods. If that is not safe (fields added,
 * removed or modified, `#private` fields), reloads the page.
 */
export function hotReplace(classes: ElementClass[], options: { privateFields?: boolean; reload?: () => void } = {}): void {
  const reload = options.reload ?? (() => location.reload());
  const replaced: Array<[Relay, ElementClass]> = [];
  for (const Class of classes) {
    const relay = relays.get(Class.tag);
    if (!relay || relay.current === Class) continue; // never displayed: the new version will be used at the first create
    if (options.privateFields) return reload(); // the old class's #fields are not those of the new one
    const live = document.querySelector(Class.tag);
    if (live) {
      let probe: object;
      try {
        probe = construct(Class, (live as SuperElement<any>).props, true);
      } catch {
        return reload();
      }
      if (fieldsOf(probe) !== fieldsOf(live)) return reload();
    }
    replaced.push([relay, Class]);
  }
  for (const [relay, Class] of replaced) {
    Object.setPrototypeOf(relay.Relay.prototype, Class.prototype);
    relay.current = Class;
    relay.versions.add(Class);
    for (const element of document.querySelectorAll(Class.tag)) (element as unknown as { [HOT_RENDER](): void })[HOT_RENDER]?.();
  }
}

function childDef(Class: ElementClass) {
  let def = childDefs.get(Class);
  if (!def) {
    def = {
      tag: Class.tag,
      create: (props: object): SuperElement<any> => {
        try {
          return construct(Class, props) as SuperElement<any>;
        } catch (error) {
          // The child's constructor crashed: in its place, an element that reports the error on behalf
          // of the child (phase `setup`) as soon as it is inserted, so that an ancestor can catch it.
          return failedChild(Class.tag, error) as unknown as SuperElement<any>;
        }
      },
    };
    childDefs.set(Class, def);
  }
  return def;
}

const FAILED_TAG = 'super-failed-child';

class FailedChild extends HTMLElement {
  error: unknown = null;
  failedTag = '';
  props: object = {};

  connectedCallback() {
    const detail: ErrorDetail = { error: toError(this.error), tag: this.failedTag, phase: 'setup', caughtBy: null, reported: false };
    this.parentNode?.dispatchEvent(new CustomEvent(ERROR_EVENT, { bubbles: true, composed: true, detail }));
    this.dispatchEvent(new CustomEvent(ERROR_REPORT, { bubbles: true, composed: true, detail }));
    if (detail.reported) return;
    if (detail.caughtBy) console.error(detail.error);
    else throw detail.error;
  }
}

function failedChild(tag: string, error: unknown): FailedChild {
  if (!customElements.get(FAILED_TAG)) customElements.define(FAILED_TAG, FailedChild);
  const element = document.createElement(FAILED_TAG) as FailedChild;
  element.error = error;
  element.failedTag = tag;
  return element;
}

/** A router screen: a component class with props `P` (none for a route screen, `{ error, path }` for the '!' screen). */
export type Screen<P extends object> = ElementClass<P, any>;

/** Internal: renders a screen in a template. */
export const renderScreen = (screen: Screen<any>, props: object): unknown => screen.create(props);
