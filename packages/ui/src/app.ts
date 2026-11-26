import type { ContractCommands, Contracts } from '@super-ts/core';
import {
  type AppRoutes,
  type Children,
  type ContractView,
  html,
  type NavigateTargetOf,
  nothing,
  type StoreContractName,
  SuperElement,
} from '@super-ts/dom';
import { classes } from './shared.ts';

/* ------------------------------------------------------------------------------------------ */
/* CommandButton                                                                               */
/* ------------------------------------------------------------------------------------------ */

/** A contract command, with its input: `commandOf(this.counter, 'reset', { id })`. */
export interface CommandRef {
  // A view of any contract. Not `ContractView<any>`: with no declared contract (the kit's
  // build), `ContractName` is `never` and TypeScript 7 rejects `any` for this constraint.
  readonly view: { readonly selectors: unknown; readonly send: unknown };
  readonly name: string;
  readonly input: unknown;
}

type InputArgs<F> = F extends (...args: infer A) => any ? A : never;

/**
 * Prepares a command for a kit component. The contract, the command name and its input
 * are checked where you write it.
 */
export function commandOf<N extends StoreContractName, K extends keyof ContractCommands<Contracts[N]> & string>(
  view: ContractView<N>,
  name: K,
  ...input: InputArgs<ContractCommands<Contracts[N]>[K]>
): CommandRef {
  return { view, name, input: input[0] };
}

type CommandButtonProps = {
  command: CommandRef;
  content: Children;
  /** Text shown while the command is pending (default: the content). */
  pendingLabel?: string;
  variant?: 'primary' | 'secondary' | 'danger';
  disabled?: boolean;
  class?: string;
};

/**
 * A button that sends a command, and is disabled while it is pending (`aria-busy`).
 * The outcome comes back as for any send: through the selectors, or through `name:done` / `name:failed`.
 *
 * ```tsx
 * <CommandButton command={commandOf(this.counter, 'reset', { id })}>Reset</CommandButton>
 * ```
 */
export class CommandButton extends SuperElement<{ props: CommandButtonProps }> {
  static tag = 'super-command-button';

  #send = () => {
    const { view, name, input } = this.props.command;
    (view.send as (name: string, input?: unknown) => void)(name, input);
  };

  render() {
    const { command, content, pendingLabel, variant = 'primary', disabled = false } = this.props;
    const reader = command.view.selectors as unknown as { pending(name: string, match?: unknown): boolean };
    const pending = reader.pending(command.name, command.input ?? undefined);
    return html`<button
      type="button"
      class=${classes('super-button', this.props.class)}
      data-variant=${variant}
      ?disabled=${disabled || pending}
      aria-busy=${pending ? 'true' : nothing}
      @click=${this.#send}
    >
      ${pending && pendingLabel ? pendingLabel : content}
    </button>`;
  }
}

/* ------------------------------------------------------------------------------------------ */
/* RouteLink                                                                                   */
/* ------------------------------------------------------------------------------------------ */

type RouteLinkProps = {
  /** The target route, typed like `navigate`: `{ to: 'counter', params: { id } }`. */
  to: NavigateTargetOf<AppRoutes>;
  content: Children;
  /** Other routes for which the link is also active (a section: the list and its detail). */
  activeFor?: readonly (keyof AppRoutes & string)[];
  /** Active only if the query is the same too (by default, the path is enough). */
  exact?: boolean;
  class?: string;
};

const pathOf = (url: string) => url.split('#')[0]!;
const pathnameOf = (url: string) =>
  pathOf(url)
    .split('?')[0]!
    .replace(/(.)\/+$/, '$1');

/**
 * A link to a route, marked `aria-current="page"` when it leads to the displayed page. The router
 * handles the click, as for any internal link.
 */
export class RouteLink extends SuperElement<{ props: RouteLinkProps }> {
  static tag = 'super-route-link';

  render() {
    const { to, content, activeFor = [], exact = false } = this.props;
    const router = this.router as unknown as {
      href(name: string, input?: object): string;
      current: { name(): string | null; path(): string };
    };
    const { to: name, ...input } = to as { to: string };
    const href = router.href(name, input);
    const path = router.current.path();
    const active = exact
      ? pathOf(path) === href
      : pathnameOf(path) === pathnameOf(href) || activeFor.includes(router.current.name() as never);
    return html`<a class=${classes('super-link', this.props.class)} href=${href} aria-current=${active ? 'page' : nothing}>${content}</a>`;
  }
}

/* ------------------------------------------------------------------------------------------ */
/* Toasts                                                                                      */
/* ------------------------------------------------------------------------------------------ */

