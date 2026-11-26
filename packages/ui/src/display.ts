import { type Children, html, nothing, SuperElement } from '@super-ts/dom';
import { classes } from './shared.ts';

/* ------------------------------------------------------------------------------------------ */
/* Button                                                                                      */
/* ------------------------------------------------------------------------------------------ */

type ButtonProps = {
  content: Children;
  variant?: 'primary' | 'secondary' | 'danger' | 'ghost';
  /** `submit` in a form (default `button`). */
  type?: 'button' | 'submit' | 'reset';
  disabled?: boolean;
  /** Name for screen readers, if the content is not one (an icon). */
  label?: string;
  class?: string;
};

/** A kit button. Emits `press` on click. */
export class Button extends SuperElement<{ props: ButtonProps; emits: { press: void } }> {
  static tag = 'super-button';

  render() {
    const { content, variant = 'primary', type = 'button', disabled = false, label } = this.props;
    return html`<button
      type=${type}
      class=${classes('super-button', this.props.class)}
      data-variant=${variant}
      ?disabled=${disabled}
      aria-label=${label ?? nothing}
      @click=${() => this.emit('press')}
    >
      ${content}
    </button>`;
  }
}

/* ------------------------------------------------------------------------------------------ */
/* Badge, Spinner, Skeleton, EmptyState                                                        */
/* ------------------------------------------------------------------------------------------ */

type BadgeProps = { content: Children; tone?: 'neutral' | 'info' | 'success' | 'warning' | 'danger'; class?: string };

/** A short label: a status, a count. */
export class Badge extends SuperElement<{ props: BadgeProps }> {
  static tag = 'super-badge';

  render() {
    const { content, tone = 'neutral' } = this.props;
    return html`<span class=${classes('super-badge', this.props.class)} data-tone=${tone}>${content}</span>`;
  }
}

type SpinnerProps = { label?: string; size?: 'small' | 'medium' | 'large'; class?: string };

/** A loading indicator, announced by screen readers (default: "Loading…"). */
export class Spinner extends SuperElement<{ props: SpinnerProps }> {
  static tag = 'super-spinner';

  render() {
    const { label = 'Loading…', size = 'medium' } = this.props;
    return html`<span class=${classes('super-spinner', this.props.class)} data-size=${size} role="status">
      <span class="super-spinner-circle" aria-hidden="true"></span>
      <span class="super-visually-hidden">${label}</span>
    </span>`;
  }
}

type SkeletonProps = {
  /** Number of lines (default 1). */
  lines?: number;
  /** CSS width and height of a line (default: full width, one line of text). */
  width?: string;
  height?: string;
  class?: string;
};

/** The outline of content being loaded. Decorative: ignored by screen readers. */
export class Skeleton extends SuperElement<{ props: SkeletonProps }> {
  static tag = 'super-skeleton';

  render() {
    const { lines = 1, width, height } = this.props;
    const style = [width && `width: ${width}`, height && `height: ${height}`].filter(Boolean).join('; ');
    return html`<span class=${classes('super-skeleton', this.props.class)} aria-hidden="true">
      ${Array.from({ length: lines }, () => html`<span class="super-skeleton-line" style=${style || nothing}></span>`)}
    </span>`;
  }
}

type EmptyStateProps = {
  title: string;
  /** An explanation, under the title. */
  content?: Children;
  /** An action to get out of it: `<:action><button>…</button></:action>`. */
  action?: Children;
  class?: string;
};

/** What to display when there is nothing: a title, an explanation, an action. */
export class EmptyState extends SuperElement<{ props: EmptyStateProps }> {
  static tag = 'super-empty-state';

  render() {
    const { title, content, action } = this.props;
    return html`<div class=${classes('super-empty-state', this.props.class)}>
      <p class="super-empty-state-title">${title}</p>
      ${content ? html`<div class="super-empty-state-body">${content}</div>` : nothing}
      ${action ? html`<div class="super-empty-state-action">${action}</div>` : nothing}
    </div>`;
  }
}
