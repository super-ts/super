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

/** Une commande d'un contrat, avec son entrée : `commandOf(this.counter, 'reset', { id })`. */
export interface CommandRef {
  // Une vue de n'importe quel contrat. Pas `ContractView<any>` : sans contrat déclaré (le build du
  // kit), `ContractName` vaut `never` et TypeScript 7 refuse `any` pour cette contrainte.
  readonly view: { readonly selectors: unknown; readonly send: unknown };
  readonly name: string;
  readonly input: unknown;
}

type InputArgs<F> = F extends (...args: infer A) => any ? A : never;

/**
 * Prépare une commande pour un composant du kit. Le contrat, le nom de la commande et son entrée
 * sont vérifiés là où on l'écrit.
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
  /** Texte affiché pendant que la commande est en cours (défaut : le contenu). */
  pendingLabel?: string;
  variant?: 'primary' | 'secondary' | 'danger';
  disabled?: boolean;
  class?: string;
};

/**
 * Un bouton qui envoie une commande, et se désactive tant qu'elle est en cours (`aria-busy`).
 * L'issue revient comme pour tout envoi : par les sélecteurs, ou par `nom:done` / `nom:failed`.
 *
 * ```tsx
 * <CommandButton command={commandOf(this.counter, 'reset', { id })}>Remettre à zéro</CommandButton>
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
  /** La route visée, typée comme `navigate` : `{ to: 'counter', params: { id } }`. */
  to: NavigateTargetOf<AppRoutes>;
  content: Children;
  /** D'autres routes pour lesquelles le lien est aussi actif (une section : la liste et son détail). */
  activeFor?: readonly (keyof AppRoutes & string)[];
  /** Actif seulement si la query est aussi la même (par défaut, le chemin suffit). */
  exact?: boolean;
  class?: string;
};

const pathOf = (url: string) => url.split('#')[0]!;
const pathnameOf = (url: string) =>
  pathOf(url)
    .split('?')[0]!
    .replace(/(.)\/+$/, '$1');

/**
 * Un lien vers une route, marqué `aria-current="page"` quand il mène à la page affichée. Le router
 * gère le clic, comme pour tout lien interne.
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
export type ToastOptions = { tone?: ToastTone /** En millisecondes ; `0` : reste jusqu'à sa fermeture. Défaut 5000. */; duration?: number };

/**
 * La file des messages affichés par `<Toasts>`. Le composant qui la crée y pousse les issues des
 * commandes qu'il veut signaler :
 *
 * ```ts
 * notices = createToasts();
 * constructor() {
 *   super();
 *   this.profile.on('save:done', () => this.notices.show('Profil enregistré', { tone: 'success' }));
 *   this.profile.on('save:failed', ({ reason }) => this.notices.show(FAILED[reason], { tone: 'error' }));
 * }
 * ```
 */
export class ToastQueue {
  #toasts: Toast[] = [];
  #listeners = new Set<(toasts: readonly Toast[]) => void>();
  #nextId = 0;

  /** Les messages affichés. */
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

  /** Suit les changements de la file ; renvoie de quoi arrêter. */
  subscribe(listener: (toasts: readonly Toast[]) => void): () => void {
    this.#listeners.add(listener);
    return () => this.#listeners.delete(listener);
  }

  #set(toasts: Toast[]) {
    this.#toasts = toasts;
    for (const listener of this.#listeners) listener(toasts);
  }
}

/** Une file de messages pour `<Toasts of={…} />`. */
export const createToasts = () => new ToastQueue();

type ToastsProps = {
  of: ToastQueue;
  /** Nom de la zone pour les lecteurs d'écran (défaut : « Notifications »). */
  label?: string;
  closeLabel?: string;
  class?: string;
};

/**
 * Affiche les messages d'une file : annoncés par les lecteurs d'écran (une erreur tout de suite,
 * le reste poliment), chacun avec sa croix.
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
    const { label = 'Notifications', closeLabel = 'Fermer', of } = this.props;
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
  /** Le chemin où l'erreur est survenue (fourni à l'écran `'!'` du router). */
  path?: string;
  title?: string;
  /** Affiche un bouton « Réessayer », qui émet `retry`. */
  canRetry?: boolean;
  retryLabel?: string;
  class?: string;
};

/**
 * Une erreur présentée à l'utilisateur : un titre, le message, et le détail technique replié.
 * S'utilise dans un `renderError`, ou tel quel comme écran `'!'` du router (`'!': ErrorPanel`).
 */
export class ErrorPanel extends SuperElement<{ props: ErrorPanelProps; emits: { retry: void } }> {
  static tag = 'super-error-panel';

  render() {
    const { error, path, title = 'Une erreur est survenue', canRetry = false, retryLabel = 'Réessayer' } = this.props;
    return html`<section class=${classes('super-error-panel', this.props.class)} role="alert">
      <h2 class="super-error-panel-title">${title}</h2>
      <p class="super-error-panel-message">${error.message}</p>
      <details class="super-error-panel-details">
        <summary>Détails</summary>
        ${path ? html`<p>Sur <code>${path}</code></p>` : nothing}
        <pre>${error.stack ?? String(error)}</pre>
      </details>
      ${canRetry ? html`<button type="button" class="super-button" data-variant="primary" @click=${() => this.emit('retry')}>${retryLabel}</button>` : nothing}
    </section>`;
  }
}
