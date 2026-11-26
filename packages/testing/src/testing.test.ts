import { type Commands, SuperStore } from '@super-ts/core';
import { html, SuperElement } from '@super-ts/dom';
import { fakeStore, flush, mount, record } from '@super-ts/testing';
import { describe, expect, test } from 'vitest';
import '../../core/src/__fixtures__/basket.ts';
import './__fixtures__/tst-inbox.ts';
import type { TstInboxContract } from './__fixtures__/tst-inbox.ts';

class InboxStore extends SuperStore<TstInboxContract> implements Commands<InboxStore> {
  constructor() {
    super({ contract: 'tst-inbox', initialState: { unread: 3 } });
  }
  async markAllRead() {
    const marked = this.get().unread;
    this.set({ unread: 0 });
    this.emit('cleared', { marked });
  }
  async archive(_input: { id: string }) {}
}

test('record captures the payloads of an event', async () => {
  const store = InboxStore.create();
  const cleared = record(store, 'cleared');

  await store.send('markAllRead');

  expect(cleared.calls).toEqual([{ marked: 3 }]);
  expect(cleared.last).toEqual({ marked: 3 });
});

test('fakeStore records commands, runs the supplied handlers and drives the state', async () => {
  const inbox = fakeStore('tst-inbox', { state: { unread: 2 }, commands: { markAllRead: async () => {} } });
  class Badge extends SuperElement {
    static tag = 't-badge';
    inbox = this.contract('tst-inbox');
    unread = this.selector(this.inbox.selectors.unread);
    render() {
      return html`<button @click=${() => this.inbox.send('markAllRead')}>${this.unread.value}</button>`;
    }
  }

  const { container } = await mount(Badge, { stores: [inbox] });
  container.querySelector('button')!.click();
  await expect(inbox.send('archive', { id: 'x' })).resolves.toBeUndefined();

  expect(inbox.sent).toEqual([
    { name: 'markAllRead', args: [] },
    { name: 'archive', args: [{ id: 'x' }] },
  ]);

  inbox.setState({ unread: 0 });
  await flush();
  expect(container.textContent).toBe('0');
});

test('fakeStore.emit broadcasts an event of the contract', () => {
  const inbox = fakeStore('tst-inbox', { state: { unread: 0 } });
  const cleared = record(inbox, 'cleared');

  inbox.emit('cleared', { marked: 1 });

  expect(cleared.calls).toEqual([{ marked: 1 }]);
});

test('fakeStore: a command not supplied publishes no outcome, the test emits it itself', async () => {
  const inbox = fakeStore('tst-inbox', { state: { unread: 2 } });
  const done = record(inbox, 'archive:done');

  await inbox.send('archive', { id: 'x' });
  expect(done.calls).toEqual([]);

  inbox.emit('archive:done', { input: { id: 'x' }, result: undefined });
  expect(done.calls).toEqual([{ input: { id: 'x' }, result: undefined }]);
});

describe('fakeStore for a class contract', () => {
  test('is referred to by the contract name, reads its selectors, records commands', async () => {
    class Count extends SuperElement {
      static tag = 'tt-count';
      basket = this.contract('basket');
      count = this.selector(this.basket.selectors.count);
      render() {
        return html`<p>${this.count.value}</p><button @click=${() => this.basket.send('add', { sku: 'mug' })}>+</button>`;
      }
    }
    const basket = fakeStore('basket', { state: { items: { mug: 2 } } });
    expect(basket.selectors.count()).toBe(2);

    const { container } = await mount(Count, { stores: [basket] });
    expect(container.textContent).toContain('2');
    container.querySelector('button')!.click();
    expect(basket.sent).toEqual([{ name: 'add', args: [{ sku: 'mug' }] }]);

    basket.setState({ items: { mug: 5 } });
    await flush();
    expect(container.textContent).toContain('5');
  });
});
