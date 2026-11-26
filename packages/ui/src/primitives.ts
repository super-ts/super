import { type Children, html, nothing, SuperElement } from '@super-ts/dom';
import type { Choice } from './fields.ts';
import { classes, uniqueId } from './shared.ts';

/** After the next render: to move focus to an element the render has just displayed. */
const afterRender = (run: () => void) => void Promise.resolve().then(() => queueMicrotask(run));

/** Closes on a click outside the component, while it is mounted. */
function onOutsideClick(host: HTMLElement, signal: AbortSignal, close: () => void) {
  document.addEventListener(
    'pointerdown',
    (event) => {
      if (!host.contains(event.target as Node)) close();
    },
    { signal },
  );
}

/** The next item of a list, skipping disabled items, and wrapping around. */
function step(items: readonly object[], from: number, delta: 1 | -1): number {
  for (let i = 1; i <= items.length; i++) {
    const index = (from + delta * i + items.length * 2) % items.length;
    if (!(items[index] as { disabled?: boolean } | undefined)?.disabled) return index;
  }
  return from;
}

/* ------------------------------------------------------------------------------------------ */
/* Menu                                                                                        */
/* ------------------------------------------------------------------------------------------ */

export type MenuItem = { id: string; label: string; disabled?: boolean };

type MenuProps = {
  /** The text of the button that opens the menu. */
  label: string;
  items: readonly MenuItem[];
  class?: string;
};

/**
 * A menu of actions behind a button. Keyboard: arrows, Home, End, Enter, Escape; a click
 * outside the menu closes it. The choice is emitted through `select`.
 */
export class Menu extends SuperElement<{ props: MenuProps; emits: { select: { id: string } } }> {
  static tag = 'super-menu';
  #ui = this.state({ open: false, active: -1 });
  #menuId = uniqueId('super-menu');
  #trigger = this.ref<HTMLButtonElement>();

  protected override mounted() {
    onOutsideClick(this, this.signal, () => this.#close(false));
  }

  #open(active: number) {
    this.#ui.set({ open: true, active });
    afterRender(() => this.#focusActive());
  }

  #close(refocus = true) {
    if (!this.#ui.get().open) return;
    this.#ui.set({ open: false, active: -1 });
    if (refocus) this.#trigger.value?.focus();
  }

  #focusActive() {
    this.querySelector<HTMLElement>(`#${this.#menuId}-${this.#ui.get().active}`)?.focus();
  }

  #move(active: number) {
    this.#ui.set({ active });
    afterRender(() => this.#focusActive());
  }

  #choose(item: MenuItem) {
    if (item.disabled) return;
    this.#close();
    this.emit('select', { id: item.id });
  }

  #first = () => step(this.props.items, -1, 1);
  #last = () => step(this.props.items, this.props.items.length, -1);

  #triggerKey = (event: KeyboardEvent) => {
    if (['ArrowDown', 'Enter', ' '].includes(event.key)) {
      event.preventDefault();
      this.#open(this.#first());
    } else if (event.key === 'ArrowUp') {
      event.preventDefault();
      this.#open(this.#last());
    }
  };

  #menuKey = (event: KeyboardEvent) => {
    const { items } = this.props;
    const { active } = this.#ui.get();
    const moves: Record<string, () => number> = {
      ArrowDown: () => step(items, active, 1),
      ArrowUp: () => step(items, active, -1),
      Home: this.#first,
      End: this.#last,
    };
    if (moves[event.key]) {
      event.preventDefault();
      this.#move(moves[event.key]!());
    } else if (event.key === 'Escape' || event.key === 'Tab') {
      if (event.key === 'Escape') event.preventDefault();
      this.#close(event.key === 'Escape');
    } else if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      const item = items[active];
      if (item) this.#choose(item);
    }
  };

  render() {
    const { label, items } = this.props;
    const { open } = this.#ui.get();
    return html`<div class=${classes('super-menu', this.props.class)}>
      <button
        type="button"
        class="super-button"
        data-variant="secondary"
        aria-haspopup="menu"
        aria-expanded=${open ? 'true' : 'false'}
        aria-controls=${this.#menuId}
        @click=${() => (open ? this.#close() : this.#open(this.#first()))}
        @keydown=${this.#triggerKey}
        ${this.#trigger}
      >
        ${label}
      </button>
      <ul class="super-menu-list" role="menu" id=${this.#menuId} ?hidden=${!open} @keydown=${this.#menuKey}>
        ${items.map(
          (item, i) => html`<li
            role="menuitem"
            id=${`${this.#menuId}-${i}`}
            class="super-menu-item"
            tabindex="-1"
            aria-disabled=${item.disabled ? 'true' : nothing}
            @click=${() => this.#choose(item)}
          >
            ${item.label}
          </li>`,
        )}
      </ul>
    </div>`;
  }
}

