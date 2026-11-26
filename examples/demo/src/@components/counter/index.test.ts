import { createRouter } from '@super-ts/dom';
import { type FakeCommands, fakeStore, flush, mount } from '@super-ts/testing';
import type { CounterState } from '@core/counter/contract';
import { within } from '@testing-library/dom';
import userEvent from '@testing-library/user-event';
import { describe, expect, test } from 'vitest';
import { Router } from '../../routes';
import { CounterScreen } from '.';

// Écran testé seul, avec un faux store qui respecte le contrat.
const idle: CounterState = { counts: { cafes: 2 }, loadErrorMessage: null };

type CounterCommands = FakeCommands<'counter'>;

async function setup(id: string, commands: CounterCommands = {}) {
  const counter = fakeStore('counter', { state: idle, commands });
  // L'écran contient des liens : il lui faut un router (ici en mémoire).
  const router = createRouter(Router, { mode: 'memory', initialPath: `/counters/${id}` });
  const { container } = await mount(CounterScreen, { stores: [counter], router });
  return { counter, router, ui: within(container) };
}

describe('CounterScreen', () => {
  test('affiche le compteur demandé par le paramètre de route', async () => {
    const { ui } = await setup('cafes');

    expect(ui.getByRole('heading').textContent).toBe('Cafés');
    expect(ui.getByLabelText('Valeur du compteur').textContent).toBe('2');
  });

  test('envoie les commandes avec l’id du compteur', async () => {
    const { counter, ui } = await setup('cafes');

    await userEvent.click(ui.getByRole('button', { name: 'Incrémenter' }));

    expect(counter.sent).toEqual([{ name: 'increment', args: [{ id: 'cafes' }] }]);
  });

  test('affiche le message de la raison d’échec, pour son compteur seulement', async () => {
    const { counter, ui } = await setup('cafes');

    counter.emit('decrement:failed', { input: { id: 'pompes' }, reason: 'storage', error: null });
    counter.emit('decrement:failed', { input: { id: 'cafes' }, reason: 'below-min', error: null });
    await flush();

    expect(ui.getByText('Le compteur est déjà à zéro.')).toBeTruthy();
    expect(ui.queryByText('Impossible d’enregistrer : le stockage est indisponible.')).toBeNull();
  });

  test('ne réagit qu’aux écritures réussies de son compteur', async () => {
    const { counter, ui } = await setup('cafes');

    counter.emit('increment:done', { input: { id: 'pompes' }, result: { count: 9 } });
    counter.emit('increment:done', { input: { id: 'cafes' }, result: { count: 10 } });
    await flush();

    expect(ui.getByText('Incrémenté : 10')).toBeTruthy();
    expect(ui.queryByText('Incrémenté : 9')).toBeNull();
  });

  test('un id hors catalogue affiche « Compteur introuvable »', async () => {
    const { ui } = await setup('inconnu');

    expect(ui.getByRole('heading').textContent).toBe('Compteur introuvable');
  });

  test('le lien retour pointe vers la liste des compteurs et navigue via le router', async () => {
    const { router, ui } = await setup('cafes');
    const back = ui.getByRole('link', { name: '← Tous les compteurs' });

    expect(back.getAttribute('href')).toBe('/counters');
    await userEvent.click(back);

    expect(router.state().name).toBe('counters');
  });
});
