import { type Commands, SuperStore } from '@super-ts/core';
import { html, repeat, SuperElement } from '@super-ts/dom';
import { fakeStore, flush, mount } from '@super-ts/testing';
import { describe, expect, test, vi } from 'vitest';
import type { FormAccountContract, FormCrashyContract } from './__fixtures__/form-contracts';
import './__fixtures__/form-contracts';

/** Ce que le test pilote : commandes reçues, réponse à la soumission en cours, réponses aux vérifications. */
type Probe = {
  sent: Array<{ command: string; input: unknown }>;
  next: { resolve: (r: { id: string }) => void; reject: (reason: 'email-taken' | 'network') => void } | null;
  replies: Map<string, { available: boolean }>;
};

/** Store dont on pilote les réponses à la main. */
class AccountStore extends SuperStore<FormAccountContract> implements Commands<AccountStore> {
  #probe: Probe;
  constructor(probe: Probe) {
    super({ contract: 'form-account', initialState: {} });
    this.#probe = probe;
  }
  register(input: Record<string, unknown>) {
    return new Promise<{ id: string }>((resolve, reject) => {
      this.#probe.sent.push({ command: 'register', input });
      this.#probe.next = {
        resolve,
        reject: (reason) => {
          try {
            this.fail(reason);
          } catch (failure) {
            reject(failure);
          }
        },
      };
    });
  }
  async checkEmail({ email }: { email: string }) {
    this.#probe.sent.push({ command: 'checkEmail', input: { email } });
    await Promise.resolve();
    return this.#probe.replies.get(email) ?? { available: true };
  }
}

function createAccount() {
  const probe: Probe = { sent: [], next: null, replies: new Map() };
  const store = AccountStore.create(probe);
  return { store, sent: probe.sent, replies: probe.replies, answer: () => probe.next! };
}

const type = (el: HTMLInputElement | HTMLTextAreaElement, value: string) => {
  el.value = value;
  el.dispatchEvent(new Event('input'));
};
const blur = (el: Element) => el.dispatchEvent(new Event('blur'));
const change = (el: Element) => el.dispatchEvent(new Event('change'));
const q = <T extends Element>(root: ParentNode, selector: string) => root.querySelector<T>(selector)!;