export type ToastTone = 'info' | 'success' | 'error';
export type Toast = { readonly id: number; readonly message: string; readonly tone: ToastTone };
export type ToastOptions = { tone?: ToastTone /** In milliseconds; `0`: stays until closed. Default 5000. */; duration?: number };

/**
 * The queue of messages displayed by `<Toasts>`. The component that creates it pushes into it the outcomes of the
 * commands it wants to report:
 *
 * ```ts
 * notices = createToasts();
 * constructor() {
 *   super();
 *   this.profile.on('save:done', () => this.notices.show('Profile saved', { tone: 'success' }));
 *   this.profile.on('save:failed', ({ reason }) => this.notices.show(FAILED[reason], { tone: 'error' }));
 * }
 * ```
 */
export class ToastQueue {
  #toasts: Toast[] = [];
  #listeners = new Set<(toasts: readonly Toast[]) => void>();
  #nextId = 0;

  /** The displayed messages. */
  list(): readonly Toast[] {
    return this.#toasts;
  }

  show(message: string, { tone = 'info', duration = 5000 }: ToastOptions = {}): number {
    const id = ++this.#nextId;
    this.#set([...this.#toasts, { id, message, tone }]);
    if (duration > 0) setTimeout(() => this.dismiss(id), duration);
    return id;
  }

  dismiss(id: number) {
    if (this.#toasts.some((toast) => toast.id === id)) this.#set(this.#toasts.filter((toast) => toast.id !== id));
  }

  /** Follows the queue's changes; returns a function to stop. */
  subscribe(listener: (toasts: readonly Toast[]) => void): () => void {
    this.#listeners.add(listener);
    return () => this.#listeners.delete(listener);
  }

  #set(toasts: Toast[]) {
    this.#toasts = toasts;
    for (const listener of this.#listeners) listener(toasts);
  }
}

/** A message queue for `<Toasts of={…} />`. */
export const createToasts = () => new ToastQueue();

type ToastsProps = {
  of: ToastQueue;
  /** Name of the region for screen readers (default: "Notifications"). */
  label?: string;
  closeLabel?: string;
  class?: string;
};

/**
 * Displays the messages of a queue: announced by screen readers (an error immediately,
 * the rest politely), each with its close button.
 */
export class Toasts extends SuperElement<{ props: ToastsProps }> {
  static tag = 'super-toasts';
  #shown = this.state({ toasts: [] as readonly Toast[] });
  #stop: (() => void) | null = null;

  protected override mounted() {
    this.#shown.set({ toasts: this.props.of.list() });
    this.#stop = this.props.of.subscribe((toasts) => this.#shown.set({ toasts }));
  }

  protected override unmounted() {
    this.#stop?.();
  }

  render() {
    const { label = 'Notifications', closeLabel = 'Close', of } = this.props;
    return html`<section class=${classes('super-toasts', this.props.class)} aria-label=${label}>
      ${this.#shown.get().toasts.map(
        (toast) => html`<div class="super-toast" data-tone=${toast.tone} role=${toast.tone === 'error' ? 'alert' : 'status'}>
          <p class="super-toast-message">${toast.message}</p>
          <button type="button" class="super-toast-close" aria-label=${closeLabel} @click=${() => of.dismiss(toast.id)}>×</button>
        </div>`,
      )}
    </section>`;
  }
}

/* ------------------------------------------------------------------------------------------ */
/* ErrorPanel                                                                                  */
/* ------------------------------------------------------------------------------------------ */

type ErrorPanelProps = {
  error: Error;
  /** The path where the error occurred (provided to the router's `'!'` screen). */
  path?: string;
  title?: string;
  /** Shows a "Retry" button, which emits `retry`. */
  canRetry?: boolean;
  retryLabel?: string;
  class?: string;
};

/**
 * An error presented to the user: a title, the message, and the collapsed technical detail.
 * Used in a `renderError`, or as is as the router's `'!'` screen (`'!': ErrorPanel`).
 */
export class ErrorPanel extends SuperElement<{ props: ErrorPanelProps; emits: { retry: void } }> {
  static tag = 'super-error-panel';

  render() {
    const { error, path, title = 'Something went wrong', canRetry = false, retryLabel = 'Retry' } = this.props;
    return html`<section class=${classes('super-error-panel', this.props.class)} role="alert">
      <h2 class="super-error-panel-title">${title}</h2>
      <p class="super-error-panel-message">${error.message}</p>
      <details class="super-error-panel-details">
        <summary>Details</summary>
        ${path ? html`<p>At <code>${path}</code></p>` : nothing}
        <pre>${error.stack ?? String(error)}</pre>
      </details>
      ${canRetry ? html`<button type="button" class="super-button" data-variant="primary" @click=${() => this.emit('retry')}>${retryLabel}</button>` : nothing}
    </section>`;
  }
}
