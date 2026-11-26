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
} from './component';
import { requestStore } from './context';
import { createForm, type FormHandle, type FormOptions } from './form';
import { mountChild } from './mount-directive';
import { type Page, pushTitle, removeTitle, type TitleEntry, type TitleValue, updateTitle } from './page';
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
} from './router-contract';
import { routerHrefs } from './router-link';

/* ------------------------------------------------------------------------------------------ */
/* Types publics                                                                               */
/* ------------------------------------------------------------------------------------------ */

declare const EVENTS: unique symbol;
declare const PROPS: unique symbol;
declare const ACCEPTS: unique symbol;
declare const SELECTED: unique symbol;

/**
 * Une valeur telle que renvoyée par un sélecteur, marquée pour le compilateur (la marque n'existe
 * pas à l'exécution). Elle s'utilise comme la valeur elle-même ; `selector` n'accepte qu'elle.
 * `null` et `undefined` ne peuvent pas porter de marque : Super les vérifie à l'exécution.
 */
export type Selected<T> = T extends null | undefined ? T : T & { readonly [SELECTED]: T };

/** Ce que peut renvoyer la fonction d'un `selector` : la valeur d'un sélecteur, telle quelle. */
export type SelectorValue = { readonly [SELECTED]: unknown } | null | undefined;

/** La valeur sans sa marque de sélecteur. */
export type Unselected<R> = R extends { readonly [SELECTED]: infer X } ? X : R;

/** Les sélecteurs vus d'un composant : leurs valeurs sont marquées, pour `selector`. */
export type ElementSelectors<N extends ContractName> = {
  [M in keyof BoundContractSelectors<Contracts[N]>]: BoundContractSelectors<Contracts[N]>[M] extends (...args: infer A) => infer R
    ? (...args: A) => Selected<R>
    : never;
};

/** Une valeur lue d'un store, recalculée à chaque lecture de `.value`. */
export interface Selection<T> {
  readonly value: T;
}

declare const CHILDREN: unique symbol;

/**
 * Des éléments passés à un composant, à placer dans son template par `{this.content}`. Un
 * composant qui en accepte le déclare dans ses props (`@prop content: Children;`, ou un emplacement nommé
 * `footer?: Children`). Ils sont remplis par les enfants écrits entre ses balises, par un
 * emplacement `<:footer>…</:footer>`, ou par l'appel d'une méthode qui émet des éléments.
 */
export interface Children {
  /** Fantôme : n'existe que pour le compilateur. */
  readonly [CHILDREN]: true;
}

/** Une référence vers un élément du template : `<input ref={this.input} />`, puis `this.input.value`. */
export interface ElementRef<T extends Element> {
  /** L'élément, une fois monté ; `undefined` avant. */
  readonly value: T | undefined;
}

/**
 * Ce qu'un composant voit d'un store, par le nom de son contrat : ses sélecteurs, ses commandes,
 * ses événements. Jamais l'état brut, jamais l'instance.
 */
export interface ContractView<N extends ContractName> {
  /** Fantôme : les commandes du contrat, pour le compilateur (`this.form({ submit: { to } })`). */
  readonly __commands?: ContractCommands<Contracts[N]>;
  /**
   * Les sélecteurs du contrat, lus sur l'état courant à chaque appel. Lus pendant `render`, ils
   * abonnent le composant au store, directement comme dans `this.selector(…)` : il ne se re-rend que si
   * une valeur lue change.
   */
  readonly selectors: ElementSelectors<N>;
  /**
   * Envoie une commande et laisse filer : rien à attendre. L'issue revient par les sélecteurs, ou
   * par `nom:done` / `nom:failed`.
   */
  send<K extends keyof ContractCommands<Contracts[N]> & string>(name: K, ...args: CommandArgs<ContractCommands<Contracts[N]>[K]>): void;
  /**
   * Écoute un événement du store, ou le cycle de vie d'une commande. Actif tant que le composant
   * est monté. Interdit pendant `render`.
   */
  on<K extends keyof AllEvents<ContractCommands<Contracts[N]>, ContractEvents<Contracts[N]>> & string>(
    name: K,
    listener: (payload: AllEvents<ContractCommands<Contracts[N]>, ContractEvents<Contracts[N]>>[K]) => void,
  ): void;
}

