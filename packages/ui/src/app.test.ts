import { type Children, createRouter, html, SuperElement } from '@super-ts/dom';
import { fakeStore, flush, mount } from '@super-ts/testing';
import { CommandButton, commandOf, createToasts, ErrorPanel, RouteLink, Toasts } from '@super-ts/ui';
import { describe, expect, test, vi } from 'vitest';
import { AppRouter } from '../../dom/src/__fixtures__/app-router.ts';
import './__fixtures__/ui-contracts.ts';

const text = (strings: TemplateStringsArray, ...values: unknown[]) => html(strings, ...values) as unknown as Children;
const library = (commands = {}) => fakeStore('ui-library', { state: { books: [], total: 0, suggestions: [] }, commands });

describe('CommandButton', () => {
  class Shelf extends SuperElement {
    static tag = 'ui-t-shelf';
    library = this.contract('ui-library');
    render() {
      return html`${CommandButton.create({ command: commandOf(this.library, 'remove', { id: 7 }), content: text`Remove`, pendingLabel: 'Removing…' })}`;
    }
  }

  test('sends its command, and stays disabled while it is pending', async () => {
    let finish = () => {};
    const store = library({ remove: () => new Promise<void>((resolve) => (finish = resolve)) });
    const { container } = await mount(Shelf, { stores: [store] });
    const button = container.querySelector('button')!;

    button.click();
    await flush();
    expect(store.sent).toEqual([{ name: 'remove', args: [{ id: 7 }] }]);
    expect(button.disabled).toBe(true);
    expect(button.getAttribute('aria-busy')).toBe('true');
    expect(button.textContent!.trim()).toBe('Removing…');

    finish();
    await flush();
    expect(button.disabled).toBe(false);
    expect(button.textContent!.trim()).toBe('Remove');
  });
});

describe('RouteLink', () => {
  class Nav extends SuperElement {
    static tag = 'ui-t-nav';
    render() {
      return html`${RouteLink.create({ to: { to: 'home' }, content: text`Home` })}
      ${RouteLink.create({ to: { to: 'list' }, content: text`List`, activeFor: ['item'] })}
      ${RouteLink.create({ to: { to: 'list', query: { sort: 'value' } }, content: text`By value`, exact: true })}
      ${RouteLink.create({ to: { to: 'item', params: { id: 3 } }, content: text`Item 3` })}`;
    }
  }
  const start = async (path: string) => {
    const router = createRouter(
      AppRouter.screens(() => ({ home: Screen, item: Screen, list: Screen, page: Screen })),
      {
        mode: 'memory',
        initialPath: path,
      },
    );
    const { container } = await mount(Nav, { router });
    const current = () => [...container.querySelectorAll('a[aria-current="page"]')].map((a) => a.textContent);
    return { router, container, current };
  };
  class Screen extends SuperElement {
    static tag = 'ui-t-screen';
    render() {
      return null;
    }
  }

  test('typed href, and aria-current on the link of the displayed page', async () => {
    const { container, current } = await start('/list?sort=label');
    expect([...container.querySelectorAll('a')].map((a) => a.getAttribute('href'))).toEqual(['/', '/list', '/list?sort=value', '/items/3']);
    expect(current()).toEqual(['List']);
  });

  test('exact also compares the query; activeFor extends the link to other routes', async () => {
    const { router, current } = await start('/list?sort=value');
    expect(current()).toEqual(['List', 'By value']);

    await router.send('visit', '/items/3');
    await flush();
    expect(current()).toEqual(['List', 'Item 3']);
  });
});

describe('Toasts', () => {
  test('displays the messages of the queue, each with its close button; an error is an alert', async () => {
    const notices = createToasts();
    const { container } = await mount(Toasts, { props: { of: notices } });
    notices.show('Saved', { tone: 'success', duration: 10 });
    notices.show('Cannot connect', { tone: 'error', duration: 0 });
    await flush();

    const toasts = () =>
      [...container.querySelectorAll('.super-toast')].map((t) => [t.getAttribute('role'), t.textContent!.replace('×', '').trim()]);
    expect(toasts()).toEqual([
      ['status', 'Saved'],
      ['alert', 'Cannot connect'],
    ]);

    await new Promise((resolve) => setTimeout(resolve, 20));
    await flush();
    expect(toasts()).toEqual([['alert', 'Cannot connect']]);

    container.querySelector<HTMLButtonElement>('.super-toast-close')!.click();
    await flush();
    expect(toasts()).toEqual([]);
  });
});

describe('ErrorPanel', () => {
  test('title, message, collapsed details; Retry on request', async () => {
    const retry = vi.fn();
    const { container } = await mount(ErrorPanel, {
      props: { error: new Error('Outage'), path: '/items/1', canRetry: true },
      on: { retry },
    });
    expect(container.querySelector('h2')!.textContent).toBe('Something went wrong');
    expect(container.querySelector('.super-error-panel-message')!.textContent).toBe('Outage');
    expect(container.querySelector('details')!.open).toBe(false);
    expect(container.querySelector('details code')!.textContent).toBe('/items/1');
    container.querySelector('button')!.click();
    expect(retry).toHaveBeenCalledOnce();
  });

  test('without canRetry, no button: it works as the "!" screen of the router', async () => {
    const { container } = await mount(ErrorPanel, { props: { error: new Error('Outage'), path: '/' } });
    expect(container.querySelector('button')).toBeNull();
  });
});