describe('form : champs', () => {
  test('chaque type de champ lit et écrit sa valeur', async () => {
    const { store } = createAccount();
    let values: Record<string, unknown> = {};
    class AllFields extends SuperElement {
      static tag = 't-form-all';
      account = this.contract('form-account');
      edit = this.form({
        initial: {
          name: 'Ada',
          age: null as number | null,
          bio: '',
          country: 'FR',
          languages: [] as string[],
          plan: 'free' as 'free' | 'pro',
          newsletter: false,
          interests: [] as string[],
          birthdate: '',
          volume: 50,
          avatar: null as File | null,
        },
        submit: { to: this.account, command: 'register', toInput: (v) => v },
        failures: { fields: {}, form: { 'email-taken': 'pris', network: 'réseau' } },
      });
      render() {
        const edit = this.edit;
        values = edit.values() as Record<string, unknown>;
        return html`
          <input class="name" ${edit.field('name')} />
          <input class="age" type="number" ${edit.field('age')} />
          <textarea class="bio" ${edit.field('bio')}></textarea>
          <select class="country" ${edit.field('country')}><option value="FR">FR</option><option value="BE">BE</option></select>
          <select class="languages" multiple ${edit.field('languages')}><option value="fr">fr</option><option value="en">en</option></select>
          <input class="free" type="radio" ${edit.field('plan', 'free')} />
          <input class="pro" type="radio" ${edit.field('plan', 'pro')} />
          <input class="newsletter" type="checkbox" ${edit.field('newsletter')} />
          <input class="sport" type="checkbox" ${edit.field('interests', 'sport')} />
          <input class="lecture" type="checkbox" ${edit.field('interests', 'lecture')} />
          <input class="birthdate" type="date" ${edit.field('birthdate')} />
          <input class="volume" type="range" min="0" max="100" ${edit.field('volume')} />
          <input class="avatar" type="file" ${edit.field('avatar')} />
        `;
      }
    }
    const { container: c } = await mount(AllFields, { stores: [store] });

    expect(q<HTMLInputElement>(c, '.name').value).toBe('Ada'); // valeur initiale écrite dans le champ
    expect(q<HTMLInputElement>(c, '.free').checked).toBe(true);

    type(q(c, '.name'), 'Grace');
    type(q(c, '.age'), '36');
    type(q(c, '.bio'), 'Pionnière');
    const country = q<HTMLSelectElement>(c, '.country');
    country.value = 'BE';
    change(country);
    const languages = q<HTMLSelectElement>(c, '.languages');
    languages.options[1]!.selected = true;
    change(languages);
    const pro = q<HTMLInputElement>(c, '.pro');
    pro.checked = true;
    change(pro);
    const newsletter = q<HTMLInputElement>(c, '.newsletter');
    newsletter.checked = true;
    change(newsletter);
    for (const box of ['.sport', '.lecture']) {
      const el = q<HTMLInputElement>(c, box);
      el.checked = true;
      change(el);
    }
    type(q(c, '.birthdate'), '1906-12-09');
    type(q(c, '.volume'), '80');
    const avatar = q<HTMLInputElement>(c, '.avatar');
    const file = new File(['x'], 'ada.png', { type: 'image/png' });
    Object.defineProperty(avatar, 'files', { value: [file], configurable: true });
    change(avatar);
    await flush();

    expect(values).toEqual({
      name: 'Grace',
      age: 36,
      bio: 'Pionnière',
      country: 'BE',
      languages: ['en'],
      plan: 'pro',
      newsletter: true,
      interests: ['sport', 'lecture'],
      birthdate: '1906-12-09',
      volume: 80,
      avatar: file,
    });

    type(q(c, '.age'), '');
    await flush();
    expect(values.age).toBeNull(); // un nombre vidé vaut null
  });
});

/** Un formulaire d'inscription complet, réutilisé par les tests suivants. */
function signup(options: { delay?: number } = {}) {
  return class Signup extends SuperElement {
    static tag = `t-form-signup-${Math.random().toString(36).slice(2)}`;
    account = this.contract('form-account');
    edit = this.form({
      initial: { email: '', password: '', confirm: '' },
      rules: {
        email: (v) => /.+@.+\..+/.test(v) || 'Adresse invalide',
        password: (v) => v.length >= 8 || '8 caractères minimum',
      },
      validate: (v) => (v.password === v.confirm ? {} : { confirm: 'Les mots de passe diffèrent' }),
      checks: {
        email: {
          command: 'checkEmail',
          toInput: (email) => ({ email }),
          accept: ({ available }) => available || 'Adresse déjà utilisée',
          delay: options.delay ?? 0,
        },
      },
      submit: { to: this.account, command: 'register', toInput: ({ email, password }) => ({ email, password }) },
      failures: { fields: { 'email-taken': { email: 'Déjà inscrit' } }, form: { network: 'Connexion impossible' } },
    });
    render() {
      const edit = this.edit;
      return html`
        <form ${edit.bind()}>
          <input class="email" ${edit.field('email')} /><p class="email-error">${edit.error('email')}</p>
          <span class="checking">${edit.checking('email') ? 'vérification' : ''}</span>
          <input class="password" ${edit.field('password')} /><p class="password-error">${edit.error('password')}</p>
          <input class="confirm" ${edit.field('confirm')} /><p class="confirm-error">${edit.error('confirm')}</p>
          <p class="form-error">${edit.formError()}</p>
          <button ?disabled=${edit.submitting()}>OK</button>
        </form>
      `;
    }
  };
}

const submitForm = (c: ParentNode) => q<HTMLFormElement>(c, 'form').dispatchEvent(new Event('submit', { cancelable: true }));
async function fillValid(c: ParentNode) {
  type(q(c, '.email'), 'ada@example.com');
  type(q(c, '.password'), 'longpassword');
  type(q(c, '.confirm'), 'longpassword');
  await flush();
  await flush();
}

