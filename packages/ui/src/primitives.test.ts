import { type Children, html } from '@super-ts/dom';
import { flush, mount } from '@super-ts/testing';
import { Combobox, Disclosure, Menu, Popover, Tabs, Tooltip } from '@super-ts/ui';
import { describe, expect, test, vi } from 'vitest';

const text = (strings: TemplateStringsArray, ...values: unknown[]) => html(strings, ...values) as unknown as Children;
const key = (target: Element, name: string) =>
  target.dispatchEvent(new KeyboardEvent('keydown', { key: name, bubbles: true, cancelable: true }));
/** Lets the render through, then the focus move that follows it. */
const settle = async () => {
  await flush();
  await flush();
};

describe('Menu', () => {
  const items = [
    { id: 'rename', label: 'Rename' },
    { id: 'archive', label: 'Archive', disabled: true },
    { id: 'delete', label: 'Delete' },
  ];

  test('the button opens the menu from the keyboard, the arrows skip disabled entries, Enter chooses', async () => {
    const select = vi.fn();
    const { container } = await mount(Menu, { props: { label: 'Actions', items }, on: { select } });
    const trigger = container.querySelector('button')!;
    const list = container.querySelector('[role=menu]')!;
    expect(list.hasAttribute('hidden')).toBe(true);

    key(trigger, 'ArrowDown');
    await settle();
    expect(trigger.getAttribute('aria-expanded')).toBe('true');
    expect(document.activeElement!.textContent!.trim()).toBe('Rename');

    key(list, 'ArrowDown');
    await settle();
    expect(document.activeElement!.textContent!.trim()).toBe('Delete');

    key(list, 'Enter');
    await settle();
    expect(select).toHaveBeenCalledWith({ id: 'delete' });
    expect(list.hasAttribute('hidden')).toBe(true);
    expect(document.activeElement).toBe(trigger);
  });

  test('Escape and a click outside the menu close it', async () => {
    const { container } = await mount(Menu, { props: { label: 'Actions', items } });
    const trigger = container.querySelector('button')!;
    trigger.click();
    await settle();
    key(container.querySelector('[role=menu]')!, 'Escape');
    await settle();
    expect(trigger.getAttribute('aria-expanded')).toBe('false');

    trigger.click();
    await settle();
    document.body.dispatchEvent(new Event('pointerdown', { bubbles: true }));
    await settle();
    expect(trigger.getAttribute('aria-expanded')).toBe('false');
  });
});

describe('Tabs', () => {
  const tabs = [
    { id: 'profile', label: 'Profile' },
    { id: 'security', label: 'Security' },
  ];

  test('one panel visible at a time; click and arrows change tab', async () => {
    const change = vi.fn();
    const { container } = await mount(Tabs, {
      props: { tabs, panels: [text`Profile panel`, text`Security panel`], label: 'Account' },
      on: { change },
    });
    const visible = () => [...container.querySelectorAll('[role=tabpanel]:not([hidden])')].map((p) => p.textContent!.trim());
    const [profile, security] = container.querySelectorAll<HTMLButtonElement>('[role=tab]');
    expect(visible()).toEqual(['Profile panel']);
    expect(profile!.getAttribute('aria-selected')).toBe('true');
    expect(security!.tabIndex).toBe(-1);

    key(profile!, 'ArrowRight');
    await settle();
    expect(visible()).toEqual(['Security panel']);
    expect(document.activeElement).toBe(security);

    profile!.click();
    await flush();
    expect(visible()).toEqual(['Profile panel']);
    expect(change.mock.calls).toEqual([[{ id: 'security' }], [{ id: 'profile' }]]);
  });

  test('driven by the parent with selected', async () => {
    const { container } = await mount(Tabs, { props: { tabs, panels: [text`A`, text`B`], selected: 'security' } });
    expect(container.querySelector('[role=tabpanel]:not([hidden])')!.textContent!.trim()).toBe('B');
  });
});

describe('Disclosure', () => {
  test('collapsed by default, open to open it', async () => {
    const closed = await mount(Disclosure, { props: { summary: 'More', content: text`Detail` } });
    expect(closed.container.querySelector('details')!.open).toBe(false);
    expect(closed.container.querySelector('summary')!.textContent).toBe('More');
    const open = await mount(Disclosure, { props: { summary: 'More', content: text`Detail`, open: true } });
    expect(open.container.querySelector('details')!.open).toBe(true);
  });
});

