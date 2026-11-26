import { createRouter, RouterOutlet } from '@super-ts/dom';
import { fakeStore, flush, mount } from '@super-ts/testing';
import type { CounterState } from '@core/counter/contract';
import { within } from '@testing-library/dom';
import userEvent from '@testing-library/user-event';
import { describe, expect, test } from 'vitest';
import { Router } from '../../routes';

const idle: CounterState = { counts: { coffees: 2, pushups: 0, books: 1 }, loadErrorMessage: null };

async function setup(initialPath: string) {
  const counter = fakeStore('counter', { state: idle });
  const router = createRouter(Router, { mode: 'memory', initialPath });
  const { container } = await mount(RouterOutlet, { stores: [counter], router });
  const labels = () => [...container.querySelectorAll('.counter-list li')].map((li) => li.textContent!.trim().split(/\s/)[0]);
  return { router, container, labels, ui: within(container) };
}

describe('CounterListScreen', () => {
  test('shows the counters in the original order, or by name with ?sort=label', async () => {
    expect((await setup('/counters')).labels()).toEqual(['Coffees', 'Push-ups', 'Books']);
    expect((await setup('/counters?sort=label')).labels()).toEqual(['Books', 'Coffees', 'Push-ups']);
  });

  test('changing the sort updates the URL without remounting the screen', async () => {
    const { router, container, labels, ui } = await setup('/counters');
    const screen = container.querySelector('counter-list-screen');

    await userEvent.click(ui.getByRole('link', { name: 'By name' }));
    await flush();

    expect(router.state().path).toBe('/counters?sort=label');
    expect(labels()).toEqual(['Books', 'Coffees', 'Push-ups']);
    expect(ui.getByRole('link', { name: 'By name' }).getAttribute('aria-current')).toBe('page');
    expect(container.querySelector('counter-list-screen')).toBe(screen);
  });
});