describe('form : validation', () => {
  test('une erreur s’affiche après le premier passage dans le champ, pas avant', async () => {
    const { store } = createAccount();
    const { container: c } = await mount(signup(), { stores: [store] });

    type(q(c, '.email'), 'abc');
    await flush();
    expect(q(c, '.email-error').textContent).toBe('');

    blur(q(c, '.email'));
    await flush();
    expect(q(c, '.email-error').textContent).toBe('Adresse invalide');
  });

  test('soumettre un formulaire invalide affiche toutes les erreurs et n’envoie rien', async () => {
    const { store, sent } = createAccount();
    const { container: c } = await mount(signup(), { stores: [store] });

    type(q(c, '.password'), 'court');
    type(q(c, '.confirm'), 'autre');
    submitForm(c);
    await flush();

    expect(q(c, '.email-error').textContent).toBe('Adresse invalide');
    expect(q(c, '.password-error').textContent).toBe('8 caractères minimum');
    expect(q(c, '.confirm-error').textContent).toBe('Les mots de passe diffèrent');
    expect(sent.filter((s) => s.command === 'register')).toEqual([]);
  });
});

describe('form : soumission', () => {
  test('envoie la commande avec le body construit, et suit « en cours »', async () => {
    const { store, sent, answer } = createAccount();
    const { container: c } = await mount(signup(), { stores: [store] });
    await fillValid(c);

    submitForm(c);
    await flush();
    expect(sent.at(-1)).toEqual({ command: 'register', input: { email: 'ada@example.com', password: 'longpassword' } });
    expect(q<HTMLButtonElement>(c, 'button').disabled).toBe(true);

    answer().resolve({ id: '1' });
    await flush();
    expect(q<HTMLButtonElement>(c, 'button').disabled).toBe(false);
  });

  test('une raison rattachée à un champ s’affiche sur ce champ, et disparaît quand on le corrige', async () => {
    const { store, answer } = createAccount();
    const { container: c } = await mount(signup(), { stores: [store] });
    await fillValid(c);

    submitForm(c);
    await flush();
    answer().reject('email-taken');
    await flush();
    expect(q(c, '.email-error').textContent).toBe('Déjà inscrit');

    type(q(c, '.email'), 'grace@example.com');
    await flush();
    await flush();
    expect(q(c, '.email-error').textContent).toBe('');
  });

  test('une raison rattachée au formulaire s’affiche dans formError', async () => {
    const { store, answer } = createAccount();
    const { container: c } = await mount(signup(), { stores: [store] });
    await fillValid(c);

    submitForm(c);
    await flush();
    answer().reject('network');
    await flush();

    expect(q(c, '.form-error').textContent).toBe('Connexion impossible');
  });
});

describe('form : vérifications asynchrones', () => {
  test('la vérification valide ou refuse le champ', async () => {
    const { store, replies } = createAccount();
    replies.set('pris@example.com', { available: false });
    const { container: c } = await mount(signup(), { stores: [store] });

    type(q(c, '.email'), 'pris@example.com');
    await flush();
    await flush();

    expect(q(c, '.email-error').textContent).toBe('Adresse déjà utilisée');
  });

  test('pas de vérification pour une valeur déjà invalide, et une pause dans la frappe avant de vérifier', async () => {
    const { store, sent } = createAccount();
    const { container: c } = await mount(signup({ delay: 400 }), { stores: [store] });
    vi.useFakeTimers(); // après le montage : mount attend lui-même un setTimeout
    try {
      type(q(c, '.email'), 'abc');
      await vi.advanceTimersByTimeAsync(500);
      expect(sent).toEqual([]);

      type(q(c, '.email'), 'a@b.fr');
      await vi.advanceTimersByTimeAsync(100);
      type(q(c, '.email'), 'ab@b.fr');
      await vi.advanceTimersByTimeAsync(100);
      expect(q(c, '.checking').textContent).toBe('vérification');
      await vi.advanceTimersByTimeAsync(500);

      expect(sent).toEqual([{ command: 'checkEmail', input: { email: 'ab@b.fr' } }]); // une seule, la dernière valeur
    } finally {
      vi.useRealTimers();
    }
  });

  test('la soumission attend la fin des vérifications', async () => {
    const { store, sent } = createAccount();
    const { container: c } = await mount(signup({ delay: 400 }), { stores: [store] });
    vi.useFakeTimers(); // après le montage : mount attend lui-même un setTimeout
    try {
      type(q(c, '.email'), 'ada@example.com');
      type(q(c, '.password'), 'longpassword');
      type(q(c, '.confirm'), 'longpassword');

      submitForm(c);
      await vi.advanceTimersByTimeAsync(0);
      expect(sent.filter((s) => s.command === 'register')).toEqual([]);

      await vi.advanceTimersByTimeAsync(500);
      expect(sent.map((s) => s.command)).toEqual(['checkEmail', 'register']);
    } finally {
      vi.useRealTimers();
    }
  });
});

