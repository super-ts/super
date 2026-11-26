import type { BoundSelectors, CommandMap, Contract, Events, FailureOf, InputOf, PendingReader, ResultOf, Selectors } from './contract';
import type { PayloadArgs, StatePatch, StoreHandle, StoreTools } from './store';
import { bindDependencies, buildStore, CommandFailure } from './store';

/* ------------------------------------------------------------------------------------------ */
/* Registre des contrats                                                                       */
/* ------------------------------------------------------------------------------------------ */

/**
 * Dictionnaire nom → classe de contrat, pour le compilateur. Rempli par le fichier généré par le
 * plugin Vite (`src/@core/contracts.d.ts`) : on ne l'écrit jamais à la main.
 */
// biome-ignore lint/suspicious/noEmptyInterface: complété par augmentation de module
export interface Contracts {}

/** Le nom d'un contrat connu de l'app : `'cart'`. */
export type ContractName = keyof Contracts & string;

/* ------------------------------------------------------------------------------------------ */
/* SuperContract                                                                               */
/* ------------------------------------------------------------------------------------------ */

declare const TYPES: unique symbol;
declare const CONTRACT: unique symbol;

/** Ce que déclare un contrat : son état, ses commandes, ses événements. */
export type ContractTypes = { state: object; commands?: CommandMap; events?: Events };

/**
 * Un contrat de store : son nom, ses types (`state`, `commands`, `events`), et ses sélecteurs,
 * écrits comme des méthodes qui reçoivent l'état en premier paramètre.
 *
 * ```ts
 * export class CartContract extends SuperContract<CartTypes> {
 *   constructor() {
 *     super({ name: 'cart' });
 *   }
 *   count(s: CartState) {
 *     return Object.values(s.quantities).reduce((sum, n) => sum + n, 0);
 *   }
 * }
 * ```
 */
export abstract class SuperContract<T extends ContractTypes> {
  /** Fantôme : n'existe que pour le compilateur. */
  declare readonly [TYPES]?: T;
  readonly name: string;

  constructor(options: { name: string } & KnownKeys<T>) {
    this.name = options.name;
  }
}

/**
 * Refuse une clé inconnue dans les types d'un contrat (`command` au lieu de `commands`) : l'erreur
 * apparaît sur `super({ name })`, avec la clé en cause et les clés attendues.
 */
type KnownKeys<T> = [Exclude<keyof T, keyof ContractTypes>] extends [never]
  ? {}
  : {
      [K in Exclude<keyof T, keyof ContractTypes> &
        string as `clé inconnue dans les types du contrat : ${K} (attendu : state, commands, events)`]: never;
    };

type AnyContract = SuperContract<any>;
type TypesOf<K> = K extends SuperContract<infer T> ? T : never;

/** L'état déclaré par un contrat-classe. */
export type ContractState<K> = TypesOf<K>['state'];
/** Les commandes déclarées par un contrat-classe. */
export type ContractCommands<K> = TypesOf<K> extends { commands: infer C extends CommandMap } ? C : {};
/** Les événements déclarés par un contrat-classe. */
export type ContractEvents<K> = TypesOf<K> extends { events: infer E extends Events } ? E : {};

type SelectorKey<K> = {
  [M in keyof K]-?: M extends 'name' | 'constructor' ? never : K[M] extends (state: any, ...args: any[]) => any ? M : never;
}[keyof K];

/** Les sélecteurs d'un contrat-classe, état en premier paramètre. */
export type ContractSelectors<K> = { [M in SelectorKey<K>]: K[M] };

/** Un sélecteur dont le premier paramètre n'accepte pas l'état du contrat. */
type MisplacedState<K> = {
  [M in SelectorKey<K>]: K[M] extends (...args: infer A) => any
    ? A extends []
      ? never // sans paramètre : il ignore l'état, rien à vérifier
      : [ContractState<K>] extends [A[0]]
        ? never
        : M
    : never;
}[SelectorKey<K>];

