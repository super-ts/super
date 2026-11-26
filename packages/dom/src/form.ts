import { type AnyStore, CommandFailure, type CommandMap, type FailureOf, type InputOf, type ResultOf } from '@super-ts/core';
import { nothing } from 'lit-html';
import { Directive, directive, type ElementPart, type PartInfo, PartType } from 'lit-html/directive.js';

/* ------------------------------------------------------------------------------------------ */
/* Public types                                                                                */
/* ------------------------------------------------------------------------------------------ */

/** A rule: `true` if the value is valid, the error message otherwise. */
export type FieldRule<T, V> = (value: T, values: Readonly<V>) => true | string;

/** The fields that are lists of rows (arrays of objects): `phones: [{ label, number }]`. */
export type ListName<V> = {
  [K in keyof V]: V[K] extends readonly (infer Item)[] ? (Item extends object ? (Item extends File ? never : K) : never) : never;
}[keyof V] &
  string;

/** The simple fields: everything except lists. */
export type FieldName<V> = Exclude<keyof V & string, ListName<V>>;

type ItemOf<T> = T extends readonly (infer Item)[] ? Item : never;

/** Value expected as the second argument of `field`: that of a radio, or of a checkbox in a group. */
export type FieldOption<T> = T extends readonly (infer E)[] ? E : T;

/** One rule per field; for a list, one rule per row field. */
export type FormRules<V> = {
  [K in keyof V]?: K extends ListName<V> ? { [F in keyof ItemOf<V[K]>]?: FieldRule<ItemOf<V[K]>[F], V> } : FieldRule<V[K], V>;
};

/** Asynchronous check of a field, through a command of the submission store. */
export type FieldCheck<T, C> = {
  [K in keyof C & string]: {
    command: K;
    /** Converts the field's value into the command's `input`. */
    toInput: (value: T) => InputOf<C[K]>;
    /** `true` if the result validates the field, the error message otherwise. */
    accept: (result: ResultOf<C[K]>) => true | string;
    /** Typing pause before checking, in milliseconds (300 by default). */
    delay?: number;
  };
}[keyof C & string];

/**
 * Where to display each failure reason of the submit command: on fields (`fields`), or
 * on the form (`form`). Each declared reason appears only once. `form.error`,
 * optional, replaces the default message of an unexpected exception.
 */
export type FormFailures<R extends string, RF extends R, V> = {
  fields: { [Reason in RF]: { [K in keyof V & string]?: string } };
  form: { [Reason in Exclude<R, RF>]: string } & { error?: string };
};

type FailuresOption<R extends string, RF extends R, V> = [R] extends [never]
  ? { failures?: { fields?: {}; form?: { error?: string } } }
  : { failures: FormFailures<R, RF, V> };

export type FormOptions<V, C extends CommandMap, K extends keyof C & string, RF extends FailureOf<C[K]>> = {
  /** The starting values: their type gives that of each field. */
  initial: V;
  rules?: FormRules<V>;
  /**
   * When a submission is blocked by an error, or a server error targets a field:
   * centres the first field in error (in page order) and focuses it. `true` by default.
   */
  scrollToError?: boolean;
  /** Rules that cross several fields: the errors per field. */
  validate?: (values: Readonly<V>) => { [F in keyof V & string]?: string };
  /** Asynchronous checks, per field, with commands of the submission store. */
  checks?: { [F in FieldName<V>]?: FieldCheck<V[F], C> };
  /** The submission is a command: its life cycle gives "pending" and the server errors. */
  submit: {
    /** The submission store, by its contract: `this.contract('checkout')`. */
    to: { readonly __commands?: C };
    command: K;
    /** Converts the form's values into the command's `input` (the one found in `name:done`). */
    toInput: (values: Readonly<V>) => InputOf<C[K]>;
  };
} & FailuresOption<FailureOf<C[K]>, RF, V>;

/** A row of a dynamic list. */
export interface FormListItem<Item> {
  /** Stable key, for `repeat`: it does not change when another row is removed. */
  readonly key: string;
  readonly index: number;
  readonly value: Readonly<Item>;
  field<F extends keyof Item & string>(name: F, option?: FieldOption<Item[F]>): unknown;
  error(name: keyof Item & string): string | null;
}

