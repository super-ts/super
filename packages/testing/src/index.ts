import type {
  AllEvents,
  AnyStore,
  CommandMap,
  ContractCommands,
  ContractEvents,
  ContractName,
  ContractSelectors,
  ContractState,
  Contracts,
  Events,
  Handlers,
  PayloadArgs,
  StatePatch,
  StoreHandle,
} from '@super-ts/core';
import { buildStore, contractByName, NO_OUTCOME, type StoreTools } from '@super-ts/core/internal';
import {
  type AppOptions,
  type ChildOptions,
  createApp,
  type EventsOf,
  type PropsOf,
  type RouterHandle,
  type SuperElement,
} from '@super-ts/dom';

/* ------------------------------------------------------------------------------------------ */
/* mount                                                                                       */
/* ------------------------------------------------------------------------------------------ */

export interface Mounted<T extends SuperElement<any>> {
  /** Container attached to `document.body`; pass it to testing-library's `within()`. */
  readonly container: HTMLElement;
  /** The mounted instance, typed by its class. */
  readonly element: T;
  setProps(props: PropsOf<T>): Promise<void>;
  unmount(): void;
}

type MountOptions<P, E> = {
  props?: P;
  stores?: AnyStore[];
  /** Router to provide, usually `createRouter(Router, { mode: 'memory', initialPath })`. */
  router?: RouterHandle<any>;
  on?: ChildOptions<E>['on'];
  /** Receives the errors of mounted components, like `createApp({ onError })`. */
  onError?: AppOptions['onError'];
};

/** A mountable component class: what `SuperElement.create` accepts. */
type Mountable<T extends SuperElement<any>> = (new () => T) & {
  readonly tag: string;
  create(props?: object): T;
  eventName(name: string): string;
};

const mounted = new Set<() => void>();

/** Mounts a component in the document, with the provided stores and router, then waits for the first render. */
export async function mount<T extends SuperElement<any>>(
  Class: Mountable<T>,
  options: MountOptions<PropsOf<T>, EventsOf<T>> = {},
): Promise<Mounted<T>> {
  const container = document.createElement('div');
  document.body.append(container);
  const app = createApp({ root: container, stores: options.stores ?? [], router: options.router, onError: options.onError });
  const element = Class.create(options.props as object | undefined);

  for (const [name, handler] of Object.entries(options.on ?? {}) as Array<[string, (payload: unknown) => void]>) {
    element.addEventListener(Class.eventName(name), (event) => handler((event as CustomEvent).detail));
  }

  app.mount(element);
  const unmount = () => {
    mounted.delete(unmount);
    app.dispose();
    container.remove();
  };
  mounted.add(unmount);
  await flush();

  return {
    container,
    element,
    async setProps(props) {
      element.props = props;
      await flush();
    },
    unmount,
  };
}

/** Unmounts everything mounted by `mount` (call it in an `afterEach`). */
export function cleanup() {
  for (const unmount of [...mounted]) unmount();
}

/** Lets the microtasks (store notifications, renders) and pending promises run. */
export function flush(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

/* ------------------------------------------------------------------------------------------ */
/* record                                                                                      */
/* ------------------------------------------------------------------------------------------ */

export interface Recorder<P> {
  readonly calls: P[];
  readonly last: P | undefined;
  stop(): void;
}

/** Records the payloads of a store event, without depending on a test framework. */
export function record<C extends CommandMap, E extends Events, K extends keyof AllEvents<C, E> & string>(
  store: StoreHandle<any, C, E>,
  name: K,
): Recorder<AllEvents<C, E>[K]> {
  const calls: AllEvents<C, E>[K][] = [];
  const stop = store.on(name, (payload) => calls.push(payload));
  return {
    calls,
    get last() {
      return calls.at(-1);
    },
    stop,
  };
}

/* ------------------------------------------------------------------------------------------ */
/* fakeStore                                                                                   */
/* ------------------------------------------------------------------------------------------ */

export type SentCommand<C extends CommandMap> = {
  [K in keyof C & string]: { name: K; args: Parameters<C[K]> };
}[keyof C & string];

export interface FakeStore<S extends object, C extends CommandMap, E extends Events, Q = {}> extends StoreHandle<S, C, E, Q> {
  /** Commands received, in order. */
  readonly sent: SentCommand<C>[];
  setState(patch: StatePatch<S>): void;
  /** Emits a contract event, or the lifecycle of a command (`increment:failed`), as the store would. */
  emit<K extends keyof AllEvents<C, E> & string>(name: K, ...args: PayloadArgs<AllEvents<C, E>[K]>): void;
}

/** The commands you can provide to a fake store, by contract name: `FakeCommands<'counter'>`. */
export type FakeCommands<N extends ContractName> = Partial<Handlers<ContractCommands<Contracts[N]>>>;

/**
 * Fake store that honours a contract, referred to by its name. Commands not provided are
 * recorded and finish without publishing an outcome: the test emits `name:done` or
 * `name:failed` itself.
 */
export function fakeStore<N extends ContractName>(
  name: N,
  options: { state: ContractState<Contracts[N]>; commands?: FakeCommands<N> },
): FakeStore<ContractState<Contracts[N]>, ContractCommands<Contracts[N]>, ContractEvents<Contracts[N]>, ContractSelectors<Contracts[N]>> {
  const sent: SentCommand<any>[] = [];
  let tools!: StoreTools<any, any>;
  const provided = (options.commands ?? {}) as Record<string, (...args: unknown[]) => unknown>;

  const store = buildStore(() => ({
    contract: contractByName(name),
    initialState: options.state as object,
    setup: (t) => {
      tools = t;
      return new Proxy({} as Handlers<any>, {
        has: () => true,
        get: (_target, command: string) => (input: unknown, commandTools: unknown) => {
          // The handler receives (body, { fail }): only the body is recorded, as it was sent.
          sent.push({ name: command, args: input === undefined ? [] : [input] } as unknown as SentCommand<any>);
          // A command not provided finishes without publishing an outcome: it is up to the test to emit it.
          const handler = provided[command];
          return handler ? handler(input, commandTools) : NO_OUTCOME;
        },
      });
    },
  }));

  return Object.assign(store, {
    sent,
    setState: (patch: StatePatch<any>) => tools.set(patch),
    emit: (event: string, ...args: unknown[]) => tools.emit(event, ...(args as [])),
  }) as never;
}