type CommandArgs<F> = F extends (...args: infer A) => any ? A : never;

/** Les routes de l'app, telles que les déclare son router (`never` sans router). */
export type AppRoutes = Contracts extends { router: infer K } ? PathsOfRouter<K> : never;

/**
 * Le router vu d'un composant (`this.router`) : la route active (`current`), une route précise
 * (`at`), la navigation (`send`), ses événements (`on`) et les URL des routes (`href`). `R` est la
 * route de l'écran, ou toutes les routes pour un composant qui n'est pas un écran.
 */
export interface RouterView<R extends keyof AppRoutes = keyof AppRoutes> {
  /**
   * La route active. Chaque valeur s'appelle pour être lue (`current.params.id()`), ou se passe
   * telle quelle à `this.selector(…)` : `id = this.selector(this.router.current.params.id)`.
   * Lue pendant `render`, elle abonne le composant au router.
   */
  readonly current: CurrentRoute<AppRoutes, R>;
  /**
   * Une route précise, pour un composant qui n'est pas son écran : ses valeurs sont typées par
   * elle, et leur lecture lève une erreur si la route active est une autre.
   */
  at<N extends keyof AppRoutes & string>(name: N): RouteAt<AppRoutes, N>;
  /** Navigation : `send('navigate', { to: 'counter', params: { id: 42 } })`, `send('back')`. */
  send<K extends keyof RouterCommands<AppRoutes> & string>(name: K, ...args: CommandArgs<RouterCommands<AppRoutes>[K]>): void;
  /** Écoute un événement du router (`navigated`). Interdit pendant `render`. */
  on<K extends keyof AllEvents<RouterCommands<AppRoutes>, RouterEvents> & string>(
    name: K,
    listener: (payload: AllEvents<RouterCommands<AppRoutes>, RouterEvents>[K]) => void,
  ): void;
  /**
   * `this.router.href('counter', { params: { id: 42 } })` donne `'/counters/42'`. Route et valeurs
   * vérifiées. `href` ne lit pas la route active : il n'abonne pas le composant au router.
   */
  href<N extends keyof AppRoutes & string>(name: N, ...input: HrefArgs<AppRoutes, N>): string;
}

/** Les contrats qu'un composant lit par `this.contract(nom)` : tous sauf le router (`this.router`). */
export type StoreContractName = Exclude<ContractName, typeof ROUTER_NAME>;

/** La vue d'un contrat par son nom. */
export type ViewOf<N extends ContractName> = N extends 'router' ? RouterView : ContractView<N>;

/**
 * Le router de l'app vu d'un composant (`this.router`), pour les routes `R` ; `never` si l'app
 * n'en déclare pas.
 */
export type AppRouterView<R = AppRouteNames> = 0 extends 1 & R
  ? any
  : [AppRoutes] extends [never]
    ? never
    : RouterView<R & keyof AppRoutes>;

/**
 * Une valeur de la route active lue par `this.selector(this.router.current.params.id)` :
 * `.value` la lit, `isValid()` dit si l'URL en portait une valeur conforme. Après ce test,
 * `.value` est du type décrit.
 */
export interface RouteSelection<V, Valid = V> extends Selection<V> {
  isValid(): this is RouteSelection<Valid, Valid>;
}

/**
 * Ce que déclare un composant : ses props, ses événements, et pour un écran sa route, tous
 * facultatifs. Dans un `.super`, la route d'un écran est posée par le compilateur, d'après le lien
 * écran → route généré par le plugin Vite.
 */
export type ElementTypes = { props?: object; emits?: Record<string, unknown>; route?: string };
/** La route déclarée (toutes les routes de l'app sans route). */
// `SuperElement<any>` (un composant quelconque) : son router est `any`, pour accepter tous les écrans.
export type RouteIn<T> = 0 extends 1 & T ? any : T extends { route: infer R extends string } ? R : AppRouteNames;
/** Les props déclarées (`{}` sans props). */
export type PropsIn<T> = 0 extends 1 & T ? any : T extends { props: infer P extends object } ? P : {};
/** Les événements déclarés (`{}` sans événements). */
export type EmitsIn<T> = 0 extends 1 & T ? any : T extends { emits: infer E } ? E : {};

