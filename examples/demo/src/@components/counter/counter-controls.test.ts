import { mount } from '@super-ts/testing';
import { within } from '@testing-library/dom';
import userEvent from '@testing-library/user-event';
import { describe, expect, test, vi } from 'vitest';
import { CounterControls } from './counter-controls';

// Presentational component tested on its own: no store, no adapter.
describe('CounterControls', () => {
  test('displays the value and emits increment / decrement', async () => {
    const increment = vi.fn();
    const decrement = vi.fn();
    const { container } = await mount(CounterControls, {
      props: { count: 4, canDecrement: true, canIncrement: true },
      on: { increment, decrement },
    });
    const ui = within(container);

    await userEvent.click(ui.getByRole('button', { name: 'Increment' }));
    await userEvent.click(ui.getByRole('button', { name: 'Decrement' }));

    expect(ui.getByLabelText('Counter value').textContent).toBe('4');
    expect(increment).toHaveBeenCalledOnce();
    expect(decrement).toHaveBeenCalledOnce();
  });

  test('disables the buttons according to the props', async () => {
    const { container } = await mount(CounterControls, {
      props: { count: 0, canDecrement: false, canIncrement: false },
    });
    const ui = within(container);

    expect(ui.getByRole('button', { name: 'Decrement' }).hasAttribute('disabled')).toBe(true);
    expect(ui.getByRole('button', { name: 'Increment' }).hasAttribute('disabled')).toBe(true);
  });
});
