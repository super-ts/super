import { type FieldName, type FormHandle, html, nothing, SuperElement } from '@super-ts/dom';
import { classes, uniqueId } from './shared.ts';

declare const VALUE: unique symbol;

/**
 * A form field, for a kit component: `fieldOf(this.edit, 'email')`. The name is
 * checked against the form where you write it; `T` is the type of its value.
 */
export interface FieldRef<T> {
  readonly form: FormHandle<any>;
  readonly name: string;
  /** Phantom: the type of the field's value. */
  readonly [VALUE]?: T;
}

/**
 * Binds a kit component to a field of `this.form(…)`. Write it in the render of the component that
 * owns the form: that component re-renders when the form changes, and the field with it.
 *
 * ```tsx
 * <Field field={fieldOf(this.edit, 'email')} label="E-mail" type="email" />
 * ```
 */
export function fieldOf<V, F extends FieldName<V>>(form: FormHandle<V>, name: F): FieldRef<V[F]> {
  return { form, name };
}

/** An option of a list of choices: its value and its label. */
export type Choice<T> = { value: T; label: string };

type Common = {
  label: string;
  /** A hint shown under the field, linked to it for screen readers. */
  hint?: string;
  class?: string;
};

/** What fields share: the label, the hint, the error, the pending check, and their ARIA links. */
abstract class FieldBase<P extends Common & { field: FieldRef<any> }> extends SuperElement<{ props: P }> {
  protected readonly controlId = uniqueId('super-field');

  protected error(): string | null {
    const { form, name } = this.props.field;
    return form.error(name);
  }

  /** The control's ARIA attributes: invalid, and described by the hint and the error. */
  protected described() {
    const error = this.error();
    const ids = [this.props.hint && `${this.controlId}-hint`, error && `${this.controlId}-error`].filter(Boolean).join(' ');
    return { invalid: error ? 'true' : nothing, describedby: ids || nothing };
  }

  protected footer() {
    const { field, hint } = this.props;
    const error = this.error();
    return html`${hint ? html`<p class="super-field-hint" id=${`${this.controlId}-hint`}>${hint}</p>` : nothing}
    ${field.form.checking(field.name) ? html`<p class="super-field-checking">Checking…</p>` : nothing}
    ${error ? html`<p class="super-field-error" id=${`${this.controlId}-error`}>${error}</p>` : nothing}`;
  }
}

/* ------------------------------------------------------------------------------------------ */

type FieldProps = Common & {
  field: FieldRef<string | number | null>;
  /** The field type (default `text`). With `number` or `range`, the value is a number. */
  type?: 'text' | 'email' | 'password' | 'number' | 'url' | 'tel' | 'search' | 'date' | 'time' | 'datetime-local' | 'color' | 'range';
  /** A multi-line text area, with `rows` lines. */
  multiline?: boolean;
  rows?: number;
  placeholder?: string;
  autocomplete?: string;
};

/**
 * An input field bound to the form: label, hint, rule error, "Checking…"
 * during an asynchronous check, `aria-invalid` and `aria-describedby`.
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
  /** Several choices: the field's value is a list. */
  multiple?: boolean;
};

/** A drop-down list bound to the form. */
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
  /** A single checkbox for a boolean; with `value`, a checkbox in a group whose field is a list. */
  field: FieldRef<boolean | readonly unknown[]>;
  value?: string;
};

/** A checkbox bound to the form. */
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

/** A group of radio buttons bound to the form, in a `<fieldset>` whose legend is `label`. */
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