/**
 * Vérifie les sélecteurs d'un contrat, à la déclaration de son store (`SuperStore<CartContract>`) :
 * - leur premier paramètre accepte l'état du contrat (il est annoté à la main) ;
 * - aucun ne s'appelle `pending`, que Super fournit avec les sélecteurs.
 */
export type CheckedContract<K> = {
  [M in MisplacedState<K>]: {
    error: 'le premier paramètre d’un sélecteur est l’état du contrat';
    expected: (state: ContractState<K>, ...args: any[]) => unknown;
  };
} & ('pending' extends SelectorKey<K> ? { pending: { error: '« pending » est réservé : Super le fournit avec les sélecteurs' } } : {});

/** Les sélecteurs d'un contrat-classe, état déjà fourni, plus `pending(…)`. */
export type BoundContractSelectors<K> = BoundSelectors<ContractSelectors<K>> & PendingReader<ContractCommands<K>>;

/** Le handle d'un store qui implémente ce contrat-classe : ce que renvoie `CartStore.create()`. */
export type ContractStore<K> = StoreHandle<ContractState<K>, ContractCommands<K>, ContractEvents<K>, ContractSelectors<K>>;

/** Le handle d'un store, par le nom de son contrat : `StoreOfContract<'cart'>`, pour typer une dépendance. */
export type StoreOfContract<N extends ContractName> = ContractStore<Contracts[N]>;

type ContractClass = abstract new () => AnyContract;

/** Sous le capot : nom → classe, rempli par le module virtuel du plugin Vite. */
const registry = new Map<string, () => ContractClass>();
const compiled = new WeakMap<ContractClass, Contract<any, any, any, any>>();

/** Interne : inscrit un contrat-classe sous son nom (fait par le plugin Vite, ou par un test du framework). */
export function registerContract(name: string, load: () => ContractClass): void {
  registry.set(name, load);
}

/** Interne : la classe inscrite sous ce nom. */
export function contractClass(name: string): ContractClass {
  const load = registry.get(name);
  if (!load) {
    throw new Error(
      `[super] aucun contrat nommé "${name}". Les contrats sont lus dans src/@core/*.contract.ts par le plugin Vite de Super.`,
    );
  }
  return load();
}

/**
 * Interne : le contrat lu par le runtime, construit une fois par classe. Les sélecteurs sont les
 * méthodes de la classe (et de ses parents jusqu'à `SuperContract`).
 */
export function compileContract(Class: ContractClass): Contract<any, any, any, any> {
  const cached = compiled.get(Class);
  if (cached) return cached;
  const instance = new (Class as unknown as new () => AnyContract)();
  const selectors: Record<string, (state: object, ...args: unknown[]) => unknown> = {};
  for (let proto = Object.getPrototypeOf(instance); proto && proto !== SuperContract.prototype; proto = Object.getPrototypeOf(proto)) {
    for (const key of Object.getOwnPropertyNames(proto)) {
      if (key === 'constructor' || key in selectors) continue;
      const method = Object.getOwnPropertyDescriptor(proto, key)?.value;
      if (typeof method !== 'function') continue;
      if (key === 'pending') throw new Error('[super] "pending" est réservé : Super le fournit avec les sélecteurs');
      selectors[key] = (state, ...args) => method.call(instance, state, ...args);
    }
  }
  const contract = Object.freeze({ name: instance.name, __selectors: Object.freeze(selectors) });
  compiled.set(Class, contract);
  return contract;
}

/** Interne : le contrat lu par le runtime, par son nom. */
export const contractByName = (name: string) => compileContract(contractClass(name));

/* ------------------------------------------------------------------------------------------ */
/* SuperStore                                                                                  */
/* ------------------------------------------------------------------------------------------ */

/** Les noms de contrat dont la classe est exactement `K`. */
type NameOf<K> = {
  [N in keyof Contracts]: [Contracts[N]] extends [K] ? ([K] extends [Contracts[N]] ? N : never) : never;
}[keyof Contracts] &
  string;