/** Les props d'une instance de composant : `PropsOf<CounterScreen>`. */
export type PropsOf<T> = T extends { readonly [PROPS]?: infer P } ? P : never;
/** Les événements d'une instance de composant. */
export type EventsOf<T> = T extends { readonly [EVENTS]?: infer E } ? E : never;

type CreateArgs<P, E> = {} extends P ? [props?: P, options?: ChildOptions<E>] : [props: P, options?: ChildOptions<E>];

/** Une classe de composant : ce qu'acceptent le router, `mount` et les templates. */
export interface ElementClass<P extends object = any, E = any> {
  new (): HTMLElement;
  /**
   * Les props du composant, comparées dans les deux sens (fantômes) : il reçoit au moins `P`
   * (`[ACCEPTS]`, contravariant) et n'attend rien de plus (`[PROPS]`, covariant).
   */
  readonly prototype: { readonly [PROPS]?: P; readonly [ACCEPTS]?: (props: P) => void };
  readonly tag: string;
  create(...args: CreateArgs<P, E>): HTMLElement;
  eventName(name: keyof E & string): string;
}

/* ------------------------------------------------------------------------------------------ */
/* Sous le capot : suivi des lectures                                                          */
/* ------------------------------------------------------------------------------------------ */

/** Stores lus pendant le calcul en cours (rendu, ou `selector`). */
let tracking: Set<AnyStore> | null = null;

/**
 * Props du composant en cours de construction : déposées par Super juste avant `new`, et posées
 * par le constructeur de base. Les champs et le constructeur de la sous-classe les lisent donc déjà.
 */
let constructing: object | null = null;

/** Rendus demandés, faits ensemble à la prochaine microtâche. */
const pendingRenders = new Map<Element, () => void>();

/**
 * Demande un rendu. Les rendus en attente passent dans l'ordre du document, parents d'abord : un
 * enfant que le rendu de son parent retire (l'écran que l'outlet remplace) ne se re-rend pas avec
 * un état qui n'est plus le sien.
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

/** Interne : re-rend un composant après un remplacement à chaud. */
const HOT_RENDER = Symbol('super.hot-render');

/** Construit un composant avec ses props, lisibles dès ses champs et son constructeur. */
function construct<T>(Class: new () => T, props: object, exact = false): T {
  const previous = constructing;
  constructing = props;
  try {
    // Construit avec le code de `Class` (ses champs, son constructeur), pour le tag défini par son relais.
    const relay = relayOf(Class as unknown as ElementClass);
    // Toujours la version courante : un parent non rechargé peut encore tenir l'ancienne classe.
    return Reflect.construct(exact ? Class : relay.current, [], relay.Relay) as T;
  } finally {
    constructing = previous;
  }
}
/** Valeurs renvoyées par les sélecteurs pendant le calcul d'un `selector`. */
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
/** Un sélecteur appelé directement dans `render`, et la valeur qu'il a donnée. */
type DirectRead = { store: AnyStore; read: () => unknown; value: unknown };
type ListenerEntry = { view: ViewEntry; name: string; listener: (payload: unknown) => void };

class SelectionValue<T> implements Selection<T> {
  #read: () => T;
  #valid: (() => boolean) | null;
  #owner: SuperElement<any>;
  /** Valeur au dernier rendu, et les stores dont elle dépend. */
  rendered: { value: T } | null = null;
  /** Validité lue au dernier rendu (valeur de route seulement). */
  renderedValid: boolean | null = null;
  readonly stores = new Set<AnyStore>();

  constructor(owner: SuperElement<any>, read: () => T, valid: (() => boolean) | null = null) {
    this.#owner = owner;
    this.#read = read;
    this.#valid = valid;
  }

