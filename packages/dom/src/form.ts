import { type AnyStore, CommandFailure, type CommandMap, type FailureOf, type InputOf, type ResultOf } from '@super-ts/core';
import { nothing } from 'lit-html';
import { Directive, directive, type ElementPart, type PartInfo, PartType } from 'lit-html/directive.js';

/* ------------------------------------------------------------------------------------------ */
/* Types publics                                                                               */
/* ------------------------------------------------------------------------------------------ */

/** Une règle : `true` si la valeur est valide, le message d'erreur sinon. */
export type FieldRule<T, V> = (value: T, values: Readonly<V>) => true | string;

/** Les champs qui sont des listes de lignes (tableaux d'objets) : `phones: [{ label, number }]`. */
export type ListName<V> = {
  [K in keyof V]: V[K] extends readonly (infer Item)[] ? (Item extends object ? (Item extends File ? never : K) : never) : never;
}[keyof V] &
  string;

/** Les champs simples : tout sauf les listes. */
export type FieldName<V> = Exclude<keyof V & string, ListName<V>>;

type ItemOf<T> = T extends readonly (infer Item)[] ? Item : never;

/** Valeur attendue en second argument de `field` : celle d'un radio, ou d'une case d'un groupe. */
export type FieldOption<T> = T extends readonly (infer E)[] ? E : T;

/** Une règle par champ ; pour une liste, une règle par champ de ligne. */
export type FormRules<V> = {
  [K in keyof V]?: K extends ListName<V> ? { [F in keyof ItemOf<V[K]>]?: FieldRule<ItemOf<V[K]>[F], V> } : FieldRule<V[K], V>;
};

/** Vérification asynchrone d'un champ, par une commande du store de soumission. */
export type FieldCheck<T, C> = {
  [K in keyof C & string]: {
    command: K;
    /** Convertit la valeur du champ en `input` de la commande. */
    toInput: (value: T) => InputOf<C[K]>;
    /** `true` si le résultat valide le champ, le message d'erreur sinon. */
    accept: (result: ResultOf<C[K]>) => true | string;
    /** Pause dans la saisie avant de vérifier, en millisecondes (300 par défaut). */
    delay?: number;
  };
}[keyof C & string];

/**
 * Où afficher chaque raison d'échec de la commande de soumission : sur des champs (`fields`), ou
 * sur le formulaire (`form`). Chaque raison déclarée apparaît une seule fois. `form.error`,
 * facultatif, remplace le message par défaut d'une exception inattendue.
 */
export type FormFailures<R extends string, RF extends R, V> = {
  fields: { [Reason in RF]: { [K in keyof V & string]?: string } };
  form: { [Reason in Exclude<R, RF>]: string } & { error?: string };
};

type FailuresOption<R extends string, RF extends R, V> = [R] extends [never]
  ? { failures?: { fields?: {}; form?: { error?: string } } }
  : { failures: FormFailures<R, RF, V> };

export type FormOptions<V, C extends CommandMap, K extends keyof C & string, RF extends FailureOf<C[K]>> = {
  /** Les valeurs de départ : leur type donne celui de chaque champ. */
  initial: V;
  rules?: FormRules<V>;
  /**
   * Quand une soumission est bloquée par une erreur, ou qu'une erreur du serveur vise un champ :
   * centre le premier champ en erreur (dans l'ordre de la page) et lui donne le focus. `true` par défaut.
   */
  scrollToError?: boolean;
  /** Règles qui croisent plusieurs champs : les erreurs par champ. */
  validate?: (values: Readonly<V>) => { [F in keyof V & string]?: string };
  /** Vérifications asynchrones, par champ, avec des commandes du store de soumission. */
  checks?: { [F in FieldName<V>]?: FieldCheck<V[F], C> };
  /** La soumission est une commande : son cycle de vie donne « en cours » et les erreurs du serveur. */
  submit: {
    /** Le store de soumission, par son contrat : `this.contract('checkout')`. */
    to: { readonly __commands?: C };
    command: K;
    /** Convertit les valeurs du formulaire en `input` de la commande (celui qu'on retrouve dans `nom:done`). */
    toInput: (values: Readonly<V>) => InputOf<C[K]>;
  };
} & FailuresOption<FailureOf<C[K]>, RF, V>;

/** Une ligne d'une liste dynamique. */
export interface FormListItem<Item> {
  /** Clé stable, pour `repeat` : elle ne change pas quand on retire une autre ligne. */
  readonly key: string;
  readonly index: number;
  readonly value: Readonly<Item>;
  field<F extends keyof Item & string>(name: F, option?: FieldOption<Item[F]>): unknown;
  error(name: keyof Item & string): string | null;
}

/** Une liste dynamique : on ajoute et retire des lignes. */
export interface FormList<Item> {
  items(): FormListItem<Item>[];
  add(item: Item): void;
  remove(item: FormListItem<Item> | number): void;
}

