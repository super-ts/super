/*
 * The page title (`document.title`), set by components (`@title`, `this.page.title`).
 *
 * Each mounted component that sets a title has an entry in a stack, in the order they were
 * mounted: the last entry that has a text wins. On unmount, the entry disappears and the previous
 * title comes back. The router sets the default title and the common suffix (`createRouter`).
 */

/** What a component sets on the page. */
export interface Page {
  /**
   * The page title, as long as the component is mounted. A string is set as is; a
   * function is tracked: recomputed after each render of the component, it reads the same values
   * as `render` (`() => \`Counter ${this.label.value}\``). Write-only.
   *
   * Set in a field or the constructor (what `@title` does), it is reapplied at each mount.
   * Set once mounted (`mounted`, handler), it replaces the component's title until
   * unmount. Forbidden during `render`.
   *
   * @example
   * this.page.title = 'Shop';
   * this.page.title = () => `Counter ${this.label.value}`;
   */
  get title(): never;
  set title(value: TitleValue);
}

export type TitleValue = string | (() => string);

/** A stack entry: the current text of a component's title (`null`: not computed yet). */
export type TitleEntry = { text: string | null };

export type TitleOptions = {
  /** The title when no component sets one (default: the document title at the first title set). */
  default?: string;
  /** Appended to the title set by a component: `' · My demo'`. */
  suffix?: string;
};

const stack: TitleEntry[] = [];
let settings: { default: string | null; suffix: string } = { default: null, suffix: '' };
/** The document title before the first title set: restored when the stack empties, without a default. */
let original: string | null = null;

/** Internal: router settings (`createRouter({ title })`). Without settings, the previous ones are forgotten. */
export function configureTitle(options: TitleOptions = {}): void {
  settings = { default: options.default ?? null, suffix: options.suffix ?? '' };
  apply();
}

/** Internal: a new entry, at the top of the stack. */
export function pushTitle(): TitleEntry {
  if (original === null && typeof document !== 'undefined') original = document.title;
  const entry: TitleEntry = { text: null };
  stack.push(entry);
  return entry;
}

/** Internal: changes an entry's text. */
export function updateTitle(entry: TitleEntry, text: string): void {
  if (entry.text === text) return;
  entry.text = text;
  apply();
}

/** Internal: removes an entry (unmount). */
export function removeTitle(entry: TitleEntry): void {
  const index = stack.indexOf(entry);
  if (index === -1) return;
  stack.splice(index, 1);
  apply();
}

function apply() {
  if (typeof document === 'undefined') return;
  let top: string | null = null;
  for (let i = stack.length - 1; i >= 0 && top === null; i--) top = stack[i]!.text;
  const next = top !== null ? `${top}${settings.suffix}` : (settings.default ?? original);
  if (next !== null && document.title !== next) document.title = next;
}
