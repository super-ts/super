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

/** `emit('x')` sans payload quand le type vaut `void`, `emit('x', payload)` sinon. */
export type PayloadArgs<P> = [P] extends [void] ? [] : [payload: P];

/** Handle public d'un store : c'est tout ce qu'un composant ou un autre store voit. */
export interface StoreHandle<S extends object, C extends CommandMap, E extends Events, Q = {}> {
  readonly contract: Contract<S, C, E>;
  /** État courant, figé (lecture seule). */
  state(): Readonly<S>;
  /**
   * Les sélecteurs du contrat, lus sur l'état courant à chaque appel, plus `pending(…)`.
   * `cart.selectors.count()` dans un test, ou dans un store qui reçoit `cart` en dépendance.
   */
  readonly selectors: BoundSelectors<Q> & PendingReader<C>;
  /**
   * Envoie une commande. La promesse ne porte aucune donnée : elle se résout quand le handler a
   * réussi, et se rejette s'il échoue (avec une `CommandFailure` pour un échec déclaré). Utile aux
   * tests, à la racine de composition et aux autres stores ; un composant, lui, n'attend jamais.
   */
  send<K extends keyof C & string>(name: K, ...args: Parameters<C[K]>): Promise<void>;
  /**
   * Écoute un événement du contrat, ou le cycle de vie d'une commande (`increment:done`,
   * `increment:failed`). Retourne la fonction de désabonnement.
   */
  on<K extends keyof AllEvents<C, E> & string>(
    name: K,
    listener: (payload: AllEvents<C, E>[K]) => void,
    options?: ListenOptions,
  ): Unsubscribe;
  /** Une commande est-elle en cours ? Toutes (`pending()`), une commande, ou une commande pour un body. */
  pending: PendingReader<C>['pending'];
  /** Écoute chaque changement d'état (notifications regroupées par microtask). */
  subscribe(listener: (state: Readonly<S>) => void, options?: ListenOptions): Unsubscribe;
  /** Retire tous les écouteurs internes : les `send` suivants sont rejetés. */
  dispose(): void;
}

export type AnyStore = StoreHandle<any, any, any, any>;

export type StatePatch<S> = Partial<S> | ((state: Readonly<S>) => Partial<S>);

/** Interne : ce que `SuperStore` reçoit du runtime pour lire et modifier l'état. */
export interface StoreTools<S extends object, E extends Events, Q = {}, C extends CommandMap = CommandMap> {
  get(): Readonly<S>;
  /**
   * Les sélecteurs du contrat, lus sur l'état courant à chaque appel (`selectors.count(id)` voit
   * toujours le dernier `set`), plus `selectors.pending(…)` pour les commandes en cours.
   */
  selectors: BoundSelectors<Q> & PendingReader<C>;
  /** Merge superficiel, puis notification regroupée par microtask. */
  set(patch: StatePatch<S>): void;
  emit<K extends keyof E & string>(name: K, ...args: PayloadArgs<E[K]>): void;
  /**
   * Avorté par `dispose()`. Inutile pour les stores reçus en dépendance (leurs `on` et `subscribe`
   * s'arrêtent seuls) ; à passer aux écouteurs posés hors de Super (`window.addEventListener`…).
   */
  signal: AbortSignal;
}

/** Outils d'un handler de commande (faux stores de `@super-ts/testing`). */
export interface CommandTools<Failure> {
  /** Fait échouer la commande avec une raison déclarée dans son `Outcome`. Ne revient pas. */
  fail(reason: Failure): never;
}

/**
 * Des handlers pour les commandes d'un contrat (faux stores de `@super-ts/testing`). Chacun reçoit le
 * body, puis `{ fail }`. Il peut être asynchrone ; il retourne le résultat déclaré par l'`Outcome`
 * (rien sinon), que Super publie dans `nom:done`.
 */
export type Handlers<C extends CommandMap> = {
  [K in keyof C]: (input: InputOf<C[K]>, tools: CommandTools<FailureOf<C[K]>>) => ResultOf<C[K]> | Promise<ResultOf<C[K]>>;
};

/**
 * Usage interne (`@super-ts/testing`) : un handler qui retourne ce marqueur termine la commande sans
 * publier d'issue. C'est le cas des commandes non implémentées d'un faux store.
 */
export const NO_OUTCOME: unique symbol = Symbol('super.no-outcome');

