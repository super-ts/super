import { type Children, html } from '@super-ts/dom';
import { flush, mount } from '@super-ts/testing';
import { Combobox, Disclosure, Menu, Popover, Tabs, Tooltip } from '@super-ts/ui';
import { describe, expect, test, vi } from 'vitest';

const text = (strings: TemplateStringsArray, ...values: unknown[]) => html(strings, ...values) as unknown as Children;
const key = (target: Element, name: string) =>
  target.dispatchEvent(new KeyboardEvent('keydown', { key: name, bubbles: true, cancelable: true }));
/** Laisse passer le rendu, puis le déplacement du focus qui le suit. */
const settle = async () => {
  await flush();
  await flush();
};

describe('Menu', () => {
  const items = [
    { id: 'rename', label: 'Renommer' },
    { id: 'archive', label: 'Archiver', disabled: true },
    { id: 'delete', label: 'Supprimer' },
  ];

  test('le bouton ouvre le menu au clavier, les flèches sautent les entrées désactivées, Entrée choisit', async () => {
    const select = vi.fn();
    const { container } = await mount(Menu, { props: { label: 'Actions', items }, on: { select } });
    const trigger = container.querySelector('button')!;
    const list = container.querySelector('[role=menu]')!;
    expect(list.hasAttribute('hidden')).toBe(true);

    key(trigger, 'ArrowDown');
    await settle();
    expect(trigger.getAttribute('aria-expanded')).toBe('true');
    expect(document.activeElement!.textContent!.trim()).toBe('Renommer');

    key(list, 'ArrowDown');
    await settle();
    expect(document.activeElement!.textContent!.trim()).toBe('Supprimer');

    key(list, 'Enter');
    await settle();
    expect(select).toHaveBeenCalledWith({ id: 'delete' });
    expect(list.hasAttribute('hidden')).toBe(true);
    expect(document.activeElement).toBe(trigger);
  });

  test('Échap et un clic hors du menu le ferment', async () => {
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
    { id: 'profile', label: 'Profil' },
    { id: 'security', label: 'Sécurité' },
  ];

  test('un panneau visible à la fois ; clic et flèches changent d’onglet', async () => {
    const change = vi.fn();
    const { container } = await mount(Tabs, {
      props: { tabs, panels: [text`Panneau profil`, text`Panneau sécurité`], label: 'Compte' },
      on: { change },
    });
    const visible = () => [...container.querySelectorAll('[role=tabpanel]:not([hidden])')].map((p) => p.textContent!.trim());
    const [profile, security] = container.querySelectorAll<HTMLButtonElement>('[role=tab]');
    expect(visible()).toEqual(['Panneau profil']);
    expect(profile!.getAttribute('aria-selected')).toBe('true');
    expect(security!.tabIndex).toBe(-1);

    key(profile!, 'ArrowRight');
    await settle();
    expect(visible()).toEqual(['Panneau sécurité']);
    expect(document.activeElement).toBe(security);

    profile!.click();
    await flush();
    expect(visible()).toEqual(['Panneau profil']);
    expect(change.mock.calls).toEqual([[{ id: 'security' }], [{ id: 'profile' }]]);
  });

  test('piloté par le parent avec selected', async () => {
    const { container } = await mount(Tabs, { props: { tabs, panels: [text`A`, text`B`], selected: 'security' } });
    expect(container.querySelector('[role=tabpanel]:not([hidden])')!.textContent!.trim()).toBe('B');
  });
});

describe('Disclosure', () => {
  test('replié par défaut, open pour l’ouvrir', async () => {
    const closed = await mount(Disclosure, { props: { summary: 'Plus', content: text`Détail` } });
    expect(closed.container.querySelector('details')!.open).toBe(false);
    expect(closed.container.querySelector('summary')!.textContent).toBe('Plus');
    const open = await mount(Disclosure, { props: { summary: 'Plus', content: text`Détail`, open: true } });
    expect(open.container.querySelector('details')!.open).toBe(true);
  });
});

describe('Tooltip', () => {
  test('relie l’élément décrit, s’affiche au focus, se masque avec Échap', async () => {
    const { container } = await mount(Tooltip, { props: { text: 'Supprime définitivement', content: text`<button>Supprimer</button>` } });
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
  test('le bouton ouvre, Échap ferme et rend le focus', async () => {
    const toggle = vi.fn();
    const { container } = await mount(Popover, { props: { label: 'Filtres', content: text`<p>Contenu</p>` }, on: { toggle } });
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
    { value: 'BE', label: 'Belgique' },
    { value: 'EC', label: 'Équateur' },
  ];
  const typeIn = (input: HTMLInputElement, value: string) => {
    input.value = value;
    input.dispatchEvent(new Event('input', { bubbles: true }));
  };

  test('statique : filtre sans accents ni casse, flèches puis Entrée choisissent', async () => {
    const select = vi.fn();
    const search = vi.fn();
    const { container } = await mount(Combobox, { props: { label: 'Pays', options: countries }, on: { select, search } });
    const input = container.querySelector('input')!;
    const options = () => [...container.querySelectorAll('[role=option]')].map((o) => o.textContent!.trim());

    typeIn(input, 'equa');
    await flush();
    expect(options()).toEqual(['Équateur']);
    expect(search).toHaveBeenCalledWith({ text: 'equa' });

    key(input, 'ArrowDown');
    await flush();
    expect(input.getAttribute('aria-activedescendant')).toBe(container.querySelector('[role=option]')!.id);

    key(input, 'Enter');
    await flush();
    expect(select).toHaveBeenCalledWith({ value: 'EC', label: 'Équateur' });
    expect(input.value).toBe('Équateur');
    expect(input.getAttribute('aria-expanded')).toBe('false');
  });

  test('rien de tapé et rien à proposer : le focus n’ouvre pas une liste vide', async () => {
    const { container } = await mount(Combobox, { props: { label: 'Livre', options: [], filter: false } });
    const input = container.querySelector('input')!;
    input.dispatchEvent(new FocusEvent('focus'));
    await flush();
    expect(container.querySelector('[role=listbox]')!.hasAttribute('hidden')).toBe(true);
    expect(input.getAttribute('aria-expanded')).toBe('false');
  });

  test('venu d’un store : les options passent telles quelles, pendant le chargement et sans résultat', async () => {
    const { container, setProps } = await mount(Combobox, { props: { label: 'Livre', options: [], filter: false, loading: true } });
    const input = container.querySelector('input')!;
    typeIn(input, 'zzz');
    await flush();
    expect(container.querySelector('[role=listbox]')!.textContent!.trim()).toBe('Chargement…');

    await setProps({ label: 'Livre', options: [{ value: '1', label: 'Dune' }], filter: false, loading: false });
    expect([...container.querySelectorAll('[role=option]')].map((o) => o.textContent!.trim())).toEqual(['Dune']);

    await setProps({ label: 'Livre', options: [], filter: false });
    expect(container.querySelector('[role=listbox]')!.textContent!.trim()).toBe('Aucun résultat');
  });
});