describe('form : listes et remise à zéro', () => {
  test('ajouter, retirer, et des erreurs qui restent attachées à leur ligne', async () => {
    const { store } = createAccount();
    class Phones extends SuperElement {
      static tag = 't-form-phones';
      account = this.contract('form-account');
      edit = this.form({
        initial: { phones: [{ number: '06 00 00 00 01' }, { number: 'x' }] },
        rules: { phones: { number: (v) => v.length >= 6 || 'Numéro invalide' } },
        submit: { to: this.account, command: 'register', toInput: (v) => v },
        failures: { fields: {}, form: { 'email-taken': 'pris', network: 'réseau' } },
      });
      phones = this.edit.list('phones');
      render() {
        const { edit, phones } = this;
        return html`
          <form ${edit.bind()}>
            ${repeat(
              phones.items(),
              (item) => item.key,
              (item) => html`
              <div class="row"><input ${item.field('number')} /><span class="err">${item.error('number')}</span>
              <button type="button" class="remove" @click=${() => phones.remove(item)}>x</button></div>
            `,
            )}
            <button type="button" class="add" @click=${() => phones.add({ number: '' })}>+</button>
          </form>
        `;
      }
    }
    const { container: c, element } = await mount(Phones, { stores: [store] });
    const api = (element as unknown as Phones).edit;

    submitForm(c);
    await flush();
    const errors = () => [...c.querySelectorAll('.err')].map((e) => e.textContent);
    expect(errors()).toEqual(['', 'Numéro invalide']);

    c.querySelectorAll<HTMLButtonElement>('.remove')[0]!.click(); // on retire la première ligne
    await flush();
    expect(errors()).toEqual(['Numéro invalide']); // l'erreur reste sur sa ligne, qui est maintenant la première

    q<HTMLButtonElement>(c, '.add').click();
    await flush();
    expect(c.querySelectorAll('.row')).toHaveLength(2);
    expect(api.values()).toEqual({ phones: [{ number: 'x' }, { number: '' }] });

    api.reset();
    await flush();
    expect(api.values()).toEqual({ phones: [{ number: '06 00 00 00 01' }, { number: 'x' }] });
    expect(errors()).toEqual(['', '']); // erreurs effacées
  });
});

