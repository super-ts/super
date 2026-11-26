import { type Children, createRouter, html, SuperElement } from '@super-ts/dom';
import { fakeStore, flush, mount } from '@super-ts/testing';
import { CommandButton, commandOf, createToasts, ErrorPanel, RouteLink, Toasts } from '@super-ts/ui';
import { describe, expect, test, vi } from 'vitest';
import { AppRouter } from '../../dom/src/__fixtures__/app-router';
import './__fixtures__/ui-contracts';

const text = (strings: TemplateStringsArray, ...values: unknown[]) => html(strings, ...values) as unknown as Children;
const library = (commands = {}) => fakeStore('ui-library', { state: { books: [], total: 0, suggestions: [] }, commands });

describe('CommandButton', () => {
  class Shelf extends SuperElement {
    static tag = 'ui-t-shelf';
    library = this.contract('ui-library');
    render() {
      return html`${CommandButton.create({ command: commandOf(this.library, 'remove', { id: 7 }), content: text`Retirer`, pendingLabel: 'Retrait…' })}`;
    }
  }

  test('envoie sa commande, et reste désactivé tant qu’elle est en cours', async () => {
    let finish = () => {};
    const store = library({ remove: () => new Promise<void>((resolve) => (finish = resolve)) });
    const { container } = await mount(Shelf, { stores: [store] });
    const button = container.querySelector('button')!;

    button.click();
    await flush();
    expect(store.sent).toEqual([{ name: 'remove', args: [{ id: 7 }] }]);
    expect(button.disabled).toBe(true);
    expect(button.getAttribute('aria-busy')).toBe('true');
    expect(button.textContent!.trim()).toBe('Retrait…');

    finish();
    await flush();
    expect(button.disabled).toBe(false);
    expect(button.textContent!.trim()).toBe('Retirer');
  });
});

describe('RouteLink', () => {
  class Nav extends SuperElement {
    static tag = 'ui-t-nav';
    render() {
      return html`${RouteLink.create({ to: { to: 'home' }, content: text`Accueil` })}
      ${RouteLink.create({ to: { to: 'list' }, content: text`Liste`, activeFor: ['item'] })}
      ${RouteLink.create({ to: { to: 'list', query: { sort: 'value' } }, content: text`Par valeur`, exact: true })}
      ${RouteLink.create({ to: { to: 'item', params: { id: 3 } }, content: text`Article 3` })}`;
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

  test('href typé, et aria-current sur le lien de la page affichée', async () => {
    const { container, current } = await start('/list?sort=label');
    expect([...container.querySelectorAll('a')].map((a) => a.getAttribute('href'))).toEqual(['/', '/list', '/list?sort=value', '/items/3']);
    expect(current()).toEqual(['Liste']);
  });

  test('exact compare aussi la query ; activeFor étend le lien à d’autres routes', async () => {
    const { router, current } = await start('/list?sort=value');
    expect(current()).toEqual(['Liste', 'Par valeur']);

    await router.send('visit', '/items/3');
    await flush();
    expect(current()).toEqual(['Liste', 'Article 3']);
  });
});

describe('Toasts', () => {
  test('affiche les messages de la file, chacun avec sa croix ; une erreur est une alerte', async () => {
    const notices = createToasts();
    const { container } = await mount(Toasts, { props: { of: notices } });
    notices.show('Enregistré', { tone: 'success', duration: 10 });
    notices.show('Connexion impossible', { tone: 'error', duration: 0 });
    await flush();

    const toasts = () =>
      [...container.querySelectorAll('.super-toast')].map((t) => [t.getAttribute('role'), t.textContent!.replace('×', '').trim()]);
    expect(toasts()).toEqual([
      ['status', 'Enregistré'],
      ['alert', 'Connexion impossible'],
    ]);

    await new Promise((resolve) => setTimeout(resolve, 20));
    await flush();
    expect(toasts()).toEqual([['alert', 'Connexion impossible']]);

    container.querySelector<HTMLButtonElement>('.super-toast-close')!.click();
    await flush();
    expect(toasts()).toEqual([]);
  });
});

describe('ErrorPanel', () => {
  test('titre, message, détails repliés ; Réessayer sur demande', async () => {
    const retry = vi.fn();
    const { container } = await mount(ErrorPanel, {
      props: { error: new Error('Panne'), path: '/items/1', canRetry: true },
      on: { retry },
    });
    expect(container.querySelector('h2')!.textContent).toBe('Une erreur est survenue');
    expect(container.querySelector('.super-error-panel-message')!.textContent).toBe('Panne');
    expect(container.querySelector('details')!.open).toBe(false);
    expect(container.querySelector('details code')!.textContent).toBe('/items/1');
    container.querySelector('button')!.click();
    expect(retry).toHaveBeenCalledOnce();
  });

  test('sans canRetry, pas de bouton : il convient comme écran « ! » du router', async () => {
    const { container } = await mount(ErrorPanel, { props: { error: new Error('Panne'), path: '/' } });
    expect(container.querySelector('button')).toBeNull();
  });
});
