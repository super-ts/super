import { type Children, html } from '@super-ts/dom';
import { flush, mount } from '@super-ts/testing';
import { ConfirmDialog, Dialog, Modal } from '@super-ts/ui';
import { describe, expect, test, vi } from 'vitest';

/** Des enfants écrits en lit, comme les produirait un `.super`. */
const children = (strings: TemplateStringsArray, ...values: unknown[]) => html(strings, ...values) as unknown as Children;

const key = (target: Element, name: string) =>
  target.dispatchEvent(new KeyboardEvent('keydown', { key: name, bubbles: true, cancelable: true }));

describe('Dialog', () => {
  test('monté, il est ouvert en modal, avec son titre, son contenu et ses actions', async () => {
    const { container } = await mount(Dialog, {
      props: { title: 'Renommer', content: children`<p>Contenu</p>`, actions: children`<button>OK</button>` },
    });
    const dialog = container.querySelector('dialog')!;
    expect(dialog.open).toBe(true);
    expect(dialog.contains(document.activeElement)).toBe(true); // le focus entre dans la fenêtre
    expect(dialog.getAttribute('aria-labelledby')).toBe(container.querySelector('h2')!.id);
    expect(container.querySelector('h2')!.textContent).toBe('Renommer');
    expect(container.querySelector('.super-window-body')!.textContent).toBe('Contenu');
    expect(container.querySelector('.super-window-actions')!.textContent!.trim()).toBe('OK');
  });

  test('par défaut, Échap et la croix demandent la fermeture, pas le fond', async () => {
    const close = vi.fn();
    const { container } = await mount(Dialog, { props: { title: 'T', content: children`x` }, on: { close } });
    const dialog = container.querySelector('dialog')!;

    key(dialog, 'Escape');
    container.querySelector<HTMLButtonElement>('.super-window-close')!.click();
    dialog.dispatchEvent(new MouseEvent('click', { bubbles: true }));

    expect(close.mock.calls).toEqual([[{ reason: 'escape' }], [{ reason: 'button' }]]);
  });

  test('closeOn règle chaque moyen de fermer', async () => {
    const close = vi.fn();
    const { container } = await mount(Modal, {
      props: { title: 'T', content: children`x`, closeOn: { escape: false, backdrop: true, button: false } },
      on: { close },
    });
    const dialog = container.querySelector('dialog')!;

    key(dialog, 'Escape');
    dialog.dispatchEvent(new MouseEvent('click', { bubbles: true }));

    expect(container.querySelector('.super-window-close')).toBeNull();
    expect(close.mock.calls).toEqual([[{ reason: 'backdrop' }]]);
  });

  test('démonté, il se ferme et rend le focus', async () => {
    const opener = document.createElement('button');
    document.body.append(opener);
    opener.focus();
    const { container, unmount } = await mount(Modal, { props: { title: 'T', content: children`x` } });
    const dialog = container.querySelector('dialog')!;

    unmount();
    await flush();

    expect(dialog.open).toBe(false);
    expect(document.activeElement).toBe(opener);
    opener.remove();
  });

  test('la classe donnée par l’app s’ajoute à la fenêtre', async () => {
    const { container } = await mount(Modal, { props: { title: 'T', content: children`x`, class: 'wide' } });
    expect(container.querySelector('dialog')!.className).toBe('super-window super-modal wide');
  });
});

describe('ConfirmDialog', () => {
  test('répond oui ou non ; Échap vaut non', async () => {
    const answered = vi.fn();
    const { container } = await mount(ConfirmDialog, { props: { question: 'Vider le panier ?', danger: true }, on: { answered } });
    const [cancel, confirm] = container.querySelectorAll<HTMLButtonElement>('.super-window-actions button');

    expect(container.querySelector('h2')!.textContent).toBe('Confirmation');
    expect(confirm!.dataset.variant).toBe('danger');
    confirm!.click();
    cancel!.click();
    key(container.querySelector('dialog')!, 'Escape');

    expect(answered.mock.calls).toEqual([[{ confirmed: true }], [{ confirmed: false }], [{ confirmed: false }]]);
  });
});
