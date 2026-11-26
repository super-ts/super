import { html, SuperElement } from '@super-ts/dom';
import { fakeStore, flush, mount } from '@super-ts/testing';
import { Checkbox, Field, fieldOf, RadioGroup, Select } from '@super-ts/ui';
import { describe, expect, test } from 'vitest';
import './__fixtures__/ui-contracts';

class Profile extends SuperElement {
  static tag = 'ui-t-profile';
  library = this.contract('ui-library');
  edit = this.form({
    initial: { name: '', age: null as number | null, country: 'FR', newsletter: false, tags: [] as string[], plan: 'free' },
    rules: { name: (v) => v.trim() !== '' || 'Nom obligatoire' },
    checks: {
      name: { command: 'checkName', toInput: (name) => ({ name }), accept: ({ available }) => available || 'Déjà pris', delay: 0 },
    },
    submit: { to: this.library, command: 'save', toInput: (values) => values },
    failures: { fields: {}, form: { network: 'Connexion impossible' } },
  });

  render() {
    const { edit } = this;
    return html`<form ${edit.bind()}>
      ${Field.create({ field: fieldOf(edit, 'name'), label: 'Nom', hint: 'Tel qu’affiché' })}
      ${Field.create({ field: fieldOf(edit, 'age'), label: 'Âge', type: 'number' })}
      ${Select.create({
        field: fieldOf(edit, 'country'),
        label: 'Pays',
        options: [
          { value: 'FR', label: 'France' },
          { value: 'BE', label: 'Belgique' },
        ],
      })}
      ${Checkbox.create({ field: fieldOf(edit, 'newsletter'), label: 'Newsletter' })}
      ${Checkbox.create({ field: fieldOf(edit, 'tags'), label: 'Sport', value: 'sport' })}
      ${RadioGroup.create({
        field: fieldOf(edit, 'plan'),
        label: 'Offre',
        options: [
          { value: 'free', label: 'Gratuite' },
          { value: 'pro', label: 'Pro' },
        ],
      })}
      <button type="submit">Enregistrer</button>
    </form>`;
  }
}

const type = (input: HTMLInputElement, value: string) => {
  input.value = value;
  input.dispatchEvent(new Event('input', { bubbles: true }));
};

describe('champs reliés à un formulaire', () => {
  async function setup() {
    const library = fakeStore('ui-library', {
      state: { books: [], total: 0, suggestions: [] },
      commands: { checkName: async () => ({ available: true }), save: async () => ({ id: '1' }) },
    });
    const { container, element } = await mount(Profile, { stores: [library] });
    const byLabel = (text: string) => {
      const label = [...container.querySelectorAll('label, legend')].find((l) => l.textContent!.trim() === text)!;
      return container.querySelector<HTMLInputElement>(`#${label.getAttribute('for')}`)!;
    };
    return { container, element, library, byLabel };
  }

  test('le libellé désigne le champ, l’aide le décrit', async () => {
    const { container, byLabel } = await setup();
    const name = byLabel('Nom');
    expect(name.tagName).toBe('INPUT');
    const hint = container.querySelector('.super-field-hint')!;
    expect(name.getAttribute('aria-describedby')).toBe(hint.id);
    expect(name.hasAttribute('aria-invalid')).toBe(false);
  });

  test('la saisie remplit le formulaire, avec le type de chaque champ', async () => {
    const { element, byLabel } = await setup();
    type(byLabel('Nom'), 'Ada');
    type(byLabel('Âge'), '36');
    const country = byLabel('Pays') as unknown as HTMLSelectElement;
    country.value = 'BE';
    country.dispatchEvent(new Event('change', { bubbles: true }));
    byLabel('Newsletter').click();
    byLabel('Sport').click();
    await flush();

    expect(element.edit.values()).toMatchObject({ name: 'Ada', age: 36, country: 'BE', newsletter: true, tags: ['sport'] });
  });

  test('un radio par option, dans un fieldset dont le libellé est la légende', async () => {
    const { container, element } = await setup();
    const radios = container.querySelectorAll<HTMLInputElement>('.super-radio-group input[type=radio]');
    expect(container.querySelector('.super-radio-group legend')!.textContent).toBe('Offre');
    expect([...radios].map((r) => r.checked)).toEqual([true, false]);
    radios[1]!.click();
    await flush();
    expect(element.edit.values().plan).toBe('pro');
  });

  test('l’erreur de la règle s’affiche sous le champ, qui devient invalide et décrit par elle', async () => {
    const { container, byLabel } = await setup();
    container.querySelector('form')!.requestSubmit();
    await flush();

    const name = byLabel('Nom');
    const error = container.querySelector('.super-field-error')!;
    expect(error.textContent).toBe('Nom obligatoire');
    expect(name.getAttribute('aria-invalid')).toBe('true');
    expect(name.getAttribute('aria-describedby')!.split(' ')).toContain(error.id);
  });
});