/* ------------------------------------------------------------------------------------------ */
/* Tabs                                                                                        */
/* ------------------------------------------------------------------------------------------ */

export type Tab = { id: string; label: string; disabled?: boolean };

type TabsProps = {
  tabs: readonly Tab[];
  /** One panel per tab, in the same order: `panels={[this.#profile(), this.#security()]}`. */
  panels: Children[];
  /** The displayed tab, if the parent drives it (otherwise, the first, then the last chosen). */
  selected?: string;
  /** Name of the tab list for screen readers. */
  label?: string;
  class?: string;
};

/**
 * Tabs: one panel visible at a time. Keyboard: left and right arrows, Home, End.
 * Without `selected`, the tabs keep their choice themselves; with it, the parent does, notified through
 * `change`.
 */
export class Tabs extends SuperElement<{ props: TabsProps; emits: { change: { id: string } } }> {
  static tag = 'super-tabs';
  #ui = this.state({ selected: null as string | null });
  #baseId = uniqueId('super-tabs');

  #current(): string {
    return this.props.selected ?? this.#ui.get().selected ?? this.props.tabs.find((tab) => !tab.disabled)?.id ?? '';
  }

  #select(id: string, focus = false) {
    this.#ui.set({ selected: id });
    this.emit('change', { id });
    if (focus) afterRender(() => this.querySelector<HTMLElement>(`#${this.#baseId}-tab-${id}`)?.focus());
  }

  #key = (event: KeyboardEvent) => {
    const { tabs } = this.props;
    const index = tabs.findIndex((tab) => tab.id === this.#current());
    const moves: Record<string, () => number> = {
      ArrowRight: () => step(tabs, index, 1),
      ArrowLeft: () => step(tabs, index, -1),
      Home: () => step(tabs, -1, 1),
      End: () => step(tabs, tabs.length, -1),
    };
    if (!moves[event.key]) return;
    event.preventDefault();
    this.#select(tabs[moves[event.key]!()]!.id, true);
  };

  render() {
    const { tabs, panels, label } = this.props;
    const current = this.#current();
    return html`<div class=${classes('super-tabs', this.props.class)}>
      <div class="super-tabs-list" role="tablist" aria-label=${label ?? nothing} @keydown=${this.#key}>
        ${tabs.map(
          (tab) => html`<button
            type="button"
            role="tab"
            class="super-tab"
            id=${`${this.#baseId}-tab-${tab.id}`}
            aria-selected=${tab.id === current ? 'true' : 'false'}
            aria-controls=${`${this.#baseId}-panel-${tab.id}`}
            tabindex=${tab.id === current ? '0' : '-1'}
            ?disabled=${tab.disabled ?? false}
            @click=${() => this.#select(tab.id)}
          >
            ${tab.label}
          </button>`,
        )}
      </div>
      ${tabs.map(
        (tab, i) => html`<div
          class="super-tab-panel"
          role="tabpanel"
          id=${`${this.#baseId}-panel-${tab.id}`}
          aria-labelledby=${`${this.#baseId}-tab-${tab.id}`}
          tabindex="0"
          ?hidden=${tab.id !== current}
        >
          ${panels[i]}
        </div>`,
      )}
    </div>`;
  }
}

/* ------------------------------------------------------------------------------------------ */
/* Disclosure                                                                                  */
/* ------------------------------------------------------------------------------------------ */

type DisclosureProps = {
  /** The always visible text, which opens and closes. */
  summary: string;
  content: Children;
  /** Open on first display. */
  open?: boolean;
  class?: string;
};

/** Collapsible content, on `<details>` and `<summary>`: the browser already makes it an accessible element. */
export class Disclosure extends SuperElement<{ props: DisclosureProps; emits: { toggle: { open: boolean } } }> {
  static tag = 'super-disclosure';

  #toggle = (event: Event) => this.emit('toggle', { open: (event.currentTarget as HTMLDetailsElement).open });

