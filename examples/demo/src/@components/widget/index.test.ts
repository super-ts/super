import { flush, mount } from '@super-ts/testing';
import { within } from '@testing-library/dom';
import userEvent from '@testing-library/user-event';
import { describe, expect, test, vi } from 'vitest';
import { WidgetScreen } from '.';

describe('WidgetScreen', () => {
  test('ouvre le minuteur dans sa propre application, le fait tourner au clavier, puis le libère', async () => {
    const { container } = await mount(WidgetScreen); // aucun store fourni : le widget a le sien
    const ui = within(container);

    // Minuteries simulées avant l'ouverture : l'intervalle du widget est créé à son montage.
    vi.useFakeTimers();
    try {
      ui.getByRole('button', { name: 'Ouvrir le minuteur' }).click();
      await vi.advanceTimersByTimeAsync(0);
      expect(ui.getByLabelText('Temps écoulé').textContent).toBe('00:00');

      window.dispatchEvent(new KeyboardEvent('keydown', { code: 'Space' })); // le raccourci démarre le minuteur
      await vi.advanceTimersByTimeAsync(3000);
      expect(ui.getByLabelText('Temps écoulé').textContent).toBe('00:03');
    } finally {
      vi.useRealTimers();
    }

    await userEvent.click(ui.getByRole('button', { name: 'Fermer le minuteur' }));
    await flush();
    expect(ui.queryByLabelText('Temps écoulé')).toBeNull();
    expect(container.querySelector('.widget-slot')!.childElementCount).toBe(0);
  });
});
