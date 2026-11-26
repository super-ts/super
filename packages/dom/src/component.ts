import type { StatePatch } from '@super-ts/core';
import { html as litHtml } from 'lit-html';

/*
 * Plumbing shared by components: Super's `html`, errors, local state. The
 * component itself is `SuperElement` (element.ts).
 */

/**
 * Phase in which a component error occurred:
 * - `setup` (the constructor, or a store not found at mount), `render`, `renderError`:
 *   the display is broken, an ancestor's `renderError` or the `'!'` screen can replace it;
 * - `event` (an `@click`…), `listener` (an `on`), `mount` (`mounted` or `unmounted`): an action
 *   failed, the display stays as it is. The error is only reported.
 */
export type ErrorPhase = 'setup' | 'render' | 'renderError' | 'event' | 'listener' | 'mount';

/** What error events carry, and what `onError` receives. */
export interface ErrorDetail {
  readonly error: Error;
  /** Tag of the component that crashed. */
  readonly tag: string;
  readonly phase: ErrorPhase;
  /** Tag of what caught the error (a component with `renderError`, or the `RouterOutlet`), `null` otherwise. */
  caughtBy: string | null;
  /** True if an application passed it to its `onError`. */
  reported: boolean;
}

/** Bubbles up from the component that crashed to the first one able to catch it. */
export const ERROR_EVENT = 'super:error';
/** Bubbles up to the application, for `onError`, whether the error was caught or not. */
export const ERROR_REPORT = 'super:error-report';

export const toError = (value: unknown) => (value instanceof Error ? value : new Error(String(value)));

/** Reports an action error to the application, without touching the display. */
export const REPORT = Symbol('super.report');
export type Reporter = { [REPORT](error: unknown, phase: ErrorPhase): void };

/** Component currently preparing or rendering its template: its `@event` handlers are attached to it. */
let rendering: Reporter | null = null;

/** Internal: the component currently rendering (or preparing) its template, `null` otherwise. */
export const currentRendering = (): Reporter | null => rendering;

/** Internal: runs `run` as a render of `owner` (its `@event` handlers are attached to it). */
export function renderingAs<T>(owner: Reporter, run: () => T): T {
  const previous = rendering;
  rendering = owner;
  try {
    return run();
  } finally {
    rendering = previous;
  }
}

/** Runs `run` and reports its error, synchronous or asynchronous (rejected promise). */
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
 * Super's `html`: lit-html's, with its `@event` handlers wrapped so that
 * their errors (synchronous or asynchronous) are reported to `onError`, with the component.
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
      // Listener options read by lit-html on the function (`capture`, `once`, `passive`) are kept.
      for (const option of LISTENER_OPTIONS) if (option in handler) (wrapped as any)[option] = (handler as any)[option];
      return wrapped;
    });
  }
  return litHtml(strings, ...values);
}

/**
 * Local state of a component, created by `state(initial)`: private to the instance, it is born at mount
 * and disappears at unmount. For UI data (message, open panel, input in
 * progress); the app's data lives in a store.
 */
export interface LocalState<T extends object> {
  /**
   * Current value, frozen. Read it in the render function so that it always reflects the
   * latest `set`.
   *
   * @example
   * <p role="status">{this.local.get().message}</p>
   */
  get(): Readonly<T>;
  /**
   * Merges the patch into the state (shallow merge), then re-renders the component. Accepts a
   * partial object, or a function that receives the current state and returns the patch. Several
   * `set` calls in a row give a single render (batched per microtask).
   *
   * @example
   * local.set({ message: 'Incremented: 3' });
   * local.set((current) => ({ count: current.count + 1 }));
   */
  set(patch: StatePatch<T>): void;
}

/** Internal: creates a component's local state; `onChange` re-renders the component. */
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

/** The parent talks to the child through its props, and listens to it through its events. */
export type ChildOptions<E> = {
  on?: { [K in keyof E]?: (payload: E[K]) => void };
};

/** DOM name of an event emitted by a component: `tag:name`. */
export const eventName = (tag: string, name: string) => `${tag}:${name}`;