/** Échec déclaré d'une commande (`fail('below-min')`) : la promesse de `send` est rejetée avec. */
export class CommandFailure<Reason extends string = string> extends Error {
  /**
   * @param command La commande qui échoue, ou `null` pour « la commande en cours » (`this.fail`
   * d'un `SuperStore`, qui ne sait pas quel handler l'appelle).
   */
  constructor(
    readonly command: string | null,
    readonly reason: Reason,
    readonly input: unknown,
  ) {
    super(command === null ? `[super] commande échouée : ${reason}` : `[super] commande "${command}" échouée : ${reason}`);
    this.name = 'CommandFailure';
  }
}

/* ------------------------------------------------------------------------------------------ */
/* Sous le capot                                                                               */
/* ------------------------------------------------------------------------------------------ */

const withSignal = (signal: AbortSignal, options?: ListenOptions): ListenOptions => ({
  signal: options?.signal ? AbortSignal.any([signal, options.signal]) : signal,
});

/**
 * Les stores reçus en dépendance (au premier niveau de `deps`) sont remplacés par une vue dont
 * `on` et `subscribe` s'arrêtent d'eux-mêmes au `dispose()` du store qui les reçoit : aucun
 * `{ signal }` à passer. Les autres dépendances sont transmises telles quelles.
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

/** Ce qu'il faut pour construire un store : le contrat, l'état de départ, et les handlers. */
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
  /** Commandes dont le handler n'a pas encore fini. */
  #pending: PendingEntry[] = [];
  /** Cache des sélecteurs : propre à ce store, libéré avec lui. */
  #selectorCache = new SelectorCache();

  constructor(prepare: (signal: AbortSignal) => StorePreparation<S, C, E>) {
    super();
    const { contract, initialState, setup } = prepare(this.#controller.signal);
    this.contract = contract;
    this.#state = deepFreeze({ ...initialState });

    // Chaque sélecteur relit l'état au moment de l'appel : jamais figé sur l'état initial.
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

  /** Voir `readStore`. Statique pour atteindre le cache privé sans l'exposer sur le handle. */
  static read(
    store: AnyStore,
    state: object,
    contract: Contract<any, any, any, any> = store.contract,
  ): Record<string, (...args: any[]) => unknown> {
    if (!(store instanceof Store)) throw new Error('[super] readStore : ce store n’a pas été créé par Super');
    return { ...bindSelectors(contract, state, store.#selectorCache), pending: store.pending.bind(store) };
  }

  send<K extends keyof C & string>(name: K, ...args: Parameters<C[K]>): Promise<void> {
    return new Promise((resolve, reject) => {
      if (this.#controller.signal.aborted) {
        return reject(new Error(`[super] store "${this.contract.name}" disposé : commande "${name}" refusée`));
      }
      if (!(name in this.#handlers)) {
        return reject(new Error(`[super] commande inconnue "${name}" sur le store "${this.contract.name}"`));
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

  /** Pose l'écouteur d'une commande au premier `send` (permet des handlers fournis par un Proxy). */
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
            settle(); // les écouteurs de `:done` voient déjà la commande comme terminée
            if (result !== NO_OUTCOME) this.#emit(`${name}:done`, { input, result });
            resolve();
          },
          (error: unknown) => {
            settle();
            if (error instanceof CommandFailure && (error.command === name || error.command === null)) {
              this.#emit(`${name}:failed`, { input, reason: error.reason, error: null });
              // `this.fail` ne sait pas quelle commande l'appelle : le store complète l'échec.
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

  /** Prévient les abonnés (état ou commandes en cours changés), une fois par tâche. */
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
 * Interne (`@super-ts/core/internal`) : les sélecteurs du contrat d'un store, liés à `state` à travers
 * le cache de ce store, plus `pending`. Ce que reçoivent `use` et les guards du router.
 */
export const readStore = (store: AnyStore, state: object = store.state(), contract?: Contract<any, any, any, any>) =>
  Store.read(store, state, contract);

/** Interne : construit un store à partir d'une préparation (utilisé par `SuperStore.create`). */
export const buildStore = <S extends object, C extends CommandMap, E extends Events>(
  prepare: (signal: AbortSignal) => StorePreparation<S, C, E>,
): StoreHandle<S, C, E> => new Store(prepare);
