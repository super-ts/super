import type {
  AllEvents,
  BoundSelectors,
  CommandMap,
  Contract,
  Events,
  FailureOf,
  InputOf,
  PendingReader,
  ResultOf,
  Selectors,
} from './contract.ts';
import { bindSelectors } from './contract.ts';
import { deepFreeze, SelectorCache } from './memo.ts';

export type Unsubscribe = () => void;
export type ListenOptions = { signal?: AbortSignal };

/** `emit('x')` without a payload when the type is `void`, `emit('x', payload)` otherwise. */
export type PayloadArgs<P> = [P] extends [void] ? [] : [payload: P];

/** Public handle of a store: it is all a component or another store sees. */
export interface StoreHandle<S extends object, C extends CommandMap, E extends Events, Q = {}> {
  readonly contract: Contract<S, C, E>;
  /** Current state, frozen (read-only). */
  state(): Readonly<S>;
  /**
   * The contract selectors, read on the current state at each call, plus `pending(…)`.
   * `cart.selectors.count()` in a test, or in a store that receives `cart` as a dependency.
   */
  readonly selectors: BoundSelectors<Q> & PendingReader<C>;
  /**
   * Sends a command. The promise carries no data: it resolves when the handler has succeeded,
   * and rejects if it fails (with a `CommandFailure` for a declared failure). Useful for tests,
   * the composition root and other stores; a component never waits.
   */
  send<K extends keyof C & string>(name: K, ...args: Parameters<C[K]>): Promise<void>;
  /**
   * Listens to a contract event, or to the lifecycle of a command (`increment:done`,
   * `increment:failed`). Returns the unsubscribe function.
   */
  on<K extends keyof AllEvents<C, E> & string>(
    name: K,
    listener: (payload: AllEvents<C, E>[K]) => void,
    options?: ListenOptions,
  ): Unsubscribe;
  /** Is a command pending? All of them (`pending()`), one command, or one command for a body. */
  pending: PendingReader<C>['pending'];
  /** Listens to every state change (notifications batched per microtask). */
  subscribe(listener: (state: Readonly<S>) => void, options?: ListenOptions): Unsubscribe;
  /** Removes all internal listeners: later `send` calls are rejected. */
  dispose(): void;
}

export type AnyStore = StoreHandle<any, any, any, any>;

export type StatePatch<S> = Partial<S> | ((state: Readonly<S>) => Partial<S>);

/** Internal: what `SuperStore` receives from the runtime to read and change the state. */
export interface StoreTools<S extends object, E extends Events, Q = {}, C extends CommandMap = CommandMap> {
  get(): Readonly<S>;
  /**
   * The contract selectors, read on the current state at each call (`selectors.count(id)` always
   * sees the latest `set`), plus `selectors.pending(…)` for pending commands.
   */
  selectors: BoundSelectors<Q> & PendingReader<C>;
  /** Shallow merge, then notification batched per microtask. */
  set(patch: StatePatch<S>): void;
  emit<K extends keyof E & string>(name: K, ...args: PayloadArgs<E[K]>): void;
  /**
   * Aborted by `dispose()`. Not needed for stores received as dependencies (their `on` and `subscribe`
   * stop by themselves); pass it to listeners added outside Super (`window.addEventListener`…).
   */
  signal: AbortSignal;
}

/** Tools of a command handler (fake stores of `@super-ts/testing`). */
export interface CommandTools<Failure> {
  /** Fails the command with a reason declared in its `Outcome`. Does not return. */
  fail(reason: Failure): never;
}

/**
 * Handlers for the commands of a contract (fake stores of `@super-ts/testing`). Each receives the
 * body, then `{ fail }`. It can be asynchronous; it returns the result declared by the `Outcome`
 * (nothing otherwise), which Super publishes in `name:done`.
 */
export type Handlers<C extends CommandMap> = {
  [K in keyof C]: (input: InputOf<C[K]>, tools: CommandTools<FailureOf<C[K]>>) => ResultOf<C[K]> | Promise<ResultOf<C[K]>>;
};

/**
 * Internal use (`@super-ts/testing`): a handler that returns this marker finishes the command without
 * publishing an outcome. That is the case for the unimplemented commands of a fake store.
 */
export const NO_OUTCOME: unique symbol = Symbol('super.no-outcome');

/** Declared failure of a command (`fail('below-min')`): the `send` promise is rejected with it. */
export class CommandFailure<Reason extends string = string> extends Error {
  /**
   * @param command The failing command, or `null` for "the current command" (`this.fail`
   * of a `SuperStore`, which does not know which handler calls it).
   */
  constructor(
    readonly command: string | null,
    readonly reason: Reason,
    readonly input: unknown,
  ) {
    super(command === null ? `[super] command failed: ${reason}` : `[super] command "${command}" failed: ${reason}`);
    this.name = 'CommandFailure';
  }
}

