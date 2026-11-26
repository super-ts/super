import { type Children, html, nothing, SuperElement } from '@super-ts/dom';
import { classes, uniqueId } from './shared.ts';

/** What closes the dialog: Escape, a click on the backdrop, the close button. */
export type CloseReason = 'escape' | 'backdrop' | 'button';

/** The ways to close the dialog. By default: Escape and the close button, not a click on the backdrop. */
export type CloseOn = { escape?: boolean; backdrop?: boolean; button?: boolean };

type BaseProps = {
  /** Title shown at the top, and name of the dialog for screen readers. */
  title?: string;
  closeOn?: CloseOn;
  /** Text of the close button for screen readers (default: "Close"). */
  closeLabel?: string;
  class?: string;
};

const DEFAULT_CLOSE_ON: Required<CloseOn> = { escape: true, backdrop: false, button: true };

/**
 * The shared mechanics of dialogs: a native `<dialog>` opened as modal on mount (the rest of
 * the page becomes inert, focus stays inside), closed on unmount, focus returned to the element that
 * had it. Like any Super component, a mounted dialog is open: the parent decides
 * whether to render it, and the dialog asks it to close through an event.
 */
abstract class WindowBase<P extends BaseProps, E extends Record<string, unknown>> extends SuperElement<{ props: P; emits: E }> {
  #dialog = this.ref<HTMLDialogElement>();
  #previousFocus: Element | null = null;
  #titleId = uniqueId('super-window-title');

  /** The parent is asked to close the dialog. */
  protected abstract requestClose(reason: CloseReason): void;
  /** The content of the dialog, under its title. */
  protected abstract body(): unknown;
  /** The dialog's own class (`super-dialog`, `super-modal`…). */
  protected abstract readonly kind: string;

  /** The displayed title. */
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
    // Focus enters the dialog (the browser usually does it; we do not rely on it).
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
    // Escape is handled here, not by the browser: the dialog closes only if the parent decides so.
    event.preventDefault();
    if (this.closeOn().escape) this.requestClose('escape');
  };

  // The browser closes a dialog on `cancel` (Escape): we keep control.
  #cancel = (event: Event) => event.preventDefault();

  #click = (event: MouseEvent) => {
    // A click whose target is the <dialog> itself is a click on the backdrop (outside the content).
    if (event.target === this.#dialog.value && this.closeOn().backdrop) this.requestClose('backdrop');
  };

  render() {
    const { closeLabel = 'Close' } = this.props;
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
  /** The action buttons, at the foot of the dialog: `<:actions>…</:actions>`. */
  actions?: Children;
};

/**
 * A dialog: a title, content, and actions at the foot.
 *
 * ```tsx
 * if (this.local.get().editing) {
 *   <Dialog title="Rename" on:close={() => this.local.set({ editing: false })}>
 *     <input … />
 *     <:actions><button on:click={this.save}>Save</button></:actions>
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
 * A dialog without actions: a title, content, and a way to close it (Escape and the close button by
 * default, configurable through `closeOn`).
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
  /** The question asked. Default title: "Confirmation". */
  question: string;
  confirmLabel?: string;
  cancelLabel?: string;
  /** Destructive action: the confirm button takes the danger colour. */
  danger?: boolean;
};

/**
 * A question to confirm. Answers through `answered`: `{ confirmed: true }` for the confirm
 * button, `false` for cancel, Escape, the close button or the backdrop.
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
    const { question, confirmLabel = 'Confirm', cancelLabel = 'Cancel', danger = false } = this.props;
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
