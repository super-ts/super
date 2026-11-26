/**
 * Functions called by the virtual TS of a `.super` file. They exist only for the
 * compiler: the virtual TS is never executed.
 */

type HtmlTag = keyof HTMLElementTagNameMap;
type SvgTag = keyof SVGElementTagNameMap;

/** A known HTML or SVG tag, or a custom element (with a hyphen). */
export type Tag = HtmlTag | SvgTag | `${string}-${string}`;

export type TagElement<K extends string> = K extends HtmlTag
  ? HTMLElementTagNameMap[K]
  : K extends SvgTag
    ? SVGElementTagNameMap[K]
    : HTMLElement;

type EventsOf<E> = E extends SVGElement ? SVGElementEventMap : HTMLElementEventMap;

/** What an attribute can receive; `null` and `undefined` remove it. */
export type AttributeValue = string | number | boolean | null | undefined;

/** Children passed to a component (`{this.content}`, or a method that emits elements). */
export type Children = import('@super-ts/dom').Children;

/** The route of a component by its tag (see `routeInserts` in virtual.ts). */
export type RouteOfTag<T extends string> = import('@super-ts/dom').RouteOfTag<T>;

/** What an interpolation can display. */
export type TextValue = string | number | boolean | null | undefined | void | Children;

/** What a method that emits elements returns, and what a prop filled by children receives. */
export declare const CHILDREN: Children;

/**
 * An element ref (`this.ref<T>()`) only accepts an element of the right type. `refFor` makes
 * the error readable (and nominal: an `HTMLInputElement` has everything an `HTMLDivElement` has).
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
 * The name of a prop (`@prop name: Type;`) becomes a property of the component: it must not
 * already be a property of an HTML element (`id`, `title`, `hidden`…).
 */
export declare function ownName<K extends string>(
  name: K extends keyof HTMLElement ? `'${K}' is already a property of HTML elements: choose another name` : K,
): void;