/* ------------------------------------------------------------------------------------------ */
/* Under the hood                                                                              */
/* ------------------------------------------------------------------------------------------ */

const withSignal = (signal: AbortSignal, options?: ListenOptions): ListenOptions => ({
  signal: options?.signal ? AbortSignal.any([signal, options.signal]) : signal,
});

/**
 * Stores received as dependencies (at the top level of `deps`) are replaced by a view whose `on`
 * and `subscribe` stop by themselves on the `dispose()` of the store that receives them: no
 * `{ signal }` to pass. The other dependencies are passed on as is.
 */
export function bindDependencies(deps: unknown, signal: AbortSignal): unknown {
  if (typeof deps !== 'object' || deps === null || Array.isArray(deps)) return deps;
  let changed = false;
  const bound: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(deps)) {
    if (value instanceof Store) {
      changed = true;
      const store = value as AnyStore;
      bound[key] = {
        contract: store.contract,
        state: () => store.state(),
        get selectors() {
          return store.selectors;
        },
        send: (name: string, ...args: unknown[]) => store.send(name, ...args),
        on: (name: string, listener: (payload: any) => void, options?: ListenOptions) =>
          store.on(name, listener, withSignal(signal, options)),
        subscribe: (listener: (state: any) => void, options?: ListenOptions) => store.subscribe(listener, withSignal(signal, options)),
        pending: (command?: string, match?: object) => store.pending(command, match as never),
        dispose: () => store.dispose(),
      } satisfies AnyStore;
    } else {
      bound[key] = value;
    }
  }
  return changed ? bound : deps;
}

/** What it takes to build a store: the contract, the initial state, and the handlers. */
export type StorePreparation<S extends object, C extends CommandMap, E extends Events> = {
  contract: Contract<S, C, E>;
  initialState: S;
  setup: (tools: StoreTools<S, E, any, any>) => Handlers<C>;
};

type AnyHandlers = Record<string, (input: unknown, tools: CommandTools<string>) => unknown>;
type PendingEntry = { command: string; input: unknown };

const matches = (input: unknown, match: object | undefined) =>
  !match ||
  (typeof input === 'object' &&
    input !== null &&
    Object.entries(match).every(([key, value]) => Object.is((input as Record<string, unknown>)[key], value)));
type CommandDetail = { args: unknown[]; resolve: () => void; reject: (reason: unknown) => void };

export const topics = {
  command: (contract: string, name: string) => `${contract}:cmd:${name}`,
  event: (contract: string, name: string) => `${contract}:evt:${name}`,
  state: (contract: string) => `${contract}:state`,
};

class Store<S extends object, C extends CommandMap, E extends Events> extends EventTarget implements StoreHandle<S, C, E> {
  readonly contract: Contract<S, C, E>;
  #state: Readonly<S>;
  #handlers: AnyHandlers;
  #wired = new Set<string>();
  #notifyScheduled = false;
  #controller = new AbortController();
  /** Commands whose handler has not finished yet. */
  #pending: PendingEntry[] = [];
  /** Selector cache: specific to this store, released with it. */
  #selectorCache = new SelectorCache();

