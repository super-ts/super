import { type FieldName, type FormHandle, html, nothing, SuperElement } from '@super-ts/dom';
import { classes, uniqueId } from './shared';

declare const VALUE: unique symbol;

/**
 * Un champ d'un formulaire, pour un composant du kit : `fieldOf(this.edit, 'email')`. Le nom est
 * vérifié contre le formulaire là où on l'écrit ; `T` est le type de sa valeur.
 */
export interface FieldRef<T> {
  readonly form: FormHandle<any>;
  readonly name: string;
  /** Fantôme : le type de la valeur du champ. */
  readonly [VALUE]?: T;
}

/**
 * Relie un composant du kit à un champ de `this.form(…)`. À écrire dans le rendu du composant qui
 * possède le formulaire : c'est lui qui se re-rend quand le formulaire change, et le champ avec lui.
 *
 * ```tsx
 * <Field field={fieldOf(this.edit, 'email')} label="E-mail" type="email" />
 * ```
 */
export function fieldOf<V, F extends FieldName<V>>(form: FormHandle<V>, name: F): FieldRef<V[F]> {
  return { form, name };
}

/** Une option d'une liste de choix : sa valeur et son libellé. */
export type Choice<T> = { value: T; label: string };

type Common = {
  label: string;
  /** Une aide affichée sous le champ, reliée à lui pour les lecteurs d'écran. */
  hint?: string;
  class?: string;
};

/** Ce que les champs partagent : le libellé, l'aide, l'erreur, la vérification en cours, et leurs liens ARIA. */
abstract class FieldBase<P extends Common & { field: FieldRef<any> }> extends SuperElement<{ props: P }> {
  protected readonly controlId = uniqueId('super-field');

  protected error(): string | null {
    const { form, name } = this.props.field;
    return form.error(name);
  }

  /** Les attributs ARIA du contrôle : invalide, et décrit par l'aide et l'erreur. */
  protected described() {
    const error = this.error();
    const ids = [this.props.hint && `${this.controlId}-hint`, error && `${this.controlId}-error`].filter(Boolean).join(' ');
    return { invalid: error ? 'true' : nothing, describedby: ids || nothing };
  }

  protected footer() {
    const { field, hint } = this.props;
    const error = this.error();
    return html`${hint ? html`<p class="super-field-hint" id=${`${this.controlId}-hint`}>${hint}</p>` : nothing}
    ${field.form.checking(field.name) ? html`<p class="super-field-checking">Vérification…</p>` : nothing}
    ${error ? html`<p class="super-field-error" id=${`${this.controlId}-error`}>${error}</p>` : nothing}`;
  }
}

/* ------------------------------------------------------------------------------------------ */

type FieldProps = Common & {
  field: FieldRef<string | number | null>;
  /** Le type du champ (défaut `text`). Avec `number` ou `range`, la valeur est un nombre. */
  type?: 'text' | 'email' | 'password' | 'number' | 'url' | 'tel' | 'search' | 'date' | 'time' | 'datetime-local' | 'color' | 'range';
  /** Une zone de texte sur plusieurs lignes, avec `rows` lignes. */
  multiline?: boolean;
  rows?: number;
  placeholder?: string;
  autocomplete?: string;
};

/**
 * Un champ de saisie relié au formulaire : libellé, aide, erreur de la règle, « Vérification… »
 * pendant une vérification asynchrone, `aria-invalid` et `aria-describedby`.
 */
export class Field extends FieldBase<FieldProps> {
  static tag = 'super-field';

  render() {
    const { field, label, type = 'text', multiline = false, rows = 3, placeholder, autocomplete } = this.props;
    const { invalid, describedby } = this.described();
    const control = multiline
      ? html`<textarea
          id=${this.controlId}
          class="super-input"
          rows=${rows}
          placeholder=${placeholder ?? nothing}
          aria-invalid=${invalid}
          aria-describedby=${describedby}
          ${field.form.field(field.name as never)}
        ></textarea>`
      : html`<input
          id=${this.controlId}
          class="super-input"
          type=${type}
          placeholder=${placeholder ?? nothing}
          autocomplete=${autocomplete ?? nothing}
          aria-invalid=${invalid}
          aria-describedby=${describedby}
          ${field.form.field(field.name as never)}
        />`;
    return html`<div class=${classes('super-field', this.props.class)}>
      <label class="super-field-label" for=${this.controlId}>${label}</label>
      ${control} ${this.footer()}
    </div>`;
  }
}

type SelectProps = Common & {
  field: FieldRef<string | readonly string[]>;
  options: readonly Choice<string>[];
  /** Plusieurs choix : la valeur du champ est une liste. */
  multiple?: boolean;
};

/** Une liste déroulante reliée au formulaire. */
export class Select extends FieldBase<SelectProps> {
  static tag = 'super-select';

  render() {
    const { field, label, options, multiple = false } = this.props;
    const { invalid, describedby } = this.described();
    return html`<div class=${classes('super-field', this.props.class)}>
      <label class="super-field-label" for=${this.controlId}>${label}</label>
      <select
        id=${this.controlId}
        class="super-input"
        ?multiple=${multiple}
        aria-invalid=${invalid}
        aria-describedby=${describedby}
        ${field.form.field(field.name as never)}
      >
        ${options.map((option) => html`<option value=${option.value}>${option.label}</option>`)}
      </select>
      ${this.footer()}
    </div>`;
  }
}

type CheckboxProps = Common & {
  /** Une case seule pour un booléen ; avec `value`, une case d'un groupe dont le champ est une liste. */
  field: FieldRef<boolean | readonly unknown[]>;
  value?: string;
};

/** Une case à cocher reliée au formulaire. */
export class Checkbox extends FieldBase<CheckboxProps> {
  static tag = 'super-checkbox';

  render() {
    const { field, label, value } = this.props;
    const { invalid, describedby } = this.described();
    return html`<div class=${classes('super-field', 'super-field-inline', this.props.class)}>
      <input
        id=${this.controlId}
        class="super-check"
        type="checkbox"
        aria-invalid=${invalid}
        aria-describedby=${describedby}
        ${field.form.field(field.name as never, value as never)}
      />
      <label class="super-field-label" for=${this.controlId}>${label}</label>
      ${this.footer()}
    </div>`;
  }
}

type RadioGroupProps = Common & {
  field: FieldRef<string>;
  options: readonly Choice<string>[];
};

/** Un groupe de boutons radio relié au formulaire, dans un `<fieldset>` dont `label` est la légende. */
export class RadioGroup extends FieldBase<RadioGroupProps> {
  static tag = 'super-radio-group';

  render() {
    const { field, label, options } = this.props;
    const { invalid, describedby } = this.described();
    return html`<fieldset class=${classes('super-field', 'super-radio-group', this.props.class)} aria-invalid=${invalid} aria-describedby=${describedby}>
      <legend class="super-field-label">${label}</legend>
      ${options.map(
        (option, i) => html`<label class="super-radio" for=${`${this.controlId}-${i}`}>
          <input id=${`${this.controlId}-${i}`} class="super-check" type="radio" name=${this.controlId} ${field.form.field(field.name as never, option.value as never)} />
          ${option.label}
        </label>`,
      )}
      ${this.footer()}
    </fieldset>`;
  }
}