describe('Tooltip', () => {
  test('links the described element, shows on focus, hides with Escape', async () => {
    const { container } = await mount(Tooltip, { props: { text: 'Deletes permanently', content: text`<button>Delete</button>` } });
    const button = container.querySelector('button')!;
    const tip = container.querySelector('[role=tooltip]')!;
    expect(button.getAttribute('aria-describedby')).toBe(tip.id);
    expect(tip.hasAttribute('hidden')).toBe(true);

    button.dispatchEvent(new FocusEvent('focusin', { bubbles: true }));
    await flush();
    expect(tip.hasAttribute('hidden')).toBe(false);

    key(button, 'Escape');
    await flush();
    expect(tip.hasAttribute('hidden')).toBe(true);
  });
});

describe('Popover', () => {
  test('the button opens, Escape closes and returns focus', async () => {
    const toggle = vi.fn();
    const { container } = await mount(Popover, { props: { label: 'Filters', content: text`<p>Content</p>` }, on: { toggle } });
    const trigger = container.querySelector('button')!;
    const panel = container.querySelector('[role=dialog]')!;

    trigger.click();
    await flush();
    expect(panel.hasAttribute('hidden')).toBe(false);
    expect(trigger.getAttribute('aria-expanded')).toBe('true');

    key(panel, 'Escape');
    await flush();
    expect(panel.hasAttribute('hidden')).toBe(true);
    expect(document.activeElement).toBe(trigger);
    expect(toggle.mock.calls).toEqual([[{ open: true }], [{ open: false }]]);
  });
});

describe('Combobox', () => {
  const countries = [
    { value: 'FR', label: 'France' },
    { value: 'BE', label: 'Belgium' },
    { value: 'CI', label: "Côte d'Ivoire" },
  ];
  const typeIn = (input: HTMLInputElement, value: string) => {
    input.value = value;
    input.dispatchEvent(new Event('input', { bubbles: true }));
  };

  test('static: filters ignoring accents and case, arrows then Enter choose', async () => {
    const select = vi.fn();
    const search = vi.fn();
    const { container } = await mount(Combobox, { props: { label: 'Country', options: countries }, on: { select, search } });
    const input = container.querySelector('input')!;
    const options = () => [...container.querySelectorAll('[role=option]')].map((o) => o.textContent!.trim());

    typeIn(input, 'cote');
    await flush();
    expect(options()).toEqual(["Côte d'Ivoire"]);
    expect(search).toHaveBeenCalledWith({ text: 'cote' });

    key(input, 'ArrowDown');
    await flush();
    expect(input.getAttribute('aria-activedescendant')).toBe(container.querySelector('[role=option]')!.id);

    key(input, 'Enter');
    await flush();
    expect(select).toHaveBeenCalledWith({ value: 'CI', label: "Côte d'Ivoire" });
    expect(input.value).toBe("Côte d'Ivoire");
    expect(input.getAttribute('aria-expanded')).toBe('false');
  });

  test('nothing typed and nothing to offer: focus does not open an empty list', async () => {
    const { container } = await mount(Combobox, { props: { label: 'Book', options: [], filter: false } });
    const input = container.querySelector('input')!;
    input.dispatchEvent(new FocusEvent('focus'));
    await flush();
    expect(container.querySelector('[role=listbox]')!.hasAttribute('hidden')).toBe(true);
    expect(input.getAttribute('aria-expanded')).toBe('false');
  });

  test('from a store: the options pass through as is, while loading and with no results', async () => {
    const { container, setProps } = await mount(Combobox, { props: { label: 'Book', options: [], filter: false, loading: true } });
    const input = container.querySelector('input')!;
    typeIn(input, 'zzz');
    await flush();
    expect(container.querySelector('[role=listbox]')!.textContent!.trim()).toBe('Loading…');

    await setProps({ label: 'Book', options: [{ value: '1', label: 'Dune' }], filter: false, loading: false });
    expect([...container.querySelectorAll('[role=option]')].map((o) => o.textContent!.trim())).toEqual(['Dune']);

    await setProps({ label: 'Book', options: [], filter: false });
    expect(container.querySelector('[role=listbox]')!.textContent!.trim()).toBe('No results');
  });
});
