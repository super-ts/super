import { SuperElement } from '@super-ts/dom';
import { expectTypeOf, test } from 'vitest';
import './__fixtures__/form-contracts';

test('form : types inférés des valeurs initiales et de la commande', () => {
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
        name: (v) => v.length > 0 || 'Obligatoire',
        age: (v) => v === null || v > 12 || 'Trop jeune',
        phones: { number: (v) => v.length > 5 || 'Numéro invalide' },
      },
      validate: (v) => (v.name ? {} : { name: 'Obligatoire' }),
      checks: { email: { command: 'checkEmail', toInput: (email) => ({ email }), accept: ({ available }) => available || 'Pris' } },
      submit: { to: this.profile, command: 'save', toInput: ({ name, plan }) => ({ name, plan }) },
      failures: { fields: { 'email-taken': { email: 'Pris' } }, form: { network: 'Réseau', rate: 'Trop de tentatives', error: 'Oups' } },
    });

    render() {
      const edit = this.edit;
      edit.field('plan', 'pro');
      edit.field('tags', 'sport');
      edit.field('age');
      // @ts-expect-error champ inconnu
      edit.field('nope');
      // @ts-expect-error une liste ne se lie pas comme un champ simple
      edit.field('phones');
      // @ts-expect-error valeur de radio hors de l'union
      edit.field('plan', 'gold');
      expectTypeOf(edit.values().age).toEqualTypeOf<number | null>();
      const phones = edit.list('phones');
      phones.add({ label: 'travail', number: '' });
      // @ts-expect-error ligne incomplète
      phones.add({ label: 'travail' });
      phones.items().map((item) => item.field('number'));
      return null;
    }
  }
  expectTypeOf<ProfileForm>().toHaveProperty('edit');
});

test('form : failures répartit exactement les raisons de la commande', () => {
  class FailuresForm extends SuperElement {
    static tag = 'td-form-failures';
    profile = this.contract('form-profile');

    constructor() {
      super();
      const submit = { to: this.profile, command: 'save' as const, toInput: (v: { name: string; plan: string }) => v };
      const initial = { name: '', plan: 'free' };

      // @ts-expect-error raison oubliée (rate)
      this.form({ initial, submit, failures: { fields: { 'email-taken': { name: 'x' } }, form: { network: 'n' } } });
      this.form({
        initial,
        submit,
        // @ts-expect-error raison présente deux fois
        failures: { fields: { network: { name: 'x' } }, form: { network: 'n', rate: 'r', 'email-taken': 'x' } },
      });
      // @ts-expect-error raison inconnue du contrat
      this.form({ initial, submit, failures: { fields: { nope: { name: 'x' } }, form: { network: 'n', rate: 'r', 'email-taken': 'x' } } });
      // @ts-expect-error champ inconnu dans fields
      this.form({ initial, submit, failures: { fields: { 'email-taken': { mail: 'x' } }, form: { network: 'n', rate: 'r' } } });
      this.form({
        initial: { name: '' },
        // @ts-expect-error input de submit qui ne produit pas le body de la commande
        submit: { to: this.profile, command: 'save', toInput: (v) => ({ nom: v.name }) },
        failures: { fields: {}, form: { network: 'n', rate: 'r', 'email-taken': 'x' } },
      });
      this.form({
        initial,
        submit,
        // @ts-expect-error check : body faux
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
