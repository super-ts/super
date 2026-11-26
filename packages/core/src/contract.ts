import { SelectorCache } from './memo.ts';

declare const OUTCOME: unique symbol;

/**
 * Outcome of a command, declared in the contract: the result published on success, and the
 * possible failure reasons. `increment(input: { id: string }): Outcome<{ count: number }, 'below-min'>`.
 * Nothing comes back to whoever sends the command: Super publishes the outcome through `increment:done` and
 * `increment:failed`.
 */
export interface Outcome<Result = void, Failure extends string = never> {
  readonly [OUTCOME]: { result: Result; failure: Failure };
}

/**
 * Commands of a contract: component to store. At most one parameter, the body. A command returns
 * nothing to the caller: it declares `void`, or `Outcome<…>` to type its outcome.
 */
export type CommandMap = Record<string, (input?: any) => void | Promise<void> | Outcome<any, any>>;

/** The body of a command (`undefined` if it has none). */
export type InputOf<F> = F extends (...args: infer A) => any ? (A extends [] ? undefined : A[0]) : never;
/** The result published by a successful command (`void` if it declares no `Outcome`). */
export type ResultOf<F> = F extends (...args: any[]) => infer R ? (R extends Outcome<infer X, any> ? X : void) : never;
/** The failure reasons declared by a command. */
export type FailureOf<F> = F extends (...args: any[]) => infer R ? (R extends Outcome<any, infer Y> ? Y : never) : never;

/** Failure reason for an unexpected exception (a bug), on top of the declared reasons. */
export type UnexpectedFailure = 'error';

/**
 * The lifecycle events, emitted by Super for each command:
 * `name:done` (`{ input, result }`) and `name:failed` (`{ input, reason, error }`).
 */
export type CommandEvents<C> = {
  [K in keyof C & string as `${K}:done`]: { input: InputOf<C[K]>; result: ResultOf<C[K]> };
} & {
  [K in keyof C & string as `${K}:failed`]: {
    input: InputOf<C[K]>;
    /** A reason declared in the `Outcome`, or `'error'` for an unexpected exception. */
    reason: FailureOf<C[K]> | UnexpectedFailure;
    /** The exception, for `'error'`; `null` for a declared failure. */
    error: Error | null;
  };
};

/** Everything you can listen to on a store: its events, and the lifecycle of its commands. */
export type AllEvents<C, E> = E & CommandEvents<C>;

/** "Is a command pending?": all of them, one command, or one command for a given body. */
export interface PendingReader<C> {
  pending<K extends keyof C & string>(command?: K, match?: Partial<NonNullable<InputOf<C[K]>>>): boolean;
}

/** Events of a contract: broadcasts from the store to subscribers, with no response. */
export type Events = Record<string, unknown>;

/** Selectors of a contract: pure reads of the state, with or without parameters. */
export type Selectors<S> = Record<string, (state: Readonly<S>, ...args: any[]) => unknown>;

/** The selectors, with the state already supplied: `count: (s, id: string) => number` becomes `count(id: string): number`. */
export type BoundSelectors<Q> = {
  [K in keyof Q]: Q[K] extends (state: any, ...args: infer A) => infer R ? (...args: A) => R : never;
};

/**
 * Under the hood: the contract as the runtime reads it, built from a `SuperContract` class (its
 * name and its selectors). The `state`, `commands` and `events` types live in a phantom property
 * that only exists for the compiler.
 */
export interface Contract<
  S extends object = object,
  C extends CommandMap = CommandMap,
  E extends Events = Events,
  Q extends Selectors<S> = {},
> {
  readonly name: string;
  readonly __types?: { state: S; commands: C; events: E; selectors: Q };
  /** The declared selectors (the methods of the contract class). */
  readonly __selectors?: Q;
}

/**
 * Binds the selectors of a contract to a state, through a cache. Internal: stores pass their own
 * cache, `read` passes a cache attached to the state being read.
 */
export function bindSelectors(contract: Contract<any, any, any, any>, state: object, cache: SelectorCache) {
  const bound: Record<string, (...args: unknown[]) => unknown> = {};
  for (const [key, select] of Object.entries((contract.__selectors ?? {}) as Selectors<any>)) {
    bound[key] = (...args) => cache.run(select, state, args);
  }
  return bound;
}
