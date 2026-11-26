import { flush, mount } from '@super-ts/testing';
import { within } from '@testing-library/dom';
import userEvent from '@testing-library/user-event';
import { describe, expect, test } from 'vitest';
import { CompositionScreen } from '.';

async function setup() {
  const { container } = await mount(CompositionScreen);
  return { ui: within(container) };
}

describe('CompositionScreen', () => {
  test('a card displays the children written between its tags', async () => {
    const { ui } = await setup();
    const card = within(ui.getByRole('region', { name: 'Children' }));
    expect(card.getByText(/fills its/)).toBeTruthy();
  });

  test('a <:actions> slot: the button belongs to the parent, and changes its state', async () => {
    const { ui } = await setup();
    const card = within(ui.getByRole('region', { name: 'A <:actions> slot' }));
    await userEvent.click(card.getByRole('button', { name: 'Like' }));
    await flush();
    expect(card.getByText('Likes: 1')).toBeTruthy();
  });

  test('a #actions(note) method fills the slot of each card in the loop', async () => {
    const { ui } = await setup();
    const coffee = within(ui.getByRole('region', { name: 'Buy coffee' }));
    await userEvent.click(coffee.getByRole('button', { name: 'Pin' }));
    await flush();
    const pinned = within(ui.getByRole('region', { name: '📌 Buy coffee' }));
    expect(pinned.getByRole('button', { name: 'Unpin' })).toBeTruthy();

    await userEvent.click(pinned.getByRole('button', { name: 'Delete' }));
    await flush();
    expect(ui.queryByRole('region', { name: /Buy coffee/ })).toBeNull();
    expect(ui.getByRole('region', { name: '📌 Reread the .super docs' })).toBeTruthy();
  });

  test('tabs: a list of slots filled by methods', async () => {
    const { ui } = await setup();
    expect(ui.getByRole('tabpanel', { name: 'Children' }).textContent).toContain('content');
    await userEvent.click(ui.getByRole('tab', { name: 'Slots' }));
    await flush();
    expect(ui.getByRole('tabpanel', { name: 'Slots' }).textContent).toContain('<:name>');
  });
});
