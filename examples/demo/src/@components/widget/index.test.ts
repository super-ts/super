import { flush, mount } from '@super-ts/testing';
import { within } from '@testing-library/dom';
import userEvent from '@testing-library/user-event';
import { describe, expect, test, vi } from 'vitest';
import { WidgetScreen } from '.';

describe('WidgetScreen', () => {
  test('opens the timer in its own application, runs it from the keyboard, then releases it', async () => {
    const { container } = await mount(WidgetScreen); // no store provided: the widget has its own
    const ui = within(container);

    // Fake timers before opening: the widget's interval is created on mount.
    vi.useFakeTimers();
    try {
      ui.getByRole('button', { name: 'Open the timer' }).click();
      await vi.advanceTimersByTimeAsync(0);
      expect(ui.getByLabelText('Elapsed time').textContent).toBe('00:00');

      window.dispatchEvent(new KeyboardEvent('keydown', { code: 'Space' })); // the shortcut starts the timer
      await vi.advanceTimersByTimeAsync(3000);
      expect(ui.getByLabelText('Elapsed time').textContent).toBe('00:03');
    } finally {
      vi.useRealTimers();
    }

    await userEvent.click(ui.getByRole('button', { name: 'Close the timer' }));
    await flush();
    expect(ui.queryByLabelText('Elapsed time')).toBeNull();
    expect(container.querySelector('.widget-slot')!.childElementCount).toBe(0);
  });
});
