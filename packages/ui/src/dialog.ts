import { type Children, html, nothing, SuperElement } from '@super-ts/dom';
import { classes, uniqueId } from './shared';

/** Ce qui ferme la fenêtre : Échap, un clic sur le fond, la croix. */
export type CloseReason = 'escape' | 'backdrop' | 'button';

/** Les moyens de fermer la fenêtre. Par défaut : Échap et la croix, pas le clic sur le fond. */
export type CloseOn = { escape?: boolean; backdrop?: boolean; button?: boolean };

type BaseProps = {
  /** Titre affiché en tête, et nom de la fenêtre pour les lecteurs d'écran. */
  title?: string;
  closeOn?: CloseOn;
  /** Texte de la croix pour les lecteurs d'écran (défaut : « Fermer »). */
  closeLabel?: string;
  class?: string;
};

const DEFAULT_CLOSE_ON: Required<CloseOn> = { escape: true, backdrop: false, button: true };

/**
 * La mécanique commune des fenêtres : un `<dialog>` natif ouvert en modal au montage (le reste de
 * la page devient inerte, le focus y reste), fermé au démontage, le focus rendu à l'élément qui
 * l'avait. Comme tout composant Super, une fenêtre montée est ouverte : c'est le parent qui décide
 * de la rendre ou non, et elle lui demande de la fermer par un événement.
 */
abstract class WindowBase<P extends BaseProps, E extends Record<string, unknown>> extends SuperElement<{ props: P; emits: E }> {
  #dialog = this.ref<HTMLDialogElement>();
  #previousFocus: Element | null = null;
  #titleId = uniqueId('super-window-title');

  /** Le parent est prié de fermer la fenêtre. */
  protected abstract requestClose(reason: CloseReason): void;
  /** Le contenu de la fenêtre, sous son titre. */
  protected abstract body(): unknown;
  /** La classe propre à la fenêtre (`super-dialog`, `super-modal`…). */
  protected abstract readonly kind: string;

  /** Le titre affiché. */
  protected heading(): string {
    return this.props.title ?? '';
  }

  protected closeOn(): Required<CloseOn> {
    return { ...DEFAULT_CLOSE_ON, ...this.props.closeOn };
  }

  protected override mounted() {
    this.#previousFocus = document.activeElement;
    const dialog = this.#dialog.value!;
    if (!dialog.open) dialog.showModal();
    // Le focus entre dans la fenêtre (le navigateur le fait d'habitude ; on ne compte pas dessus).
    if (!dialog.contains(document.activeElement)) {
      (
        dialog.querySelector<HTMLElement>('[autofocus], a[href], button, input, select, textarea, [tabindex]:not([tabindex="-1"])') ??
        dialog
      ).focus();
    }
  }

  protected override unmounted() {
    const dialog = this.#dialog.value;
    if (dialog?.open) dialog.close();
    if (this.#previousFocus instanceof HTMLElement && this.#previousFocus.isConnected) this.#previousFocus.focus();
  }

  #keydown = (event: KeyboardEvent) => {
    if (event.key !== 'Escape') return;
    // Échap est géré ici, pas par le navigateur : la fenêtre ne se ferme que si le parent le décide.
    event.preventDefault();
    if (this.closeOn().escape) this.requestClose('escape');
  };

  // Le navigateur ferme un dialog sur `cancel` (Échap) : on garde la main.
  #cancel = (event: Event) => event.preventDefault();

  #click = (event: MouseEvent) => {
    // Un clic dont la cible est le <dialog> lui-même est un clic sur le fond (hors du contenu).
    if (event.target === this.#dialog.value && this.closeOn().backdrop) this.requestClose('backdrop');
  };

  render() {
    const { closeLabel = 'Fermer' } = this.props;
    const title = this.heading();
    const titleId = this.#titleId;
    return html`<dialog
      class=${classes('super-window', this.kind, this.props.class)}
      aria-labelledby=${titleId}
      @keydown=${this.#keydown}
      @cancel=${this.#cancel}
      @click=${this.#click}
      ${this.#dialog}
    >
      <div class="super-window-content">
        <header class="super-window-header">
          <h2 class="super-window-title" id=${titleId}>${title}</h2>
          ${
            this.closeOn().button
              ? html`<button type="button" class="super-window-close" aria-label=${closeLabel} @click=${() => this.requestClose('button')}>
                  ×
                </button>`
              : nothing
          }
        </header>
        ${this.body()}
      </div>
    </dialog>`;
  }
}

/* ------------------------------------------------------------------------------------------ */

type DialogProps = BaseProps & {
  title: string;
  content: Children;
  /** Les boutons d'action, en pied de fenêtre : `<:actions>…</:actions>`. */
  actions?: Children;
};

/**
 * Une fenêtre de dialogue : un titre, un contenu, et des actions en pied.
 *
 * ```tsx
 * if (this.local.get().editing) {
 *   <Dialog title="Renommer" on:close={() => this.local.set({ editing: false })}>
 *     <input … />
 *     <:actions><button on:click={this.save}>Enregistrer</button></:actions>
 *   </Dialog>
 * }
 * ```
 */
export class Dialog extends WindowBase<DialogProps, { close: { reason: CloseReason } }> {
  static tag = 'super-dialog';
  protected readonly kind = 'super-dialog';

  protected requestClose(reason: CloseReason) {
    this.emit('close', { reason });
  }

  protected body() {
    const { content, actions } = this.props;
    return html`<div class="super-window-body">${content}</div>
      ${actions ? html`<footer class="super-window-actions">${actions}</footer>` : nothing}`;
  }
}

type ModalProps = BaseProps & { title: string; content: Children };

/**
 * Une fenêtre sans actions : un titre, un contenu, et de quoi la fermer (Échap et la croix par
 * défaut, réglable par `closeOn`).
 */
export class Modal extends WindowBase<ModalProps, { close: { reason: CloseReason } }> {
  static tag = 'super-modal';
  protected readonly kind = 'super-modal';

  protected requestClose(reason: CloseReason) {
    this.emit('close', { reason });
  }

  protected body() {
    return html`<div class="super-window-body">${this.props.content}</div>`;
  }
}

type ConfirmProps = BaseProps & {
  /** La question posée. Titre par défaut : « Confirmation ». */
  question: string;
  confirmLabel?: string;
  cancelLabel?: string;
  /** Action destructrice : le bouton de confirmation prend la couleur d'alerte. */
  danger?: boolean;
};

/**
 * Une question à confirmer. Répond par `answered` : `{ confirmed: true }` pour le bouton de
 * confirmation, `false` pour l'annulation, Échap, la croix ou le fond.
 */
export class ConfirmDialog extends WindowBase<ConfirmProps, { answered: { confirmed: boolean } }> {
  static tag = 'super-confirm-dialog';
  protected readonly kind = 'super-confirm-dialog';

  protected requestClose() {
    this.emit('answered', { confirmed: false });
  }

  protected override heading() {
    return this.props.title ?? 'Confirmation';
  }

  protected body() {
    const { question, confirmLabel = 'Confirmer', cancelLabel = 'Annuler', danger = false } = this.props;
    return html`<p class="super-window-body">${question}</p>
      <footer class="super-window-actions">
        <button type="button" class="super-button" data-variant="secondary" @click=${() => this.emit('answered', { confirmed: false })}>
          ${cancelLabel}
        </button>
        <button
          type="button"
          class="super-button"
          data-variant=${danger ? 'danger' : 'primary'}
          @click=${() => this.emit('answered', { confirmed: true })}
        >
          ${confirmLabel}
        </button>
      </footer>`;
  }
}
