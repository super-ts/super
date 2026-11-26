import { nothing } from 'lit-html';
import { type ChildPart, Directive, directive, type PartInfo, PartType } from 'lit-html/directive.js';
import type { ChildOptions } from './component.ts';
import { eventName } from './component.ts';

/** Ce que la directive sait créer : un composant (voir `SuperElement.create`). */
export type ChildDef = { readonly tag: string; create(props: object): HTMLElement & { props: object } };

type Handler = (payload: unknown) => void;

/**
 * Rend un composant enfant dans un template parent. L'élément est créé une fois par
 * emplacement, puis ses props et écouteurs sont mis à jour à chaque rendu du parent.
 */
class MountChildDirective extends Directive {
  #def: ChildDef | null = null;
  #el: (HTMLElement & { props: object }) | null = null;
  #handlers: Record<string, Handler | undefined> = {};
  #listening = new Set<string>();

  constructor(partInfo: PartInfo) {
    super(partInfo);
    if (partInfo.type !== PartType.CHILD) {
      throw new Error('[super] un composant enfant doit être placé en position de contenu dans le template');
    }
  }

  render(_def: ChildDef, _props: object, _options: ChildOptions<any>) {
    return nothing;
  }

  override update(_part: ChildPart, [def, props, options]: Parameters<this['render']>) {
    if (this.#def !== def || !this.#el) {
      this.#def = def;
      this.#el = def.create(props); // les props sont lisibles dès le constructeur de l'enfant
      this.#listening.clear();
    }
    const el = this.#el;
    this.#handlers = (options.on ?? {}) as Record<string, Handler | undefined>;

    for (const name of Object.keys(this.#handlers)) {
      if (this.#listening.has(name)) continue;
      this.#listening.add(name);
      el.addEventListener(eventName(def.tag, name), (event) => {
        // Ignore les événements homonymes remontant d'un descendant du même type.
        if (event.target === el) this.#handlers[name]?.((event as CustomEvent).detail);
      });
    }

    el.props = props;
    return el;
  }
}

export const mountChild = directive(MountChildDirective);