  /** Valeur de route : l'URL en portait-elle une valeur conforme ? */
  isValid(): boolean {
    if (!this.#valid) throw new Error(`[super] <${this.#owner.localName}> : isValid() n'existe que sur une valeur de route`);
    const valid = tracked(this.stores, this.#valid);
    if (currentRendering() === (this.#owner as unknown)) {
      this.renderedValid = valid;
      internalsOf(this.#owner).reads.add(this as SelectionValue<unknown>);
    }
    return valid;
  }

  /** Ce qui a été rendu a-t-il changé ? */
  changed(): boolean {
    if (this.rendered && !Object.is(this.compute(), this.rendered.value)) return true;
    return this.renderedValid !== null && tracked(this.stores, this.#valid!) !== this.renderedValid;
  }

  /** Recalcule, en stabilisant la référence tant que la valeur est égale en profondeur. */
  compute(): T {
    this.stores.clear();
    if (this.#valid) tracked(this.stores, this.#valid); // la validité dépend des mêmes stores
    const returns = new Set<unknown>();
    const next = tracked(this.stores, this.#read, returns);
    // La valeur d'un selector est celle d'un sélecteur, telle quelle : sinon elle pourrait ne dépendre
    // d'aucun store (et rester figée), ou mélanger le store avec autre chose. Le compilateur le vérifie
    // déjà, sauf pour `null` et `undefined`, qui ne portent pas de marque.
    if (!returns.has(next)) {
      throw new Error(
        `[super] <${this.#owner.localName}> : selector() doit renvoyer la valeur d’un sélecteur, telle quelle. ` +
          'Passe un sélecteur (`this.selector(this.cart.selectors.lines)`) ou une fonction qui en appelle un ' +
          '(`this.selector(() => this.cart.selectors.quantity(this.props.sku))`). Si l’affichage dépend d’une ' +
          'condition ou d’un calcul, fais-le dans render : `${this.props.show ? this.count.value : 0}`.',
      );
    }
    return this.rendered ? (share(this.rendered.value, next) as T) : next;
  }

  get value(): T {
    const value = this.compute();
    // Lu pendant le rendu de son composant : c'est la valeur affichée, à comparer au prochain changement.
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
  /** Branchements à rejouer à chaque montage (formulaires). */
  connectors: Array<(signal: AbortSignal) => void>;
  listeners: ListenerEntry[];
  /** `selector` lus pendant le dernier rendu. */
  reads: Set<SelectionValue<unknown>>;
  /** Stores lus directement (sans `selector`) pendant le dernier rendu. */
  rawReads: Set<AnyStore>;
  /** Les lectures directes du dernier rendu : un changement de store ne re-rend que si l'une d'elles change. */
  directReads: DirectRead[];
  subscriptions: Map<AnyStore, Unsubscribe>;
  /** La vue du router, créée au premier accès à `this.router`. */
  router: object | null;
  /** `this.page`, créé au premier accès. */
  page: Page | null;
  /**
   * Le titre posé à la préparation (`@title`, repris à chaque montage), celui posé une fois monté
   * (jusqu'au démontage), et l'entrée du composant dans la pile des titres (tant qu'il est monté).
   */
  title: { declared: TitleValue | null; live: TitleValue | null; entry: TitleEntry | null };
  controller: AbortController | null;
  mounted: boolean;
  renderScheduled: boolean;
  failed: Error | null;
};

const internals = new WeakMap<SuperElement<any>, Internals>();
/** La vue d'un contrat → son entrée (et son store, une fois monté). */
const viewEntries = new WeakMap<object, ViewEntry>();
const internalsOf = (element: SuperElement<any>) => internals.get(element)!;

/** Adaptateurs pour la directive d'enfant : un par classe, pour qu'elle reconnaisse le même composant. */
const childDefs = new WeakMap<ElementClass, { tag: string; create(props: object): SuperElement<any> }>();

/* ------------------------------------------------------------------------------------------ */
/* SuperElement                                                                                */
/* ------------------------------------------------------------------------------------------ */

/**
 * Un composant : un custom element dont la classe déclare ses props et ses événements. Il s'écrit
 * dans un fichier `.super` (voir packages/lang/SPEC.md) :
 *
 * ```tsx
 * export class ShopScreen extends SuperElement {
 *   @tag = 'shop-screen';
 *   @title = 'Boutique';
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
 * Les champs et le constructeur préparent le composant (une fois) ; `render` décrit le HTML à
 * chaque rendu, et ne peut ni lire un nouveau contrat ni créer d'état.
 */
export abstract class SuperElement<T extends ElementTypes = {}> extends HTMLElement {
  /** Fantômes : n'existent que pour le compilateur. */
  declare readonly [PROPS]?: PropsIn<T>;
  declare readonly [ACCEPTS]?: (props: PropsIn<T>) => void;
  declare readonly [EVENTS]?: EmitsIn<T>;

  constructor() {
    super();
    const props = constructing ?? {};
    constructing = null; // consommées : un élément construit ensuite par ce constructeur ne les reprend pas
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

  /** Décrit le HTML du composant. Appelé à chaque rendu. */
  abstract render(): unknown;

  /**
   * Facultatif : affiché à la place de `render` si `render` ou un composant descendant plante.
   * S'il plante lui-même, l'erreur remonte au parent suivant.
   */
  renderError?(error: Error): unknown;

  /** Appelé après le premier rendu, à chaque montage. */
  protected mounted(): void {}

  /** Appelé au démontage. */
  protected unmounted(): void {}

  /**
   * Les props reçues du parent, lisibles dès les champs et le constructeur. Un changement de prop
   * re-rend le composant ; une valeur copiée à la construction (`this.state({ draft: this.props.text })`)
   * ne suit pas les changements suivants.
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
  /* Préparation : champs et constructeur                                                      */
  /* ---------------------------------------------------------------------------------------- */

  /** Le store fourni par l'app pour ce contrat, vu à travers son contrat. Le router : `this.router`. */
  protected contract<N extends StoreContractName>(name: N): ContractView<N> {
    this.#preparing('contract');
    if ((name as string) === ROUTER_NAME) {
      throw new Error(`[super] <${this.localName}> : le router se lit par \`this.router\`, pas par \`this.contract('router')\``);
    }
    return this.#view(name) as ContractView<N>;
  }

  /**
   * Le router de l'app : la route active (`this.router.current.params.id`), une route précise
   * (`this.router.at('counter')`), la navigation (`this.router.send('navigate', { to: 'shop' })`), et
   * les URL des routes (`this.router.href('counter', { params: { id } })`). Dans un écran, `current`
   * est typé par sa route. Lisible partout, `render` compris : la vue est créée au premier accès, et
   * cherche le router au montage (tout de suite si le composant est monté).
   */
  protected get router(): AppRouterView<RouteIn<T>> {
    const state = internalsOf(this);
    if (!state.router) {
      const view = this.#view(ROUTER_NAME);
      state.router = view;
      // Premier accès une fois monté (render, mounted, gestionnaire) : le montage est déjà passé.
      if (state.mounted) {
        const entry = viewEntries.get(view)!;
        entry.store = requestStore(this, ROUTER_NAME);
      }
    }
    return state.router as AppRouterView<RouteIn<T>>;
  }

  /**
   * La page : son titre (`this.page.title = 'Boutique'`), tant que le composant est monté. Le titre
   * du dernier composant monté qui en pose un l'emporte ; à son démontage, le précédent revient. Une
   * fonction est suivie, recalculée après chaque rendu (`() => \`Compteur ${this.label.value}\``).
   * `@title = …` dans un `.super` est un raccourci pour le poser dans un champ.
   */
  protected get page(): Page {
    const state = internalsOf(this);
    if (!state.page) {
      const element = this;
      state.page = {
        get title(): never {
          throw new Error(`[super] <${element.localName}> : \`this.page.title\` se pose, il ne se lit pas`);
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
      throw new Error(`[super] <${this.localName}> : \`this.page.title\` ne se pose pas pendant render`);
    }
    const state = internalsOf(this);
    if (!state.mounted) {
      state.title.declared = value;
      return;
    }
    state.title.live = value;
    state.title.entry ??= pushTitle();
    if (typeof value === 'string') return updateTitle(state.title.entry, value);
    // Une fonction : calculée tout de suite, puis suivie par le prochain rendu (qui retient ses lectures).
    try {
      updateTitle(state.title.entry, value());
    } catch {
      // Le rendu la recalcule, et son erreur suivra le chemin des erreurs de rendu.
    }
    this.#requestRender();
  }

  /** Recalcule le titre du composant (pendant le rendu, pour que ses lectures soient suivies). */
  #refreshTitle() {
    const { title } = internalsOf(this);
    const value = title.live ?? title.declared;
    if (value === null || !title.entry) return;
    updateTitle(title.entry, typeof value === 'string' ? value : value());
  }

  /** Crée la vue d'un contrat, branchée sur son store à chaque montage. */
  #view(name: string): object {
    const view: ViewEntry = { name, store: null };
    internalsOf(this).views.push(view);
    const resolved = () => {
      if (!view.store) throw new Error(`[super] <${this.localName}> : le contrat "${name}" ne se lit qu'une fois le composant monté`);
      return view.store;
    };
    const selectors = new Proxy({} as Record<string, (...args: unknown[]) => unknown>, {
      get:
        (_target, key: string) =>
        (...args: unknown[]) => {
          const store = resolved();
          tracking?.add(store);
          // Lu à travers le contrat-classe inscrit sous ce nom (pour le router, ses sélecteurs).
          const read = () => readStore(store, store.state(), contractByName(name))[key]!(...args);
          const value = read();
          selected?.add(value);
          // Lu directement pendant un rendu (pas dans un `selector`) : retenu chez le composant qui rend,
          // qui peut être un autre que celui de la vue (un bouton qui lit le contrat de son parent).
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
            // L'issue est publiée par `nom:failed` : seule une exception inattendue mérite la console.
            if (!(error instanceof CommandFailure)) console.error(error);
          });
      },
      on: (event: string, listener: (payload: never) => void) => {
        if (currentRendering() === (this as unknown)) {
          throw new Error(`[super] <${this.localName}> : \`on\` ne s'appelle pas pendant render`);
        }
        const entry: ListenerEntry = { view, name: event, listener: listener as (payload: unknown) => void };
        // Déclaré à la préparation : rejoué à chaque montage. Posé une fois monté (gestionnaire,
        // mounted) : vit jusqu'au démontage, et c'est au code qui l'a posé de le reposer.
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
                `[super] <${this.localName}> : this.router.at('${route}') lu alors que la route active est ${active === null ? 'aucune' : `'${active}'`}`,
              );
            }
          }),
        href: (route: string, input?: object) => {
          const build = routerHrefs.get(resolved());
          if (!build) throw new Error(`[super] <${this.localName}> : ce router n'a pas été créé par createRouter`);
          return build(route, input);
        },
      });
    }
    viewEntries.set(contractView, view);
    return contractView;
  }

  /**
   * Un formulaire : valeurs, règles, vérifications asynchrones, et une soumission qui est une
   * commande d'un store (`submit.to: this.checkout`). Prêt dès la construction pour le rendu ; il
   * se branche sur le store au montage.
   */
  protected form<V, C extends CommandMap, K extends keyof C & string, RF extends FailureOf<C[K]> = never>(
    options: FormOptions<V, C, K, RF>,
  ): FormHandle<V> {
    this.#preparing('form');
    const entry = viewEntries.get(options.submit.to as object);
    if (!entry) throw new Error('[super] form : submit.to doit être un contrat obtenu avec this.contract(...)');
    const state = internalsOf(this);
    return createForm(options as never, {
      requestRender: () => this.#requestRender(),
      connect: (attach) => {
        state.connectors.push((signal) => attach(entry.store!, signal));
      },
    }) as FormHandle<V>;
  }

  /**
   * Une valeur lue d'un ou plusieurs stores : un sélecteur sans paramètre
   * (`this.selector(this.cart.selectors.lines)`), ou une fonction qui lit des sélecteurs
   * (`this.selector(() => this.cart.selectors.quantity(this.props.sku))`). Lue par `.value` dans
   * `render`, elle est recalculée à chaque rendu (donc à chaque changement de props), et le
   * composant se re-rend quand elle change. La fonction renvoie la valeur d'un sélecteur telle
   * quelle : une condition ou un calcul se font dans `render` (le compilateur le vérifie).
   */
  protected selector<V, Valid>(read: RouteValue<V, Valid>): RouteSelection<V, Valid>;
  protected selector<R extends SelectorValue>(read: () => R): Selection<Unselected<R>>;
  protected selector(read: () => SelectorValue): Selection<unknown> {
    this.#preparing('selector');
    return new SelectionValue(this, read, isRouteValue(read) ? read.isValid : null);
  }

  /**
   * État local du composant : privé à l'instance, pour les données d'interface. Le type est déduit
   * de `initial` : élargir les champs qui changeront de type (`null as string | null`).
   */
  protected state<T extends object>(initial: T): LocalState<T> {
    this.#preparing('state');
    return createLocalState(initial, () => this.#requestRender());
  }

  /** Une référence vers un élément du template : `<input ref={this.input} />`. */
  protected ref<T extends Element>(): ElementRef<T> {
    this.#preparing('ref');
    const target = createRef<T>();
    const result = ref(target);
    Object.defineProperty(result, 'value', { get: () => target.value });
    return result as unknown as ElementRef<T>;
  }

  /** Émet un événement vers le parent. */
  protected emit<K extends keyof EmitsIn<T> & string>(name: K, ...args: PayloadArgs<EmitsIn<T>[K]>): void {
    this.dispatchEvent(new CustomEvent(eventName(this.localName, name), { detail: (args as unknown[])[0], bubbles: true, composed: true }));
  }

  /** Avorté au démontage. À passer aux écouteurs posés hors de Super (`addEventListener` sur `window`…). */
  protected get signal(): AbortSignal {
    const { controller } = internalsOf(this);
    if (!controller) throw new Error(`[super] <${this.localName}> : \`signal\` n'existe qu'une fois le composant monté`);
    return controller.signal;
  }

  #preparing(name: string) {
    if (currentRendering() === (this as unknown)) {
      throw new Error(`[super] <${this.localName}> : \`${name}\` se déclare dans un champ ou le constructeur, pas pendant render`);
    }
  }

  /* ---------------------------------------------------------------------------------------- */
  /* Création                                                                                  */
  /* ---------------------------------------------------------------------------------------- */

  /**
   * Crée le composant. Dans un template, c'est ce qu'appelle la balise
   * `<ConfirmDialog question={question} on:answered={this.onAnswered} />` : il est monté à cet
   * emplacement et mis à jour à chaque rendu du parent. Hors template (router, tests), renvoie l'élément.
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

  /** Nom DOM d'un événement émis, pour les écouteurs posés à la main. */
  static eventName<T extends SuperElement<any>>(this: (new () => T) & { readonly tag: string }, name: keyof EventsOf<T> & string): string {
    return eventName(this.tag, name);
  }

  /* ---------------------------------------------------------------------------------------- */
  /* Cycle de vie                                                                              */
  /* ---------------------------------------------------------------------------------------- */

  connectedCallback() {
    if (internalsOf(this).mounted) return; // simple déplacement dans le DOM : on garde l'état
    this.#mount();
  }

  disconnectedCallback() {
    // Un déplacement déconnecte puis reconnecte dans la même tâche : on attend avant de démonter.
    queueMicrotask(() => {
      if (!this.isConnected && internalsOf(this).mounted) this.#unmount();
    });
  }

  /** Interne : re-rend après un remplacement à chaud. */
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
    // Entrée prise avant le rendu : les enfants montés par ce rendu passent au-dessus.
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
          if (state.failed) return; // déjà en renderError : l'erreur continue de remonter
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
      // Retiré du DOM par le rendu d'un parent (l'outlet qui change d'écran) : il va être démonté.
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

  /** S'abonne à chaque store lu pendant le rendu (directement, ou par un `selector`). */
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
        // Une lecture qui échoue (`this.router.at(…)` sur une autre route) : le rendu la refera,
        // et son erreur suivra le chemin des erreurs de rendu, pas celui du store qui notifie.
        return this.#requestRender();
      }
    }
  }