  render() {
    const { summary, content, open = false } = this.props;
    return html`<details class=${classes('super-disclosure', this.props.class)} ?open=${open} @toggle=${this.#toggle}>
      <summary class="super-disclosure-summary">${summary}</summary>
      <div class="super-disclosure-body">${content}</div>
    </details>`;
  }
}

/* ------------------------------------------------------------------------------------------ */
/* Tooltip                                                                                     */
/* ------------------------------------------------------------------------------------------ */

type TooltipProps = {
  /** The tooltip's text. */
  text: string;
  /** The described element: a button, a link, a field. */
  content: Children;
  class?: string;
};

const FOCUSABLE = 'a[href], button, input, select, textarea, [tabindex]';

/**
 * A tooltip on an element: shown on hover and focus, hidden by Escape. The described
 * element (the first focusable element of the content) is linked to it through `aria-describedby`.
 */
export class Tooltip extends SuperElement<{ props: TooltipProps }> {
  static tag = 'super-tooltip';
  #ui = this.state({ visible: false });
  #tipId = uniqueId('super-tooltip');

  protected override mounted() {
    this.querySelector(FOCUSABLE)?.setAttribute('aria-describedby', this.#tipId);
  }

  #show = () => this.#ui.set({ visible: true });
  #hide = () => this.#ui.set({ visible: false });
  #key = (event: KeyboardEvent) => {
    if (event.key === 'Escape') this.#hide();
  };

  render() {
    const { text, content } = this.props;
    return html`<span
      class=${classes('super-tooltip', this.props.class)}
      @mouseenter=${this.#show}
      @mouseleave=${this.#hide}
      @focusin=${this.#show}
      @focusout=${this.#hide}
      @keydown=${this.#key}
    >
      ${content}
      <span class="super-tooltip-text" role="tooltip" id=${this.#tipId} ?hidden=${!this.#ui.get().visible}>${text}</span>
    </span>`;
  }
}

/* ------------------------------------------------------------------------------------------ */
/* Popover                                                                                     */
/* ------------------------------------------------------------------------------------------ */

type PopoverProps = {
  /** The text of the button that opens the content. */
  label: string;
  content: Children;
  /** Name of the content for screen readers (default: `label`). */
  title?: string;
  class?: string;
};

/**
 * Floating content behind a button, non-modal: the rest of the page stays usable. Escape
 * or a click outside the content closes it.
 */
export class Popover extends SuperElement<{ props: PopoverProps; emits: { toggle: { open: boolean } } }> {
  static tag = 'super-popover';
  #ui = this.state({ open: false });
  #panelId = uniqueId('super-popover');
  #trigger = this.ref<HTMLButtonElement>();

  protected override mounted() {
    onOutsideClick(this, this.signal, () => this.#set(false));
  }

  #set(open: boolean, refocus = false) {
    if (this.#ui.get().open === open) return;
    this.#ui.set({ open });
    this.emit('toggle', { open });
    if (refocus) this.#trigger.value?.focus();
  }

  #key = (event: KeyboardEvent) => {
    if (event.key === 'Escape' && this.#ui.get().open) {
      event.preventDefault();
      this.#set(false, true);
    }
  };

  render() {
    const { label, content, title } = this.props;
    const { open } = this.#ui.get();
    return html`<div class=${classes('super-popover', this.props.class)} @keydown=${this.#key}>
      <button
        type="button"
        class="super-button"
        data-variant="secondary"
        aria-expanded=${open ? 'true' : 'false'}
        aria-controls=${this.#panelId}
        @click=${() => this.#set(!open)}
        ${this.#trigger}
      >
        ${label}
      </button>
      <div class="super-popover-panel" role="dialog" aria-label=${title ?? label} id=${this.#panelId} ?hidden=${!open}>${content}</div>
    </div>`;
  }
}

/* ------------------------------------------------------------------------------------------ */
/* Combobox                                                                                    */
/* ------------------------------------------------------------------------------------------ */

type ComboboxProps = {
  label: string;
  /**
   * The offered choices. Static: the combobox filters them itself based on the input. From a
   * store: the parent filters them (on `search`) and passes `filter={false}`.
   */
  options: readonly Choice<string>[];
  /** Filters the options on the input (default `true`). `false` when the parent provides them already filtered. */
  filter?: boolean;
  /** The initially chosen value. */
  value?: string;
  placeholder?: string;
  /** The options are on their way (a search is pending). */
  loading?: boolean;
  emptyLabel?: string;
  class?: string;
};