/** A dynamic list: rows are added and removed. */
export interface FormList<Item> {
  items(): FormListItem<Item>[];
  add(item: Item): void;
  remove(item: FormListItem<Item> | number): void;
}

export interface FormHandle<V> {
  /** To place on the `<form>` tag: submission by keyboard and button, without reloading. */
  bind(): unknown;
  /** To place on a field: `<input ${form.field('name')} />`. Value of a radio or of a checkbox in a group as second argument. */
  field<F extends FieldName<V>>(name: F, option?: FieldOption<V[F]>): unknown;
  /** The message to display under a field, or `null`. */
  error(name: keyof V & string): string | null;
  /** The message to display for the whole form (server error without a field), or `null`. */
  formError(): string | null;
  /** Is the submission pending (or waiting for checks)? */
  submitting(): boolean;
  /** Is an asynchronous check of this field pending? */
  checking(name: FieldName<V>): boolean;
  values(): Readonly<V>;
  set<F extends keyof V & string>(name: F, value: V[F]): void;
  list<L extends ListName<V>>(name: L): FormList<ItemOf<V[L]>>;
  submit(): void;
  /** Goes back to the initial values and clears errors and touched fields. */
  reset(): void;
}

/* ------------------------------------------------------------------------------------------ */
/* Under the hood                                                                              */
/* ------------------------------------------------------------------------------------------ */

/** Message displayed for an unexpected exception, if `failures.form.error` does not replace it. */
export const UNEXPECTED_FAILURE_MESSAGE = 'An unexpected error occurred.';

type Path = { field: string; key?: string; sub?: string };
type AnyRecord = Record<string, any>;
type Controller = {
  read(path: Path): unknown;
  write(path: Path, value: unknown): void;
  touch(path: Path): void;
  submit(): void;
  /** An element bound by `field(…)` makes itself known, so that it can be found when in error. */
  register(path: Path, element: Element): void;
};

/**
 * What the component provides to the form. `connect` receives the function that wires the form
 * to the submission store, called at each mount: the store is only known once the
 * component is in the DOM.
 */
type Environment = {
  requestRender(): void;
  connect(attach: (store: AnyStore, signal: AbortSignal) => void): void;
};

const pathId = ({ field, key, sub }: Path) => (key === undefined ? field : `${field}.${key}.${sub}`);

