import { mount } from '@super-ts/testing';
import { within } from '@testing-library/dom';
import userEvent from '@testing-library/user-event';
import { describe, expect, test, vi } from 'vitest';
import { CounterControls } from './counter-controls';

// Composant de présentation testé seul : ni store, ni adapter.
describe('CounterControls', () => {
  test('affiche la valeur et émet increment / decrement', async () => {
    const increment = vi.fn();
    const decrement = vi.fn();
    const { container } = await mount(CounterControls, {
      props: { count: 4, canDecrement: true, canIncrement: true },
      on: { increment, decrement },
    });
    const ui = within(container);

    await userEvent.click(ui.getByRole('button', { name: 'Incrémenter' }));
    await userEvent.click(ui.getByRole('button', { name: 'Décrémenter' }));

    expect(ui.getByLabelText('Valeur du compteur').textContent).toBe('4');
    expect(increment).toHaveBeenCalledOnce();
    expect(decrement).toHaveBeenCalledOnce();
  });

  test('désactive les boutons selon les props', async () => {
    const { container } = await mount(CounterControls, {
      props: { count: 0, canDecrement: false, canIncrement: false },
    });
    const ui = within(container);

    expect(ui.getByRole('button', { name: 'Décrémenter' }).hasAttribute('disabled')).toBe(true);
    expect(ui.getByRole('button', { name: 'Incrémenter' }).hasAttribute('disabled')).toBe(true);
  });
});
