import { type Commands, SuperStore } from '@super-ts/core';
import { html, repeat, SuperElement } from '@super-ts/dom';
import { fakeStore, flush, mount } from '@super-ts/testing';
import { describe, expect, test, vi } from 'vitest';
import type { FormAccountContract, FormCrashyContract } from './__fixtures__/form-contracts.ts';
import './__fixtures__/form-contracts.ts';

/** What the test drives: commands received, response to the pending submission, responses to the checks. */
type Probe = {
  sent: Array<{ command: string; input: unknown }>;
  next: { resolve: (r: { id: string }) => void; reject: (reason: 'email-taken' | 'network') => void } | null;
  replies: Map<string, { available: boolean }>;
};

/** Store whose responses are driven by hand. */
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

describe('form: fields', () => {
  test('each field type reads and writes its value', async () => {
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
        failures: { fields: {}, form: { 'email-taken': 'taken', network: 'network' } },
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
          <input class="reading" type="checkbox" ${edit.field('interests', 'reading')} />
          <input class="birthdate" type="date" ${edit.field('birthdate')} />
          <input class="volume" type="range" min="0" max="100" ${edit.field('volume')} />
          <input class="avatar" type="file" ${edit.field('avatar')} />
        `;
      }
    }
    const { container: c } = await mount(AllFields, { stores: [store] });

    expect(q<HTMLInputElement>(c, '.name').value).toBe('Ada'); // initial value written into the field
    expect(q<HTMLInputElement>(c, '.free').checked).toBe(true);

    type(q(c, '.name'), 'Grace');
    type(q(c, '.age'), '36');
    type(q(c, '.bio'), 'Pioneer');
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
    for (const box of ['.sport', '.reading']) {
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
      bio: 'Pioneer',
      country: 'BE',
      languages: ['en'],
      plan: 'pro',
      newsletter: true,
      interests: ['sport', 'reading'],
      birthdate: '1906-12-09',
      volume: 80,
      avatar: file,
    });

    type(q(c, '.age'), '');
    await flush();
    expect(values.age).toBeNull(); // an emptied number is null
  });
});

/** A complete sign-up form, reused by the following tests. */
function signup(options: { delay?: number } = {}) {
  return class Signup extends SuperElement {
    static tag = `t-form-signup-${Math.random().toString(36).slice(2)}`;
    account = this.contract('form-account');
    edit = this.form({
      initial: { email: '', password: '', confirm: '' },
      rules: {
        email: (v) => /.+@.+\..+/.test(v) || 'Invalid address',
        password: (v) => v.length >= 8 || '8 characters minimum',
      },
      validate: (v) => (v.password === v.confirm ? {} : { confirm: 'The passwords differ' }),
      checks: {
        email: {
          command: 'checkEmail',
          toInput: (email) => ({ email }),
          accept: ({ available }) => available || 'Address already in use',
          delay: options.delay ?? 0,
        },
      },
      submit: { to: this.account, command: 'register', toInput: ({ email, password }) => ({ email, password }) },
      failures: { fields: { 'email-taken': { email: 'Already registered' } }, form: { network: 'Cannot connect' } },
    });
    render() {
      const edit = this.edit;
      return html`
        <form ${edit.bind()}>
          <input class="email" ${edit.field('email')} /><p class="email-error">${edit.error('email')}</p>
          <span class="checking">${edit.checking('email') ? 'checking' : ''}</span>
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

describe('form: validation', () => {
  test('an error is displayed after the first visit to the field, not before', async () => {
    const { store } = createAccount();
    const { container: c } = await mount(signup(), { stores: [store] });

    type(q(c, '.email'), 'abc');
    await flush();
    expect(q(c, '.email-error').textContent).toBe('');

    blur(q(c, '.email'));
    await flush();
    expect(q(c, '.email-error').textContent).toBe('Invalid address');
  });

  test('submitting an invalid form displays all the errors and sends nothing', async () => {
    const { store, sent } = createAccount();
    const { container: c } = await mount(signup(), { stores: [store] });

    type(q(c, '.password'), 'short');
    type(q(c, '.confirm'), 'other');
    submitForm(c);
    await flush();

    expect(q(c, '.email-error').textContent).toBe('Invalid address');
    expect(q(c, '.password-error').textContent).toBe('8 characters minimum');
    expect(q(c, '.confirm-error').textContent).toBe('The passwords differ');
    expect(sent.filter((s) => s.command === 'register')).toEqual([]);
  });
});

describe('form: submission', () => {
  test('sends the command with the built body, and tracks "pending"', async () => {
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

  test('a reason attached to a field is displayed on that field, and disappears when it is corrected', async () => {
    const { store, answer } = createAccount();
    const { container: c } = await mount(signup(), { stores: [store] });
    await fillValid(c);

    submitForm(c);
    await flush();
    answer().reject('email-taken');
    await flush();
    expect(q(c, '.email-error').textContent).toBe('Already registered');

    type(q(c, '.email'), 'grace@example.com');
    await flush();
    await flush();
    expect(q(c, '.email-error').textContent).toBe('');
  });

  test('a reason attached to the form is displayed in formError', async () => {
    const { store, answer } = createAccount();
    const { container: c } = await mount(signup(), { stores: [store] });
    await fillValid(c);

    submitForm(c);
    await flush();
    answer().reject('network');
    await flush();

    expect(q(c, '.form-error').textContent).toBe('Cannot connect');
  });
});

describe('form: asynchronous checks', () => {
  test('the check validates or rejects the field', async () => {
    const { store, replies } = createAccount();
    replies.set('taken@example.com', { available: false });
    const { container: c } = await mount(signup(), { stores: [store] });

    type(q(c, '.email'), 'taken@example.com');
    await flush();
    await flush();

    expect(q(c, '.email-error').textContent).toBe('Address already in use');
  });

  test('no check for a value that is already invalid, and a typing pause before checking', async () => {
    const { store, sent } = createAccount();
    const { container: c } = await mount(signup({ delay: 400 }), { stores: [store] });
    vi.useFakeTimers(); // after mounting: mount itself waits for a setTimeout
    try {
      type(q(c, '.email'), 'abc');
      await vi.advanceTimersByTimeAsync(500);
      expect(sent).toEqual([]);

      type(q(c, '.email'), 'a@b.fr');
      await vi.advanceTimersByTimeAsync(100);
      type(q(c, '.email'), 'ab@b.fr');
      await vi.advanceTimersByTimeAsync(100);
      expect(q(c, '.checking').textContent).toBe('checking');
      await vi.advanceTimersByTimeAsync(500);

      expect(sent).toEqual([{ command: 'checkEmail', input: { email: 'ab@b.fr' } }]); // only one, the last value
    } finally {
      vi.useRealTimers();
    }
  });

  test('the submission waits for the checks to finish', async () => {
    const { store, sent } = createAccount();
    const { container: c } = await mount(signup({ delay: 400 }), { stores: [store] });
    vi.useFakeTimers(); // after mounting: mount itself waits for a setTimeout
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

describe('form: lists and reset', () => {
  test('add, remove, and errors that stay attached to their row', async () => {
    const { store } = createAccount();
    class Phones extends SuperElement {
      static tag = 't-form-phones';
      account = this.contract('form-account');
      edit = this.form({
        initial: { phones: [{ number: '06 00 00 00 01' }, { number: 'x' }] },
        rules: { phones: { number: (v) => v.length >= 6 || 'Invalid number' } },
        submit: { to: this.account, command: 'register', toInput: (v) => v },
        failures: { fields: {}, form: { 'email-taken': 'taken', network: 'network' } },
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
    expect(errors()).toEqual(['', 'Invalid number']);

    c.querySelectorAll<HTMLButtonElement>('.remove')[0]!.click(); // remove the first row
    await flush();
    expect(errors()).toEqual(['Invalid number']); // the error stays on its row, which is now the first

    q<HTMLButtonElement>(c, '.add').click();
    await flush();
    expect(c.querySelectorAll('.row')).toHaveLength(2);
    expect(api.values()).toEqual({ phones: [{ number: 'x' }, { number: '' }] });

    api.reset();
    await flush();
    expect(api.values()).toEqual({ phones: [{ number: '06 00 00 00 01' }, { number: 'x' }] });
    expect(errors()).toEqual(['', '']); // errors cleared
  });
});

describe('form: unexpected exception', () => {
  class CrashyStore extends SuperStore<FormCrashyContract> implements Commands<CrashyStore> {
    constructor() {
      super({ contract: 'form-crashy', initialState: {} });
    }
    async save(_: { name: string }) {
      throw new SyntaxError('unreadable response');
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
        failures: { fields: {}, form: custom ? { network: 'network', error: custom } : { network: 'network' } },
      });
      render() {
        return html`<form ${this.edit.bind()}><p class="form-error">${this.edit.formError()}</p></form>`;
      }
    };

  test('without a provided message, formError displays the default message', async () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
    const { container: c } = await mount(Screen(), { stores: [crashy()] });
    submitForm(c);
    await flush();
    expect(q(c, '.form-error').textContent).toBe('An unexpected error occurred.');
    expect(consoleError).toHaveBeenCalledWith(expect.objectContaining({ message: 'unreadable response' }));
    consoleError.mockRestore();
  });

  test('form.error replaces the default message', async () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
    const { container: c } = await mount(Screen('Problem on our side'), { stores: [crashy()] });
    submitForm(c);
    await flush();
    expect(q(c, '.form-error').textContent).toBe('Problem on our side');
    consoleError.mockRestore();
  });
});

test('form: a check that ends without an outcome (fake store) does not block the submission', async () => {
  const account = fakeStore('form-account', { state: {} }); // checkEmail and register not implemented: no outcome published
  const { container: c } = await mount(signup(), { stores: [account] });
  await fillValid(c);

  submitForm(c);
  await flush();
  await flush();

  expect(account.sent.map((s) => s.name)).toEqual(['checkEmail', 'register']);
});

describe('form: go to the first error', () => {
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

  test('a blocked submission centres the first field in error, in page order, and focuses it', async () => {
    spyScroll();
    try {
      const { store } = createAccount();
      const { container: c } = await mount(signup(), { stores: [store] });
      type(q(c, '.email'), 'ada@example.com'); // valid: the first in error will be the password
      await flush();

      submitForm(c);
      await flush();

      expect(document.activeElement).toBe(q(c, '.password'));
      expect(scrolled).toEqual([q(c, '.password')]);
    } finally {
      restore();
    }
  });

  test('a server error attached to a field also leads there', async () => {
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

  test('scrollToError: false moves nothing', async () => {
    spyScroll();
    try {
      const { store } = createAccount();
      class Quiet extends SuperElement {
        static tag = 't-form-quiet';
        account = this.contract('form-account');
        edit = this.form({
          initial: { email: '' },
          rules: { email: (v) => v !== '' || 'Required' },
          scrollToError: false,
          submit: { to: this.account, command: 'register', toInput: (v) => v },
          failures: { fields: {}, form: { 'email-taken': 'taken', network: 'network' } },
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