export function createForm(options: FormOptions<any, CommandMap, string, never>, env: Environment): FormHandle<any> {
  /** The submission store, once the form is wired. */
  let store: AnyStore | null = null;
  const connected = (): AnyStore => {
    if (!store) throw new Error('[super] form: the form only talks to the store once the component is mounted');
    return store;
  };

  const rules = (options.rules ?? {}) as AnyRecord;
  const checks = (options.checks ?? {}) as Record<
    string,
    { command: string; toInput(v: unknown): unknown; accept(r: unknown): true | string; delay?: number }
  >;
  const failures = (options as { failures?: { fields?: AnyRecord; form?: AnyRecord } }).failures ?? {};
  const command = options.submit.command as string;

  let nextKey = 0;
  const keysFor = (rows: unknown[]) => rows.map(() => `k${nextKey++}`);

  let values: AnyRecord;
  let keys: Record<string, string[]>;
  let touched: Set<string>;
  let submitted: boolean;
  let serverErrors: Record<string, string>;
  let formError: string | null;
  let checkErrors: Record<string, string>;
  let waitingSubmit: boolean;
  let lastSubmit: unknown;
  const checking = new Map<string, { timer?: ReturnType<typeof setTimeout>; input?: unknown }>();

  function init() {
    values = { ...(options.initial as AnyRecord) };
    keys = {};
    for (const [name, value] of Object.entries(values)) {
      if (Array.isArray(value) && value.length > 0 && typeof value[0] === 'object' && !(value[0] instanceof File))
        keys[name] = keysFor(value);
    }
    touched = new Set();
    submitted = false;
    serverErrors = {};
    formError = null;
    checkErrors = {};
    waitingSubmit = false;
    lastSubmit = undefined;
    for (const entry of checking.values()) clearTimeout(entry.timer);
    checking.clear();
  }
  init();

  const isList = (name: string) => name in keys || (Array.isArray(values[name]) && typeof rules[name] === 'object');
  const rowIndex = (field: string, key: string) => (keys[field] ?? []).indexOf(key);

  function read(path: Path): unknown {
    if (path.key === undefined) return values[path.field];
    return (values[path.field] as AnyRecord[])[rowIndex(path.field, path.key)]?.[path.sub!];
  }

  function ruleError(path: Path): string | null {
    const rule = path.key === undefined ? rules[path.field] : rules[path.field]?.[path.sub!];
    if (typeof rule !== 'function') return null;
    const result = rule(read(path), values);
    return result === true ? null : result;
  }

  const crossErrors = () => (options.validate ? options.validate(values) : {}) as Record<string, string | undefined>;

  function blocking(): boolean {
    for (const name of Object.keys(values)) {
      if (isList(name)) {
        const subs = Object.keys(rules[name] ?? {});
        for (const key of keys[name] ?? []) if (subs.some((sub) => ruleError({ field: name, key, sub }))) return true;
      } else if (ruleError({ field: name })) return true;
    }
    return Object.values(crossErrors()).some(Boolean) || Object.values(checkErrors).some(Boolean);
  }

  function errorOf(path: Path): string | null {
    const id = pathId(path);
    if (path.key === undefined && serverErrors[path.field]) return serverErrors[path.field]!;
    const shown = submitted || touched.has(id);
    if (shown) {
      const own = ruleError(path);
      if (own) return own;
      if (path.key === undefined) {
        const cross = crossErrors()[path.field];
        if (cross) return cross;
      }
    }
    return path.key === undefined ? (checkErrors[path.field] ?? null) : null;
  }

  function scheduleCheck(field: string) {
    const check = checks[field];
    if (!check) return;
    clearTimeout(checking.get(field)?.timer);
    delete checkErrors[field];
    if (ruleError({ field })) {
      checking.delete(field); // no point querying the server for a value that is already invalid
      return;
    }
    const entry: { timer?: ReturnType<typeof setTimeout>; input?: unknown } = {};
    entry.timer = setTimeout(() => {
      entry.timer = undefined;
      const input = check.toInput(values[field]);
      entry.input = input;
      // The verdict arrives through `:done`. If the command ends without a published outcome (fake store), or
      // fails, the check ends anyway, without a verdict: it no longer blocks anything.
      connected()
        .send(check.command, input)
        .catch(() => {})
        .finally(() => settleCheck(input, null));
    }, check.delay ?? 300);
    checking.set(field, entry);
  }

  function settleCheck(input: unknown, outcome: { result: unknown } | null) {
    for (const [field, entry] of checking) {
      if (entry.input !== input) continue; // stale response: the value has changed since
      checking.delete(field);
      if (outcome) {
        const verdict = checks[field]!.accept(outcome.result);
        if (verdict === true) delete checkErrors[field];
        else checkErrors[field] = verdict;
      }
    }
    if (waitingSubmit && checking.size === 0) submit();
    env.requestRender();
  }

  env.connect((attached, signal) => {
    store = attached;
    for (const name of new Set(Object.values(checks).map((check) => check.command))) {
      attached.on(`${name}:done`, ({ input, result }: { input: unknown; result: unknown }) => settleCheck(input, { result }), { signal });
      attached.on(`${name}:failed`, ({ input }: { input: unknown }) => settleCheck(input, null), { signal });
    }

    attached.on(
      `${command}:failed`,
      ({ input, reason }: { input: unknown; reason: string }) => {
        if (input !== lastSubmit) return;
        const onFields = failures.fields?.[reason] as Record<string, string> | undefined;
        if (onFields) {
          serverErrors = { ...onFields };
          revealFirstError();
        } else
          formError =
            (failures.form?.[reason] as string | undefined) ??
            (reason === 'error' ? (failures.form?.error ?? UNEXPECTED_FAILURE_MESSAGE) : reason);
        env.requestRender();
      },
      { signal },
    );
    attached.on(
      `${command}:done`,
      ({ input }: { input: unknown }) => {
        if (input !== lastSubmit) return;
        submitted = false;
        touched = new Set();
        env.requestRender();
      },
      { signal },
    );

    // "Pending" comes from the store: re-render when it changes.
    let wasSubmitting = false;
    attached.subscribe(
      () => {
        const now = attached.pending(command);
        if (now === wasSubmitting) return;
        wasSubmitting = now;
        env.requestRender();
      },
      { signal },
    );
  });

  function write(path: Path, value: unknown) {
    if (path.key === undefined) {
      values = { ...values, [path.field]: value };
      delete serverErrors[path.field];
      scheduleCheck(path.field);
    } else {
      const rows = [...(values[path.field] as AnyRecord[])];
      const index = rowIndex(path.field, path.key);
      rows[index] = { ...rows[index], [path.sub!]: value };
      values = { ...values, [path.field]: rows };
      delete serverErrors[path.field];
    }
    env.requestRender();
  }

  function touch(path: Path) {
    if (touched.has(pathId(path))) return;
    touched = new Set(touched).add(pathId(path));
    env.requestRender();
  }

  function submit() {
    submitted = true;
    formError = null;
    if (blocking()) {
      waitingSubmit = false;
      env.requestRender();
      revealFirstError();
      return;
    }
    if (checking.size > 0) {
      waitingSubmit = true; // the submission restarts when the checks have answered
      env.requestRender();
      return;
    }
    waitingSubmit = false;
    serverErrors = {};
    lastSubmit = options.submit.toInput(values);
    connected()
      .send(command, lastSubmit)
      .catch((error: unknown) => {
        if (!(error instanceof CommandFailure)) console.error(error);
      });
    env.requestRender();
  }

  /** Elements bound by `field(…)`, per field (several for a group of radios or checkboxes). */
  const elements = new Map<string, Set<Element>>();
  function register(path: Path, element: Element) {
    const id = pathId(path);
    if (!elements.has(id)) elements.set(id, new Set());
    elements.get(id)!.add(element);
  }

  /** Centres the first field in error, in page order, and focuses it. */
  function revealFirstError() {
    if (options.scrollToError === false) return;
    // After the render: the inserted error messages may have shifted the fields.
    queueMicrotask(() => {
      let first: HTMLElement | null = null;
      for (const [id, set] of elements) {
        const [field, key, sub] = id.split('.');
        if (!errorOf(key === undefined ? { field: field! } : { field: field!, key, sub })) continue;
        for (const element of set) {
          if (!element.isConnected || !(element instanceof HTMLElement)) continue;
          if (!first || first.compareDocumentPosition(element) & Node.DOCUMENT_POSITION_PRECEDING) first = element;
        }
      }
      if (!first) return;
      first.focus({ preventScroll: true });
      first.scrollIntoView({ block: 'center', behavior: 'smooth' });
    });
  }

  const controller: Controller = { read, write, touch, submit, register };

  return {
    bind: () => formDirective(controller),
    field: (name, option) => fieldDirective(controller, { field: name }, option),
    error: (name) => errorOf({ field: name }),
    formError: () => formError,
    submitting: () => waitingSubmit || (store?.pending(command) ?? false),
    checking: (name) => checking.has(name),
    values: () => values,
    set: (name, value) => write({ field: name }, value),
    submit,
    reset() {
      init();
      env.requestRender();
    },
    list(name) {
      keys[name] ??= keysFor((values[name] as unknown[]) ?? []);
      return {
        items: () =>
          (values[name] as AnyRecord[]).map((row, index) => {
            const key = keys[name]![index]!;
            return {
              key,
              index,
              value: row,
              field: (sub: string, option?: unknown) => fieldDirective(controller, { field: name, key, sub }, option),
              error: (sub: string) => errorOf({ field: name, key, sub }),
            };
          }) as never,
        add(item) {
          keys[name] = [...keys[name]!, `k${nextKey++}`];
          values = { ...values, [name]: [...(values[name] as unknown[]), item] };
          env.requestRender();
        },
        remove(item) {
          const index = typeof item === 'number' ? item : rowIndex(name, item.key);
          if (index < 0) return;
          keys[name] = keys[name]!.filter((_, i) => i !== index);
          values = { ...values, [name]: (values[name] as unknown[]).filter((_, i) => i !== index) };
          env.requestRender();
        },
      };
    },
  };
}

