import { createRouter } from '@super-ts/dom';
import { type FakeCommands, fakeStore, flush, mount } from '@super-ts/testing';
import type { CounterState } from '@core/counter/contract';
import { within } from '@testing-library/dom';
import userEvent from '@testing-library/user-event';
import { describe, expect, test } from 'vitest';
import { Router } from '../../routes';
import { CounterScreen } from '.';

// Screen tested on its own, with a fake store that honours the contract.
const idle: CounterState = { counts: { coffees: 2 }, loadErrorMessage: null };

type CounterCommands = FakeCommands<'counter'>;

async function setup(id: string, commands: CounterCommands = {}) {
  const counter = fakeStore('counter', { state: idle, commands });
  // The screen contains links: it needs a router (here in memory).
  const router = createRouter(Router, { mode: 'memory', initialPath: `/counters/${id}` });
  const { container } = await mount(CounterScreen, { stores: [counter], router });
  return { counter, router, ui: within(container) };
}

describe('CounterScreen', () => {
  test('displays the counter requested by the route parameter', async () => {
    const { ui } = await setup('coffees');

    expect(ui.getByRole('heading').textContent).toBe('Coffees');
    expect(ui.getByLabelText('Counter value').textContent).toBe('2');
  });

  test('sends the commands with the counter id', async () => {
    const { counter, ui } = await setup('coffees');

    await userEvent.click(ui.getByRole('button', { name: 'Increment' }));

    expect(counter.sent).toEqual([{ name: 'increment', args: [{ id: 'coffees' }] }]);
  });

  test('displays the failure reason message, for its own counter only', async () => {
    const { counter, ui } = await setup('coffees');

    counter.emit('decrement:failed', { input: { id: 'pushups' }, reason: 'storage', error: null });
    counter.emit('decrement:failed', { input: { id: 'coffees' }, reason: 'below-min', error: null });
    await flush();

    expect(ui.getByText('The counter is already at zero.')).toBeTruthy();
    expect(ui.queryByText('Could not save: storage is unavailable.')).toBeNull();
  });

  test('reacts only to successful writes of its own counter', async () => {
    const { counter, ui } = await setup('coffees');

    counter.emit('increment:done', { input: { id: 'pushups' }, result: { count: 9 } });
    counter.emit('increment:done', { input: { id: 'coffees' }, result: { count: 10 } });
    await flush();

    expect(ui.getByText('Incremented: 10')).toBeTruthy();
    expect(ui.queryByText('Incremented: 9')).toBeNull();
  });

  test('an id outside the catalogue shows "Counter not found"', async () => {
    const { ui } = await setup('unknown-id');

    expect(ui.getByRole('heading').textContent).toBe('Counter not found');
  });

  test('the back link points to the counter list and navigates through the router', async () => {
    const { router, ui } = await setup('coffees');
    const back = ui.getByRole('link', { name: '← All counters' });

    expect(back.getAttribute('href')).toBe('/counters');
    await userEvent.click(back);

    expect(router.state().name).toBe('counters');
  });
});
