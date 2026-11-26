/**
 * Fonctions appelées par le TS virtuel d'un fichier `.super`. Elles n'existent que pour le
 * compilateur : le TS virtuel n'est jamais exécuté.
 */

type HtmlTag = keyof HTMLElementTagNameMap;
type SvgTag = keyof SVGElementTagNameMap;

/** Une balise HTML ou SVG connue, ou un élément personnalisé (avec un tiret). */
export type Tag = HtmlTag | SvgTag | `${string}-${string}`;

export type TagElement<K extends string> = K extends HtmlTag
  ? HTMLElementTagNameMap[K]
  : K extends SvgTag
    ? SVGElementTagNameMap[K]
    : HTMLElement;

type EventsOf<E> = E extends SVGElement ? SVGElementEventMap : HTMLElementEventMap;

/** Ce qu'un attribut peut recevoir ; `null` et `undefined` le retirent. */
export type AttributeValue = string | number | boolean | null | undefined;

/** Des enfants passés à un composant (`{this.content}`, ou une méthode qui émet des éléments). */
export type Children = import('@super-ts/dom').Children;

/** La route d'un composant par son tag (voir `routeInserts` dans virtual.ts). */
export type RouteOfTag<T extends string> = import('@super-ts/dom').RouteOfTag<T>;

/** Ce qu'une interpolation peut afficher. */
export type TextValue = string | number | boolean | null | undefined | void | Children;

/** Ce que renvoie une méthode qui émet des éléments, et ce que reçoit une prop remplie par des enfants. */
export declare const CHILDREN: Children;

/**
 * Une référence d'élément (`this.ref<T>()`) n'accepte qu'un élément du bon type. `refFor` rend
 * l'erreur lisible (et nominale : un `HTMLInputElement` a tout ce qu'a un `HTMLDivElement`).
 */
type DirectiveFor<D, E> = D extends { readonly value: infer T | undefined }
  ? T extends Element
    ? E extends T
      ? D
      : { readonly value: E | undefined; readonly refFor: E }
    : D
  : D;

export declare function open<K extends Tag>(tag: K): TagElement<K>;
export declare function attr(element: Element, name: string, value: AttributeValue): void;
export declare function prop<E extends Element, K extends keyof E & string>(element: E, name: K, value: E[K]): void;
export declare function on<E extends Element, K extends keyof EventsOf<E> & string>(
  element: E,
  name: K,
  handler: (event: EventsOf<E>[K] & { currentTarget: E }) => unknown,
): void;
export declare function use<E extends Element, D>(element: E, directive: DirectiveFor<D, E>): void;
export declare function text(value: TextValue): void;
export declare function key(value: unknown): void;

/**
 * Le nom d'une prop (`@prop nom: Type;`) devient une propriété du composant : il ne doit pas être
 * déjà une propriété d'un élément HTML (`id`, `title`, `hidden`…).
 */
export declare function ownName<K extends string>(
  name: K extends keyof HTMLElement ? `« ${K} » est déjà une propriété des éléments HTML : choisis un autre nom` : K,
): void;