  constructor(prepare: (signal: AbortSignal) => StorePreparation<S, C, E>) {
    super();
    const { contract, initialState, setup } = prepare(this.#controller.signal);
    this.contract = contract;
    this.#state = deepFreeze({ ...initialState });

    // Each selector rereads the state at call time: never stuck on the initial state.
    const selectors: Record<string, (...args: unknown[]) => unknown> = {};
    for (const [key, select] of Object.entries(((contract as Contract<any, any, any, any>).__selectors ?? {}) as Selectors<any>)) {
      selectors[key] = (...args) => this.#selectorCache.run(select, this.#state, args);
    }

    selectors.pending = (command, match) => this.pending(command as never, match as never);

    this.#handlers = setup({
      get: () => this.#state,
      selectors: selectors as never,
      set: (patch) => this.#set(patch),
      emit: (name, ...args) => this.#emit(name, args[0]),
      signal: this.#controller.signal,
    }) as AnyHandlers;
  }

  state(): Readonly<S> {
    return this.#state;
  }

  get selectors(): any {
    return Store.read(this, this.#state);
  }

  /** See `readStore`. Static to reach the private cache without exposing it on the handle. */
  static read(
    store: AnyStore,
    state: object,
    contract: Contract<any, any, any, any> = store.contract,
  ): Record<string, (...args: any[]) => unknown> {
    if (!(store instanceof Store)) throw new Error('[super] readStore: this store was not created by Super');
    return { ...bindSelectors(contract, state, store.#selectorCache), pending: store.pending.bind(store) };
  }

  send<K extends keyof C & string>(name: K, ...args: Parameters<C[K]>): Promise<void> {
    return new Promise((resolve, reject) => {
      if (this.#controller.signal.aborted) {
        return reject(new Error(`[super] store "${this.contract.name}" disposed: command "${name}" rejected`));
      }
      if (!(name in this.#handlers)) {
        return reject(new Error(`[super] unknown command "${name}" on the store "${this.contract.name}"`));
      }
      this.#wire(name);
      const detail: CommandDetail = { args, resolve, reject };
      this.dispatchEvent(new CustomEvent(topics.command(this.contract.name, name), { detail }));
    });
  }

  on<K extends keyof AllEvents<C, E> & string>(
    name: K,
    listener: (payload: AllEvents<C, E>[K]) => void,
    options?: ListenOptions,
  ): Unsubscribe {
    return this.#listen(topics.event(this.contract.name, name), (event) => listener(event.detail), options);
  }

  pending<K extends keyof C & string>(command?: K, match?: Partial<NonNullable<InputOf<C[K]>>>): boolean {
    return this.#pending.some((entry) => (command === undefined || entry.command === command) && matches(entry.input, match));
  }

  subscribe(listener: (state: Readonly<S>) => void, options?: ListenOptions): Unsubscribe {
    return this.#listen(topics.state(this.contract.name), () => listener(this.#state), options);
  }

  dispose(): void {
    this.#controller.abort();
  }

  /** Adds the listener of a command on the first `send` (allows handlers provided by a Proxy). */
  #wire(name: string) {
    if (this.#wired.has(name)) return;
    this.#wired.add(name);
    this.addEventListener(
      topics.command(this.contract.name, name),
      (event) => {
        const { args, resolve, reject } = (event as CustomEvent<CommandDetail>).detail;
        const input = args[0];
        const entry: PendingEntry = { command: name, input };
        this.#pending = [...this.#pending, entry];
        this.#notify();

        const fail = (reason: string): never => {
          throw new CommandFailure(name, reason, input);
        };
        const settle = () => {
          this.#pending = this.#pending.filter((other) => other !== entry);
          this.#notify();
        };

        new Promise((run) => run(this.#handlers[name]!(input, { fail }))).then(
          (result) => {
            settle(); // `:done` listeners already see the command as finished
            if (result !== NO_OUTCOME) this.#emit(`${name}:done`, { input, result });
            resolve();
          },
          (error: unknown) => {
            settle();
            if (error instanceof CommandFailure && (error.command === name || error.command === null)) {
              this.#emit(`${name}:failed`, { input, reason: error.reason, error: null });
              // `this.fail` does not know which command calls it: the store completes the failure.
              if (error.command === null) error = new CommandFailure(name, error.reason, input);
            } else {
              const unexpected = error instanceof Error ? error : new Error(String(error));
              this.#emit(`${name}:failed`, { input, reason: 'error', error: unexpected });
            }
            reject(error);
          },
        );
      },
      { signal: this.#controller.signal },
    );
  }

  #set(patch: StatePatch<S>) {
    const partial = typeof patch === 'function' ? patch(this.#state) : patch;
    this.#state = deepFreeze({ ...this.#state, ...partial });
    this.#notify();
  }

  /** Notifies subscribers (state or pending commands changed), once per task. */
  #notify() {
    if (this.#notifyScheduled) return;
    this.#notifyScheduled = true;
    queueMicrotask(() => {
      this.#notifyScheduled = false;
      this.dispatchEvent(new CustomEvent(topics.state(this.contract.name)));
    });
  }

  #emit(name: string, payload: unknown) {
    this.dispatchEvent(new CustomEvent(topics.event(this.contract.name, name), { detail: payload }));
  }

  #listen(type: string, listener: (event: CustomEvent) => void, options?: ListenOptions): Unsubscribe {
    const controller = new AbortController();
    const stop = () => controller.abort();
    this.addEventListener(type, listener as EventListener, { signal: controller.signal });
    options?.signal?.addEventListener('abort', stop, { once: true, signal: controller.signal });
    this.#controller.signal.addEventListener('abort', stop, { once: true, signal: controller.signal });
    return stop;
  }
}

/**
 * Internal (`@super-ts/core/internal`): the selectors of a store's contract, bound to `state` through
 * that store's cache, plus `pending`. What `use` and the router guards receive.
 */
export const readStore = (store: AnyStore, state: object = store.state(), contract?: Contract<any, any, any, any>) =>
  Store.read(store, state, contract);

/** Internal: builds a store from a preparation (used by `SuperStore.create`). */
export const buildStore = <S extends object, C extends CommandMap, E extends Events>(
  prepare: (signal: AbortSignal) => StorePreparation<S, C, E>,
): StoreHandle<S, C, E> => new Store(prepare);