export interface FormHandle<V> {
  /** À placer sur la balise `<form>` : soumission au clavier et au bouton, sans rechargement. */
  bind(): unknown;
  /** À placer sur un champ : `<input ${form.field('name')} />`. Valeur d'un radio ou d'une case d'un groupe en second argument. */
  field<F extends FieldName<V>>(name: F, option?: FieldOption<V[F]>): unknown;
  /** Le message à afficher sous un champ, ou `null`. */
  error(name: keyof V & string): string | null;
  /** Le message à afficher pour tout le formulaire (erreur serveur sans champ), ou `null`. */
  formError(): string | null;
  /** La soumission est-elle en cours (ou en attente de vérifications) ? */
  submitting(): boolean;
  /** Une vérification asynchrone de ce champ est-elle en cours ? */
  checking(name: FieldName<V>): boolean;
  values(): Readonly<V>;
  set<F extends keyof V & string>(name: F, value: V[F]): void;
  list<L extends ListName<V>>(name: L): FormList<ItemOf<V[L]>>;
  submit(): void;
  /** Revient aux valeurs initiales et efface erreurs et champs touchés. */
  reset(): void;
}

/* ------------------------------------------------------------------------------------------ */
/* Sous le capot                                                                               */
/* ------------------------------------------------------------------------------------------ */

/** Message affiché pour une exception inattendue, si `failures.form.error` ne le remplace pas. */
export const UNEXPECTED_FAILURE_MESSAGE = 'Une erreur inattendue est survenue.';

type Path = { field: string; key?: string; sub?: string };
type AnyRecord = Record<string, any>;
type Controller = {
  read(path: Path): unknown;
  write(path: Path, value: unknown): void;
  touch(path: Path): void;
  submit(): void;
  /** Un élément lié par `field(…)` se fait connaître, pour qu'on puisse le retrouver en erreur. */
  register(path: Path, element: Element): void;
};

/**
 * Ce que le composant fournit au formulaire. `connect` reçoit la fonction qui branche le formulaire
 * sur le store de soumission, appelée à chaque montage : le store n'est connu qu'une fois le
 * composant dans le DOM.
 */
type Environment = {
  requestRender(): void;
  connect(attach: (store: AnyStore, signal: AbortSignal) => void): void;
};

const pathId = ({ field, key, sub }: Path) => (key === undefined ? field : `${field}.${key}.${sub}`);

export function createForm(options: FormOptions<any, CommandMap, string, never>, env: Environment): FormHandle<any> {
  /** Le store de soumission, une fois le formulaire branché. */
  let store: AnyStore | null = null;
  const connected = (): AnyStore => {
    if (!store) throw new Error('[super] form : le formulaire ne parle au store qu’une fois le composant monté');
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
      checking.delete(field); // inutile d'interroger le serveur pour une valeur déjà invalide
      return;
    }
    const entry: { timer?: ReturnType<typeof setTimeout>; input?: unknown } = {};
    entry.timer = setTimeout(() => {
      entry.timer = undefined;
      const input = check.toInput(values[field]);
      entry.input = input;
      // Le verdict arrive par `:done`. Si la commande se termine sans issue publiée (faux store), ou
      // échoue, la vérification se termine quand même, sans verdict : elle ne bloque plus rien.
      connected()
        .send(check.command, input)
        .catch(() => {})
        .finally(() => settleCheck(input, null));
    }, check.delay ?? 300);
    checking.set(field, entry);
  }

  function settleCheck(input: unknown, outcome: { result: unknown } | null) {
    for (const [field, entry] of checking) {
      if (entry.input !== input) continue; // réponse périmée : la valeur a changé depuis
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

    // « En cours » vient du store : on re-rend quand il change.
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
      waitingSubmit = true; // la soumission repart quand les vérifications ont répondu
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

  /** Éléments liés par `field(…)`, par champ (plusieurs pour un groupe de radios ou de cases). */
  const elements = new Map<string, Set<Element>>();
  function register(path: Path, element: Element) {
    const id = pathId(path);
    if (!elements.has(id)) elements.set(id, new Set());
    elements.get(id)!.add(element);
  }

  /** Centre le premier champ en erreur, dans l'ordre de la page, et lui donne le focus. */
  function revealFirstError() {
    if (options.scrollToError === false) return;
    // Après le rendu : les messages d'erreur insérés ont pu décaler les champs.
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
/* Directives : relier les éléments du DOM au formulaire                                       */
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
  if (el.value !== text) el.value = text; // ne touche pas un champ déjà à jour : le curseur ne saute pas
}

class FieldDirective extends Directive {
  #element: FieldElement | null = null;
  #controller: Controller | null = null;
  #path: Path | null = null;
  #option: unknown;

  constructor(part: PartInfo) {
    super(part);
    if (part.type !== PartType.ELEMENT) throw new Error('[super] form.field(...) se place sur un champ : <input ${form.field("nom")} />');
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
    // Les options d'un <select> rendues après lui (repeat) : on resynchronise une fois tout en place.
    if (el instanceof HTMLSelectElement) queueMicrotask(() => writeElement(el, controller.read(path), option));
    return nothing;
  }
}

class FormDirective extends Directive {
  #element: HTMLFormElement | null = null;
  #controller: Controller | null = null;

  constructor(part: PartInfo) {
    super(part);
    if (part.type !== PartType.ELEMENT) throw new Error('[super] form.bind() se place sur la balise <form>');
  }

  render(_controller: Controller) {
    return nothing;
  }

  override update(part: ElementPart, [controller]: [Controller]) {
    this.#controller = controller;
    const el = part.element as HTMLFormElement;
    if (this.#element !== el) {
      this.#element = el;
      el.noValidate = true; // les règles du formulaire remplacent la validation native du navigateur
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