  /**
   * Une lecture directe du dernier rendu, sur ce store, donne-t-elle une autre valeur ? Égale en
   * profondeur, elle n'a pas changé (comme pour `selector`). Une lecture qui échoue re-rend : le
   * rendu la refera, et son erreur suivra le chemin des erreurs de rendu.
   */
  #directReadChanged(store: AnyStore): boolean {
    const reads = internalsOf(this).directReads.filter((direct) => direct.store === store);
    if (reads.length === 0) return true; // store lu sans lecture retenue : on ne sait pas ce qui a changé
    try {
      return reads.some((direct) => share(direct.value, direct.read()) !== direct.value);
    } catch {
      return true;
    }
  }

  /** Passe à `renderError` (le sien, ou celui d'un ancêtre) et signale l'erreur à l'application. */
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
/* Définition                                                                                  */
/* ------------------------------------------------------------------------------------------ */

const LIFECYCLE = ['connectedCallback', 'disconnectedCallback'] as const;

/**
 * Un tag n'est défini qu'une fois auprès du navigateur, avec une classe relais : elle hérite de la
 * version courante du composant. Le remplacement à chaud (`hotReplace`) change cette version sans
 * redéfinir le tag, ce que `customElements.define` refuserait.
 */
type Relay = { Relay: CustomElementConstructor; current: ElementClass; versions: Set<ElementClass> };
const relays = new Map<string, Relay>();