/** Ce que reçoit `super(…)` dans le constructeur d'un store. */
export type StoreOptions<K> = {
  /** Le nom du contrat implémenté, celui de `super({ name })` dans le contrat. */
  contract: NameOf<K>;
  /** Copié superficiellement à la création. */
  initialState: NoInfer<ContractState<K>>;
};

/** Les paramètres d'une commande (aucun, ou le body). */
type ArgsOf<F> = F extends (...args: infer A) => any ? A : never;

type AllFailures<C> = { [M in keyof C]: FailureOf<C[M]> }[keyof C];

type StoreInternals = {
  options: StoreOptions<any>;
  tools: StoreTools<any, any, any, any> | null;
  handle: StoreHandle<any, any, any, any> | null;
};

/**
 * Implémentation d'un contrat. Chaque méthode publique est une commande du contrat ; le code
 * partagé entre commandes s'écrit en méthodes `#privées`.
 *
 * ```ts
 * export class CartStore extends SuperStore<CartContract> implements Commands<CartStore> {
 *   constructor() {
 *     super({ contract: 'cart', initialState: { quantities: {} } });
 *   }
 *   add({ sku }: { sku: string }) {
 *     this.set({ quantities: { ...this.get().quantities, [sku]: this.selectors.quantity(sku) + 1 } });
 *   }
 * }
 * ```
 */
export abstract class SuperStore<K extends AnyContract & CheckedContract<K>> {
  /** Fantôme : n'existe que pour le compilateur. */
  declare readonly [CONTRACT]?: K;
  #internals: StoreInternals;

  constructor(options: StoreOptions<K>) {
    this.#internals = { options, tools: null, handle: null };
  }

  #tools(): StoreTools<any, any, any, any> {
    const { tools } = this.#internals;
    if (!tools) throw new Error('[super] un store ne lit ni ne modifie son état dans son constructeur : utilise create()');
    return tools;
  }

  /** État courant, figé. */
  protected get(): Readonly<ContractState<K>> {
    return this.#tools().get();
  }

  /** Merge superficiel, puis notification regroupée par microtask. */
  protected set(patch: StatePatch<ContractState<K>>): void {
    this.#tools().set(patch);
  }

  /** Les sélecteurs du contrat, lus sur l'état courant à chaque appel, plus `pending(…)`. */
  protected get selectors(): BoundContractSelectors<K> {
    return this.#tools().selectors as never;
  }

  /** Émet un événement déclaré par le contrat. */
  protected emit<N extends keyof ContractEvents<K> & string>(name: N, ...args: PayloadArgs<ContractEvents<K>[N]>): void {
    this.#tools().emit(name, ...(args as []));
  }

  /**
   * Envoie une commande de ce store, suivie par Super (en cours, `nom:done`, `nom:failed`). Pour
   * partager du code entre commandes sans suivi, utilise une méthode `#privée`.
   */
  protected send<N extends keyof ContractCommands<K> & string>(name: N, ...args: ArgsOf<ContractCommands<K>[N]>): Promise<void> {
    const { handle } = this.#internals;
    if (!handle) throw new Error('[super] un store n’envoie pas de commande dans son constructeur');
    return handle.send(name, ...(args as unknown as never[]));
  }

  /** Fait échouer la commande en cours avec une raison déclarée dans son `Outcome`. Ne revient pas. */
  protected fail(reason: AllFailures<ContractCommands<K>>): never {
    throw new CommandFailure(null, reason as string, undefined);
  }

  /** Avorté par `dispose()`, pour les écouteurs posés hors de Super (`window.addEventListener`…). */
  protected get signal(): AbortSignal {
    return this.#tools().signal;
  }

  /**
   * Crée le store et renvoie son handle : `send`, `on`, `selectors`, `subscribe`… jamais l'instance.
   * Les arguments sont ceux du constructeur (les dépendances).
   */
  static create<T extends SuperStore<any>, A extends unknown[]>(
    this: new (
      ...args: A
    ) => T,
    ...args: A
  ): ContractStore<T extends SuperStore<infer K> ? K : never> {
    const Class = this;
    let instance!: T;
    const handle = buildStore((signal) => {
      // Les stores reçus en dépendance arrêtent seuls leurs écoutes au dispose() de celui-ci.
      const bound = args.length > 0 ? [bindDependencies(args[0], signal), ...args.slice(1)] : args;
      instance = new Class(...(bound as A));
      const internals = instance.#internals;
      return {
        contract: contractByName(internals.options.contract),
        initialState: internals.options.initialState,
        setup: (tools) => {
          internals.tools = tools;
          return commandHandlers(instance) as never;
        },
      };
    });
    instance.#internals.handle = handle;
    return handle as never;
  }
}

