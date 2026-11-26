import { type Children, html, nothing, SuperElement } from '@super-ts/dom';
import { classes } from './shared.ts';

/* ------------------------------------------------------------------------------------------ */
/* Button                                                                                      */
/* ------------------------------------------------------------------------------------------ */

type ButtonProps = {
  content: Children;
  variant?: 'primary' | 'secondary' | 'danger' | 'ghost';
  /** `submit` dans un formulaire (défaut `button`). */
  type?: 'button' | 'submit' | 'reset';
  disabled?: boolean;
  /** Nom pour les lecteurs d'écran, si le contenu n'en est pas un (une icône). */
  label?: string;
  class?: string;
};

/** Un bouton du kit. Émet `press` au clic. */
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

/** Une étiquette courte : un statut, un compte. */
export class Badge extends SuperElement<{ props: BadgeProps }> {
  static tag = 'super-badge';

  render() {
    const { content, tone = 'neutral' } = this.props;
    return html`<span class=${classes('super-badge', this.props.class)} data-tone=${tone}>${content}</span>`;
  }
}

type SpinnerProps = { label?: string; size?: 'small' | 'medium' | 'large'; class?: string };

/** Un indicateur de chargement, annoncé par les lecteurs d'écran (défaut : « Chargement… »). */
export class Spinner extends SuperElement<{ props: SpinnerProps }> {
  static tag = 'super-spinner';

  render() {
    const { label = 'Chargement…', size = 'medium' } = this.props;
    return html`<span class=${classes('super-spinner', this.props.class)} data-size=${size} role="status">
      <span class="super-spinner-circle" aria-hidden="true"></span>
      <span class="super-visually-hidden">${label}</span>
    </span>`;
  }
}

type SkeletonProps = {
  /** Nombre de lignes (défaut 1). */
  lines?: number;
  /** Largeur et hauteur CSS d'une ligne (défaut : toute la largeur, une ligne de texte). */
  width?: string;
  height?: string;
  class?: string;
};

/** La silhouette d'un contenu en cours de chargement. Décorative : ignorée par les lecteurs d'écran. */
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
  /** Une explication, sous le titre. */
  content?: Children;
  /** Une action pour en sortir : `<:action><button>…</button></:action>`. */
  action?: Children;
  class?: string;
};

/** Ce qu'on affiche quand il n'y a rien : un titre, une explication, une action. */
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