function relayOf(Class: ElementClass): Relay {
  const relay = relays.get(Class.tag);
  if (!relay) throw new Error(`[super] ${Class.name} : composant construit avant d'être défini`);
  return relay;
}

/** Enregistre le custom element au premier `create`, après avoir vérifié la classe. */
function define(Class: ElementClass) {
  const { tag } = Class;
  const existing = relays.get(tag);
  if (existing?.versions.has(Class)) return; // la version courante, ou une version remplacée à chaud
  if (typeof tag !== 'string' || !tag.includes('-')) {
    throw new Error(
      `[super] ${Class.name} : le tag (\`@tag = '…'\` dans un .super, \`static tag\` dans un .ts) est obligatoire et doit contenir un tiret (reçu ${String(tag)})`,
    );
  }
  for (let proto = Class.prototype; proto && proto !== SuperElement.prototype; proto = Object.getPrototypeOf(proto)) {
    for (const hook of LIFECYCLE) {
      if (Object.hasOwn(proto, hook)) {
        throw new Error(`[super] ${Class.name} : ne surcharge pas ${hook}, utilise mounted() / unmounted()`);
      }
    }
  }
  if (existing || customElements.get(tag)) throw new Error(`[super] le tag "${tag}" est déjà utilisé par un autre composant`);
  const Relay = class extends HTMLElement {};
  Object.setPrototypeOf(Relay.prototype, Class.prototype);
  relays.set(tag, { Relay, current: Class, versions: new Set([Class]) });
  customElements.define(tag, Relay);
}