/** Ignoring accents and case: "cote" finds "Côte d'Ivoire". */
const fold = (text: string) =>
  text
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .toLowerCase();

/**
 * An input with suggestions. Keyboard: arrows, Enter to choose, Escape to close. Emits
 * `search` on every input (to load options), and `select` on choice.
 *
 * ```tsx
 * // Static
 * <Combobox label="Country" options={COUNTRIES} on:select={…} />
 * // From a store: the parent searches, the combobox displays
 * <Combobox label="Book" options={this.results.value} filter={false} loading={this.searching.value}
 *   on:search={({ text }) => this.library.send('search', { text })} on:select={…} />
 * ```
 */
export class Combobox extends SuperElement<{
  props: ComboboxProps;
  emits: { search: { text: string }; select: { value: string; label: string } };
}> {
  static tag = 'super-combobox';
  #ui = this.state({ text: null as string | null, open: false, active: -1 });
  #id = uniqueId('super-combobox');

  protected override mounted() {
    onOutsideClick(this, this.signal, () => this.#ui.set({ open: false, active: -1 }));
  }

  #text(): string {
    const { text } = this.#ui.get();
    if (text !== null) return text;
    return this.props.options.find((option) => option.value === this.props.value)?.label ?? '';
  }

  #shown(): readonly Choice<string>[] {
    const { options, filter = true } = this.props;
    if (!filter) return options;
    const wanted = fold(this.#text());
    return options.filter((option) => fold(option.label).includes(wanted));
  }

  #input = (event: Event) => {
    const text = (event.currentTarget as HTMLInputElement).value;
    this.#ui.set({ text, open: true, active: -1 });
    this.emit('search', { text });
  };

  #choose(option: Choice<string>) {
    this.#ui.set({ text: option.label, open: false, active: -1 });
    this.emit('select', { value: option.value, label: option.label });
  }

  #key = (event: KeyboardEvent) => {
    const shown = this.#shown();
    const { open, active } = this.#ui.get();
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault();
      if (shown.length === 0) return this.#ui.set({ open: true });
      const next =
        !open || active < 0 ? (event.key === 'ArrowDown' ? 0 : shown.length - 1) : step(shown, active, event.key === 'ArrowDown' ? 1 : -1);
      this.#ui.set({ open: true, active: next });
    } else if (event.key === 'Enter' && open && shown[active]) {
      event.preventDefault();
      this.#choose(shown[active]!);
    } else if (event.key === 'Escape' && open) {
      event.preventDefault();
      this.#ui.set({ open: false, active: -1 });
    }
  };

  render() {
    const { label, placeholder, loading = false, emptyLabel = 'No results' } = this.props;
    const { open, active } = this.#ui.get();
    const shown = this.#shown();
    // Nothing typed and nothing to offer (options that will come from a search): the list stays closed.
    const visible = open && (shown.length > 0 || loading || this.#text() !== '');
    const listId = `${this.#id}-list`;
    const optionId = (i: number) => `${this.#id}-option-${i}`;
    return html`<div class=${classes('super-field', 'super-combobox', this.props.class)}>
      <label class="super-field-label" for=${this.#id}>${label}</label>
      <input
        id=${this.#id}
        class="super-input"
        role="combobox"
        autocomplete="off"
        aria-autocomplete="list"
        aria-expanded=${visible ? 'true' : 'false'}
        aria-controls=${listId}
        aria-activedescendant=${visible && active >= 0 ? optionId(active) : nothing}
        aria-busy=${loading ? 'true' : nothing}
        placeholder=${placeholder ?? nothing}
        .value=${this.#text()}
        @input=${this.#input}
        @keydown=${this.#key}
        @focus=${() => this.#ui.set({ open: true })}
      />
      <ul class="super-combobox-list" role="listbox" id=${listId} aria-label=${label} ?hidden=${!visible}>
        ${
          loading
            ? html`<li class="super-combobox-status" role="presentation">Loading…</li>`
            : shown.length === 0
              ? html`<li class="super-combobox-status" role="presentation">${emptyLabel}</li>`
              : shown.map(
                  (option, i) => html`<li
                    role="option"
                    id=${optionId(i)}
                    class="super-combobox-option"
                    aria-selected=${i === active ? 'true' : 'false'}
                    @pointerdown=${(event: Event) => event.preventDefault()}
                    @click=${() => this.#choose(option)}
                  >
                    ${option.label}
                  </li>`,
                )
        }
      </ul>
    </div>`;
  }
}
