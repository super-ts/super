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
  /** Conteneur attaché à `document.body` ; à passer à `within()` de testing-library. */
  readonly container: HTMLElement;
  /** L'instance montée, typée par sa classe. */
  readonly element: T;
  setProps(props: PropsOf<T>): Promise<void>;
  unmount(): void;
}

type MountOptions<P, E> = {
  props?: P;
  stores?: AnyStore[];
  /** Router à fournir, en général `createRouter(Router, { mode: 'memory', initialPath })`. */
  router?: RouterHandle<any>;
  on?: ChildOptions<E>['on'];
  /** Reçoit les erreurs des composants montés, comme `createApp({ onError })`. */
  onError?: AppOptions['onError'];
};

/** Une classe de composant montable : ce que `SuperElement.create` accepte. */
type Mountable<T extends SuperElement<any>> = (new () => T) & {
  readonly tag: string;
  create(props?: object): T;
  eventName(name: string): string;
};

const mounted = new Set<() => void>();

/** Monte un composant dans le document, avec les stores et le router fournis, puis attend le premier rendu. */
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

/** Démonte tout ce qui a été monté par `mount` (à appeler dans un `afterEach`). */
export function cleanup() {
  for (const unmount of [...mounted]) unmount();
}

/** Laisse passer les microtasks (notifications de store, rendus) et les promesses en attente. */
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

/** Enregistre les payloads d'un événement de store, sans dépendre d'un framework de test. */
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
  /** Commandes reçues, dans l'ordre. */
  readonly sent: SentCommand<C>[];
  setState(patch: StatePatch<S>): void;
  /** Émet un événement du contrat, ou le cycle de vie d'une commande (`increment:failed`), comme le ferait le store. */
  emit<K extends keyof AllEvents<C, E> & string>(name: K, ...args: PayloadArgs<AllEvents<C, E>[K]>): void;
}

/** Les commandes qu'on peut fournir à un faux store, par le nom du contrat : `FakeCommands<'counter'>`. */
export type FakeCommands<N extends ContractName> = Partial<Handlers<ContractCommands<Contracts[N]>>>;

/**
 * Faux store qui respecte un contrat, désigné par son nom. Les commandes non fournies sont
 * enregistrées et se terminent sans publier d'issue : le test émet lui-même `nom:done` ou
 * `nom:failed`.
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
          // Le handler reçoit (body, { fail }) : seul le body est enregistré, comme il a été envoyé.
          sent.push({ name: command, args: input === undefined ? [] : [input] } as unknown as SentCommand<any>);
          // Une commande non fournie se termine sans publier d'issue : c'est au test de l'émettre.
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
