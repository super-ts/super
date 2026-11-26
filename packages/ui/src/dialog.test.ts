import { type Children, html } from '@super-ts/dom';
import { flush, mount } from '@super-ts/testing';
import { ConfirmDialog, Dialog, Modal } from '@super-ts/ui';
import { describe, expect, test, vi } from 'vitest';

/** Children written in lit, as a `.super` file would produce them. */
const children = (strings: TemplateStringsArray, ...values: unknown[]) => html(strings, ...values) as unknown as Children;

const key = (target: Element, name: string) =>
  target.dispatchEvent(new KeyboardEvent('keydown', { key: name, bubbles: true, cancelable: true }));

describe('Dialog', () => {
  test('once mounted, it is open as modal, with its title, its content and its actions', async () => {
    const { container } = await mount(Dialog, {
      props: { title: 'Rename', content: children`<p>Content</p>`, actions: children`<button>OK</button>` },
    });
    const dialog = container.querySelector('dialog')!;
    expect(dialog.open).toBe(true);
    expect(dialog.contains(document.activeElement)).toBe(true); // focus enters the dialog
    expect(dialog.getAttribute('aria-labelledby')).toBe(container.querySelector('h2')!.id);
    expect(container.querySelector('h2')!.textContent).toBe('Rename');
    expect(container.querySelector('.super-window-body')!.textContent).toBe('Content');
    expect(container.querySelector('.super-window-actions')!.textContent!.trim()).toBe('OK');
  });

  test('by default, Escape and the close button request closing, not the backdrop', async () => {
    const close = vi.fn();
    const { container } = await mount(Dialog, { props: { title: 'T', content: children`x` }, on: { close } });
    const dialog = container.querySelector('dialog')!;

    key(dialog, 'Escape');
    container.querySelector<HTMLButtonElement>('.super-window-close')!.click();
    dialog.dispatchEvent(new MouseEvent('click', { bubbles: true }));

    expect(close.mock.calls).toEqual([[{ reason: 'escape' }], [{ reason: 'button' }]]);
  });

  test('closeOn configures each way to close', async () => {
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

  test('once unmounted, it closes and returns focus', async () => {
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

  test('the class given by the app is added to the dialog', async () => {
    const { container } = await mount(Modal, { props: { title: 'T', content: children`x`, class: 'wide' } });
    expect(container.querySelector('dialog')!.className).toBe('super-window super-modal wide');
  });
});

describe('ConfirmDialog', () => {
  test('answers yes or no; Escape means no', async () => {
    const answered = vi.fn();
    const { container } = await mount(ConfirmDialog, { props: { question: 'Empty the basket?', danger: true }, on: { answered } });
    const [cancel, confirm] = container.querySelectorAll<HTMLButtonElement>('.super-window-actions button');

    expect(container.querySelector('h2')!.textContent).toBe('Confirmation');
    expect(confirm!.dataset.variant).toBe('danger');
    confirm!.click();
    cancel!.click();
    key(container.querySelector('dialog')!, 'Escape');

    expect(answered.mock.calls).toEqual([[{ confirmed: true }], [{ confirmed: false }], [{ confirmed: false }]]);
  });
});