/** Les commandes d'une instance : ses méthodes publiques, de sa classe jusqu'à `SuperStore`. */
function commandHandlers(instance: SuperStore<any>): Record<string, (input: unknown) => unknown> {
  const handlers: Record<string, (input: unknown) => unknown> = {};
  for (let proto = Object.getPrototypeOf(instance); proto && proto !== SuperStore.prototype; proto = Object.getPrototypeOf(proto)) {
    for (const key of Object.getOwnPropertyNames(proto)) {
      if (key === 'constructor' || key in handlers) continue;
      const method = Object.getOwnPropertyDescriptor(proto, key)?.value;
      if (typeof method === 'function') handlers[key] = (input) => method.call(instance, input);
    }
  }
  return handlers;
}

/* ------------------------------------------------------------------------------------------ */
/* Commands<Self>                                                                              */
/* ------------------------------------------------------------------------------------------ */

type Equals<A, B> = (<X>() => X extends A ? 1 : 2) extends <X>() => X extends B ? 1 : 2 ? true : false;

type CheckCommand<Declared, Method> = Method extends (...args: infer P) => infer R
  ? Declared extends (...args: infer DP) => infer DR
    ? Equals<P, DP> extends true
      ? [Awaited<R>] extends [ResultOf<(...args: any[]) => DR>]
        ? Method
        : { error: 'le handler renvoie une donnée non déclarée par le contrat'; expected: ResultOf<(...args: any[]) => DR> }
      : { error: 'paramètres différents de ceux du contrat'; expected: DP }
    : never
  : { error: 'une commande est une méthode'; expected: Declared };

type ContractOfStore<Self> = Self extends SuperStore<infer K> ? K : never;

type PublicMethodKey<Self> = {
  [M in keyof Self]-?: Self[M] extends (...args: any[]) => any ? M : never;
}[keyof Self];

type Extra<Self> = Exclude<PublicMethodKey<Self>, keyof ContractCommands<ContractOfStore<Self>>>;

/**
 * Vérifie qu'un store implémente exactement les commandes de son contrat :
 * `class CartStore extends SuperStore<CartContract> implements Commands<CartStore>`.
 *
 * - chaque commande a un handler, aux paramètres strictement égaux à ceux du contrat ;
 * - un handler ne renvoie que le résultat déclaré (`void`, ou le `R` d'un `Outcome<R, …>`) ;
 * - toute méthode publique est une commande : le code partagé s'écrit en méthodes `#privées`.
 */
export type Commands<Self> = {
  [M in keyof ContractCommands<ContractOfStore<Self>>]: M extends keyof Self
    ? CheckCommand<ContractCommands<ContractOfStore<Self>>[M], Self[M]>
    : ContractCommands<ContractOfStore<Self>>[M];
} & {
  [M in Extra<Self>]: { error: 'méthode publique hors contrat : une commande se déclare dans le contrat, un helper s’écrit en #privé' };
};

/** Le body d'une commande d'un contrat-classe. */
export type ContractInput<K, N extends keyof ContractCommands<K>> = InputOf<ContractCommands<K>[N]>;
