import { SuperElement } from '@super-ts/dom';
import { expectTypeOf, test } from 'vitest';
import './__fixtures__/form-contracts.ts';

test('form: types inferred from the initial values and the command', () => {
  class ProfileForm extends SuperElement {
    static tag = 'td-form';
    profile = this.contract('form-profile');
    edit = this.form({
      initial: {
        name: '',
        email: '',
        plan: 'free' as 'free' | 'pro',
        age: null as number | null,
        tags: [] as string[],
        phones: [{ label: 'mobile', number: '' }],
      },
      rules: {
        name: (v) => v.length > 0 || 'Required',
        age: (v) => v === null || v > 12 || 'Too young',
        phones: { number: (v) => v.length > 5 || 'Invalid number' },
      },
      validate: (v) => (v.name ? {} : { name: 'Required' }),
      checks: { email: { command: 'checkEmail', toInput: (email) => ({ email }), accept: ({ available }) => available || 'Taken' } },
      submit: { to: this.profile, command: 'save', toInput: ({ name, plan }) => ({ name, plan }) },
      failures: { fields: { 'email-taken': { email: 'Taken' } }, form: { network: 'Network', rate: 'Too many attempts', error: 'Oops' } },
    });

    render() {
      const edit = this.edit;
      edit.field('plan', 'pro');
      edit.field('tags', 'sport');
      edit.field('age');
      // @ts-expect-error unknown field
      edit.field('nope');
      // @ts-expect-error a list is not bound like a simple field
      edit.field('phones');
      // @ts-expect-error radio value outside the union
      edit.field('plan', 'gold');
      expectTypeOf(edit.values().age).toEqualTypeOf<number | null>();
      const phones = edit.list('phones');
      phones.add({ label: 'work', number: '' });
      // @ts-expect-error incomplete row
      phones.add({ label: 'work' });
      phones.items().map((item) => item.field('number'));
      return null;
    }
  }
  expectTypeOf<ProfileForm>().toHaveProperty('edit');
});

test('form: failures distributes exactly the command reasons', () => {
  class FailuresForm extends SuperElement {
    static tag = 'td-form-failures';
    profile = this.contract('form-profile');

    constructor() {
      super();
      const submit = { to: this.profile, command: 'save' as const, toInput: (v: { name: string; plan: string }) => v };
      const initial = { name: '', plan: 'free' };

      // @ts-expect-error forgotten reason (rate)
      this.form({ initial, submit, failures: { fields: { 'email-taken': { name: 'x' } }, form: { network: 'n' } } });
      this.form({
        initial,
        submit,
        // @ts-expect-error reason present twice
        failures: { fields: { network: { name: 'x' } }, form: { network: 'n', rate: 'r', 'email-taken': 'x' } },
      });
      // @ts-expect-error reason unknown to the contract
      this.form({ initial, submit, failures: { fields: { nope: { name: 'x' } }, form: { network: 'n', rate: 'r', 'email-taken': 'x' } } });
      // @ts-expect-error unknown field in fields
      this.form({ initial, submit, failures: { fields: { 'email-taken': { mail: 'x' } }, form: { network: 'n', rate: 'r' } } });
      this.form({
        initial: { name: '' },
        // @ts-expect-error submit input that does not produce the command body
        submit: { to: this.profile, command: 'save', toInput: (v) => ({ title: v.name }) },
        failures: { fields: {}, form: { network: 'n', rate: 'r', 'email-taken': 'x' } },
      });
      this.form({
        initial,
        submit,
        // @ts-expect-error check: wrong body
        checks: { name: { command: 'checkEmail', toInput: (n) => ({ mail: n }), accept: () => true } },
        failures: { fields: {}, form: { network: 'n', rate: 'r', 'email-taken': 'x' } },
      });
    }

    render() {
      return null;
    }
  }
  expectTypeOf<FailuresForm>().toHaveProperty('profile');
});
