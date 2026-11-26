import { nothing } from 'lit-html';
import { type ChildPart, Directive, directive, type PartInfo, PartType } from 'lit-html/directive.js';
import type { ChildOptions } from './component.ts';
import { eventName } from './component.ts';

/** What the directive knows how to create: a component (see `SuperElement.create`). */
export type ChildDef = { readonly tag: string; create(props: object): HTMLElement & { props: object } };

type Handler = (payload: unknown) => void;

/**
 * Renders a child component in a parent template. The element is created once per
 * position, then its props and listeners are updated on each render of the parent.
 */
class MountChildDirective extends Directive {
  #def: ChildDef | null = null;
  #el: (HTMLElement & { props: object }) | null = null;
  #handlers: Record<string, Handler | undefined> = {};
  #listening = new Set<string>();

  constructor(partInfo: PartInfo) {
    super(partInfo);
    if (partInfo.type !== PartType.CHILD) {
      throw new Error('[super] a child component must be placed in a content position in the template');
    }
  }

  render(_def: ChildDef, _props: object, _options: ChildOptions<any>) {
    return nothing;
  }

  override update(_part: ChildPart, [def, props, options]: Parameters<this['render']>) {
    if (this.#def !== def || !this.#el) {
      this.#def = def;
      this.#el = def.create(props); // props are readable from the child's constructor onwards
      this.#listening.clear();
    }
    const el = this.#el;
    this.#handlers = (options.on ?? {}) as Record<string, Handler | undefined>;

    for (const name of Object.keys(this.#handlers)) {
      if (this.#listening.has(name)) continue;
      this.#listening.add(name);
      el.addEventListener(eventName(def.tag, name), (event) => {
        // Ignore same-named events bubbling up from a descendant of the same type.
        if (event.target === el) this.#handlers[name]?.((event as CustomEvent).detail);
      });
    }

    el.props = props;
    return el;
  }
}

export const mountChild = directive(MountChildDirective);