/* ------------------------------------------------------------------------------------------ */
/* Directives: binding DOM elements to the form                                                */
/* ------------------------------------------------------------------------------------------ */

type FieldElement = HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement;

const kindOf = (el: FieldElement) =>
  el instanceof HTMLInputElement ? el.type : el instanceof HTMLSelectElement && el.multiple ? 'select-multiple' : 'text';

function readElement(el: FieldElement, option: unknown, current: unknown): unknown {
  const kind = kindOf(el);
  if (el instanceof HTMLInputElement) {
    if (kind === 'checkbox') {
      if (option === undefined) return el.checked;
      const list = Array.isArray(current) ? current : [];
      return el.checked ? [...list.filter((v) => v !== option), option] : list.filter((v) => v !== option);
    }
    if (kind === 'radio') return option;
    if (kind === 'number' || kind === 'range') return el.value === '' ? null : el.valueAsNumber;
    if (kind === 'file') return el.multiple ? [...(el.files ?? [])] : (el.files?.[0] ?? null);
  }
  if (kind === 'select-multiple') return [...(el as HTMLSelectElement).selectedOptions].map((o) => o.value);
  return el.value;
}

function writeElement(el: FieldElement, value: unknown, option: unknown) {
  const kind = kindOf(el);
  if (el instanceof HTMLInputElement) {
    if (kind === 'checkbox') {
      if (option !== undefined) el.value = String(option);
      el.checked = option === undefined ? Boolean(value) : Array.isArray(value) && value.includes(option);
      return;
    }
    if (kind === 'radio') {
      el.value = String(option);
      el.checked = value === option;
      return;
    }
    if (kind === 'file') {
      if (value === null || (Array.isArray(value) && value.length === 0)) el.value = '';
      return;
    }
    if (kind === 'number' || kind === 'range') {
      const text = value === null || value === undefined ? '' : String(value);
      if (el.value !== text && !(el.value !== '' && el.valueAsNumber === value)) el.value = text;
      return;
    }
  }
  if (kind === 'select-multiple') {
    const selected = new Set(Array.isArray(value) ? value.map(String) : []);
    for (const option of (el as HTMLSelectElement).options) option.selected = selected.has(option.value);
    return;
  }
  const text = value === null || value === undefined ? '' : String(value);
  if (el.value !== text) el.value = text; // leave an up-to-date field alone: the cursor does not jump
}

