import type { StatePatch } from '@super-ts/core';
import { html as litHtml } from 'lit-html';

/*
 * Plomberie partagée par les composants : le `html` de Super, les erreurs, l'état local. Le
 * composant lui-même est `SuperElement` (element.ts).
 */

/**
 * Phase où une erreur de composant s'est produite :
 * - `setup` (le constructeur, ou un store introuvable au montage), `render`, `renderError` :
 *   l'affichage est cassé, le `renderError` d'un ancêtre ou l'écran `'!'` peut le remplacer ;
 * - `event` (un `@click`…), `listener` (un `on`), `mount` (`mounted` ou `unmounted`) : une action a
 *   échoué, l'affichage reste tel quel. L'erreur est seulement signalée.
 */
export type ErrorPhase = 'setup' | 'render' | 'renderError' | 'event' | 'listener' | 'mount';

/** Ce que transportent les événements d'erreur, et ce que reçoit `onError`. */
export interface ErrorDetail {
  readonly error: Error;
  /** Tag du composant qui a planté. */
  readonly tag: string;
  readonly phase: ErrorPhase;
  /** Tag de ce qui a rattrapé l'erreur (un composant avec `renderError`, ou le `RouterOutlet`), `null` sinon. */
  caughtBy: string | null;
  /** Vrai si une application l'a transmise à son `onError`. */
  reported: boolean;
}

/** Remonte du composant qui a planté jusqu'au premier qui sait la rattraper. */
export const ERROR_EVENT = 'super:error';
/** Remonte jusqu'à l'application, pour `onError`, que l'erreur ait été rattrapée ou non. */
export const ERROR_REPORT = 'super:error-report';

export const toError = (value: unknown) => (value instanceof Error ? value : new Error(String(value)));

/** Signale une erreur d'action à l'application, sans toucher à l'affichage. */
export const REPORT = Symbol('super.report');
export type Reporter = { [REPORT](error: unknown, phase: ErrorPhase): void };

/** Composant en train de préparer ou de rendre son template : ses gestionnaires `@événement` lui sont rattachés. */
let rendering: Reporter | null = null;

/** Interne : le composant en train de rendre (ou de préparer) son template, `null` sinon. */
export const currentRendering = (): Reporter | null => rendering;

/** Interne : exécute `run` comme rendu de `owner` (ses gestionnaires `@événement` lui sont rattachés). */
export function renderingAs<T>(owner: Reporter, run: () => T): T {
  const previous = rendering;
  rendering = owner;
  try {
    return run();
  } finally {
    rendering = previous;
  }
}

/** Lance `run` et signale son erreur, synchrone ou asynchrone (promesse rejetée). */
export function guarded<T>(owner: Reporter, phase: ErrorPhase, run: () => T): T | undefined {
  try {
    const result = run();
    if (result instanceof Promise) result.catch((error: unknown) => owner[REPORT](error, phase));
    return result;
  } catch (error) {
    owner[REPORT](error, phase);
    return undefined;
  }
}

const EVENT_BINDING = /@[^\s=]+=["']?$/;
const LISTENER_OPTIONS = ['capture', 'once', 'passive'] as const;

/**
 * Le `html` de Super : celui de lit-html, dont les gestionnaires `@événement` sont enveloppés pour
 * que leurs erreurs (synchrones ou asynchrones) soient signalées à `onError`, avec le composant.
 */
export function html(strings: TemplateStringsArray, ...values: unknown[]) {
  const owner = rendering;
  if (owner) {
    values = values.map((value, i) => {
      if (typeof value !== 'function' || !EVENT_BINDING.test(strings[i]!)) return value;
      const handler = value as (this: unknown, ...args: unknown[]) => unknown;
      const wrapped = function (this: unknown, ...args: unknown[]) {
        return guarded(owner, 'event', () => handler.apply(this, args));
      };
      // Les options d'écoute lues par lit-html sur la fonction (`capture`, `once`, `passive`) sont conservées.
      for (const option of LISTENER_OPTIONS) if (option in handler) (wrapped as any)[option] = (handler as any)[option];
      return wrapped;
    });
  }
  return litHtml(strings, ...values);
}

/**
 * État local d'un composant, créé par `state(initial)` : privé à l'instance, il naît au montage
 * et disparaît au démontage. Pour les données d'interface (message, panneau ouvert, saisie en
 * cours) ; les données de l'app vivent dans un store.
 */
export interface LocalState<T extends object> {
  /**
   * Valeur courante, figée. À lire dans la fonction de rendu pour qu'elle reflète toujours le
   * dernier `set`.
   *
   * @example
   * <p role="status">{this.local.get().message}</p>
   */
  get(): Readonly<T>;
  /**
   * Fusionne le patch dans l'état (merge superficiel), puis re-rend le composant. Accepte un
   * objet partiel, ou une fonction qui reçoit l'état courant et retourne le patch. Plusieurs
   * `set` d'affilée ne donnent qu'un seul rendu (regroupé par microtask).
   *
   * @example
   * local.set({ message: 'Incrémenté : 3' });
   * local.set((current) => ({ count: current.count + 1 }));
   */
  set(patch: StatePatch<T>): void;
}

/** Interne : crée l'état local d'un composant ; `onChange` re-rend le composant. */
export function createLocalState<T extends object>(initial: T, onChange: () => void): LocalState<T> {
  let value: Readonly<T> = Object.freeze({ ...initial });
  return {
    get: () => value,
    set: (patch: StatePatch<T>) => {
      value = Object.freeze({ ...value, ...(typeof patch === 'function' ? patch(value) : patch) });
      onChange();
    },
  };
}

/** Le parent communique avec l'enfant par ses props, et l'écoute par ses événements. */
export type ChildOptions<E> = {
  on?: { [K in keyof E]?: (payload: E[K]) => void };
};

/** Nom DOM d'un événement émis par un composant : `tag:nom`. */
export const eventName = (tag: string, name: string) => `${tag}:${name}`;