/* ------------------------------------------------------------------------------------------ */
/* Remplacement à chaud (HMR)                                                                  */
/* ------------------------------------------------------------------------------------------ */

/** Les champs d'une instance : leurs noms, et le code des fonctions (handlers en champ fléché). */
const fieldsOf = (element: object) =>
  Object.entries(element)
    .filter(([key]) => !key.startsWith('_$')) // posés par lit-html sur l'élément rendu, pas des champs de la classe
    .map(([key, value]) => (typeof value === 'function' ? `${key}=${String(value)}` : key))
    .sort()
    .join('\n');

/**
 * Interne, appelé par le code que le plugin Vite ajoute aux modules de composants en dev : remplace
 * la version des composants déjà définis par celle du module rechargé. Les éléments affichés gardent
 * leur état et se re-rendent avec les nouvelles méthodes. Si ce n'est pas sûr (champs ajoutés,
 * retirés ou modifiés, champs `#privés`), recharge la page.
 */
export function hotReplace(classes: ElementClass[], options: { privateFields?: boolean; reload?: () => void } = {}): void {
  const reload = options.reload ?? (() => location.reload());
  const replaced: Array<[Relay, ElementClass]> = [];
  for (const Class of classes) {
    const relay = relays.get(Class.tag);
    if (!relay || relay.current === Class) continue; // jamais affiché : la nouvelle version servira au premier create
    if (options.privateFields) return reload(); // les #champs de l'ancienne classe ne sont pas ceux de la nouvelle
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
          // Le constructeur de l'enfant a planté : à sa place, un élément qui signale l'erreur au nom
          // de l'enfant (phase `setup`) dès qu'il est inséré, pour qu'un ancêtre puisse la rattraper.
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

/** Un écran du router : une classe de composant aux props `P` (aucune pour un écran de route, `{ error, path }` pour l'écran '!'). */
export type Screen<P extends object> = ElementClass<P, any>;

/** Interne : rend un écran dans un template. */
export const renderScreen = (screen: Screen<any>, props: object): unknown => screen.create(props);