class FieldDirective extends Directive {
  #element: FieldElement | null = null;
  #controller: Controller | null = null;
  #path: Path | null = null;
  #option: unknown;

  constructor(part: PartInfo) {
    super(part);
    if (part.type !== PartType.ELEMENT) throw new Error('[super] form.field(...) goes on a field: <input ${form.field("name")} />');
  }

  render(_controller: Controller, _path: Path, _option: unknown) {
    return nothing;
  }

  override update(part: ElementPart, [controller, path, option]: [Controller, Path, unknown]) {
    this.#controller = controller;
    this.#path = path;
    this.#option = option;
    const el = part.element as FieldElement;
    if (this.#element !== el) {
      this.#element = el;
      controller.register(path, el);
      const kind = kindOf(el);
      const onChange = () => {
        const current = this.#controller!.read(this.#path!);
        if (kind === 'radio' && !(el as HTMLInputElement).checked) return;
        this.#controller!.write(this.#path!, readElement(el, this.#option, current));
      };
      const live = el instanceof HTMLTextAreaElement || (el instanceof HTMLInputElement && !['checkbox', 'radio', 'file'].includes(kind));
      el.addEventListener(live ? 'input' : 'change', onChange);
      el.addEventListener(live ? 'blur' : 'change', () => this.#controller!.touch(this.#path!));
    }
    const value = controller.read(path);
    writeElement(el, value, option);
    // The options of a <select> rendered after it (repeat): resynchronise once everything is in place.
    if (el instanceof HTMLSelectElement) queueMicrotask(() => writeElement(el, controller.read(path), option));
    return nothing;
  }
}

class FormDirective extends Directive {
  #element: HTMLFormElement | null = null;
  #controller: Controller | null = null;

  constructor(part: PartInfo) {
    super(part);
    if (part.type !== PartType.ELEMENT) throw new Error('[super] form.bind() goes on the <form> tag');
  }

  render(_controller: Controller) {
    return nothing;
  }

  override update(part: ElementPart, [controller]: [Controller]) {
    this.#controller = controller;
    const el = part.element as HTMLFormElement;
    if (this.#element !== el) {
      this.#element = el;
      el.noValidate = true; // the form's rules replace the browser's native validation
      el.addEventListener('submit', (event) => {
        event.preventDefault();
        this.#controller!.submit();
      });
    }
    return nothing;
  }
}

const fieldDirective = directive(FieldDirective);
const formDirective = directive(FormDirective);