describe('form : exception inattendue', () => {
  class CrashyStore extends SuperStore<FormCrashyContract> implements Commands<CrashyStore> {
    constructor() {
      super({ contract: 'form-crashy', initialState: {} });
    }
    async save(_: { name: string }) {
      throw new SyntaxError('réponse illisible');
    }
  }
  const crashy = () => CrashyStore.create();
  const Screen = (custom?: string) =>
    class Screen extends SuperElement {
      static tag = `t-form-crash-${custom ? 'custom' : 'default'}`;
      crashy = this.contract('form-crashy');
      edit = this.form({
        initial: { name: 'Ada' },
        submit: { to: this.crashy, command: 'save', toInput: (v) => v },
        failures: { fields: {}, form: custom ? { network: 'réseau', error: custom } : { network: 'réseau' } },
      });
      render() {
        return html`<form ${this.edit.bind()}><p class="form-error">${this.edit.formError()}</p></form>`;
      }
    };

  test('sans message prévu, formError affiche le message par défaut', async () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
    const { container: c } = await mount(Screen(), { stores: [crashy()] });
    submitForm(c);
    await flush();
    expect(q(c, '.form-error').textContent).toBe('Une erreur inattendue est survenue.');
    expect(consoleError).toHaveBeenCalledWith(expect.objectContaining({ message: 'réponse illisible' }));
    consoleError.mockRestore();
  });

  test('form.error remplace le message par défaut', async () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
    const { container: c } = await mount(Screen('Problème de notre côté'), { stores: [crashy()] });
    submitForm(c);
    await flush();
    expect(q(c, '.form-error').textContent).toBe('Problème de notre côté');
    consoleError.mockRestore();
  });
});

test('form : une vérification qui se termine sans issue (faux store) ne bloque pas la soumission', async () => {
  const account = fakeStore('form-account', { state: {} }); // checkEmail et register non implémentés : aucune issue publiée
  const { container: c } = await mount(signup(), { stores: [account] });
  await fillValid(c);

  submitForm(c);
  await flush();
  await flush();

  expect(account.sent.map((s) => s.name)).toEqual(['checkEmail', 'register']);
});

describe('form : aller à la première erreur', () => {
  const scrolled: Element[] = [];
  const original = HTMLElement.prototype.scrollIntoView;
  const spyScroll = () => {
    scrolled.length = 0;
    HTMLElement.prototype.scrollIntoView = function (this: Element) {
      scrolled.push(this);
    };
  };
  const restore = () => {
    HTMLElement.prototype.scrollIntoView = original;
  };

  test('une soumission bloquée centre le premier champ en erreur, dans l’ordre de la page, et lui donne le focus', async () => {
    spyScroll();
    try {
      const { store } = createAccount();
      const { container: c } = await mount(signup(), { stores: [store] });
      type(q(c, '.email'), 'ada@example.com'); // valide : le premier en erreur sera le mot de passe
      await flush();

      submitForm(c);
      await flush();

      expect(document.activeElement).toBe(q(c, '.password'));
      expect(scrolled).toEqual([q(c, '.password')]);
    } finally {
      restore();
    }
  });

  test('une erreur du serveur rattachée à un champ y amène aussi', async () => {
    spyScroll();
    try {
      const { store, answer } = createAccount();
      const { container: c } = await mount(signup(), { stores: [store] });
      await fillValid(c);
      q<HTMLInputElement>(c, '.confirm').focus();

      submitForm(c);
      await flush();
      answer().reject('email-taken');
      await flush();

      expect(document.activeElement).toBe(q(c, '.email'));
      expect(scrolled.at(-1)).toBe(q(c, '.email'));
    } finally {
      restore();
    }
  });

  test('scrollToError: false ne déplace rien', async () => {
    spyScroll();
    try {
      const { store } = createAccount();
      class Quiet extends SuperElement {
        static tag = 't-form-quiet';
        account = this.contract('form-account');
        edit = this.form({
          initial: { email: '' },
          rules: { email: (v) => v !== '' || 'Obligatoire' },
          scrollToError: false,
          submit: { to: this.account, command: 'register', toInput: (v) => v },
          failures: { fields: {}, form: { 'email-taken': 'pris', network: 'réseau' } },
        });
        render() {
          return html`<form ${this.edit.bind()}><input class="email" ${this.edit.field('email')} /><button class="go">OK</button></form>`;
        }
      }
      const { container: c } = await mount(Quiet, { stores: [store] });
      q<HTMLButtonElement>(c, '.go').focus();

      submitForm(c);
      await flush();

      expect(document.activeElement).toBe(q(c, '.go'));
      expect(scrolled).toEqual([]);
    } finally {
      restore();
    }
  });
});
