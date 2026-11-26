import { SelectorCache } from './memo.ts';

declare const OUTCOME: unique symbol;

/**
 * Issue d'une commande, déclarée dans le contrat : le résultat publié en cas de succès, et les
 * raisons d'échec possibles. `increment(input: { id: string }): Outcome<{ count: number }, 'below-min'>`.
 * Rien ne revient à celui qui envoie la commande : Super publie l'issue par `increment:done` et
 * `increment:failed`.
 */
export interface Outcome<Result = void, Failure extends string = never> {
  readonly [OUTCOME]: { result: Result; failure: Failure };
}

/**
 * Commandes d'un contrat : composant vers store. Au plus un paramètre, le body. Une commande ne
 * renvoie rien à l'appelant : elle déclare `void`, ou `Outcome<…>` pour typer son issue.
 */
export type CommandMap = Record<string, (input?: any) => void | Promise<void> | Outcome<any, any>>;

/** Le body d'une commande (`undefined` si elle n'en a pas). */
export type InputOf<F> = F extends (...args: infer A) => any ? (A extends [] ? undefined : A[0]) : never;
/** Le résultat publié par une commande réussie (`void` si elle ne déclare pas d'`Outcome`). */
export type ResultOf<F> = F extends (...args: any[]) => infer R ? (R extends Outcome<infer X, any> ? X : void) : never;
/** Les raisons d'échec déclarées par une commande. */
export type FailureOf<F> = F extends (...args: any[]) => infer R ? (R extends Outcome<any, infer Y> ? Y : never) : never;

/** Raison d'échec d'une exception inattendue (un bug), en plus des raisons déclarées. */
export type UnexpectedFailure = 'error';

/**
 * Les événements de cycle de vie, émis par Super pour chaque commande :
 * `nom:done` (`{ input, result }`) et `nom:failed` (`{ input, reason, error }`).
 */
export type CommandEvents<C> = {
  [K in keyof C & string as `${K}:done`]: { input: InputOf<C[K]>; result: ResultOf<C[K]> };
} & {
  [K in keyof C & string as `${K}:failed`]: {
    input: InputOf<C[K]>;
    /** Une raison déclarée dans l'`Outcome`, ou `'error'` pour une exception inattendue. */
    reason: FailureOf<C[K]> | UnexpectedFailure;
    /** L'exception, pour `'error'` ; `null` pour un échec déclaré. */
    error: Error | null;
  };
};

/** Tout ce qu'on peut écouter sur un store : ses événements, et le cycle de vie de ses commandes. */
export type AllEvents<C, E> = E & CommandEvents<C>;

/** « Une commande est-elle en cours ? » : toutes, une commande, ou une commande pour un body donné. */
export interface PendingReader<C> {
  pending<K extends keyof C & string>(command?: K, match?: Partial<NonNullable<InputOf<C[K]>>>): boolean;
}

/** Événements d'un contrat : diffusions store vers abonnés, sans réponse. */
export type Events = Record<string, unknown>;

/** Sélecteurs d'un contrat : des lectures pures de l'état, avec ou sans paramètres. */
export type Selectors<S> = Record<string, (state: Readonly<S>, ...args: any[]) => unknown>;

/** Les sélecteurs, état déjà fourni : `count: (s, id: string) => number` devient `count(id: string): number`. */
export type BoundSelectors<Q> = {
  [K in keyof Q]: Q[K] extends (state: any, ...args: infer A) => infer R ? (...args: A) => R : never;
};

/**
 * Sous le capot : le contrat tel que le runtime le lit, construit à partir d'une classe
 * `SuperContract` (son nom et ses sélecteurs). Les types `state`, `commands` et `events` vivent
 * dans une propriété fantôme qui n'existe que pour le compilateur.
 */
export interface Contract<
  S extends object = object,
  C extends CommandMap = CommandMap,
  E extends Events = Events,
  Q extends Selectors<S> = {},
> {
  readonly name: string;
  readonly __types?: { state: S; commands: C; events: E; selectors: Q };
  /** Les sélecteurs déclarés (les méthodes de la classe du contrat). */
  readonly __selectors?: Q;
}

/**
 * Lie les sélecteurs d'un contrat à un état, à travers un cache. Interne : les stores passent leur
 * propre cache, `read` un cache attaché à l'état lu.
 */
export function bindSelectors(contract: Contract<any, any, any, any>, state: object, cache: SelectorCache) {
  const bound: Record<string, (...args: unknown[]) => unknown> = {};
  for (const [key, select] of Object.entries((contract.__selectors ?? {}) as Selectors<any>)) {
    bound[key] = (...args) => cache.run(select, state, args);
  }
  return bound;
}
